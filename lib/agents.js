// Agent 1 "Scout" reads the live charts. Agent 2 "Strategist" applies the course method to them.
// Both run on the server and return plain facts; Agent 3 "Risk Guard" runs in the browser,
// because only the browser knows the trader's balance, stop-loss count and open trades.
//
// Method (Sarmaya "CWT - Cambist With Trend" lectures + the trader's own checklist):
//   bigger chart : Alligator (13/8/5 smoothed, shifted 8/5/3) with Heikin Ashi candles gives the
//                  only allowed direction; normal-candle structure (HH+HL / LH+LL) must agree.
//   entry chart  : the lecture sorts it into Scenario 1 (trends with the bigger chart),
//                  2 (pulls back against it) or 3 (sideways).
//   trigger      : the trader's rule - one normal candle FINISHES past the last peak / dip.
//                  First close = enter. Two or more closes = missed, never chase.
//   stop, target : stop a few pips beyond the dip / bounce made before the break; target 1:1.
import { INST, MODES, GROUPS, USD_MAJORS, px } from '../public/lib/core.js';
import { heikinAshi, haColor, alligator, atr, waves, structure, divergence, fairValueGaps } from '../public/lib/indicators.js';
import { getSeries, getStrength, pool } from './feeds.js';

export const CFG = {
  minBars: 40,          // candles needed before a chart is judged
  waveBig: 2,           // a peak / dip on the bigger chart counts after a turn of 2 x ATR
  waveEntry: 1.5,       // same on the entry chart, 1.5 x ATR
  equalAtr: 0.1,        // peaks closer than 0.1 x ATR are "equal", not higher or lower
  mouthGapAtr: 0.25,    // Lips-to-Jaw distance (in ATRs) for the Alligator mouth to count as open
  colourBars: 2,        // entry-chart Heikin Ashi candles that must be the trade colour
  chasePips: 10,        // forex: price this far past the level = the move is gone
  chaseAtr: 0.5,        // other markets: same rule, in ATRs of the entry chart
  slBufferPips: 3,      // "a few pips" beyond the last dip / peak
  slBufferAtr: 0.1,
  rr: 1,                // target = 1 x the stop distance
  sparkBars: 60,
};

const sign = d => (d === 'BUY' ? 1 : -1);
const ordered = (al, d) => (d === 'BUY' ? al.lips > al.teeth && al.teeth > al.jaw : al.lips < al.teeth && al.teeth < al.jaw);

/* ---------- Scout: read the bigger chart ---------- */
export function readBig(c, inst, tf) {
  const i = c.length - 1, ha = heikinAshi(c), al = alligator(c)[i], a = atr(c)[i];
  const { jaw, teeth, lips } = al;
  const dir = ordered(al, 'BUY') ? 'BUY' : ordered(al, 'SELL') ? 'SELL' : null;
  const gap = a ? Math.abs(lips - jaw) / a : 0;
  const colour = haColor(ha[i]);
  const sw = waves(c, CFG.waveBig), st = structure(sw, CFG.equalAtr * (a || 0));
  const f = v => px(v, inst.pip);
  const checks = [];

  if (!dir) {
    checks.push({ id: 'big', ok: false, t: `${tf} Alligator lines tangled`, d: `Lips ${f(lips)}, Teeth ${f(teeth)}, Jaw ${f(jaw)} are not in order. The trend is asleep.` });
    return { dir, checks, colour, struct: st.type, gap, waves: sw };
  }
  const want = dir === 'BUY' ? 'green' : 'red';
  const beyond = dir === 'BUY' ? ha[i].c > lips : ha[i].c < lips;
  const side = dir === 'BUY' ? 'above' : 'below';
  const problems = [];
  if (gap < CFG.mouthGapAtr) problems.push('mouth barely open');
  if (!beyond) problems.push(`last candle not ${side} the Lips`);
  if (colour !== want) problems.push(`last Heikin Ashi candle is ${colour}`);
  checks.push({
    id: 'big', ok: problems.length === 0,
    t: problems.length ? `${tf} direction not clean: ${problems.join(', ')}` : `${tf} Alligator mouth open, candles ${side} the Lips`,
    d: `Lips ${f(lips)} ${dir === 'BUY' ? '>' : '<'} Teeth ${f(teeth)} ${dir === 'BUY' ? '>' : '<'} Jaw ${f(jaw)}. Heikin Ashi ${colour}. ${dir} only.`,
  });

  const need = dir === 'BUY' ? 'up' : 'down';
  const lab = s => f(s.price) + (s.live ? ' (still moving)' : '');
  const hs = st.highs.map(lab).join(' → '), ls = st.lows.map(lab).join(' → ');
  checks.push({
    id: 'structure', ok: st.type === need,
    t: st.type === need ? `${tf} structure: ${dir === 'BUY' ? 'higher highs + higher lows' : 'lower highs + lower lows'}`
      : st.type === 'unknown' ? `${tf} structure unclear` : `${tf} structure is ${st.type === 'side' ? 'sideways' : 'against the Alligator'}`,
    d: st.type === 'unknown' ? 'Not enough waves yet.' : `Peaks ${hs}. Dips ${ls}. A wave counts after a turn of ${CFG.waveBig} × ATR.`,
  });

  // Reversal lecture: divergence from the extreme RSI zone warns that the trend may be ending.
  const div = divergence(c, sw.filter(x => !x.live));
  if ((dir === 'BUY' && div === 'bearish') || (dir === 'SELL' && div === 'bullish')) {
    checks.push({ id: 'divergence', ok: true, st: 'warn', t: `${tf} RSI divergence against the trend`, d: `Price made a new ${dir === 'BUY' ? 'high' : 'low'} but RSI did not, starting from the ${dir === 'BUY' ? 'above-70' : 'below-30'} zone. A reversal may be forming.` });
  }
  return { dir, checks, colour, struct: st.type, gap, waves: sw };
}

