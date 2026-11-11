// Live market feeds (server side). All sources are free and need no API key:
//   candles  - Yahoo Finance chart endpoint
//   gold/silver spot quote - Swissquote public feed (used to shift futures candles onto spot prices)
//   red news - ForexFactory weekly calendar export
import { INST, CURS, USD_MAJORS, mt4OffsetSec } from '../public/lib/core.js';
import { aggregate } from '../public/lib/indicators.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

/* ---------- tiny in-memory cache (lives as long as the server instance stays warm) ---------- */
// bucketMs: data fetched before the latest candle boundary is never reused, otherwise a candle
// could be judged "finished" on a price that was read before it actually closed.
const mem = new Map();
export function cached(key, ttlMs, fn, bucketMs = 0) {
  const hit = mem.get(key), now = Date.now();
  if (hit && now - hit.at < ttlMs && (!bucketMs || Math.floor(hit.at / bucketMs) === Math.floor(now / bucketMs))) return hit.p;
  const p = Promise.resolve().then(fn);
  mem.set(key, { at: now, p });
  p.catch(() => { if (mem.get(key)?.p === p) mem.delete(key); });
  return p;
}
export const clearCache = () => mem.clear();

async function getJson(url, ms = 9000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Ask the first host; if it has not answered after delayMs (or fails), ask the next one too.
// The first good answer wins. Keeps a scan fast when one host is slow.
function hedged(run, hosts, delayMs) {
  return new Promise((resolve, reject) => {
    let left = hosts.length, started = 0, done = false, lastErr;
    const start = () => {
      if (done || started >= hosts.length) return;
      run(hosts[started++]).then(
        v => { if (!done) { done = true; resolve(v); } },
        e => { lastErr = e; if (--left === 0) { if (!done) reject(lastErr); } else start(); },
      );
    };
    start();
    setTimeout(start, delayMs);
  });
}

/* ---------- Yahoo candles ---------- */
async function yahooChart(ticker, interval, range) {
  const one = async host => {
    const j = await getJson(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`, 8000);
    const r = j?.chart?.result?.[0];
    if (!r || !r.timestamp) throw new Error(j?.chart?.error?.description || 'empty result');
    const q = r.indicators.quote[0], bars = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null) continue; // gaps come back as nulls
      bars.push({ t: r.timestamp[i], o, h, l, c });
    }
    if (!bars.length) throw new Error('no candles');
    return { bars, price: r.meta.regularMarketPrice ?? bars[bars.length - 1].c, gmtoffset: r.meta.gmtoffset || 0 };
  };
  try { return await hedged(one, YAHOO_HOSTS, 1500); }
  catch (e) { throw new Error(`${ticker} ${interval}: ${e?.message || 'feed error'}`); }
}

// Yahoo appends the live tick as an extra element. Fold everything into clean buckets and
// split into finished candles and the one still forming.
export function normalise(bars, keyOf, startOf, lengthSec, nowSec) {
  const all = aggregate(bars, keyOf, startOf);
  const closed = [], forming = [];
  for (const k of all) (k.t + lengthSec <= nowSec ? closed : forming).push(k);
  return { closed, forming: forming[forming.length - 1] || null };
}

const RANGE = { M15: ['15m', '10d', 900, 50e3], H1: ['60m', '1mo', 3600, 55e3], D1: ['1d', '1y', 86400, 600e3] };

// Cut H1 candles into H4 candles on the MT4 server clock (Paris + 1h).
const offCache = new Map();
function mt4Off(t) {
  const day = Math.floor(t / 86400);
  let o = offCache.get(day);
  if (o === undefined) { o = mt4OffsetSec(new Date(t * 1000)); offCache.set(day, o); }
  return o;
}

// Spot quote used to move futures candles (gold, silver) onto the spot prices MT4 shows.
async function spotMid(base, quote) {
  const j = await getJson(`https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${base}/${quote}`, 6000);
  const p = j?.[0]?.spreadProfilePrices?.[0];
  if (!p) throw new Error('no spot quote');
  return (p.bid + p.ask) / 2;
}

async function rawSeries(sym, tf) {
  const inst = INST[sym], [interval, range, , ttl] = RANGE[tf];
  return cached(`y:${sym}:${tf}`, ttl, async () => {
    const data = await yahooChart(inst.feed, interval, range);
    let basis = 0, basisNote = null;
    if (inst.cls === 'metal') {
      try {
        const spot = await cached(`spot:${sym}`, 55e3, () => spotMid(inst.base, inst.quote));
        const b = data.price - spot;
        if (Math.abs(b) / spot < 0.03) { basis = b; basisNote = 'futures candles shifted onto the spot price'; }
      } catch { basisNote = 'futures prices (spot quote unavailable)'; }
    }
    if (basis) for (const k of data.bars) { k.o -= basis; k.h -= basis; k.l -= basis; k.c -= basis; }
    return { bars: data.bars, price: data.price - basis, gmtoffset: data.gmtoffset, basisNote };
  }, tf === 'D1' ? 0 : RANGE[tf][2] * 1000);
}

// Finished candles + the forming one for a symbol and chart (M15, H1, H4, D1).
export async function getSeries(sym, tf, nowSec = Math.floor(Date.now() / 1000)) {
  if (tf === 'H4') {
    const h1 = await getSeries(sym, 'H1', nowSec);
    const src = h1.forming ? [...h1.closed, h1.forming] : h1.closed;
    const key = t => Math.floor((t + mt4Off(t)) / 14400);
    const all = aggregate(src, key);
    // bucket start on the MT4 clock, expressed back in UTC seconds
    for (const k of all) { const b = key(k.t); k.t = b * 14400 - mt4Off(k.t); }
    all.shift(); // first bucket is usually cut off by the data range
    const closed = all.filter(k => k.t + 14400 <= nowSec), forming = all.filter(k => k.t + 14400 > nowSec).pop() || null;
    return { ...h1, closed, forming };
  }
  const raw = await rawSeries(sym, tf), len = RANGE[tf][2];
  const key = tf === 'D1' ? t => Math.floor((t + raw.gmtoffset) / 86400) : t => Math.floor(t / len);
  const start = tf === 'D1' ? b => b * 86400 - raw.gmtoffset : b => b * len;
  const { closed, forming } = normalise(raw.bars, key, start, len, nowSec);
  return { closed, forming, price: raw.price, basisNote: raw.basisNote };
}

/* ---------- currency strength (live, from the seven USD pairs) ---------- */
export async function getStrength(nowSec) {
  const series = await Promise.all(USD_MAJORS.map(s => getSeries(s, 'H1', nowSec)));
  const ref = series[0], refBars = ref.forming ? [...ref.closed, ref.forming] : ref.closed;
  if (refBars.length < 130) throw new Error('not enough history for strength');
  // value of each currency in USD at time t
  const valueAt = t => {
    const v = { USD: 1 };
    USD_MAJORS.forEach((sym, n) => {
      const s = series[n], bars = s.forming ? [...s.closed, s.forming] : s.closed;
      let k = bars[bars.length - 1];
      if (t != null) for (let i = bars.length - 1; i >= 0; i--) if (bars[i].t <= t) { k = bars[i]; break; }
      const inst = INST[sym];
      v[inst.base === 'USD' ? inst.quote : inst.base] = inst.base === 'USD' ? 1 / k.c : k.c;
    });
    return v;
  };
  const now = valueAt(null), out = {};
  for (const [name, hours] of Object.entries({ d1: 24, w1: 120 })) {
    const then = valueAt(refBars[refBars.length - 1 - hours].t);
    for (const c of CURS) {
      let sum = 0;
      for (const o of CURS) if (o !== c) sum += ((now[c] / now[o]) / (then[c] / then[o]) - 1) * 100;
      (out[c] = out[c] || {})[name] = +(sum / (CURS.length - 1)).toFixed(3);
    }
  }
  return out;
}

/* ---------- red news ---------- */
export async function getCalendar() {
  return cached('ff', 20 * 60e3, async () => {
    const j = await getJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json', 9000);
    return j
      .filter(e => /high/i.test(e.impact || ''))
      .map(e => { const d = new Date(e.date); return isNaN(d) ? null : { cur: e.country, title: e.title, t: d.toISOString() }; })
      .filter(Boolean)
      .sort((a, b) => a.t.localeCompare(b.t));
  });
}

// Run tasks with limited parallelism so the free data source is not hammered.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
