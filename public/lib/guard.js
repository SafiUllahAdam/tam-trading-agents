// Agent 3 "Risk Guard". Pure rules, no I/O: it takes what the Scout and Strategist found plus the
// trader's own numbers and answers TAKE / TAKE WITH CARE / NO TRADE. Runs in the browser so the
// balance, stop-loss count and open trades never leave the device.
import { INST, CURS, SESSIONS, SHORT, TZ, riskFor, partsIn, pad, status, forexClosed } from './core.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
export const fmtPct = v => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const FF = '<a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">ForexFactory</a>';
const FINVIZ = '<a href="https://finviz.com/forex_performance.ashx" target="_blank" rel="noopener">finviz</a>';

// Clock-based rules (rule 1 and rule 2 of "My 3 rules").
export function timeCtx(slTimes, now = new Date()) {
  const p = partsIn(TZ, now), last = slTimes.length ? Math.max(...slTimes) : null;
  const breakLeft = last ? Math.max(0, 60 - Math.floor((now.getTime() - last) / 60000)) : 0;
  return { p, losses: slTimes.length, breakLeft, after22: p.min >= 1320, fri21: p.wd === 'Fri' && p.min >= 1260, weekend: p.wd === 'Sat' || p.wd === 'Sun', to22: 1320 - p.min };
}

// Lot size from the stop distance (rule 3). The stop decides the size, never the other way round.
export function sizeTrade(inst, etf, bal, entry, sl, tp) {
  const riskPct = riskFor(inst.sym, etf);
  const slDist = entry && sl ? Math.abs(entry - sl) : 0, tpDist = entry && tp ? Math.abs(tp - entry) : 0;
  const slPips = slDist / inst.pip, tpPips = tpDist / inst.pip, riskMoney = bal * riskPct / 100;
  const lots = slPips >= 5 ? Math.floor(riskMoney / (slPips * inst.pipVal) * 100) / 100 : 0;
  const rr = slDist > 0 ? tpDist / slDist : 0;
  return { riskPct, slDist, tpDist, slPips, tpPips, riskMoney, lots, rr, realRisk: lots * slPips * inst.pipVal, reward: lots * tpPips * inst.pipVal };
}

// Strong-vs-weak check. Returns [class, title, html]; class g = with you, r = against, n = neutral.
export function biasLine(inst, dir, st, loaded) {
  if (!st) return ['n', 'Bias', loaded ? `Live strength unavailable right now. Check ${FINVIZ}.` : 'Loading live strength…'];
  const isFx = CURS.includes(inst.base) && CURS.includes(inst.quote);
  if (!isFx) {
    const u = st.USD.w1, tone = u < -0.3 ? 'weak' : u > 0.3 ? 'strong' : 'flat';
    const help = inst.sym.startsWith('XA') ? (tone === 'weak' ? 'helps gold/silver' : tone === 'strong' ? 'weighs on gold/silver' : 'no clear push') : '';
    return ['n', `USD this week ${fmtPct(u)}`, `USD is ${tone} vs the other majors${help ? ' — ' + help : ''}. ${inst.sym} itself is not in the strength table; confirm the trend on your chart.`];
  }
  const b = st[inst.base], q = st[inst.quote], diff = b.w1 - q.w1;
  const fav = diff > 0.3 ? 'BUY' : diff < -0.3 ? 'SELL' : null;
  const txt = `${inst.base} ${fmtPct(b.w1)} · ${inst.quote} ${fmtPct(q.w1)} this week (today ${fmtPct(b.d1)} / ${fmtPct(q.d1)})`;
  if (!fav) return ['n', 'No clear bias', txt + '. Both near zero — only take a very clean setup.'];
  const ok = fav === dir;
  return [ok ? 'g' : 'r', `Bias favours ${fav}${ok ? ' — with you' : ' — against your ' + dir}`, txt + '.'];
}

// Red-news check for the instrument's two currencies. Same return shape as biasLine.
export function newsLine(inst, news, loaded, nowMs = Date.now()) {
  const curs = [inst.base, inst.quote].filter(c => CURS.includes(c));
  if (!curs.length) curs.push('USD');
  if (!news) return ['n', 'Red news', loaded ? `News feed unavailable — check ${FF} for ${curs.join(' & ')}.` : 'Loading…'];
  const ev = news.filter(e => curs.includes(e.cur));
  const recent = ev.find(e => e.t <= nowMs && nowMs - e.t < 15 * 6e4);
  if (recent) return ['r', `Red news just released: ${esc(recent.cur)} ${esc(recent.title)}`, 'Wait 15 minutes for the spike to settle.'];
  const next = ev.find(e => e.t > nowMs);
  if (!next) return ['g', 'No red news left this week for ' + curs.join(' & '), ''];
  const mins = Math.round((next.t - nowMs) / 6e4), p = partsIn(TZ, new Date(next.t)), today = partsIn(TZ, new Date(nowMs)).date === p.date;
  const when = today ? `today ${pad(p.h)}:${pad(p.m)}` : `${p.wd} ${pad(p.h)}:${pad(p.m)}`;
  if (mins <= 120) return ['r', `Red news in ${mins} min: ${esc(next.cur)} ${esc(next.title)}`, `${when} Paris — no new trade until 15 min after.`];
  if (today) return ['n', `Red news later today: ${esc(next.cur)} ${esc(next.title)} at ${pad(p.h)}:${pad(p.m)}`, 'Fine to trade now; be flat or protected before it.'];
  return ['g', 'No red news today for ' + curs.join(' & '), `Next: ${esc(next.cur)} ${esc(next.title)}, ${when} Paris.`];
}