/* ---------- Strategist: entry chart ---------- */
export function readEntry(c, dir, inst, tf, entrySec, price, nowSec) {
  const i = c.length - 1, ha = heikinAshi(c), a = atr(c)[i] || 0, sw = waves(c, CFG.waveEntry), al = alligator(c)[i];
  const f = v => px(v, inst.pip), s = sign(dir), pips = v => Math.round(Math.abs(v) / inst.pip);
  const want = dir === 'BUY' ? 'green' : 'red', opp = dir === 'BUY' ? 'SELL' : 'BUY';
  const colours = ha.slice(-CFG.colourBars).map(haColor);
  const colourOk = colours.every(x => x === want);
  const buf = Math.max(CFG.slBufferPips * inst.pip, CFG.slBufferAtr * a);

  // Lecture scenario for the entry chart.
  const scenario = ordered(al, dir) && s * (ha[i].c - al.lips) > 0 ? 1 : ordered(al, opp) ? 2 : 3;
  const scenText = [`Scenario 1: ${tf} trends with the bigger chart.`, `Scenario 2: ${tf} is pulling back against the bigger chart.`, `Scenario 3: ${tf} is sideways.`][scenario - 1];

  const checks = [{
    id: 'colour', ok: colourOk ? true : null, // wrong colour = pullback still running = wait, not a veto
    t: colourOk ? `${tf} Heikin Ashi candles are ${want}` : `${tf} Heikin Ashi not ${want} yet (pullback)`,
    d: `Last ${CFG.colourBars} finished candles: ${colours.join(', ')}.`,
  }];

  // the level to break: the last finished peak (BUY) / dip (SELL), i.e. price has already turned away from it
  const peak = [...sw].reverse().find(x => !x.live && x.type === (dir === 'BUY' ? 'H' : 'L'));
  if (!peak) {
    checks.push({ id: 'trigger', ok: null, t: `No clear ${dir === 'BUY' ? 'peak' : 'dip'} on ${tf} yet`, d: 'Wait for the chart to print a swing.' });
    return { stage: 'WATCH', checks, why: 'No level to break yet.', scenario, lecture: { text: scenText }, waves: sw };
  }
  const level = peak.price;
  let first = -1, count = 0;
  for (let k = peak.i + 1; k <= i; k++) if (s * (c[k].c - level) > 0) { if (first < 0) first = k; count++; }

  // stop goes beyond the dip made after the peak (BUY) / the bounce made after the dip (SELL)
  const end = first >= 0 ? first : i;
  let ext = dir === 'BUY' ? Infinity : -Infinity;
  for (let k = peak.i + 1; k <= end; k++) ext = dir === 'BUY' ? Math.min(ext, c[k].l) : Math.max(ext, c[k].h);
  const sl = ext - s * buf;
  const chase = inst.cls === 'fx' ? CFG.chasePips * inst.pip : CFG.chaseAtr * a;
  const word = dir === 'BUY' ? 'above' : 'below', lvlName = dir === 'BUY' ? 'last peak' : 'last dip';

  let stage, why, entry;
  if (count === 0) {
    stage = 'WATCH'; entry = level;
    const dist = s * (level - price) / inst.pip;
    why = `Waiting for one ${tf} candle to finish ${word} ${f(level)} (${dist >= 0 ? Math.round(dist) + ' pips away' : 'price is past it, candle not finished'}).`;
    checks.push({ id: 'trigger', ok: null, t: `No ${tf} close ${word} the ${lvlName} ${f(level)} yet`, d: 'Touching is not enough. Wait for the candle to finish.' });
  } else if (first === i && count === 1) {
    entry = c[i].c;
    const fresh = nowSec < c[i].t + 2 * entrySec;
    const run = Math.max(s * (entry - level), s * (price - level));
    if (!fresh) {
      stage = 'LATE'; why = 'Trigger candle is old (market closed or feed delayed).';
      checks.push({ id: 'trigger', ok: false, t: 'Trigger is stale', d: `The ${tf} candle that closed ${word} ${f(level)} finished a while ago.` });
    } else if (run > chase) {
      stage = 'LATE'; why = `Price is already ${pips(run)} pips past ${f(level)}. Chasing = buying the top. Wait for the next ${dir === 'BUY' ? 'peak' : 'dip'}.`;
      checks.push({ id: 'trigger', ok: false, t: `Move already ${pips(run)} pips past the level`, d: 'Too late to enter. Leave it.' });
    } else if (!colourOk) {
      stage = 'WATCH'; why = `Candle closed ${word} ${f(level)} but ${tf} Heikin Ashi is not ${want} twice. Do not force it.`;
      checks.push({ id: 'trigger', ok: null, t: `Close ${word} ${f(level)}, colour not confirmed`, d: 'Wait.' });
    } else {
      stage = 'TRIGGER'; why = `${tf} candle finished ${word} the ${lvlName} ${f(level)}. Enter at market near ${f(entry)}.`;
      checks.push({ id: 'trigger', ok: true, t: `${tf} candle finished ${word} the ${lvlName} ${f(level)}`, d: `Closed at ${f(entry)}. First close past the level, so the entry is fresh.` });
    }
  } else {
    stage = 'LATE'; entry = c[first].c;
    const ago = i - first, next = dir === 'BUY' ? 'peak' : 'dip';
    why = count === 1
      ? `The ${tf} entry candle finished ${word} ${f(level)} ${ago} candle${ago > 1 ? 's' : ''} ago. Entry missed, wait for the next ${next}.`
      : `${count} ${tf} candles already finished ${word} ${f(level)}. The move is gone, wait for the next ${next}.`;
    checks.push({ id: 'trigger', ok: false, t: `Entry missed (first close past ${f(level)} was ${ago} candle${ago > 1 ? 's' : ''} ago)`, d: 'Missed trade = no trade.' });
  }

  const risk = Math.abs(entry - sl), tp = entry + s * CFG.rr * risk;
  const slOk = s * (entry - sl) > 0 && risk / inst.pip >= 5;
  checks.push({
    id: 'sl', ok: stage === 'TRIGGER' ? slOk : null,
    t: `Stop ${f(sl)}, ${pips(risk)} pips, beyond the ${dir === 'BUY' ? 'last dip' : 'last bounce'} ${f(ext)}`,
    d: `Target 1:${CFG.rr} at ${f(tp)}.`,
  });

  // What the lectures themselves draw on a chart like this. Shown for comparison only: the
  // trigger above stays the trader's own candle-close rule.
  const side = dir === 'BUY' ? 'Buy' : 'Sell', plans = [];
  let text = scenText;
  const filled = count > 0 || s * (price - level) > 0;
  const stopPlan = { label: `${side} Stop`, entry: level, sl, tp: level + s * Math.abs(level - sl) };
  if (scenario === 1) {
    const jsl = al.jaw - s * buf, r = s * (price - jsl);
    text += ' This is the case the lectures prefer.';
    if (r > 0) { plans.push({ label: 'Market, stop at the Jaw', entry: price, sl: jsl, tp: price + s * r }); text += ` Week 5 charts: enter at market, stop at the ${tf} Jaw ${f(jsl)} (${pips(r)} pips), target 1:1.`; }
    if (!filled) { plans.push(stopPlan); text += ` Week 6: ${side} Stop at the ${lvlName} ${f(level)}, stop ${f(sl)}.`; }
  } else {
    text += ` Week 5 charts: ${side} Stop at the ${lvlName} ${f(level)}, stop ${f(sl)} (${pips(level - sl)} pips), target 1:1.${filled ? ' That order would already be filled.' : ''}`;
    if (!filled) plans.push(stopPlan);
  }
  return { stage, why, checks, level, entry, sl, tp, slPips: risk / inst.pip, trigT: first >= 0 ? c[first].t : null, validUntil: first === i ? c[i].t + 2 * entrySec : null, scenario, lecture: { text, plans }, buf, waves: sw };
}

