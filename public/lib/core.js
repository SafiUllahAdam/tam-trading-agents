// Shared by the browser (dashboard) and the server (agents). Pure data + time helpers, no I/O.

// sym, base, quote, pip, $/pip/lot, sessions, character, drivers, beginner, live-feed ticker, class
export const INSTRUMENTS = [
  ['EURUSD', 'EUR', 'USD', 0.0001, 10, ['london', 'ny'], 'Calm, clean trends, tight spread. The best pair to learn on.', 'ECB vs Fed interest rates; US data at 14:30 Paris, ECB on Thursdays', true, 'EURUSD=X', 'fx'],
  ['GBPUSD', 'GBP', 'USD', 0.0001, 10, ['london', 'ny'], 'Faster than EURUSD. Use a slightly wider stop.', 'Bank of England vs Fed; UK data at 08:00 Paris, US at 14:30', true, 'GBPUSD=X', 'fx'],
  ['USDJPY', 'USD', 'JPY', 0.01, 6.5, ['tokyo', 'ny'], 'Moves in Tokyo and New York. Pip = 0.01.', 'US bond yields vs Bank of Japan; moves with US data and risk mood', true, 'USDJPY=X', 'fx'],
  ['USDCAD', 'USD', 'CAD', 0.0001, 7.2, ['ny'], 'Follows oil (opposite). New York only.', 'Oil price (CAD rises when oil rises); Canadian data at 14:30 Paris', true, 'USDCAD=X', 'fx'],
  ['AUDUSD', 'AUD', 'USD', 0.0001, 10, ['sydney', 'tokyo'], 'Asian hours; also active in New York.', 'China data and commodity prices; RBA decisions in Asian hours', true, 'AUDUSD=X', 'fx'],
  ['NZDUSD', 'NZD', 'USD', 0.0001, 10, ['sydney', 'tokyo'], 'Like AUD, thinner. Wide spread in the evening.', 'Dairy prices and RBNZ; follows AUD but thinner', false, 'NZDUSD=X', 'fx'],
  ['USDCHF', 'USD', 'CHF', 0.0001, 12, ['london', 'ny'], 'Usually the mirror of EURUSD.', 'Safe-haven flows; usually the mirror of EURUSD', true, 'USDCHF=X', 'fx'],
  ['EURGBP', 'EUR', 'GBP', 0.0001, 12.7, ['london'], 'Slow and range-bound. Needs patience.', 'ECB vs Bank of England; slow, range-bound, small daily moves', false, 'EURGBP=X', 'fx'],
  ['EURJPY', 'EUR', 'JPY', 0.01, 6.5, ['tokyo', 'london'], 'Trend-friendly cross.', 'Risk mood: rises when stocks rise; ECB vs Bank of Japan', true, 'EURJPY=X', 'fx'],
  ['GBPJPY', 'GBP', 'JPY', 0.01, 6.5, ['tokyo', 'london'], 'Very volatile. Wide stop, small lots. Not for beginners.', 'Risk mood with double volatility; 150+ pip days are normal', false, 'GBPJPY=X', 'fx'],
  ['AUDJPY', 'AUD', 'JPY', 0.01, 6.5, ['sydney', 'tokyo'], 'Rises when stocks rise. Tokyo session.', 'Pure risk-mood pair: up with stocks, down in panic', true, 'AUDJPY=X', 'fx'],
  ['CADJPY', 'CAD', 'JPY', 0.01, 6.5, ['tokyo', 'ny'], 'Oil + yen.', 'Oil plus risk mood', true, 'CADJPY=X', 'fx'],
  ['EURAUD', 'EUR', 'AUD', 0.0001, 6.5, ['tokyo', 'london'], 'Wide daily range.', 'Europe vs China/commodity cycle; wide daily range', false, 'EURAUD=X', 'fx'],
  ['AUDNZD', 'AUD', 'NZD', 0.0001, 5.8, ['sydney', 'tokyo'], 'Ranges a lot. Asia only.', 'Two similar economies; mostly ranges', false, 'AUDNZD=X', 'fx'],
  ['XAUUSD', 'XAU', 'USD', 0.1, 10, ['london', 'ny'], 'Gold. Very fast around US news. Pip = 0.10.', 'US real yields and the dollar (gold falls when USD/yields rise); fear buys gold', false, 'GC=F', 'metal'],
  ['XAGUSD', 'XAG', 'USD', 0.01, 50, ['ny'], 'Silver. Wilder than gold.', 'Follows gold with bigger swings; industrial demand', false, 'SI=F', 'metal'],
  ['USOIL', 'OIL', 'USD', 0.01, 10, ['ny'], 'Oil. Inventory news Wednesday 16:30 Paris.', 'OPEC decisions, US inventories (Wed 16:30 Paris), global growth', false, 'CL=F', 'energy'],
  ['NAS100', 'NAS', 'USD', 1, 1, ['ny'], 'US tech index. Opens 15:30 Paris; first hour is wild.', 'US tech earnings and interest rates; falls when yields rise', false, 'NQ=F', 'index'],
  ['US30', 'DOW', 'USD', 1, 1, ['ny'], 'Dow Jones. Calmer than NAS100.', 'US economy and big-company earnings', false, 'YM=F', 'index'],
  ['UK100', 'FTSE', 'GBP', 1, 1.3, ['london'], 'FTSE 100. London, from 09:00 Paris.', 'Global miners and oil companies; often moves opposite to GBP', false, '^FTSE', 'index'],
  ['GER40', 'DAX', 'EUR', 1, 1.1, ['london'], 'DAX. Strong moves 09:00–11:00 Paris.', 'German exports, ECB, US futures after 15:30 Paris', false, '^GDAXI', 'index'],
  ['BTCUSD', 'BTC', 'USD', 1, 1, ['ny'], 'Crypto, 24/7. Check the Daily trend first.', 'Risk appetite and liquidity; follows NAS100 on big days; 24/7', false, 'BTC-USD', 'crypto'],
];

