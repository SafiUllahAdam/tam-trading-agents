// GET /api/brief?ping=1                      -> is the AI analyst available?
// GET /api/brief?sym=EURUSD&mode=H1&k=<key>  -> short AI second opinion on that setup
// The server rebuilds the setup from its own live data; nothing the browser sends reaches the model.
import { INST, MODES } from '../public/lib/core.js';
import { getSeries, getStrength, getCalendar } from '../lib/feeds.js';
import { analyse } from '../lib/agents.js';
import { provider, facts, ask, underBudget, NO_MODEL } from '../lib/analyst.js';

const send = (res, code, body, cache) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.statusCode = code;
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost'), q = url.searchParams;
  const p = provider(req);
  if (q.get('ping')) return send(res, 200, p ? { available: true, provider: p.name, model: p.model } : { available: false, reason: NO_MODEL }, 'no-store');
  if (!p) return send(res, 200, { available: false, reason: NO_MODEL }, 'public, max-age=0, s-maxage=300');
  const sym = q.get('sym'), mode = q.get('mode');
  if (!INST[sym] || !MODES[mode]) return send(res, 400, { available: false, reason: 'Unknown instrument or chart.' }, 'no-store');
  try {
    const nowSec = Math.floor(Date.now() / 1000), m = MODES[mode];
    const [big, entry] = await Promise.all([getSeries(sym, m.dirTf, nowSec), getSeries(sym, m.entryTf, nowSec)]);
    // x.bk names the exact setup (trigger candle, or the level being watched). It keeps one cached
    // answer per setup and stops stale or made-up requests from reaching the model.
    const x = analyse(sym, mode, big, entry, nowSec), key = x.bk;
    if (!key || !['TRIGGER', 'WATCH'].includes(x.stage)) return send(res, 200, { available: false, reason: 'No setup on this chart right now.' }, 'no-store');
    if (q.get('k') !== key) return send(res, 409, { available: false, reason: 'The setup changed. Refresh.' }, 'no-store');
    if (!underBudget()) return send(res, 429, { available: false, reason: 'AI analyst is resting (hourly budget used).' }, 'no-store');
    const [strength, news] = await Promise.all([getStrength(nowSec).catch(() => null), getCalendar().catch(() => null)]);
    const text = await ask(p, facts(x, strength, news));
    // One answer per setup is enough: the CDN keeps it for 30 minutes.
    return send(res, 200, { available: true, text, model: p.model, provider: p.name, key }, 'public, max-age=0, s-maxage=1800');
  } catch (e) {
    return send(res, 200, { available: false, reason: 'AI analyst did not answer: ' + String(e?.message || e).slice(0, 160) }, 'no-store');
  }
}