// Week 6: when the entry chart is pulling back or sideways, the lecture rests a limit order on the
// nearest open fair value gap of the bigger chart, with the stop beyond the swing that started the move.
export function fvgPlan(big, dir, inst, tf, price, buf) {
  const s = sign(dir), f = v => px(v, inst.pip), want = dir === 'BUY' ? 'bull' : 'bear';
  const g = fairValueGaps(big).filter(x => x.type === want && x.open && (dir === 'BUY' ? x.top < price : x.bottom > price)).pop();
  if (!g) return null;
  const entry = dir === 'BUY' ? g.top : g.bottom, far = dir === 'BUY' ? g.bottom : g.top;
  const origin = waves(big, CFG.waveBig).filter(x => !x.live && x.type === (dir === 'BUY' ? 'L' : 'H') && x.i <= g.i - 1).pop();
  const beyond = origin ? (dir === 'BUY' ? Math.min(origin.price, far) : Math.max(origin.price, far)) : far;
  const sl = beyond - s * buf;
  return {
    plan: { label: `${dir === 'BUY' ? 'Buy' : 'Sell'} Limit`, entry, sl, tp: entry + s * Math.abs(entry - sl) },
    text: ` Week 6: ${dir === 'BUY' ? 'Buy' : 'Sell'} Limit at the edge of the ${tf} fair value gap ${f(g.bottom)}–${f(g.top)}, so ${f(entry)}, stop ${f(sl)} (${Math.round(Math.abs(entry - sl) / inst.pip)} pips).`,
  };
}

