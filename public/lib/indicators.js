// Pure chart maths. A candle is { t, o, h, l, c } with t = open time in seconds (UTC).

export const median = k => (k.h + k.l) / 2;

// Heikin Ashi (smoothed candles). Used only for direction and colour, never for prices.
export function heikinAshi(c) {
  const out = [];
  for (let i = 0; i < c.length; i++) {
    const k = c[i];
    const close = (k.o + k.h + k.l + k.c) / 4;
    const open = i === 0 ? (k.o + k.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: k.t, o: open, h: Math.max(k.h, open, close), l: Math.min(k.l, open, close), c: close });
  }
  return out;
}
export const haColor = k => (k.c >= k.o ? 'green' : 'red');

// Smoothed moving average, as MT4 computes it (seeded with a simple average).
export function smma(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  out[n - 1] = sum / n;
  for (let i = n; i < values.length; i++) out[i] = (out[i - 1] * (n - 1) + values[i]) / n;
  return out;
}

// Bill Williams Alligator on median price: Jaw 13 shifted 8, Teeth 8 shifted 5, Lips 5 shifted 3.
// Returns the value each line shows under bar i (the forward shift is already applied).
export function alligator(c) {
  const med = c.map(median);
  const j = smma(med, 13), t = smma(med, 8), l = smma(med, 5);
  const at = (arr, i, shift) => (i - shift >= 0 ? arr[i - shift] : null);
  return c.map((_, i) => ({ jaw: at(j, i, 8), teeth: at(t, i, 5), lips: at(l, i, 3) }));
}

// Average true range (Wilder).
export function atr(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  const tr = c.map((k, i) => (i === 0 ? k.h - k.l : Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c))));
  let sum = 0;
  for (let i = 1; i <= n; i++) sum += tr[i];
  out[n] = sum / n;
  for (let i = n + 1; i < c.length; i++) out[i] = (out[i - 1] * (n - 1) + tr[i]) / n;
  return out;
}

// RSI (Wilder), default 14.
export function rsi(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let up = 0, dn = 0;
  for (let i = 1; i <= n; i++) { const d = c[i].c - c[i - 1].c; if (d > 0) up += d; else dn -= d; }
  up /= n; dn /= n;
  out[n] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i].c - c[i - 1].c;
    up = (up * (n - 1) + Math.max(d, 0)) / n; dn = (dn * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}

// RSI divergence between the last two peaks (bearish) or the last two dips (bullish).
// As taught, it only counts when RSI was in the extreme zone: above 70 or below 30.
export function divergence(c, sw, r = rsi(c)) {
  const hs = sw.filter(s => s.type === 'H').slice(-2), ls = sw.filter(s => s.type === 'L').slice(-2);
  if (hs.length === 2 && r[hs[0].i] != null && hs[1].price > hs[0].price && r[hs[1].i] < r[hs[0].i] && Math.max(r[hs[0].i], r[hs[1].i]) >= 70) return 'bearish';
  if (ls.length === 2 && r[ls[0].i] != null && ls[1].price < ls[0].price && r[ls[1].i] > r[ls[0].i] && Math.min(r[ls[0].i], r[ls[1].i]) <= 30) return 'bullish';
  return null;
}

// Fair value gaps: three candles where the 1st and 3rd do not overlap (normal candles).
// Bullish zone = high of candle 1 up to low of candle 3; bearish = high of candle 3 up to low of candle 1.
// `open` = price has not come back to the zone's entry edge since it formed.
export function fairValueGaps(c, lookback = 60) {
  const out = [];
  for (let i = Math.max(2, c.length - lookback); i < c.length; i++) {
    const a = c[i - 2], b = c[i];
    if (a.h < b.l) out.push({ type: 'bull', i, bottom: a.h, top: b.l });
    else if (a.l > b.h) out.push({ type: 'bear', i, bottom: b.h, top: a.l });
  }
  for (const g of out) {
    g.open = true;
    for (let k = g.i + 1; k < c.length; k++) if (g.type === 'bull' ? c[k].l <= g.top : c[k].h >= g.bottom) { g.open = false; break; }
  }
  return out;
}

