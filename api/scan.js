// GET /api/scan?modes=H1,M15&groups=fx,metals
// Runs the Scout and Strategist agents on live data and returns what they found.
import { runScan } from '../lib/agents.js';
import { MODES, GROUPS } from '../public/lib/core.js';

const pick = (raw, allowed, fallback) => {
  const got = String(raw || '').split(',').map(s => s.trim()).filter(s => allowed.includes(s));
  return got.length ? allowed.filter(a => got.includes(a)) : fallback; // fixed order = better cache hits
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const modes = pick(url.searchParams.get('modes'), Object.keys(MODES), ['H1']);
  const groups = pick(url.searchParams.get('groups'), Object.keys(GROUPS), ['fx']);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const body = await runScan({ modes, groups });
    // One shared answer per minute for every visitor keeps the free data source and free hosting happy.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=45, stale-while-revalidate=30');
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}
