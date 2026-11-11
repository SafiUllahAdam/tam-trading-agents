import test from 'node:test';
import assert from 'node:assert/strict';
import { INST, mt4OffsetSec, forexClosed, riskFor } from '../public/lib/core.js';
import { heikinAshi, haColor, smma, alligator, atr, rsi, swings, waves, structure, aggregate, divergence } from '../public/lib/indicators.js';
import { readBig, readEntry, analyse, CFG } from '../lib/agents.js';
import { normalise } from '../lib/feeds.js';

// Build candles from a list of closes: open = previous close, small wicks.
const mk = (closes, sec = 3600, wick = 0.0002, t0 = 1_700_000_000) => closes.map((c, i) => {
  const o = i ? closes[i - 1] : c - 0.0005;
  return { t: t0 + i * sec, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c };
});
// Staircase: `up` rising steps then `down` falling steps, repeated.
function stairs(start, cycles, up = 6, down = 3, upStep = 0.0010, downStep = 0.0006) {
  const out = []; let p = start;
  for (let k = 0; k < cycles; k++) {
    for (let i = 0; i < up; i++) out.push(p += upStep);
    for (let i = 0; i < down; i++) out.push(p -= downStep);
  }
  return out;
}
const flip = closes => closes.map(c => 2.4 - c); // mirror an uptrend into a downtrend
// Staircase with dips deep enough (36 pips) to count as real waves.
const deep = (start, cycles) => stairs(start, cycles, 6, 3, 0.0010, 0.0012);
const EUR = INST.EURUSD;

