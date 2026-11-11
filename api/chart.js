// GET /api/chart?sym=USDCAD&mode=M15
// The evidence behind one row of the market board: the candles, Alligator lines and waves the
// agents used, so the reading can be compared with any other chart.
import { INST, MODES } from '../public/lib/core.js';
import { getSeries } from '../lib/feeds.js';
import { analyse, evidence } from '../lib/agents.js';

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://localhost').searchParams, sym = q.get('sym'), mode = q.get('mode');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!INST[sym] || !MODES[mode]) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 400; return res.end(JSON.stringify({ error: 'Unknown instrument or chart.' })); }
  try {
    const nowSec = Math.floor(Date.now() / 1000), m = MODES[mode];
    const [big, entry] = await Promise.all([getSeries(sym, m.dirTf, nowSec), getSeries(sym, m.entryTf, nowSec)]);
    const item = analyse(sym, mode, big, entry, nowSec);
    delete item.spark;
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=45, stale-while-revalidate=30');
    res.statusCode = 200;
    res.end(JSON.stringify({ ts: Date.now(), item, ...evidence(sym, mode, big, entry) }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}