// Is the instrument's home session open?
export function sessionLine(inst, now = new Date()) {
  const names = inst.sessions.map(id => SESSIONS.find(x => x.id === id).name).join(' / ');
  if (inst.cls !== 'crypto' && forexClosed(now)) return ['r', 'Market closed (weekend)', ''];
  const open = inst.sessions.some(id => status(SESSIONS.find(x => x.id === id), now).open);
  return open ? ['g', `Right time: ${names} session is open`, ''] : ['r', `Wrong time: ${inst.sym} moves in the ${names} session`, 'Thin market and wider spread now. Better to wait for its home session.'];
}

// Rules shared by the planner and the agents: time, losses, exposure.
export function accountRules(inst, etf, p) {
  const out = [], R = (st, t, w = '') => out.push({ st, t, w }), c = p.tc, short = SHORT.includes(etf);
  if (c.weekend) R('fail', 'Weekend — no trading');
  else if (c.fri21) R('fail', 'Friday after 21:00 — no new trades');
  else if (c.after22 && short) R('fail', 'After 22:00 — no short-chart trades');
  else if (short && c.to22 < 90) R('warn', `Only ${c.to22} min to the 22:00 cut-off`, 'May not have time to reach the target.');
  else R('pass', 'Time OK');
  if (c.losses >= 2) R('fail', '2 stop-losses today — stop for today');
  else if (c.breakLeft > 0) R('fail', `Break: ${c.breakLeft} min left`);
  else R('pass', 'Loss rule OK');
  const open = p.open || [];
  const clash = open.find(o => { const i = INST[o.sym]; return i && [i.base, i.quote].some(x => x === inst.base || x === inst.quote); });
  const used = open.reduce((s, o) => s + (o.riskPct || 0), 0), mine = riskFor(inst.sym, etf);
  if (clash) R('fail', `Already in ${clash.sym} — same currency`, 'Rule 2: no two trades on the same currency.');
  else if (used + mine > 3 + 1e-9) R('fail', `Open risk would be ${(used + mine).toFixed(2)}%`, 'Rule 3: max 3% open at once.');
  else if (open.length) R('pass', `Open risk ${used.toFixed(2)}% + this ${mine}% is within 3%`);
  return out;
}

// Full verdict for one agent finding.
// p = { balance, tc, strength, news, loaded, open, now }
export function judge(item, p) {
  const inst = INST[item.sym], etf = item.entryTf, rules = [];
  const R = (st, t, w = '') => rules.push({ st, t, w });
  for (const c of item.checks || []) R(c.st || (c.ok === true ? 'pass' : c.ok === false ? 'fail' : 'wait'), c.t, c.d);

  let sz = null;
  if (item.entry != null && item.sl != null) {
    sz = sizeTrade(inst, etf, p.balance, item.entry, item.sl, item.tp);
    if (sz.slPips < 5) R('fail', `Stop only ${sz.slPips.toFixed(1)} pips`, 'Too tight to be a real stop.');
    else if (sz.lots < 0.01) R('fail', 'Stop too wide for this risk', `Even 0.01 lot would risk more than ${sz.riskPct}% of the account.`);
    else {
      R('pass', `Size ${sz.lots.toFixed(2)} lots = $${sz.realRisk.toFixed(0)} risk (${sz.riskPct}%)`, `Stop ${Math.floor(sz.slPips + 1e-9)} pips × $${inst.pipVal} per pip per lot.`);
      if (sz.slPips < 15 && !SHORT.includes(etf)) R('warn', `Stop ${Math.floor(sz.slPips + 1e-9)} pips is tight for ${etf}`, 'Ideally 30+ pips on H1/H4 so normal noise does not hit it.');
    }
  }
  for (const r of accountRules(inst, etf, p)) rules.push(r);

  const now = p.now || new Date();
  // Outside the home session is a caution, like in the planner; a closed market is a stop.
  const ses = sessionLine(inst, now);
  R(ses[0] === 'g' ? 'pass' : /closed/.test(ses[1]) ? 'fail' : 'warn', ses[1], ses[2]);

  if (item.dir) {
    const b = biasLine(inst, item.dir, p.strength, p.loaded);
    R(b[0] === 'g' ? 'pass' : b[0] === 'r' ? 'fail' : (inst.cls === 'fx' ? 'warn' : 'pass'), b[1], b[2]);
  }
  const n = newsLine(inst, p.news, p.loaded, now.getTime());
  R(n[0] === 'r' ? 'fail' : n[0] === 'g' ? 'pass' : (p.news ? 'pass' : 'warn'), n[1], n[2]);

  if (!inst.beginner) R('warn', 'Hard instrument for a beginner', inst.note);
  if (item.approx) R('warn', 'Levels come from a different price feed than MT4', item.feedNote ? `Here: ${item.feedNote}. Confirm the peak, dip and stop on your own chart.` : 'Futures / cash index feed. Confirm the peak, dip and stop on your own chart.');

  const fails = rules.filter(r => r.st === 'fail'), warns = rules.filter(r => r.st === 'warn'), waits = rules.filter(r => r.st === 'wait');
  const verdict = fails.length ? 'skip' : waits.length ? 'wait' : warns.length ? 'care' : 'take';
  return { verdict, rules, fails, warns, waits, size: sz };
}