test('smma is seeded with a simple average, then smoothed', () => {
  const s = smma([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(s.slice(0, 2), [null, null]);
  assert.equal(s[2], 2);
  assert.ok(Math.abs(s[3] - (2 * 2 + 4) / 3) < 1e-12);
  assert.ok(Math.abs(s[4] - (s[3] * 2 + 5) / 3) < 1e-12);
});

test('alligator lines carry their forward shift (8 / 5 / 3 bars)', () => {
  const c = mk(stairs(1.1, 10));
  const med = c.map(k => (k.h + k.l) / 2), al = alligator(c), i = c.length - 1;
  assert.equal(al[i].jaw, smma(med, 13)[i - 8]);
  assert.equal(al[i].teeth, smma(med, 8)[i - 5]);
  assert.equal(al[i].lips, smma(med, 5)[i - 3]);
});

test('heikin ashi: close is the 4-price average, open is the midpoint of the previous HA body', () => {
  const c = mk([1.10, 1.11, 1.12]), ha = heikinAshi(c);
  assert.ok(Math.abs(ha[1].c - (c[1].o + c[1].h + c[1].l + c[1].c) / 4) < 1e-12);
  assert.ok(Math.abs(ha[1].o - (ha[0].o + ha[0].c) / 2) < 1e-12);
  assert.equal(haColor(ha[2]), 'green');
});

test('swings alternate and a staircase reads as higher highs + higher lows', () => {
  const sw = swings(mk(stairs(1.1, 8)));
  for (let i = 1; i < sw.length; i++) assert.notEqual(sw[i].type, sw[i - 1].type);
  assert.equal(structure(sw).type, 'up');
  assert.equal(structure(swings(mk(flip(stairs(1.1, 8))))).type, 'down');
});

test('rsi stays within 0..100 and is high in a steady rise', () => {
  const r = rsi(mk(stairs(1.1, 8)));
  const last = r[r.length - 4];
  assert.ok(last > 55 && last <= 100);
  assert.equal(atr(mk([1, 2, 3]))[2], null); // not enough candles
});

test('divergence needs the extreme zone', () => {
  const c = mk(stairs(1.1, 8)), sw = swings(c);
  const fake = new Array(c.length).fill(50), hs = sw.filter(s => s.type === 'H').slice(-2);
  fake[hs[0].i] = 60; fake[hs[1].i] = 55;
  assert.equal(divergence(c, sw, fake), null); // lower RSI high, but never above 70
  fake[hs[0].i] = 78;
  assert.equal(divergence(c, sw, fake), 'bearish');
});

test('aggregate + normalise fold the live tick into the forming candle', () => {
  const bars = [{ t: 0, o: 1, h: 2, l: 0.5, c: 1.5 }, { t: 3600, o: 1.5, h: 1.8, l: 1.4, c: 1.7 }, { t: 7200, o: 1.7, h: 1.9, l: 1.6, c: 1.8 }, { t: 7300, o: 1.8, h: 2.1, l: 1.75, c: 2.0 }];
  const { closed, forming } = normalise(bars, t => Math.floor(t / 3600), b => b * 3600, 3600, 7400);
  assert.equal(closed.length, 2);
  assert.deepEqual([forming.t, forming.o, forming.h, forming.l, forming.c], [7200, 1.7, 2.1, 1.6, 2.0]);
  assert.equal(aggregate(bars, t => Math.floor(t / 7200)).length, 2);
});

test('MT4 clock = Paris + 1h (winter UTC+2, summer UTC+3)', () => {
  assert.equal(mt4OffsetSec(new Date('2026-01-15T12:00:00Z')), 7200);
  assert.equal(mt4OffsetSec(new Date('2026-07-15T12:00:00Z')), 10800);
});

test('forex week: closed on Saturday, open on Wednesday', () => {
  assert.equal(forexClosed(new Date('2026-11-14T12:00:00Z')), true);
  assert.equal(forexClosed(new Date('2026-11-11T12:00:00Z')), false);
  assert.equal(riskFor('NAS100', 'H1'), 0.5);
  assert.equal(riskFor('EURUSD', 'H1'), 0.6);
});

test('Scout: clean uptrend on the bigger chart = BUY only; choppy flat = asleep', () => {
  const up = deep(1.1, 12); up.push(...[1, 2, 3, 4, 5, 6].map(k => up[up.length - 1] + k * 0.001)); // finish on a rising leg
  const b = readBig(mk(up, 14400), EUR, 'H4');
  assert.equal(b.dir, 'BUY');
  assert.ok(b.checks.every(x => x.ok), JSON.stringify(b.checks));
  const dn = readBig(mk(flip(up), 14400), EUR, 'H4');
  assert.equal(dn.dir, 'SELL');
  assert.ok(dn.checks.every(x => x.ok), JSON.stringify(dn.checks));
  const flat = []; for (let i = 0; i < 120; i++) flat.push(1.1 + (i % 2 ? 0.0004 : -0.0004));
  const f = readBig(mk(flat, 14400), EUR, 'H4');
  assert.ok(f.dir === null || f.checks.some(x => x.ok === false));
});

// Entry chart: staircase up to a peak P, a 3-candle dip, then candles climbing back through P.
function entrySeries(tail) {
  const base = deep(1.1, 10); // ends after a dip
  const run = [1, 2, 3, 4, 5, 6].map(k => base[base.length - 1] + k * 0.001); // rising leg, last value is the peak
  const P = run[run.length - 1];
  const dip = [P - 0.0010, P - 0.0020, P - 0.0030];
  return { closes: [...base, ...run, ...dip, ...tail(P)], P };
}
const nowFor = c => c[c.length - 1].t + 3600 + 60; // one minute after the last candle finished

test('Strategist: first candle finishing above the last peak = TRIGGER, stop below the dip, target 1:1', () => {
  const { closes, P } = entrySeries(P => [P - 0.0018, P - 0.0006, P + 0.0004]);
  const c = mk(closes), e = readEntry(c, 'BUY', EUR, 'H1', 3600, closes[closes.length - 1], nowFor(c));
  assert.equal(e.stage, 'TRIGGER', e.why);
  assert.ok(Math.abs(e.level - (P + 0.0002)) < 1e-9, 'level is the high of the peak candle');
  const dipLow = P - 0.0030 - 0.0002;
  assert.ok(e.sl < dipLow && e.sl > dipLow - 0.0006, `stop ${e.sl} sits a few pips under the dip ${dipLow}`);
  assert.ok(Math.abs((e.tp - e.entry) - (e.entry - e.sl)) < 1e-9, 'target is 1:1');
  assert.ok(e.checks.find(x => x.id === 'trigger').ok === true);
});

test('Strategist: no close past the level = WATCH; two closes past = LATE; stale candle = LATE', () => {
  const w = entrySeries(P => [P - 0.0018, P - 0.0006]);
  const cw = mk(w.closes);
  assert.equal(readEntry(cw, 'BUY', EUR, 'H1', 3600, w.closes.at(-1), nowFor(cw)).stage, 'WATCH');
  const l = entrySeries(P => [P - 0.0018, P - 0.0006, P + 0.0004, P + 0.0008]);
  const cl = mk(l.closes);
  assert.equal(readEntry(cl, 'BUY', EUR, 'H1', 3600, l.closes.at(-1), nowFor(cl)).stage, 'LATE');
  const t = entrySeries(P => [P - 0.0018, P - 0.0006, P + 0.0004]);
  const ct = mk(t.closes);
  assert.equal(readEntry(ct, 'BUY', EUR, 'H1', 3600, t.closes.at(-1), nowFor(ct) + 3 * 3600).stage, 'LATE');
});

test('Strategist: breakout that already ran more than 10 pips is not chased', () => {
  const { closes } = entrySeries(P => [P - 0.0018, P - 0.0006, P + 0.0015]);
  const c = mk(closes), e = readEntry(c, 'BUY', EUR, 'H1', 3600, closes.at(-1), nowFor(c));
  assert.equal(e.stage, 'LATE');
  assert.match(e.why, /pips past/);
});

test('Strategist: SELL is the exact mirror', () => {
  const { closes } = entrySeries(P => [P - 0.0018, P - 0.0006, P + 0.0004]);
  const m = flip(closes), c = mk(m), e = readEntry(c, 'SELL', EUR, 'H1', 3600, m.at(-1), nowFor(c));
  assert.equal(e.stage, 'TRIGGER', e.why);
  assert.ok(e.sl > e.entry && e.tp < e.entry);
});

test('analyse: no trade when the bigger chart is asleep; full item when it triggers', () => {
  const up = deep(1.1, 12); up.push(...[1, 2, 3, 4, 5, 6].map(k => up[up.length - 1] + k * 0.001));
  const big = { closed: mk(up, 14400), price: up.at(-1) };
  const { closes } = entrySeries(P => [P - 0.0018, P - 0.0006, P + 0.0004]);
  const ec = mk(closes), entry = { closed: ec, price: closes.at(-1) };
  const x = analyse('EURUSD', 'H1', big, entry, nowFor(ec));
  assert.equal(x.stage, 'TRIGGER', x.why);
  assert.equal(x.dir, 'BUY');
  assert.ok(x.sig && x.spark.length === CFG.sparkBars && [1, 2, 3].includes(x.scenario) && x.lecture.text);
  const flat = []; for (let i = 0; i < 120; i++) flat.push(1.1 + (i % 2 ? 0.0004 : -0.0004));
  const none = analyse('EURUSD', 'H1', { closed: mk(flat, 14400), price: 1.1 }, entry, nowFor(ec));
  assert.equal(none.stage, 'NONE');
});

test('waves ignore two-candle wiggles: a strong rise with two near-equal micro peaks is still an uptrend', () => {
  // the USDCAD case: price climbs, pauses with two tiny peaks 1 pip apart, then makes a new high
  const closes = deep(1.1, 8);
  let p = closes.at(-1);
  for (let k = 0; k < 6; k++) closes.push(p += 0.0010);          // rising leg
  closes.push(p -= 0.0003, p += 0.0002, p -= 0.0003, p += 0.0002); // pause: second micro peak is lower
  closes.push(p += 0.0004, p += 0.0004);                          // new high in progress
  const c = mk(closes);
  const w = waves(c, 2);
  assert.equal(w.at(-1).live, true);
  assert.equal(structure(w, 0.00015).type, 'up');
  for (let i = 1; i < w.length; i++) assert.notEqual(w[i].type, w[i - 1].type);
});

test('structure: equal peaks are not higher; an unfinished pullback changes nothing; a broken dip ends the staircase', () => {
  const H = (price, live) => ({ type: 'H', price, live }), L = (price, live) => ({ type: 'L', price, live });
  assert.equal(structure([L(1.10), H(1.12), L(1.11), H(1.1201)], 0.0005).type, 'side'); // double top
  assert.equal(structure([L(1.10), H(1.12), L(1.11), H(1.13), L(1.125, true)]).type, 'up'); // pullback above the last dip
  assert.equal(structure([L(1.10), H(1.12), L(1.11), H(1.13), L(1.105, true)]).type, 'side'); // pullback broke the last dip
  assert.equal(structure([H(1.13), L(1.11), H(1.12), L(1.10), H(1.105, true)]).type, 'down'); // bounce below the last peak
});