export const INST = Object.fromEntries(INSTRUMENTS.map(a => [a[0], {
  sym: a[0], base: a[1], quote: a[2], pip: a[3], pipVal: a[4], sessions: a[5],
  note: a[6], drivers: a[7], beginner: a[8], feed: a[9], cls: a[10],
}]));

// Watchlist groups the agents can scan.
export const GROUPS = {
  fx: { name: 'Forex pairs', syms: INSTRUMENTS.filter(i => i[10] === 'fx').map(i => i[0]) },
  metals: { name: 'Gold, silver, oil', syms: ['XAUUSD', 'XAGUSD', 'USOIL'] },
  indices: { name: 'Indices + BTC', syms: ['NAS100', 'US30', 'UK100', 'GER40', 'BTCUSD'] },
};

// The seven USD pairs needed to rank the eight major currencies.
export const CURS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];
export const USD_MAJORS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF'];

export const SESSIONS = [
  { id: 'sydney', name: 'Sydney', tz: 'Australia/Sydney', open: '07:00', close: '16:00', why: 'Quiet start of the day. AUD and NZD wake up.' },
  { id: 'tokyo', name: 'Tokyo', tz: 'Asia/Tokyo', open: '09:00', close: '18:00', why: 'JPY, AUD, NZD pairs. Slow, range-like moves.' },
  { id: 'london', name: 'London', tz: 'Europe/London', open: '08:00', close: '17:00', why: 'Biggest session. EUR, GBP, CHF pairs, UK100, GER40, gold. The 09:00 Paris open often sets the day.' },
  { id: 'ny', name: 'New York', tz: 'America/New_York', open: '08:00', close: '17:00', why: 'USD pairs, gold, silver, oil, US indices. US news 14:30 Paris, stocks open 15:30.' },
  { id: 'psx', name: 'PSX Karachi', tz: 'Asia/Karachi', psx: true, why: 'Pakistan stocks. Mon–Thu 09:30–15:30, Fri 09:15–12:00 & 14:30–16:30 (PKT).' },
];