// Swing points: a peak is a high above the highs of `span` candles on each side (a dip is the mirror).
// The list alternates peak / dip; when two of a kind follow each other the more extreme one is kept.
export function swings(c, span = 2) {
  const raw = [];
  for (let i = span; i < c.length - span; i++) {
    let hi = true, lo = true;
    for (let k = 1; k <= span; k++) {
      if (!(c[i].h >= c[i - k].h && c[i].h > c[i + k].h)) hi = false;
      if (!(c[i].l <= c[i - k].l && c[i].l < c[i + k].l)) lo = false;
    }
    if (hi) raw.push({ i, t: c[i].t, price: c[i].h, type: 'H' });
    if (lo) raw.push({ i, t: c[i].t, price: c[i].l, type: 'L' });
  }
  const out = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && last.type === s.type) {
      const better = s.type === 'H' ? s.price >= last.price : s.price <= last.price;
      if (better) out[out.length - 1] = s;
    } else out.push(s);
  }
  return out;
}

// Waves: the peaks and dips a person sees on the chart. A peak only counts once price has fallen
// back from it by at least k x ATR (a dip: once price has risen from it by that much), so two-candle
// wiggles inside a move are ignored. The last item is the running extreme of the move still in
// progress and is marked live: it can still be exceeded.
export function waves(c, k = 2, n = 14) {
  const a = atr(c, n), out = [], start = a.findIndex(v => v != null);
  if (start < 0) return out;
  const piv = (i, type) => ({ i, t: c[i].t, price: type === 'H' ? c[i].h : c[i].l, type });
  const arg = (from, to, type) => { let b = from; for (let j = from; j <= to; j++) if (type === 'H' ? c[j].h > c[b].h : c[j].l < c[b].l) b = j; return b; };
  let dir = 0, hi = start, lo = start;
  for (let i = start + 1; i < c.length; i++) {
    const th = k * a[i];
    if (dir === 0) {
      if (c[i].h > c[hi].h) hi = i;
      if (c[i].l < c[lo].l) lo = i;
      if (hi < i && c[hi].h - c[i].l >= th) { out.push(piv(hi, 'H')); dir = -1; lo = arg(hi + 1, i, 'L'); }
      else if (lo < i && c[i].h - c[lo].l >= th) { out.push(piv(lo, 'L')); dir = 1; hi = arg(lo + 1, i, 'H'); }
    } else if (dir === 1) {
      if (c[i].h >= c[hi].h) hi = i;
      else if (c[hi].h - c[i].l >= th) { out.push(piv(hi, 'H')); dir = -1; lo = arg(hi + 1, i, 'L'); }
    } else if (c[i].l <= c[lo].l) lo = i;
    else if (c[i].h - c[lo].l >= th) { out.push(piv(lo, 'L')); dir = 1; hi = arg(lo + 1, i, 'H'); }
  }
  if (dir === 1) out.push({ ...piv(hi, 'H'), live: true });
  else if (dir === -1) out.push({ ...piv(lo, 'L'), live: true });
  return out;
}

// Price structure from the last two peaks and the last two dips.
// A move still in progress counts only when it has already gone past the previous peak / dip
// (a new high being made is a higher high; a pullback that has not broken the last dip changes nothing).
// tol = how far apart two levels must be to count as different (equal peaks are not "higher").
export function structure(sw, tol = 0) {
  const pick = type => {
    const done = sw.filter(s => s.type === type && !s.live), live = sw.find(s => s.type === type && s.live), last = done[done.length - 1];
    if (live && last && (type === 'H' ? live.price > last.price : live.price < last.price)) done.push(live);
    return done.slice(-2);
  };
  const highs = pick('H'), lows = pick('L');
  if (highs.length < 2 || lows.length < 2) return { type: 'unknown', highs, lows };
  const dh = highs[1].price - highs[0].price, dl = lows[1].price - lows[0].price;
  return { type: dh > tol && dl > tol ? 'up' : dh < -tol && dl < -tol ? 'down' : 'side', highs, lows };
}

// Group small candles into bigger ones. keyOf(t) gives the bucket a candle belongs to.
export function aggregate(c, keyOf, startOf) {
  const out = [];
  let key = null;
  for (const k of c) {
    const b = keyOf(k.t);
    if (b !== key) { key = b; out.push({ t: startOf ? startOf(b) : k.t, o: k.o, h: k.h, l: k.l, c: k.c, n: 1 }); }
    else { const a = out[out.length - 1]; a.h = Math.max(a.h, k.h); a.l = Math.min(a.l, k.l); a.c = k.c; a.n++; }
  }
  return out;
}
