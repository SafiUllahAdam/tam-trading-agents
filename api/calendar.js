// GET /api/calendar - this week's high-impact ("red") news events.
import { getCalendar } from '../lib/feeds.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const events = await getCalendar();
    // The calendar source asks for few requests, so the CDN keeps this for 15 minutes.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=900, stale-while-revalidate=3600');
    res.statusCode = 200;
    res.end(JSON.stringify({ ts: Date.now(), events }));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}