/* ---------- one instrument, one mode ---------- */
export function analyse(sym, mode, big, entry, nowSec) {
  const inst = INST[sym], m = MODES[mode];
  const base = { id: `${sym}:${mode}`, sym, mode, dirTf: m.dirTf, entryTf: m.entryTf, price: entry.price, approx: inst.cls !== 'fx', feedNote: entry.basisNote || null };
  if (big.closed.length < CFG.minBars || entry.closed.length < CFG.minBars) {
    return { ...base, stage: 'NONE', dir: null, why: 'Not enough candles from the feed yet.', checks: [] };
  }
  const b = readBig(big.closed, inst, m.dirTf);
  const lastT = entry.closed[entry.closed.length - 1].t;
  const spark = entry.closed.slice(-CFG.sparkBars).map(k => [k.t, k.o, k.h, k.l, k.c]);
  const out = { ...base, dir: b.dir, big: { colour: b.colour, struct: b.struct, gap: +b.gap.toFixed(2) }, lastT };
  if (!b.dir) return { ...out, stage: 'NONE', why: `${m.dirTf} Alligator is asleep (lines tangled). No trade.`, checks: b.checks };
  const bad = b.checks.filter(x => x.ok === false);
  if (bad.length) return { ...out, stage: 'NONE', why: bad.map(x => x.t).join('. ') + '.', checks: b.checks };
  const e = readEntry(entry.closed, b.dir, inst, m.entryTf, m.entrySec, entry.price, nowSec);
  if (e.lecture?.plans && e.scenario !== 1) {
    const g = fvgPlan(big.closed, b.dir, inst, m.dirTf, entry.price, e.buf);
    if (g) { e.lecture.text += g.text; e.lecture.plans.push(g.plan); }
  }
  const sig = e.stage === 'TRIGGER' ? `${sym}:${mode}:${b.dir}:${e.trigT}` : null;
  return {
    ...out, stage: e.stage, why: e.why, checks: [...b.checks, ...e.checks], setup: 'CWT trend breakout',
    scenario: e.scenario, lecture: e.lecture || null,
    level: e.level ?? null, entry: e.entry ?? null, sl: e.sl ?? null, tp: e.tp ?? null, slPips: e.slPips != null ? +e.slPips.toFixed(1) : null,
    trigT: e.trigT ?? null, validUntil: e.validUntil ?? null, spark,
    sig,
    // names this exact setup: the trigger candle, or the level being watched
    bk: sig || (e.level != null ? `${sym}:${mode}:${b.dir}:${px(e.level, inst.pip)}` : null),
  };
}

