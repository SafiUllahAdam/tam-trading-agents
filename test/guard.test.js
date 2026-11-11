import test from 'node:test';
import assert from 'node:assert/strict';
import { INST } from '../public/lib/core.js';
import { timeCtx, sizeTrade, biasLine, newsLine, sessionLine, accountRules, judge } from '../public/lib/guard.js';

const EUR = INST.EURUSD;
// Wednesday 11 Nov 2026, 15:00 Paris (14:00 UTC): London + New York overlap.
const WED = new Date('2026-11-11T14:00:00Z');
const strength = Object.fromEntries(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'].map(c => [c, { d1: 0, w1: 0 }]));
const strong = { ...strength, EUR: { d1: 0.2, w1: 0.9 }, USD: { d1: -0.1, w1: -0.6 } };
const item = (over = {}) => ({
  sym: 'EURUSD', entryTf: 'H1', dirTf: 'H4', dir: 'BUY', stage: 'TRIGGER', entry: 1.1050, sl: 1.1020, tp: 1.1080, approx: false,
  checks: [{ id: 'big', ok: true, t: 'big ok', d: '' }, { id: 'trigger', ok: true, t: 'trigger ok', d: '' }], ...over,
});
const P = (over = {}) => ({ balance: 25000, tc: timeCtx([], WED), strength: strong, news: [], loaded: true, open: [], now: WED, ...over });

test('lot size comes from the stop distance', () => {
  const z = sizeTrade(EUR, 'H1', 25000, 1.1050, 1.1020, 1.1080);
  assert.equal(z.riskPct, 0.6);
  assert.equal(Math.round(z.riskMoney), 150);
  assert.equal(Math.round(z.slPips), 30);
  assert.equal(z.lots, 0.5); // $150 / (30 pips x $10)
  assert.ok(Math.abs(z.rr - 1) < 1e-9);
  assert.equal(sizeTrade(EUR, 'H1', 25000, 1.1050, 1.1048, 1.1060).lots, 0); // 2-pip stop is not a stop
});

test('clean setup in the right session with bias and no news = TAKE', () => {
  const j = judge(item(), P());
  assert.equal(j.verdict, 'take', JSON.stringify(j.rules.filter(r => r.st !== 'pass')));
  assert.equal(j.size.lots, 0.5);
});

test('time rules: weekend and Friday after 21:00 block; M15 after 22:00 blocks', () => {
  assert.equal(judge(item(), P({ tc: timeCtx([], new Date('2026-11-14T10:00:00Z')), now: new Date('2026-11-14T10:00:00Z') })).verdict, 'skip');
  const fri = new Date('2026-11-13T20:30:00Z'); // 21:30 Paris
  assert.ok(accountRules(EUR, 'H1', { tc: timeCtx([], fri), open: [] }).some(r => r.st === 'fail' && /Friday/.test(r.t)));
  const late = new Date('2026-11-11T21:30:00Z'); // 22:30 Paris
  assert.ok(accountRules(EUR, 'M15', { tc: timeCtx([], late), open: [] }).some(r => r.st === 'fail' && /22:00/.test(r.t)));
  assert.ok(accountRules(EUR, 'H1', { tc: timeCtx([], late), open: [] }).every(r => r.st !== 'fail'));
});

test('loss rules: 60-minute break after one stop-loss, done after two', () => {
  const now = WED.getTime();
  assert.ok(accountRules(EUR, 'H1', { tc: timeCtx([now - 10 * 60000], WED), open: [] }).some(r => r.st === 'fail' && /Break: 50 min/.test(r.t)));
  assert.ok(accountRules(EUR, 'H1', { tc: timeCtx([now - 90 * 60000], WED), open: [] }).every(r => r.st !== 'fail'));
  assert.ok(accountRules(EUR, 'H1', { tc: timeCtx([now - 300 * 60000, now - 200 * 60000], WED), open: [] }).some(r => /2 stop-losses/.test(r.t)));
});

test('exposure rules: same currency and 3% cap', () => {
  const tc = timeCtx([], WED);
  assert.ok(accountRules(EUR, 'H1', { tc, open: [{ sym: 'GBPUSD', riskPct: 0.6 }] }).some(r => r.st === 'fail' && /same currency/.test(r.t)));
  assert.ok(accountRules(EUR, 'H1', { tc, open: [{ sym: 'AUDJPY', riskPct: 1 }, { sym: 'CADJPY', riskPct: 1 }, { sym: 'AUDNZD', riskPct: 1 }] }).some(r => r.st === 'fail' && /Open risk/.test(r.t)));
  assert.ok(accountRules(EUR, 'H1', { tc, open: [{ sym: 'AUDJPY', riskPct: 1 }] }).every(r => r.st !== 'fail'));
});

test('red news inside 2 hours or released under 15 minutes ago blocks', () => {
  const t = WED.getTime();
  assert.equal(newsLine(EUR, [{ cur: 'USD', title: 'CPI m/m', t: t + 45 * 60000 }], true, t)[0], 'r');
  assert.equal(newsLine(EUR, [{ cur: 'USD', title: 'CPI m/m', t: t - 5 * 60000 }], true, t)[0], 'r');
  assert.equal(newsLine(EUR, [{ cur: 'USD', title: 'FOMC', t: t + 5 * 3600000 }], true, t)[0], 'n'); // later today: allowed, be careful
  assert.equal(newsLine(EUR, [{ cur: 'JPY', title: 'BoJ', t: t + 30 * 60000 }], true, t)[0], 'g'); // not our currencies
  assert.equal(judge(item(), P({ news: [{ cur: 'EUR', title: 'ECB Rate', t: t + 30 * 60000 }] })).verdict, 'skip');
  assert.match(newsLine(EUR, [{ cur: 'USD', title: '<img src=x>', t: t + 30 * 60000 }], true, t)[1], /&lt;img/); // feed text is escaped
});

test('strong vs weak: with you passes, against blocks, flat needs care', () => {
  assert.equal(biasLine(EUR, 'BUY', strong, true)[0], 'g');
  assert.equal(biasLine(EUR, 'SELL', strong, true)[0], 'r');
  assert.equal(judge(item({ dir: 'SELL', sl: 1.1080, tp: 1.1020 }), P()).verdict, 'skip');
  assert.equal(judge(item(), P({ strength })).verdict, 'care');
});

test('session: EURUSD is right in London/New York hours, wrong in the Asian night', () => {
  assert.equal(sessionLine(EUR, WED)[0], 'g');
  assert.equal(sessionLine(EUR, new Date('2026-11-11T01:30:00Z'))[0], 'r'); // 02:30 Paris
  assert.equal(sessionLine(EUR, new Date('2026-11-14T14:00:00Z'))[0], 'r'); // Saturday
  assert.equal(sessionLine(INST.USDJPY, new Date('2026-11-11T02:30:00Z'))[0], 'g'); // Tokyo morning
  // outside the home session the verdict is "care", never a clean TAKE
  const night = new Date('2026-11-11T01:30:00Z');
  assert.equal(judge(item(), P({ now: night, tc: timeCtx([], night) })).verdict, 'care');
});

test('forming setup is "wait", failed chart check is "skip", hard instrument is "care"', () => {
  assert.equal(judge(item({ stage: 'WATCH', checks: [{ id: 'trigger', ok: null, t: 'no close yet', d: '' }] }), P()).verdict, 'wait');
  assert.equal(judge(item({ checks: [{ id: 'big', ok: false, t: 'tangled', d: '' }] }), P()).verdict, 'skip');
  const gbpjpy = judge(item({ sym: 'GBPJPY', entry: 212.50, sl: 212.10, tp: 212.90 }), P({ strength: { ...strength, GBP: { d1: 0, w1: 1 }, JPY: { d1: 0, w1: -1 } }, now: new Date('2026-11-11T09:00:00Z'), tc: timeCtx([], new Date('2026-11-11T09:00:00Z')) }));
  assert.equal(gbpjpy.verdict, 'care');
  assert.ok(gbpjpy.warns.some(w => /beginner/.test(w.t)));
});

test('a warn-type chart check (RSI divergence) downgrades TAKE to CARE', () => {
  const j = judge(item({ checks: [{ id: 'big', ok: true, t: 'ok', d: '' }, { id: 'divergence', ok: true, st: 'warn', t: 'H4 RSI divergence against the trend', d: '' }] }), P());
  assert.equal(j.verdict, 'care');
});