// Risk % per entry chart (Rules tab).
export const RISK = { M5: 0.25, M15: 0.35, M30: 0.45, H1: 0.60, H4: 1.0, D1: 2.0 };
export const riskFor = (sym, etf) => (sym === 'NAS100' && etf === 'H1') ? 0.50 : RISK[etf];
export const SHORT = ['M5', 'M15', 'M30'];
export const TZ = 'Europe/Paris';

// Scan modes: entry chart + the bigger chart that gives direction.
export const MODES = {
  M15: { entryTf: 'M15', dirTf: 'H1', entrySec: 900, dirSec: 3600 },
  H1: { entryTf: 'H1', dirTf: 'H4', entrySec: 3600, dirSec: 14400 },
  H4: { entryTf: 'H4', dirTf: 'D1', entrySec: 14400, dirSec: 86400 },
};

/* ---------- time ---------- */
const fmtCache = new Map();
function fmtFor(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}
export function partsIn(tz, d = new Date()) {
  const o = {};
  fmtFor(tz).formatToParts(d).forEach(p => { o[p.type] = p.value; });
  const h = (+o.hour) % 24;
  return { h, m: +o.minute, s: +o.second, min: h * 60 + (+o.minute), wd: o.weekday, date: `${o.year}-${o.month}-${o.day}` };
}
export const pad = n => String(n).padStart(2, '0');
export const hm = min => { min = ((min % 1440) + 1440) % 1440; return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; };
export const toMin = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };

export function forexClosed(d = new Date()) {
  const ny = partsIn('America/New_York', d);
  return ny.wd === 'Sat' || (ny.wd === 'Fri' && ny.min >= 1020) || (ny.wd === 'Sun' && ny.min < 1020);
}
export function windows(s, d = new Date()) {
  const p = partsIn(s.tz, d);
  if (s.psx) {
    if (p.wd === 'Sat' || p.wd === 'Sun') return [];
    if (p.wd === 'Fri') return [[toMin('09:15'), toMin('12:00')], [toMin('14:30'), toMin('16:30')]];
    return [[toMin('09:30'), toMin('15:30')]];
  }
  return [[toMin(s.open), toMin(s.close)]];
}
export function status(s, d = new Date()) {
  const p = partsIn(s.tz, d), wins = windows(s, d);
  let open = false, next = null, closeIn = null;
  for (const [a, b] of wins) {
    if (p.min >= a && p.min < b) { open = true; closeIn = b - p.min; }
    else if (p.min < a && (next === null || a - p.min < next)) next = a - p.min;
  }
  const weekend = !s.psx && forexClosed(d);
  if (weekend) open = false;
  return { open, closeIn, next, local: p, weekend, wins };
}
export const offset = (tz, d = new Date()) => ((partsIn(tz, d).min - partsIn(TZ, d).min) % 1440 + 1440) % 1440;

// UTC offset (seconds) of a time zone at a given instant.
export function utcOffsetSec(tz, d = new Date()) {
  const p = partsIn(tz, d);
  const [y, mo, da] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, p.h, p.m, p.s);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 1000);
}
// MT4 server clock in this workflow = Paris + 1 hour. H4 and D1 candles are cut on that clock.
export const mt4OffsetSec = (d = new Date()) => utcOffsetSec(TZ, d) + 3600;

// Price formatting by pip size (same rule the planner uses).
export const px = (v, pip) => (+v).toFixed(pip >= 1 ? 1 : pip >= 0.1 ? 2 : pip >= 0.01 ? 3 : 5);

// Same instrument on TradingView, so every agent reading can be checked against an independent chart.
const TV = { XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD', USOIL: 'TVC:USOIL', NAS100: 'OANDA:NAS100USD', US30: 'OANDA:US30USD', UK100: 'OANDA:UK100GBP', GER40: 'OANDA:DE30EUR', BTCUSD: 'BITSTAMP:BTCUSD' };
const TV_INTERVAL = { M15: '15', H1: '60', H4: '240', D1: 'D' };
export const tvUrl = (sym, tf) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(TV[sym] || 'OANDA:' + sym)}&interval=${TV_INTERVAL[tf] || '60'}`;