/* ---------- evidence: the exact candles, Alligator lines and waves a reading was based on ---------- */
export function evidence(sym, mode, big, entry, bars = 70) {
  const inst = INST[sym], m = MODES[mode], dec = inst.pip >= 1 ? 1 : inst.pip >= 0.1 ? 2 : inst.pip >= 0.01 ? 3 : 5;
  const r = v => (v == null ? null : +v.toFixed(dec));
  const pack = (c, tf, k) => {
    const from = Math.max(0, c.length - bars), al = alligator(c);
    return {
      tf, bars: c.slice(from).map(x => [x.t, r(x.o), r(x.h), r(x.l), r(x.c)]),
      jaw: al.slice(from).map(x => r(x.jaw)), teeth: al.slice(from).map(x => r(x.teeth)), lips: al.slice(from).map(x => r(x.lips)),
      waves: waves(c, k).filter(x => x.i >= from).map(x => ({ n: x.i - from, price: r(x.price), type: x.type, live: !!x.live })),
      ha: haColor(heikinAshi(c)[c.length - 1]),
    };
  };
  return { sym, mode, feed: inst.feed, note: entry.basisNote || null, big: pack(big.closed, m.dirTf, CFG.waveBig), entry: pack(entry.closed, m.entryTf, CFG.waveEntry) };
}

/* ---------- full scan ---------- */
const ORDER = { TRIGGER: 0, WATCH: 1, LATE: 2, NONE: 3, ERROR: 4 };

export async function runScan({ modes = ['H1'], groups = ['fx'] } = {}) {
  const t0 = Date.now(), nowSec = Math.floor(t0 / 1000);
  modes = modes.filter(m => MODES[m]);
  const syms = [...new Set(groups.flatMap(g => GROUPS[g]?.syms || []))];
  const jobs = syms.flatMap(sym => modes.map(mode => ({ sym, mode })));
  const log = [], errors = [];

  const items = await pool(jobs, 6, async ({ sym, mode }) => {
    const m = MODES[mode];
    try {
      const [big, entry] = await Promise.all([getSeries(sym, m.dirTf, nowSec), getSeries(sym, m.entryTf, nowSec)]);
      return analyse(sym, mode, big, entry, nowSec);
    } catch (e) {
      errors.push(`${sym} ${mode}: ${e.message}`);
      return { id: `${sym}:${mode}`, sym, mode, dirTf: m.dirTf, entryTf: m.entryTf, stage: 'ERROR', dir: null, why: 'Live feed unavailable for this instrument right now.', checks: [] };
    }
  });

  let strength = null;
  try { strength = await getStrength(nowSec); } catch (e) { errors.push(`strength: ${e.message}`); }

  items.sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || a.sym.localeCompare(b.sym) || a.mode.localeCompare(b.mode));
  const n = s => items.filter(x => x.stage === s).length;
  const tookMs = Date.now() - t0;
  log.push({ a: 'Scout', m: `Read ${syms.length} instruments on ${modes.map(x => `${MODES[x].dirTf}+${MODES[x].entryTf}`).join(', ')} in ${(tookMs / 1000).toFixed(1)}s${errors.length ? `, ${errors.length} feed error${errors.length > 1 ? 's' : ''}` : ''}.` });
  log.push({ a: 'Strategist', m: `${n('TRIGGER')} ready, ${n('WATCH')} forming, ${n('LATE')} missed, ${n('NONE')} no trend.` });
  for (const x of items) if (x.stage === 'TRIGGER') log.push({ a: 'Strategist', m: `${x.sym} ${x.dir}: ${x.why}` });
  return { ts: t0, tookMs, modes, groups, items, strength, log, errors, usdMajors: USD_MAJORS };
}
