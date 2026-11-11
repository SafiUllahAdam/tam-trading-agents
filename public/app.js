import { INSTRUMENTS, INST, GROUPS, CURS, SESSIONS, SHORT, TZ, MODES, riskFor, partsIn, pad, hm, forexClosed, windows, status, offset, px, tvUrl } from './lib/core.js';
import { esc, fmtPct, timeCtx, sizeTrade, biasLine, newsLine, accountRules, judge } from './lib/guard.js';

const $ = id => document.getElementById(id);

/* ---------- storage (this browser) ---------- */
const S = {
  get(k, d) { try { const v = localStorage.getItem('tm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tm.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
function slState() { const st = S.get('sl', { date: '', times: [] }); const today = partsIn(TZ).date; if (st.date !== today) return { date: today, times: [] }; return st; }
const ctx = () => timeCtx(slState().times);
const openTrades = () => S.get('open', []);

/* ---------- nav ---------- */
const TABS = ['home', 'agents', 'sessions', 'planner', 'rules'];
function showTab(id) {
  if (!TABS.includes(id)) id = 'home';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + id));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  try { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
  window.scrollTo({ top: 0 });
  if (id === 'agents') drawCharts();
}
document.querySelectorAll('#nav button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

/* ---------- home ---------- */
function tick() {
  const p = partsIn(TZ);
  $('parisClock').textContent = `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}`;
  $('parisDate').textContent = `${p.wd} ${p.date}`;
  $('mt4Clock').textContent = hm(p.min + 60);
  renderSessions();
  agentTick();
}
function renderSessions() {
  const parisMin = partsIn(TZ).min; let html = '', tl = '';
  for (const s of SESSIONS) {
    const st = status(s), off = offset(s.tz);
    let pill, sub;
    if (st.open) { pill = '<span class="pill open">● OPEN</span>'; sub = `closes in ${Math.floor(st.closeIn / 60)}h ${st.closeIn % 60}m`; }
    else if (st.weekend) { pill = '<span class="pill closed">weekend</span>'; sub = 'market closed'; }
    else if (st.next !== null) { pill = `<span class="pill ${st.next <= 60 ? 'soon' : 'closed'}">${st.next <= 60 ? 'opens soon' : 'closed'}</span>`; sub = `opens in ${Math.floor(st.next / 60)}h ${st.next % 60}m`; }
    else { pill = '<span class="pill closed">closed</span>'; sub = 'opens tomorrow'; }
    const win = st.wins.map(([a, b]) => `${hm(a - off)}–${hm(b - off)}`).join(' & ') || 'closed today';
    html += `<div class="sess"><div><div class="n">${s.name} ${pill}</div><div class="sub">${win} Paris · ${sub}</div></div><div class="t">${pad(st.local.h)}:${pad(st.local.m)}</div></div>`;
    let blocks = '';
    for (const [a, b] of st.wins) {
      const pa = ((a - off) % 1440 + 1440) % 1440, pb = ((b - off) % 1440 + 1440) % 1440, on = st.open ? ' class="on"' : '';
      blocks += pb > pa ? `<i${on} style="left:${pa / 14.4}%;width:${(pb - pa) / 14.4}%"></i>` : `<i${on} style="left:${pa / 14.4}%;width:${(1440 - pa) / 14.4}%"></i><i${on} style="left:0;width:${pb / 14.4}%"></i>`;
    }
    tl += `<div class="tl-row"><div class="small"><b>${s.name}</b></div><div class="tl-track">${blocks}<div class="tl-now" style="left:${parisMin / 14.4}%"></div></div></div>`;
  }
  $('sessionList').innerHTML = html; $('timeline').innerHTML = tl; renderBest();
}
function pickInstrument(sym) { $('pInst').value = sym; calc(); showTab('planner'); }
function renderBest() {
  const openIds = SESSIONS.filter(s => status(s).open).map(s => s.id), box = $('bestNow'), why = $('bestNowWhy');
  if (forexClosed()) { box.innerHTML = '<span class="muted">Forex is closed for the weekend.</span>'; why.textContent = ''; return; }
  const fx = openIds.filter(i => i !== 'psx');
  if (!fx.length) { box.innerHTML = '<span class="muted">No major session open. Better to wait.</span>'; why.textContent = ''; return; }
  const overlap = fx.includes('london') && fx.includes('ny');
  box.innerHTML = INSTRUMENTS.filter(i => i[5].some(x => fx.includes(x))).map(i => `<span class="chip ${overlap && i[5].includes('london') && i[5].includes('ny') ? 'hot' : ''}" data-sym="${i[0]}">${i[0]}</span>`).join('');
  why.textContent = overlap ? 'London + New York overlap — the busiest hours. Highlighted pairs are active in both.' : `Open now: ${fx.map(i => SESSIONS.find(s => s.id === i).name).join(', ')}.`;
  box.querySelectorAll('.chip').forEach(c => { c.onclick = () => pickInstrument(c.dataset.sym); });
}
const ruleRow = r => `<div class="rule ${r.st}"><div class="ic">${r.st === 'pass' ? '✓' : r.st === 'fail' ? '✕' : r.st === 'wait' ? '…' : '!'}</div><div><b>${r.t}</b>${r.w ? `<div class="why">${r.w}</div>` : ''}</div></div>`;
function renderToday() {
  const c = ctx(), rows = []; const R = (st, t, w) => rows.push({ st, t, w });
  if (c.weekend) R('fail', 'Weekend — no trading', 'Market reopens Sunday 23:00 Paris.');
  else if (c.fri21) R('fail', 'Friday after 21:00 — close everything', 'Nothing stays open over the weekend.');
  else if (c.after22) R('fail', 'After 22:00 — no short-chart trades', 'Only H1/H4 trades planned earlier may stay open.');
  else R('pass', `Time OK — ${Math.floor(c.to22 / 60)}h ${c.to22 % 60}m to the 22:00 cut-off`, c.p.wd === 'Fri' ? 'Friday: everything closed by 21:00.' : '');
  if (c.losses >= 2) R('fail', `${c.losses} stop-losses today — stop for today`, 'Close MT4. Tomorrow is a new day.');
  else if (c.breakLeft > 0) R('warn', `1 stop-loss — break: ${c.breakLeft} min left`, 'No new trade until the break ends.');
  else R('pass', `${c.losses} stop-loss today`, c.losses === 1 ? 'Break finished. One more = done for today.' : 'Max 2 today.');
  $('todayRules').innerHTML = rows.map(ruleRow).join('');
}
function refreshPersonal() { renderToday(); calc(); rejudge(); }
$('hitSl').onclick = () => { const st = slState(); st.times.push(Date.now()); S.set('sl', st); refreshPersonal(); };
$('undoSl').onclick = () => { const st = slState(); st.times.pop(); S.set('sl', st); refreshPersonal(); };

/* ---------- sessions tab ---------- */
function renderSessionsTab() {
  let html = '';
  for (const s of SESSIONS) {
    const st = status(s), off = offset(s.tz); const win = st.wins.map(([a, b]) => `${hm(a - off)}–${hm(b - off)}`).join(' & ');
    const chips = INSTRUMENTS.filter(i => i[5].includes(s.id)).map(i => `<span class="chip" data-sym="${i[0]}">${i[0]}</span>`).join('');
    html += `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h3 style="margin:0">${s.name} ${st.open ? '<span class="pill open">open</span>' : ''}</h3><span class="mono small muted">${win || '—'} Paris</span></div><p class="small" style="margin:6px 0 8px;color:#374151">${s.why}</p><div class="chips">${chips}</div></div>`;
  }
  html += `<div class="card"><h3 style="margin:0">London + New York overlap <span class="pill info">14:00–18:00 Paris</span></h3><p class="small" style="margin:6px 0 8px;color:#374151">Highest volume of the day. If you can only trade 2 hours, trade these.</p><div class="chips">${['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD', 'NAS100'].map(s => `<span class="chip hot" data-sym="${s}">${s}</span>`).join('')}</div></div>`;
  $('sessionCards').innerHTML = html;
  document.querySelector('#instTable tbody').innerHTML = INSTRUMENTS.map(i => `<tr style="cursor:pointer" data-sym="${i[0]}"><td><b>${i[0]}</b></td><td class="small">${i[5].map(x => SESSIONS.find(s => s.id === x).name).join(', ')}</td><td class="small muted">${i[6]}</td></tr>`).join('');
  document.querySelectorAll('#sessionCards .chip,#instTable tr[data-sym]').forEach(el => { el.onclick = () => pickInstrument(el.dataset.sym); });
}

/* ---------- live data (comes from the Scout agent: /api/scan and /api/calendar) ---------- */
const Live = { st: null, news: null, loaded: false };
async function loadNews() {
  try {
    const r = await fetch('/api/calendar'); const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
    Live.news = j.events.map(e => ({ cur: e.cur, title: e.title, t: new Date(e.t).getTime() })).filter(e => !isNaN(e.t)).sort((a, b) => a.t - b.t);
  } catch (e) { pushLog([{ a: 'Scout', m: 'News calendar unavailable: ' + e.message }]); }
  renderLive(); calc(); rejudge();
}
function renderLive() {
  const b = $('liveBadge');
  if (Live.st) {
    const p = partsIn(TZ, new Date(A.okAt || Date.now()));
    b.textContent = `live ${pad(p.h)}:${pad(p.m)}`; b.className = 'pill ok';
    const rows = CURS.map(c => [c, Live.st[c].w1]).sort((x, y) => y[1] - x[1]); const max = Math.max(0.3, ...rows.map(r => Math.abs(r[1])));
    $('strength').innerHTML = rows.map(([c, v]) => `<div class="sr"><b>${c}</b><div class="bw"><i class="${v >= 0 ? 'g' : 'r'}" style="left:${v >= 0 ? 50 : 50 - Math.abs(v) / max * 50}%;width:${Math.abs(v) / max * 50}%"></i></div><span class="v" style="color:${v >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(v)}</span></div>`).join('') + `<p class="small muted" style="margin-top:6px">Change vs the other 7 currencies over 5 trading days. Buy the top against the bottom. Day: ${rows.slice(0, 1).map(([c]) => c + ' ' + fmtPct(Live.st[c].d1)).join('')} · ${rows.slice(-1).map(([c]) => c + ' ' + fmtPct(Live.st[c].d1)).join('')}</p>`;
  } else {
    b.textContent = Live.loaded ? 'feed unavailable' : 'loading…'; b.className = Live.loaded ? 'pill closed' : 'pill info';
    if (Live.loaded) $('strength').innerHTML = '<p class="small muted">Live feed is not answering right now. Check <a href="https://finviz.com/forex_performance.ashx" target="_blank" rel="noopener">finviz strength</a>.</p>';
  }
  const n = $('newsToday');
  if (Live.news) {
    const today = partsIn(TZ).date; const list = Live.news.filter(e => partsIn(TZ, new Date(e.t)).date === today);
    n.innerHTML = '<div class="small muted" style="margin-bottom:4px"><b>Red news today</b> (Paris time)</div>' + (list.length ? list.map(e => { const p = partsIn(TZ, new Date(e.t)); const past = e.t < Date.now(); return `<div class="nw" style="${past ? 'opacity:.5' : ''}"><span class="t">${pad(p.h)}:${pad(p.m)}</span><b>${esc(e.cur)}</b><span>${esc(e.title)}</span></div>`; }).join('') : '<div class="small">None today.</div>');
  } else if (Live.loaded) n.innerHTML = '<p class="small muted">News feed not answering — check <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">ForexFactory</a>.</p>';
}

/* ---------- planner ---------- */
const CHECKS = [ // title, how, meaning
  ['News', 'Open <b>forexfactory.com → Calendar</b>. Any <b>red</b> (high-impact) event for your two currencies in the next 2 hours? → Wait until 15 min after it.',
    'News = a scheduled announcement (interest rate, jobs, inflation). In the seconds after it, price can jump 30–50 pips in any direction and straight through your stop-loss. Red = high impact. If EURUSD is your pair, you care about EUR and USD news only. Trading 15 minutes after the release, once the jump is over, is fine.'],
  ['Strong vs weak', 'Open <b>finviz.com → Forex → Performance</b>. Buy the greenest currency against the reddest. If both are in the middle → skip.',
    'A pair is a tug-of-war between two currencies. The easiest trade is the strongest currency against the weakest: both sides push price the same way. Example: EUR is the greenest today and JPY the reddest → BUY EURJPY. If your two currencies are both average, the pair will drift sideways — no edge, skip it.'],
  ['Big chart direction', 'In MT4 open the chart <b>4× bigger</b> than your entry chart (H1 entry → H4). Heikin Ashi + Alligator on. <b>Mouth open and candles above the Lips = BUY only. Below = SELL only.</b> Lines tangled → no trade.',
    'The big chart is the river; you only swim with its current. The Alligator is three moving-average lines (Jaw, Teeth, Lips). When they are spread apart and sloping, the trend is awake. Price above the green Lips = uptrend, so you only look for BUYs. Below = only SELLs. Lines crossing each other = the trend is asleep — do nothing.'],
  ['Price structure', 'Same big chart, normal candles. BUY needs higher highs + higher lows. SELL needs lower highs + lower lows. Sideways → no trade.',
    'Look at the last 3–4 waves. A wave up ends at a peak (high), a wave down at a dip (low). Uptrend = a staircase: each peak higher than the last, each dip higher than the last. Example dips 1.0800 → 1.0830 → 1.0860, peaks 1.0880 → 1.0910 → 1.0940 = BUY zone. Downtrend is the staircase going down. Peaks and dips at the same levels = sideways, nobody is winning, no trade.'],
  ['Entry chart colour', 'Open your entry chart with Heikin Ashi. Candles must be <b>your colour</b> (green for BUY, red for SELL). Wrong colour → wait, don’t force it.',
    'Heikin Ashi candles are smoothed, so a trend shows as one solid colour block. If the big chart says BUY, you want the last 2–3 entry-chart candles to be green: the small chart agrees with the big one. Red candles while the big chart is bullish = a pullback. Don’t buy yet — wait for the colour to turn green again, that is the pullback finishing.'],
  ['Entry trigger', 'Entry chart, normal candles. Find the <b>last peak</b> (BUY) or <b>last dip</b> (SELL). Wait for <b>one candle to finish</b> past it. Enter at that close. If 2 or more candles of your colour have already finished past it → the move is gone, <b>leave it</b>.',
    '<b>Which chart?</b> Always the entry chart. The big chart only said which way (steps 3–4); you never go back to it for the entry.<br><br><b>Example — H1 direction → M15 entry (BUY)</b><br>1. H1 with Heikin Ashi + Alligator says BUY. Close H1, you are done with it.<br>2. Open M15, normal candles. Find the last peak (the most recent top before price dipped). Say it is 1.0850. Draw a horizontal line there.<br>3. Wait. M15 candles finish at :00, :15, :30, :45. Do nothing until a candle <b>finishes above</b> 1.0850 — touching is not enough.<br>4. It finishes at 1.0856 → buy at market (about 1.0856). Stop-loss a few pips below the last M15 dip, e.g. 1.0828.<br>5. Risk 0.35% (M15). Close by 22:00 Paris.<br><br><b>Too late?</b> If 2 or more green candles have already finished above the line, or price is 10+ pips past it, the entry is gone. Leave it and wait for the next peak. Chasing late = buying the top.<br><br><b>Same idea for H4 → H1:</b> direction from H4, peak and candle close on H1 (finishes every hour on the hour; MT4 clock = Paris +1), stop below the last H1 dip, risk 0.60%.'],
  ['Stop-loss placed', 'BUY: a few pips <b>below the last swing low</b>. SELL: a few pips <b>above the last swing high</b>. Type it above; the planner gives the lot size and the 1:1 target.',
    'The stop-loss is the price where your idea is proven wrong. For a BUY, the idea breaks when price falls under the last dip, so the stop goes a few pips below it (a few pips extra so a normal wick doesn’t touch it). Never put a stop just because it is “a round number of pips” — put it behind structure, then let the planner size the lot to fit.'],
  ['Calm', 'Ask: “Am I taking this because of my plan, or because of a feeling?” Feeling → close MT4 for an hour.',
    'Feelings that cost money: fear of missing out (entering late), revenge (after a loss), boredom (forcing a trade because nothing is happening), greed (bigger lots). If the honest answer is a feeling, the best trade is no trade. Close the platform, walk, come back in an hour.'],
];
let dir = 'BUY';
function setDir(d) { dir = d; document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('active', x.dataset.dir === d)); }
function initPlanner() {
  $('pInst').innerHTML = INSTRUMENTS.map(i => `<option>${i[0]}</option>`).join('');
  $('checklist').innerHTML = CHECKS.map((c, i) => `<div class="step"><input type="checkbox" id="chk${i}"><div><label for="chk${i}"><b>${i + 1}. ${c[0]}</b><div class="how">${c[1]}</div></label><div id="agc${i}"></div><details class="more"><summary>What does this mean?</summary><p>${c[2]}</p></details></div></div>`).join('');
  $('balance').value = S.get('balance', 25000);
  document.querySelectorAll('.seg button').forEach(b => { b.onclick = () => { setDir(b.dataset.dir); calc(); }; });
  ['pInst', 'pEtf', 'pEntry', 'pSl', 'pTp'].forEach(id => $(id).addEventListener('input', calc));
  $('balance').addEventListener('input', () => { S.set('balance', +$('balance').value || 0); calc(); rejudge(); });
  document.querySelectorAll('#checklist input').forEach(i => i.addEventListener('change', calc));
  calc();
}
function renderPairInfo(inst) {
  const openIds = SESSIONS.filter(x => status(x).open).map(x => x.id);
  const names = inst.sessions.map(id => SESSIONS.find(x => x.id === id));
  const win = names.map(x => { const off = offset(x.tz), w = windows(x)[0]; return w ? `${x.name} ${hm(w[0] - off)}–${hm(w[1] - off)}` : x.name; });
  const inSession = inst.sessions.some(id => openIds.includes(id)), closed = forexClosed();
  const sessTxt = `Best in ${win.join(', ')} Paris`;
  const L = [];
  if (closed) L.push(['r', 'Market closed (weekend)', sessTxt + '.']);
  else if (inSession) L.push(['g', 'Right time now', sessTxt + ' — its home session is open.']);
  else L.push(['r', 'Wrong time now', sessTxt + ' — wait for that session.']);
  L.push(['n', 'What moves it', inst.drivers + '.']);
  if (!inst.beginner) L.push(['r', 'Hard pair for a beginner', inst.note]);
  L.push(biasLine(inst, dir, Live.st, Live.loaded));
  L.push(newsLine(inst, Live.news, Live.loaded));
  $('pairInfo').innerHTML = L.map(([c, t, d]) => `<div class="pi ${c}"><i></i><div><b>${t}.</b> ${d}</div></div>`).join('');
}
// What the agents see for each checklist step (steps 1-7; step 8 "Calm" is always yours).
function agentEvidence(inst, etf) {
  const ev = new Array(CHECKS.length).fill(null);
  const n = newsLine(inst, Live.news, Live.loaded), b = biasLine(inst, dir, Live.st, Live.loaded);
  const cls = c => (c === 'g' ? 'pass' : c === 'r' ? 'fail' : 'warn');
  if (Live.loaded) { ev[0] = { st: cls(n[0]), t: n[1] }; ev[1] = { st: cls(b[0]), t: b[1] }; }
  const item = A.scan && A.scan.items.find(x => x.sym === inst.sym && x.entryTf === etf);
  if (!MODES[etf]) { ev[2] = { st: 'warn', t: `Agents scan M15, H1 and H4 entries, not ${etf}. Check this step yourself.` }; return { ev, item: null }; }
  if (!item) { ev[2] = { st: 'warn', t: A.scan ? `Agents are not watching ${inst.sym} on ${etf}. Turn it on in the Agents tab.` : 'Waiting for the first agent scan…' }; return { ev, item: null }; }
  if (item.stage === 'ERROR') { ev[2] = { st: 'warn', t: item.why }; return { ev, item }; }
  const find = id => item.checks.find(c => c.id === id);
  const st = c => (c.ok === true ? 'pass' : c.ok === false ? 'fail' : 'warn');
  if (item.dir && item.dir !== dir) {
    ev[2] = { st: 'fail', t: `${item.dirTf} says ${item.dir} only — against your ${dir}.` };
    return { ev, item };
  }
  const map = { 2: 'big', 3: 'structure', 4: 'colour', 5: 'trigger' };
  for (const [i, id] of Object.entries(map)) { const c = find(id); if (c) ev[i] = { st: st(c), t: c.t }; }
  if (item.sl != null) ev[6] = { st: item.stage === 'TRIGGER' ? 'pass' : 'warn', t: `Agent's stop: ${px(item.sl, inst.pip)} (${Math.round(item.slPips)} pips). Compare with your chart.` };
  return { ev, item };
}
function calc() {
  const inst = INST[$('pInst').value], etf = $('pEtf').value, bal = +$('balance').value || 0;
  const entry = +$('pEntry').value, sl = +$('pSl').value, tp = +$('pTp').value;
  const z = sizeTrade(inst, etf, bal, entry, sl, tp), { riskPct, slDist, slPips, riskMoney, lots, rr, realRisk, reward } = z;
  renderPairInfo(inst);
  $('riskHint').textContent = `Risk for ${etf}: ${riskPct}% = $${riskMoney.toFixed(0)}`;
  $('tpSuggest').textContent = entry && sl ? `1:1 target → ${px(dir === 'BUY' ? entry + slDist : entry - slDist, inst.pip)}` : '';
  const wp = v => Math.floor(v + 1e-9);
  $('calcOut').innerHTML = [['Lot size', lots ? lots.toFixed(2) : '—'], ['Stop-loss', slPips ? wp(slPips) + ' pips' : '—'], ['Risk', `$${(lots ? realRisk : riskMoney).toFixed(0)} · ${riskPct}%`], ['R : R', rr ? '1 : ' + rr.toFixed(1) : '—'], ['If TP hits', lots ? '+$' + reward.toFixed(0) : '—'], ['If SL hits', lots ? '−$' + realRisk.toFixed(0) : '—']].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const pipRule = inst.pip === 0.0001 ? '1 pip = 4th decimal (ignore the 5th digit)' : inst.pip === 0.01 && inst.quote === 'JPY' ? '1 pip = 2nd decimal (ignore the 3rd digit)' : inst.pip === 0.1 ? '1 pip = 0.10' : inst.pip === 0.01 ? '1 pip = 0.01' : '1 pip = 1 point';
  $('calcFormula').innerHTML = slPips ? `<b>Pips:</b> ${px(entry, inst.pip)} − ${px(sl, inst.pip)} = ${slDist.toFixed(inst.pip < 1 ? 5 : 2).replace(/0+$/, '').replace(/\.$/, '')} → <b>${wp(slPips)} pips</b> (${pipRule}).<br><b>Lots:</b> $${riskMoney.toFixed(0)} risk ÷ (${wp(slPips)} pips × $${inst.pipVal} per pip per lot) = <b>${lots.toFixed(2)}</b>. Check: 10 pips on 0.01 lot ≈ $1.` : `Enter entry and stop-loss to get the lot size. ${pipRule}.`;
  // agent evidence under each checklist step
  const { ev } = agentEvidence(inst, etf);
  ev.forEach((e, i) => { $('agc' + i).innerHTML = e ? `<div class="aic ${e.st}"><i></i><span><b>Agents:</b> ${e.t}</span></div>` : ''; });
  // rules
  const rules = []; const R = (st, t, w) => rules.push({ st, t, w }); const ready = entry > 0 && sl > 0 && tp > 0, short = SHORT.includes(etf);
  if (ready) {
    const slOk = dir === 'BUY' ? sl < entry : sl > entry, tpOk = dir === 'BUY' ? tp > entry : tp < entry;
    R(slOk ? 'pass' : 'fail', slOk ? 'Stop-loss on the correct side' : 'Stop-loss on the wrong side', slOk ? '' : (dir === 'BUY' ? 'BUY: stop must be below entry.' : 'SELL: stop must be above entry.'));
    R(tpOk ? 'pass' : 'fail', tpOk ? 'Take-profit on the correct side' : 'Take-profit on the wrong side', '');
    R(rr >= 0.999 ? 'pass' : 'fail', `Reward ${rr.toFixed(1)}× the risk`, rr >= 0.999 ? '' : 'Rule 3: take-profit must be at least 1× the stop distance (1:1).');
    if (slPips < 5) R('fail', `Stop only ${slPips.toFixed(1)} pips — check your prices`, 'Entry and stop-loss are almost the same number. A real stop is usually 10–50 pips (ideally 30+ on H1).');
    else if (lots < 0.01) R('fail', 'Stop too wide for this risk', 'Find a closer stop level or use a bigger chart.');
    else if (slPips < 15 && !short) R('warn', `Stop ${wp(slPips)} pips is tight for ${etf}`, 'Ideally 30+ pips on H1/H4 so normal noise does not hit it.');
  }
  // the trade being planned is not "another trade" if it is already tracked with the same entry
  const others = openTrades().filter(o => !(o.sym === inst.sym && o.dir === dir && Math.abs(o.entry - entry) < inst.pip / 2));
  for (const r of accountRules(inst, etf, { tc: ctx(), open: others })) rules.push(r);
  const missing = CHECKS.filter((x, i) => !$('chk' + i).checked);
  R(missing.length ? 'fail' : 'pass', missing.length ? `${missing.length} checklist step${missing.length > 1 ? 's' : ''} not done` : 'Checklist complete', missing.map(m => m[0]).join(' · '));
  $('ruleCheck').innerHTML = rules.map(ruleRow).join('');
  const v = $('verdict'), fails = rules.filter(r => r.st === 'fail'), warns = rules.filter(r => r.st === 'warn');
  if (!ready) { v.className = 'verdict hidden'; return; }
  if (fails.length) { v.className = 'verdict skip'; v.innerHTML = `<div class="big">✕ NO TRADE</div><div class="small">${fails.map(f => f.t).join(' · ')}</div>`; }
  else {
    const head = warns.length ? `<div class="big">! TAKE WITH CARE</div><div class="small">${warns.map(f => f.t).join(' · ')}</div>` : `<div class="big">✓ TAKE — ${inst.sym} ${dir} ${lots.toFixed(2)} lots</div><div class="small">Entry ${px(entry, inst.pip)} · SL ${px(sl, inst.pip)} · TP ${px(tp, inst.pip)}. Place it, then don’t touch it.</div>`;
    v.className = 'verdict ' + (warns.length ? 'care' : 'take');
    v.innerHTML = head + '<div class="acts"><button class="btn sm" id="planTook">I placed it — track this trade</button></div>';
    $('planTook').onclick = () => { logTrade({ sym: inst.sym, dir, tf: etf, entry, sl, tp, lots, riskPct, rr }); showTab('agents'); };
  }
}

/* ============================================================
   AGENTS
   ============================================================ */
const A = {
  scan: null, err: null, okAt: 0, busy: false, nextAt: 0, lastTs: 0, log: [],
  cfg: Object.assign({ modes: ['H1'], groups: ['fx'], notify: false, sound: true, tgToken: '', tgChat: '' }, S.get('agentCfg', {})),
  seen: S.get('seenSig', {}), judged: new Map(), openRows: new Set(), lastSummary: '',
  ai: { available: null }, briefs: new Map(), ev: new Map(), openEv: new Set(),
};
A.cfg.modes = A.cfg.modes.filter(m => MODES[m]); if (!A.cfg.modes.length) A.cfg.modes = ['H1'];
A.cfg.groups = A.cfg.groups.filter(g => GROUPS[g]); if (!A.cfg.groups.length) A.cfg.groups = ['fx'];
const saveCfg = () => S.set('agentCfg', A.cfg);
const hhmm = ms => { const p = partsIn(TZ, new Date(ms)); return `${pad(p.h)}:${pad(p.m)}`; };

function pushLog(lines, ts = Date.now()) {
  for (const l of lines) A.log.unshift({ ts, a: l.a, m: l.m });
  A.log.length = Math.min(A.log.length, 80);
  renderLog();
}
function renderLog() {
  $('agentLog').innerHTML = A.log.length ? A.log.map(l => `<div><span class="muted">${hhmm(l.ts)}</span><span class="a">${esc(l.a)}</span><span>${esc(l.m)}</span></div>`).join('') : '<p class="small muted" style="font-family:Inter,sans-serif">Nothing yet. The first scan starts as soon as the page opens.</p>';
}

const minEntryMs = () => Math.min(...A.cfg.modes.map(m => MODES[m].entrySec)) * 1000;
function schedule() {
  const now = Date.now(), step = minEntryMs();
  const afterClose = Math.ceil(now / step) * step + 12000; // 12 s after the next candle finishes
  A.nextAt = Math.min(now + 60000, afterClose > now + 5000 ? afterClose : now + 60000);
}
async function poll() {
  if (A.busy) return;
  A.busy = true;
  const bucket = Math.floor(Date.now() / minEntryMs()); // new URL after each candle close = fresh answer
  try {
    const r = await fetch(`/api/scan?modes=${A.cfg.modes.join(',')}&groups=${A.cfg.groups.join(',')}&b=${bucket}`);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
    A.scan = j; A.err = null; A.okAt = Date.now();
    if (j.strength) Live.st = j.strength;
    if (j.ts !== A.lastTs) {
      A.lastTs = j.ts;
      const summary = j.log.filter(l => l.a === 'Strategist').map(l => l.m).join(' | ');
      pushLog(summary === A.lastSummary ? j.log.filter(l => l.a === 'Scout') : j.log, j.ts);
      A.lastSummary = summary;
    }
  } catch (e) {
    A.err = String(e.message || e);
    pushLog([{ a: 'Scout', m: 'Live feed did not answer: ' + A.err }]);
  }
  Live.loaded = true; A.busy = false;
  schedule(); renderLive(); calc(); rejudge();
  for (const id of A.openEv) loadEvidence(id); // keep any open proof in step with the newest candles
}
function agentTick() {
  if (A.nextAt && Date.now() >= A.nextAt) poll();
  const n = $('agNext'), c = $('agClose');
  if (n) n.textContent = A.busy ? 'Reading the market…' : `Next read in ${Math.max(0, Math.ceil((A.nextAt - Date.now()) / 1000))}s`;
  if (c) {
    c.textContent = A.cfg.modes.map(m => { const len = MODES[m].entrySec * 1000, left = Math.ceil((Math.ceil(Date.now() / len) * len - Date.now()) / 1000); return `${m} candle closes in ${left >= 3600 ? Math.floor(left / 3600) + 'h ' : ''}${pad(Math.floor(left % 3600 / 60))}:${pad(left % 60)}`; }).join(' · ');
  }
}

/* ----- Risk Guard: judge every finding with the trader's own numbers ----- */
const guardParams = () => ({ balance: +$('balance').value || 0, tc: ctx(), strength: Live.st, news: Live.news, loaded: Live.loaded, open: openTrades(), now: new Date() });
const sigOf = x => x.sig || x.id;
function rejudge() {
  if (!A.scan) { renderAgents(); return; }
  const p = guardParams();
  // a setup you already placed must not be blocked by its own open trade
  A.judged = new Map(A.scan.items.map(x => [x.id, judge(x, x.sig ? { ...p, open: p.open.filter(o => o.sig !== x.sig) } : p)]));
  for (const x of A.scan.items) {
    if (x.stage !== 'TRIGGER' || A.seen[x.sig]) continue;
    const j = A.judged.get(x.id), inst = INST[x.sym];
    A.seen[x.sig] = Date.now();
    const plan = `Entry ${px(x.entry, inst.pip)} · SL ${px(x.sl, inst.pip)} · TP ${px(x.tp, inst.pip)} (${x.entryTf})`;
    if (j.verdict === 'skip') pushLog([{ a: 'Risk Guard', m: `${x.sym} ${x.dir} blocked: ${j.fails.map(f => f.t).join('; ')}` }]);
    else {
      const head = `${x.sym} ${x.dir} — ${j.verdict === 'take' ? 'TAKE' : 'TAKE WITH CARE'}${j.size ? ' ' + j.size.lots.toFixed(2) + ' lots' : ''}`;
      pushLog([{ a: 'Risk Guard', m: `${head}. ${plan}` }]);
      alertUser(head, plan + (j.warns.length ? `\nCare: ${j.warns.map(w => w.t).join('; ')}` : ''));
    }
  }
  const cut = Date.now() - 3 * 864e5;
  for (const k of Object.keys(A.seen)) if (A.seen[k] < cut) delete A.seen[k];
  S.set('seenSig', A.seen);
  renderAgents();
}

/* ----- alerts ----- */
function beep() {
  try {
    const C = window.AudioContext || window.webkitAudioContext, ac = new C(), o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.65);
  } catch (e) { /* no audio */ }
}
async function telegram(text) {
  if (!A.cfg.tgToken || !A.cfg.tgChat) return false;
  const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(A.cfg.tgToken)}/sendMessage`, { method: 'POST', body: new URLSearchParams({ chat_id: A.cfg.tgChat, text }) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description || 'HTTP ' + r.status);
  return true;
}
function alertUser(title, body) {
  if (A.cfg.sound) beep();
  try { if (A.cfg.notify && 'Notification' in window && Notification.permission === 'granted') new Notification('Trading Mastery: ' + title, { body, tag: title }); } catch (e) { /* ignore */ }
  telegram(`${title}\n${body}`).catch(e => pushLog([{ a: 'Risk Guard', m: 'Telegram alert failed: ' + e.message }]));
  document.title = '● ' + title;
  setTimeout(() => { document.title = 'Trading Mastery Dashboard'; }, 60000);
}

/* ----- journal: open trades (needed for "no two trades on the same currency" and "max 3% open") ----- */
function logTrade(t) {
  const open = openTrades();
  open.push({ id: Date.now().toString(36), at: Date.now(), ...t });
  S.set('open', open);
  pushLog([{ a: 'Risk Guard', m: `Tracking ${t.sym} ${t.dir} ${t.lots.toFixed(2)} lots, ${t.riskPct}% at risk.` }]);
  calc(); rejudge();
}
function closeTrade(id, result) {
  const open = openTrades(), t = open.find(o => o.id === id);
  if (!t) return;
  S.set('open', open.filter(o => o.id !== id));
  const hist = S.get('hist', []); hist.unshift({ ...t, result, closedAt: Date.now() }); hist.length = Math.min(hist.length, 300); S.set('hist', hist);
  if (result === 'SL') { const st = slState(); st.times.push(Date.now()); S.set('sl', st); }
  pushLog([{ a: 'Risk Guard', m: `${t.sym} ${t.dir} closed: ${result === 'TP' ? 'take-profit' : result === 'SL' ? 'stop-loss (break rule started)' : 'by hand'}.` }]);
  refreshPersonal();
}
function renderOpenTrades() {
  const open = openTrades(), hist = S.get('hist', []), used = open.reduce((s, o) => s + (o.riskPct || 0), 0);
  const week = hist.filter(h => Date.now() - h.closedAt < 7 * 864e5), tp = week.filter(h => h.result === 'TP').length, sl = week.filter(h => h.result === 'SL').length;
  let html = open.length ? open.map(o => {
    const inst = INST[o.sym];
    return `<div class="wrow"><div class="hd">${o.sym} <span class="dir ${o.dir}">${o.dir}</span><span class="mono small muted">${o.lots.toFixed(2)} lots · ${o.riskPct}% · ${o.tf}</span></div><div class="sub mono">Entry ${px(o.entry, inst.pip)} · SL ${px(o.sl, inst.pip)} · TP ${px(o.tp, inst.pip)} · since ${hhmm(o.at)}</div><div class="acts" style="margin-top:8px"><button class="btn sm" data-close="TP" data-id="${o.id}">TP hit</button><button class="btn red sm" data-close="SL" data-id="${o.id}">SL hit</button><button class="btn sm" data-close="MANUAL" data-id="${o.id}">Closed by hand</button></div></div>`;
  }).join('') : '<p class="small muted">No open trades tracked. Press “I placed it” on a setup so the Risk Guard can count your open risk and block a second trade on the same currency.</p>';
  html += `<p class="small muted" style="margin-top:10px">Open risk <b class="mono">${used.toFixed(2)}%</b> of 3% · last 7 days: ${week.length} closed, ${tp} TP, ${sl} SL.</p>`;
  $('openTrades').innerHTML = html;
  $('openTrades').querySelectorAll('[data-close]').forEach(b => { b.onclick = () => closeTrade(b.dataset.id, b.dataset.close); });
}

/* ----- rendering ----- */
const VERD = { take: ['take', '✓ TAKE'], care: ['care', '! TAKE WITH CARE'], skip: ['skip', '✕ NO TRADE'], wait: ['wait', '… NOT READY'] };
const dirTag = d => (d ? `<span class="dir ${d}">${d}</span>` : '');
function renderAgentCards() {
  const s = A.scan, live = A.okAt && Date.now() - A.okAt < 150000;
  const pill = !s && !A.err ? '<span class="pill info">starting…</span>' : live ? '<span class="pill ok">● live</span>' : '<span class="pill bad">feed error</span>';
  const n = st => (s ? s.items.filter(x => x.stage === st).length : 0);
  const c = ctx(), open = openTrades(), used = open.reduce((a, o) => a + (o.riskPct || 0), 0);
  const today = partsIn(TZ).date, newsToday = (Live.news || []).filter(e => partsIn(TZ, new Date(e.t)).date === today), nextNews = newsToday.find(e => e.t > Date.now());
  const timeTxt = c.weekend ? 'Weekend: no trading' : c.fri21 ? 'Friday after 21:00: no new trades' : c.after22 ? 'After 22:00: no short-chart trades' : 'Time OK';
  const lossTxt = c.losses >= 2 ? 'done for today' : c.breakLeft > 0 ? `break ${c.breakLeft} min` : 'OK';
  const cards = [
    ['1', 'Scout', pill, 'Reads live candles from Yahoo Finance and red news from ForexFactory.',
      [s ? `${new Set(s.items.map(x => x.sym)).size} instruments · ${s.modes.map(m => MODES[m].dirTf + ' → ' + m).join(', ')}` : (A.err ? esc(A.err) : 'Connecting to the live feed…'),
        s ? `Last read ${hhmm(s.ts)} Paris, took ${(s.tookMs / 1000).toFixed(1)}s${s.errors.length ? ` · ${s.errors.length} feed error${s.errors.length > 1 ? 's' : ''}` : ''}` : '', '<span id="agNext"></span>']],
    ['2', 'Strategist', s ? `<span class="pill ${n('TRIGGER') ? 'ok' : 'closed'}">${n('TRIGGER')} ready</span>` : '', 'Applies the checklist: big chart, structure, colour, candle close.',
      [s ? `${n('WATCH')} forming · ${n('LATE')} missed · ${n('NONE')} no trend` : '', '<span id="agClose"></span>']],
    ['3', 'Risk Guard', `<span class="pill ${c.weekend || c.fri21 || c.losses >= 2 || c.breakLeft > 0 ? 'bad' : 'ok'}">${c.weekend || c.fri21 || c.losses >= 2 || c.breakLeft > 0 ? 'blocking' : 'clear'}</span>`, 'Checks My 3 rules and sizes the lot. Runs in this browser.',
      [`${timeTxt} · stop-losses today ${c.losses} (${lossTxt})`, `Open risk ${used.toFixed(2)}% of 3% · ${open.length} trade${open.length === 1 ? '' : 's'}`,
        Live.news ? (newsToday.length ? `Red news today: ${newsToday.length}${nextNews ? `, next ${hhmm(nextNews.t)} ${esc(nextNews.cur)}` : ', all released'}` : 'No red news today') : 'News: loading…']],
  ];
  $('agentCards').innerHTML = cards.map(([num, name, pl, what, lines]) => `<div class="card"><div class="agent"><div class="av">${num}</div><div><div class="nm">${name} ${pl}</div><div class="small muted">${what}</div>${lines.filter(Boolean).map(l => `<div class="ln">${l}</div>`).join('')}</div></div></div>`).join('');
  agentTick();
}
function levelsHtml(x, j) {
  const inst = INST[x.sym], z = j.size, f = v => px(v, inst.pip);
  const cells = [['Entry', f(x.entry)], ['Stop-loss', f(x.sl)], ['Take-profit', f(x.tp)], ['Stop', Math.round(x.slPips) + ' pips'], ['Lots', z && z.lots ? z.lots.toFixed(2) : '—'], [z ? `Risk ${z.riskPct}%` : 'Risk', z && z.lots ? `$${z.realRisk.toFixed(0)}` : '—']];
  return `<div class="lv">${cells.map(([l, v]) => `<div><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div>`;
}
/* ----- optional AI analyst: a short second opinion written by a language model ----- */
async function pingAi() {
  try { A.ai = await (await fetch('/api/brief?ping=1')).json(); } catch (e) { A.ai = { available: false, reason: 'AI analyst unreachable.' }; }
  $('aiStatus').textContent = A.ai.available ? `On · ${A.ai.model} via ${A.ai.provider}. It writes a short second opinion on ready setups. It never decides.` : `Off · ${A.ai.reason || 'Not connected.'} The three agents work without it.`;
  renderAgents();
}
async function loadBrief(x) {
  if (!A.ai.available || !x.bk || A.briefs.has(x.bk)) return;
  A.briefs.set(x.bk, { loading: true });
  try {
    const j = await (await fetch(`/api/brief?sym=${x.sym}&mode=${x.mode}&k=${encodeURIComponent(x.bk)}`)).json();
    A.briefs.set(x.bk, j.available ? { text: j.text } : { reason: j.reason || 'No answer.' });
    if (j.available) pushLog([{ a: 'Analyst', m: `Second opinion written for ${x.sym} ${x.dir}.` }]);
  } catch (e) { A.briefs.set(x.bk, { reason: 'AI analyst did not answer.' }); }
  renderAgents();
}
function briefHtml(x) {
  if (!A.ai.available || !x.bk) return '';
  const b = A.briefs.get(x.bk);
  const body = !b ? `<a href="#" data-ask="${x.id}" style="color:var(--accent)">Ask for a second opinion</a>` : b.loading ? 'Reading the setup…' : b.text ? esc(b.text).replace(/\n/g, '<br>') : `<span class="muted">${esc(b.reason)}</span>`;
  return `<div class="ai"><h4>AI analyst · second opinion, not a signal</h4>${body}</div>`;
}
// The lecture's own reading of the same chart, for comparison with the checklist plan.
const lectureHtml = x => (x.lecture ? `<div class="ai"><h4>Sarmaya lecture view · for comparison</h4>${esc(x.lecture.text)}${(x.lecture.plans || []).length ? `<div class="small" style="margin-top:6px">Size it in the planner: ${x.lecture.plans.map((p, n) => `<a href="#" data-lecture="${x.id}" data-n="${n}" style="color:var(--accent)">${esc(p.label)}</a>`).join(' · ')}</div>` : ''}</div>` : '');
function renderSignals() {
  const s = A.scan, box = $('signals');
  if (!s) { box.innerHTML = `<div class="card"><p class="muted">${A.err ? 'The live feed did not answer. The agents retry every minute.' : 'The agents are reading the market for the first time…'}</p></div>`; return; }
  const trig = s.items.filter(x => x.stage === 'TRIGGER');
  if (!trig.length) {
    const w = s.items.filter(x => x.stage === 'WATCH').length;
    box.innerHTML = `<div class="verdict wait"><div class="big">No setup is ready right now</div><div class="small">${w ? `${w} setup${w > 1 ? 's are' : ' is'} forming below.` : 'Nothing is forming either.'} The agents check again every minute and right after each candle closes. No trade is also a decision.</div></div>`;
    return;
  }
  box.innerHTML = trig.map(x => {
    const j = A.judged.get(x.id), [cls, word] = VERD[j.verdict], inst = INST[x.sym];
    const took = openTrades().some(o => o.sig === x.sig);
    const title = took ? `✓ PLACED — ${x.sym} ${x.dir}, now leave it alone` : j.verdict === 'take' || j.verdict === 'care' ? `${word} — ${x.sym} ${x.dir}${j.size && j.size.lots ? ' ' + j.size.lots.toFixed(2) + ' lots' : ''}` : `${word} — ${x.sym} ${x.dir} setup`;
    const sub = took ? 'Tracked under Open trades. Do not move the stop further away. Do not add size.' : j.verdict === 'skip' ? j.fails.map(f => f.t).join(' · ') : j.verdict === 'care' ? j.warns.map(f => f.t).join(' · ') : 'Every rule passes. Check the chart on MT4, tick Calm, place it, then don’t touch it.';
    return `<div class="sig"><div class="grid" style="align-content:start">
      <div class="verdict ${cls}"><div class="big">${title}</div><div class="small">${sub}</div></div>
      <div class="card"><h2>${x.setup} · ${x.entryTf} entry, ${x.dirTf} direction · valid until ${hhmm(x.validUntil * 1000)} Paris</h2>
        <p>${esc(x.why)}</p>${levelsHtml(x, j)}<div class="chart" data-chart="${x.id}"></div>
        <div class="acts"><button class="btn pri" data-plan="${x.id}">Open in planner</button>${j.verdict !== 'skip' ? `<button class="btn" data-took="${x.id}" ${took ? 'disabled' : ''}>${took ? 'Tracked' : 'I placed it'}</button>` : ''}</div>
        ${lectureHtml(x)}${briefHtml(x)}
      </div></div>
      <div class="card"><h2>Why · rule by rule</h2>${j.rules.map(ruleRow).join('')}</div></div>`;
  }).join('');
}
function renderWatch() {
  const s = A.scan, box = $('watchList');
  if (!s) { box.innerHTML = '<p class="small muted">Waiting for the first scan…</p>'; return; }
  const watch = s.items.filter(x => x.stage === 'WATCH'), late = s.items.filter(x => x.stage === 'LATE');
  let html = watch.map(x => {
    const j = A.judged.get(x.id), blockers = j.fails;
    const pre = blockers.length ? `<span class="pill bad" title="${esc(blockers.map(b => b.t).join(' · '))}">would be blocked</span>` : j.warns.length ? '<span class="pill soon">would need care</span>' : '<span class="pill ok">rules clear so far</span>';
    return `<details class="wrow" data-row="${x.id}" ${A.openRows.has(x.id) ? 'open' : ''}><summary><div><div class="hd">${x.sym} ${dirTag(x.dir)}<span class="mono small muted">${x.dirTf} → ${x.entryTf}</span>${pre}</div><div class="sub">${esc(x.why)}${blockers.length ? ` <span class="muted">Blocked now by: ${blockers.map(b => b.t).join(' · ')}.</span>` : ''}</div></div><span class="small" style="color:var(--accent);white-space:nowrap">details</span></summary>
      <div class="sig" style="margin-top:10px"><div><p class="small muted">Plan if it triggers (the entry is the candle close, so it will move a little):</p>${levelsHtml(x, j)}<div class="chart" data-chart="${x.id}"></div><div class="acts"><button class="btn sm" data-plan="${x.id}">Open in planner</button></div>${lectureHtml(x)}${briefHtml(x)}</div><div>${j.rules.map(ruleRow).join('')}</div></div></details>`;
  }).join('');
  if (!watch.length) html = '<p class="small muted">Nothing is forming. Either the bigger charts have no clean trend, or the entries were already missed.</p>';
  if (late.length) html += `<p class="small muted" style="margin-top:10px"><b>Missed, do not chase:</b> ${late.map(x => `${x.sym} ${x.dir} (${x.entryTf})`).join(' · ')}. Wait for the next ${late.some(x => x.dir === 'BUY') ? 'peak' : 'dip'}.</p>`;
  box.innerHTML = html;
  box.querySelectorAll('details[data-row]').forEach(d => d.addEventListener('toggle', () => { if (d.open) A.openRows.add(d.dataset.row); else A.openRows.delete(d.dataset.row); drawCharts(); }));
}
// Proof for one row: what the agents read, where it came from, and a link to check it elsewhere.
async function loadEvidence(id) {
  const [sym, mode] = id.split(':');
  if (!A.ev.has(id)) A.ev.set(id, { loading: true });
  try {
    const r = await fetch(`/api/chart?sym=${sym}&mode=${mode}`), j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
    if (A.openEv.has(id)) A.ev.set(id, j);
  } catch (e) { if (A.openEv.has(id)) A.ev.set(id, { error: String(e.message || e) }); }
  renderBoard(); drawCharts();
}
function evidenceHtml(x) {
  const d = A.ev.get(x.id), inst = INST[x.sym];
  if (!d || d.loading) return '<p class="small muted">Loading the candles the agents used…</p>';
  if (d.error) return `<p class="small muted">Could not load the proof: ${esc(d.error)}</p>`;
  const last = d.entry.bars[d.entry.bars.length - 1], lastBig = d.big.bars[d.big.bars.length - 1];
  const rules = (d.item.checks || []).map(c => ruleRow({ st: c.st || (c.ok === true ? 'pass' : c.ok === false ? 'fail' : 'wait'), t: c.t, w: c.d })).join('');
  return `<div class="sig">
    <div><h3>${d.big.tf} direction chart · Heikin Ashi now ${d.big.ha}</h3><div class="chart" data-ev="${x.id}|big"></div></div>
    <div><h3>${d.entry.tf} entry chart</h3><div class="chart" data-ev="${x.id}|entry"></div></div></div>
    <p class="small muted" style="margin-top:6px">Lines: Jaw (blue), Teeth (red), Lips (green). Dots: the peaks and dips the agents count, hollow = still moving. Hover a candle for its prices.</p>
    <div style="margin-top:8px">${rules}</div>
    <p class="small" style="margin-top:10px"><b>Check it yourself:</b> <a href="${tvUrl(x.sym, d.big.tf)}" target="_blank" rel="noopener" style="color:var(--accent)">${x.sym} ${d.big.tf} on TradingView</a> · <a href="${tvUrl(x.sym, d.entry.tf)}" target="_blank" rel="noopener" style="color:var(--accent)">${x.sym} ${d.entry.tf} on TradingView</a>. Add Williams Alligator there (13/8/5, offsets 8/5/3).</p>
    <p class="small muted" style="margin-top:4px">Source: Yahoo Finance candles, ticker ${esc(d.feed)}${d.note ? ` (${esc(d.note)})` : ''}. Last finished candles: ${d.big.tf} ${hhmm((lastBig[0] + MODES[x.mode].dirSec) * 1000)}, ${d.entry.tf} ${hhmm((last[0] + MODES[x.mode].entrySec) * 1000)} Paris, close ${px(last[4], inst.pip)}. Another data provider can differ by a pip or two. If the picture differs by more than that, the agent is wrong, not you.</p>
    <div class="acts"><button class="btn sm" data-toplan="${x.id}">Open in planner</button></div>`;
}
const STAGE = { TRIGGER: ['ok', 'ready'], WATCH: ['info', 'forming'], LATE: ['soon', 'missed'], NONE: ['closed', 'no trade'], ERROR: ['bad', 'no feed'] };
function renderBoard() {
  const s = A.scan, body = document.querySelector('#board tbody');
  if (!s) { body.innerHTML = '<tr><td colspan="5" class="muted">Waiting for the first scan…</td></tr>'; return; }
  body.innerHTML = s.items.map(x => {
    const [cls, word] = STAGE[x.stage], open = A.openEv.has(x.id);
    return `<tr style="cursor:pointer" data-row="${x.id}"><td><b>${x.sym}</b>${x.price != null ? `<div class="mono small muted">${px(x.price, INST[x.sym].pip)}</div>` : ''}</td><td class="mono small">${x.dirTf} → ${x.entryTf}</td><td>${x.dir ? dirTag(x.dir) + ' <span class="small muted">only</span>' : '<span class="small muted">asleep</span>'}</td><td><span class="pill ${cls}">${word}</span></td><td class="small">${esc(x.why)} <span style="color:var(--accent);white-space:nowrap">${open ? 'hide proof' : 'show proof'}</span></td></tr>` + (open ? `<tr class="ev"><td colspan="5">${evidenceHtml(x)}</td></tr>` : '');
  }).join('');
  body.querySelectorAll('tr[data-row]').forEach(tr => {
    tr.onclick = () => {
      const id = tr.dataset.row;
      if (A.openEv.has(id)) { A.openEv.delete(id); A.ev.delete(id); renderBoard(); }
      else { A.openEv.add(id); renderBoard(); loadEvidence(id); }
    };
  });
  body.querySelectorAll('[data-toplan]').forEach(b => {
    b.onclick = () => { const it = s.items.find(x => x.id === b.dataset.toplan); if (!it) return; if (it.entry != null) return openInPlanner(it.id); $('pInst').value = it.sym; $('pEtf').value = it.entryTf; if (it.dir) setDir(it.dir); calc(); showTab('planner'); };
  });
}
function renderHome() {
  const s = A.scan, pill = $('homeAgentPill'), box = $('homeAgents'), live = A.okAt && Date.now() - A.okAt < 150000;
  pill.className = 'pill ' + (!s && !A.err ? 'info' : live ? 'ok' : 'bad'); pill.textContent = !s && !A.err ? 'starting…' : live ? '● live' : 'feed error';
  let good = 0, html = '';
  if (s) {
    const trig = s.items.filter(x => x.stage === 'TRIGGER'), watch = s.items.filter(x => x.stage === 'WATCH');
    for (const x of trig) { const j = A.judged.get(x.id), [cls, word] = VERD[j.verdict]; if (j.verdict !== 'skip') good++; html += ruleRow({ st: cls === 'take' ? 'pass' : cls === 'care' ? 'warn' : 'fail', t: `${x.sym} ${x.dir} (${x.entryTf}): ${word.slice(2)}`, w: j.verdict === 'skip' ? j.fails.map(f => f.t).join(' · ') : esc(x.why) }); }
    if (!trig.length) html += ruleRow({ st: 'wait', t: 'No setup ready', w: watch.length ? `Forming: ${watch.slice(0, 4).map(x => `${x.sym} ${x.dir}`).join(' · ')}${watch.length > 4 ? ` +${watch.length - 4}` : ''}` : 'Nothing forming on the charts you watch.' });
  } else html = `<p class="small muted">${A.err ? 'Live feed did not answer. Retrying every minute.' : 'Reading the market…'}</p>`;
  box.innerHTML = html + '<div style="margin-top:10px"><button class="btn sm" id="goAgents">Open agents</button></div>';
  $('goAgents').onclick = () => showTab('agents');
  $('navBadge').innerHTML = good ? `<span class="pill ok">${good}</span>` : '';
}
function renderAgents() {
  renderAgentCards(); renderSignals(); renderWatch(); renderBoard(); renderOpenTrades(); renderHome();
  document.querySelectorAll('[data-plan]').forEach(b => { b.onclick = () => openInPlanner(b.dataset.plan); });
  document.querySelectorAll('[data-lecture]').forEach(b => { b.onclick = e => { e.preventDefault(); openInPlanner(b.dataset.lecture, +b.dataset.n); }; });
  document.querySelectorAll('[data-ask]').forEach(b => { b.onclick = e => { e.preventDefault(); const x = A.scan.items.find(i => i.id === b.dataset.ask); if (x) loadBrief(x); }; });
  if (A.scan) for (const x of A.scan.items) if (x.stage === 'TRIGGER') loadBrief(x); // ready setups get their second opinion automatically
  document.querySelectorAll('[data-took]').forEach(b => { b.onclick = () => { const x = A.scan.items.find(i => i.id === b.dataset.took), j = A.judged.get(x.id); if (!j.size || !j.size.lots) return; logTrade({ sym: x.sym, dir: x.dir, tf: x.entryTf, entry: x.entry, sl: x.sl, tp: x.tp, lots: j.size.lots, riskPct: j.size.riskPct, rr: j.size.rr, sig: x.sig }); }; });
  drawCharts();
}
// planIndex = which lecture plan to size instead of the checklist plan (omit for the checklist plan)
function openInPlanner(id, planIndex = -1) {
  const x = A.scan && A.scan.items.find(i => i.id === id); if (!x) return;
  const inst = INST[x.sym], p = (planIndex >= 0 && x.lecture && x.lecture.plans && x.lecture.plans[planIndex]) || x;
  $('pInst').value = x.sym; $('pEtf').value = x.entryTf; setDir(x.dir);
  $('pEntry').value = px(p.entry, inst.pip); $('pSl').value = px(p.sl, inst.pip); $('pTp').value = px(p.tp, inst.pip);
  const { ev } = agentEvidence(inst, x.entryTf);
  CHECKS.forEach((c, i) => { $('chk' + i).checked = !!(ev[i] && ev[i].st === 'pass'); }); // "Calm" is never ticked for you
  calc(); showTab('planner');
}

/* ----- mini candle chart: last 60 entry-chart candles with the plan drawn on it ----- */
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
function drawCharts() {
  if (!A.scan) return;
  document.querySelectorAll('.chart[data-chart]').forEach(box => {
    if (box.offsetParent === null) return; // hidden tab or closed row
    const x = A.scan.items.find(i => i.id === box.dataset.chart);
    if (x && x.spark && box.dataset.ts !== String(A.scan.ts)) { box.dataset.ts = String(A.scan.ts); candleChart(box, x); }
  });
  document.querySelectorAll('.chart[data-ev]').forEach(box => {
    if (box.offsetParent === null || box.dataset.done) return;
    const [id, which] = box.dataset.ev.split('|'), d = A.ev.get(id);
    if (d && d.big) { box.dataset.done = '1'; evidenceChart(box, d.sym, d[which], which === 'entry' ? d.item.level : null); }
  });
}
function candleChart(box, x) {
  const inst = INST[x.sym];
  const levels = [['Level', x.level, 'var(--muted)', '4 3'], ['Entry', x.entry, 'var(--accent)', ''], ['SL', x.sl, 'var(--red)', '6 3'], ['TP', x.tp, 'var(--green)', '2 3']].filter(l => l[1] != null && !(l[0] === 'Level' && Math.abs(l[1] - x.entry) < inst.pip / 2));
  plot(box, { bars: x.spark, pip: inst.pip, levels, aria: `${x.sym} last ${x.spark.length} ${x.entryTf} candles with entry, stop and target` });
}
// Evidence chart: the candles, Alligator lines and counted peaks / dips behind a reading.
function evidenceChart(box, sym, d, level) {
  const inst = INST[sym];
  plot(box, {
    bars: d.bars, pip: inst.pip, marks: d.waves,
    curves: [{ name: 'Jaw', color: 'var(--accent)', pts: d.jaw }, { name: 'Teeth', color: 'var(--red)', pts: d.teeth }, { name: 'Lips', color: 'var(--green)', pts: d.lips }],
    levels: level != null ? [['Level', level, 'var(--muted)', '4 3']] : [],
    aria: `${sym} last ${d.bars.length} ${d.tf} candles with Alligator lines and the peaks and dips the agents count`,
  });
}
// o = { bars:[[t,o,h,l,c]], pip, levels:[[name,value,colour,dash]], curves:[{name,color,pts}], marks:[{n,price,type,live}], aria }
function plot(box, o) {
  const f = v => px(v, o.pip), bars = o.bars, n = bars.length, levels = o.levels || [], curves = o.curves || [], marks = o.marks || [];
  // drawn at the container's own width so labels keep their size on a phone
  const W = Math.max(300, Math.min(620, Math.round(box.clientWidth) || 560)), H = 190, L = 6, Rm = 92, T = 12, B = 20, pw = W - L - Rm, ph = H - T - B;
  let lo = Math.min(...bars.map(b => b[3])), hi = Math.max(...bars.map(b => b[2]));
  for (const l of levels) { lo = Math.min(lo, l[1]); hi = Math.max(hi, l[1]); }
  for (const cv of curves) for (const v of cv.pts) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const padY = (hi - lo) * 0.07 || o.pip; lo -= padY; hi += padY;
  const y = v => T + (hi - v) / (hi - lo) * ph, step = pw / n, bw = Math.max(2, Math.min(7, step * 0.62)), cx = i => L + step * (i + 0.5);
  box.textContent = '';
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.aria || 'price chart' }, box);
  for (const [, v, col, dash] of levels) el('line', { x1: L, x2: L + pw, y1: y(v), y2: y(v), stroke: col, 'stroke-width': 1.5, 'stroke-dasharray': dash || 'none' }, svg);
  bars.forEach((b, i) => {
    const up = b[4] >= b[1], col = up ? 'var(--green)' : 'var(--red)';
    el('line', { x1: cx(i), x2: cx(i), y1: y(b[2]), y2: y(b[3]), stroke: col, 'stroke-width': 1 }, svg);
    const top = y(Math.max(b[1], b[4])), h = Math.max(1, Math.abs(y(b[1]) - y(b[4])));
    // rising candles are hollow, falling candles are solid: readable without relying on red/green
    el('rect', { x: cx(i) - bw / 2, y: top, width: bw, height: h, fill: up ? 'var(--card)' : col, stroke: col, 'stroke-width': 1 }, svg);
  });
  for (const cv of curves) {
    let dPath = '', pen = false;
    cv.pts.forEach((v, i) => { if (v == null) { pen = false; return; } dPath += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
    el('path', { d: dPath, fill: 'none', stroke: cv.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
  }
  // counted peaks and dips: solid dot = finished, hollow dot = still moving
  for (const m of marks) el('circle', { cx: cx(m.n), cy: y(m.price) + (m.type === 'H' ? -6 : 6), r: 3.5, fill: m.live ? 'var(--card)' : 'var(--ink)', stroke: 'var(--ink)', 'stroke-width': 1.5 }, svg);
  // direct labels on the right, nudged apart so they never overlap
  const labs = [...levels.map(([name, v]) => ({ text: `${name} ${f(v)}`, y: y(v) })), ...curves.map(cv => { const v = [...cv.pts].reverse().find(q => q != null); return v == null ? null : { text: cv.name, y: y(v) }; }).filter(Boolean)].sort((p, q) => p.y - q.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 12) labs[i].y = labs[i - 1].y + 12;
  for (const l of labs) { const t = el('text', { x: L + pw + 6, y: l.y + 4, 'font-size': 11, 'font-family': 'JetBrains Mono, monospace', fill: 'var(--ink)' }, svg); t.textContent = l.text; }
  const tl = t => { const p = partsIn(TZ, new Date(t * 1000)); return `${p.wd} ${pad(p.h)}:${pad(p.m)}`; };
  const a1 = el('text', { x: L, y: H - 5, 'font-size': 10, 'font-family': 'JetBrains Mono, monospace', fill: 'var(--muted)' }, svg); a1.textContent = tl(bars[0][0]);
  const a2 = el('text', { x: L + pw, y: H - 5, 'font-size': 10, 'font-family': 'JetBrains Mono, monospace', fill: 'var(--muted)', 'text-anchor': 'end' }, svg); a2.textContent = tl(bars[n - 1][0]) + ' Paris';
  // hover: crosshair + one-line readout
  const cross = el('line', { y1: T, y2: T + ph, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0 }, svg);
  const tip = document.createElement('div'); tip.className = 'tip'; box.appendChild(tip);
  const hit = el('rect', { x: L, y: T, width: pw, height: ph, fill: 'transparent' }, svg);
  const move = ev => {
    const r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((mx - L) / step))), bb = bars[i];
    cross.setAttribute('x1', cx(i)); cross.setAttribute('x2', cx(i)); cross.setAttribute('opacity', 0.35);
    tip.textContent = `${tl(bb[0])}  O ${f(bb[1])}  H ${f(bb[2])}  L ${f(bb[3])}  C ${f(bb[4])}` + curves.map(cv => (cv.pts[i] != null ? `  ${cv.name} ${f(cv.pts[i])}` : '')).join('');
    tip.style.display = 'block';
    const left = cx(i) / W * r.width; tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
  };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.style.display = 'none'; });
}

/* ----- settings ----- */
function renderCfg() {
  const chip = (on, key, label, title) => `<span class="chip ${on ? 'on' : ''}" data-k="${key}" title="${title || ''}">${label}</span>`;
  $('cfgGroups').innerHTML = Object.entries(GROUPS).map(([k, g]) => chip(A.cfg.groups.includes(k), k, `${g.name} · ${g.syms.length}`, g.syms.join(', '))).join('');
  $('cfgModes').innerHTML = Object.keys(MODES).map(k => chip(A.cfg.modes.includes(k), k, `${k} entry · ${riskFor('', k)}% risk`)).join('');
  const toggle = (box, list) => box.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => {
      const k = c.dataset.k, i = A.cfg[list].indexOf(k);
      if (i >= 0) { if (A.cfg[list].length === 1) return; A.cfg[list].splice(i, 1); } else A.cfg[list].push(k);
      saveCfg(); renderCfg(); A.nextAt = 0; poll();
    };
  });
  toggle($('cfgGroups'), 'groups'); toggle($('cfgModes'), 'modes');
  const can = 'Notification' in window, perm = can ? Notification.permission : 'denied';
  $('btnNotify').textContent = !can ? 'Browser alerts not supported here' : A.cfg.notify && perm === 'granted' ? 'Browser alerts: on' : perm === 'denied' ? 'Browser alerts blocked in this browser' : 'Turn on browser alerts';
  $('btnSound').textContent = `Sound: ${A.cfg.sound ? 'on' : 'off'}`;
}
$('btnNotify').onclick = async () => {
  if (!('Notification' in window)) return;
  if (A.cfg.notify && Notification.permission === 'granted') A.cfg.notify = false;
  else { const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); A.cfg.notify = p === 'granted'; }
  saveCfg(); renderCfg();
};
$('btnSound').onclick = () => { A.cfg.sound = !A.cfg.sound; saveCfg(); renderCfg(); if (A.cfg.sound) beep(); };
$('tgToken').value = A.cfg.tgToken; $('tgChat').value = A.cfg.tgChat;
['tgToken', 'tgChat'].forEach(id => $(id).addEventListener('input', () => { A.cfg.tgToken = $('tgToken').value.trim(); A.cfg.tgChat = $('tgChat').value.trim(); saveCfg(); }));
$('tgTest').onclick = async () => {
  const msg = $('tgMsg'); msg.textContent = 'Sending…';
  try { const ok = await telegram('Trading Mastery: test alert. The agents can reach you here.'); msg.textContent = ok ? 'Sent. Check Telegram.' : 'Enter the bot token and chat ID first.'; }
  catch (e) { msg.textContent = 'Telegram said: ' + e.message; }
};

/* ---------- boot ---------- */
initPlanner(); renderSessionsTab(); renderToday(); renderCfg(); renderLog(); renderAgents();
showTab((location.hash || '#home').slice(1));
tick(); setInterval(tick, 1000); setInterval(() => { renderToday(); calc(); rejudge(); }, 30000);
poll(); loadNews(); pingAi(); setInterval(loadNews, 30 * 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - A.okAt > 70000) poll(); });
