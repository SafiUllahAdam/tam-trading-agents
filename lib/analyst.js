// Optional AI "Analyst": a language model writes a short second opinion on a setup the rule-based
// agents already checked. It never decides anything. It only runs when a model is connected:
//   - a free-tier key you add yourself as an environment variable: GROQ_API_KEY or GEMINI_API_KEY, or
//   - Vercel AI Gateway, only when switched on with AI_GATEWAY=1 (or AI_GATEWAY_API_KEY). The gateway
//     refuses requests from accounts without a card on file, so it is off by default.
// Set AI_MODEL to override the default model id. Without any of these the dashboard works the same,
// just without the AI paragraph.
import { INST, CURS, px } from '../public/lib/core.js';

export const NO_MODEL = 'No free AI model is connected. Add a free GROQ_API_KEY or GEMINI_API_KEY in the Vercel project settings to switch it on.';

export function provider(req) {
  const env = process.env, model = env.AI_MODEL;
  if (env.GROQ_API_KEY) return { name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: model || 'llama-3.3-70b-versatile' };
  if (env.GEMINI_API_KEY) return { name: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env.GEMINI_API_KEY, model: model || 'gemini-2.5-flash' };
  const key = env.AI_GATEWAY_API_KEY || (env.AI_GATEWAY === '1' ? req?.headers?.['x-vercel-oidc-token'] || env.VERCEL_OIDC_TOKEN : null);
  if (key) return { name: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh/v1/chat/completions', key, model: model || 'anthropic/claude-haiku-5.5' };
  return null;
}

const SYSTEM = `You are the Analyst on a small trading desk that follows the Sarmaya "CWT - Cambist With Trend" method: the bigger chart gives the only allowed direction (Alligator with Heikin Ashi candles, plus higher-highs/higher-lows structure); the entry is on the smaller chart when one candle finishes past the last peak or dip; the stop goes beyond the last dip or bounce; the target is 1:1.
Two rule-based agents already checked the chart. You receive their findings as facts. Write a second opinion for a beginner.
Hard rules:
- Use only the facts given. Never invent prices, news, indicators or probabilities.
- Do not tell the trader to take or skip the trade. The rules decide that.
- Never suggest a bigger position, a wider stop, removing the stop, adding to a loser or re-entering after a loss.
- Plain English. Under 80 words in total.
Format, exactly three lines:
Picture: one sentence on what the charts show.
Main risk: the single biggest risk visible in these facts.
Invalid if: the price level or event that cancels the idea.`;

// Compact fact sheet for the model. Everything in it was computed by the Scout and Strategist.
export function facts(x, strength, news, nowMs = Date.now()) {
  const inst = INST[x.sym], f = v => (v == null ? 'n/a' : px(v, inst.pip)), L = [];
  L.push(`Instrument: ${x.sym} (${inst.note})`);
  L.push(`Charts: ${x.dirTf} for direction, ${x.entryTf} for entry. Allowed direction: ${x.dir || 'none'}.`);
  L.push(`Stage: ${x.stage === 'TRIGGER' ? 'entry candle just finished' : 'setup forming, not triggered'}. ${x.why}`);
  for (const c of x.checks) L.push(`- ${c.ok === true ? 'OK' : c.ok === false ? 'FAIL' : 'PENDING'}${c.st === 'warn' ? ' (warning)' : ''}: ${c.t}. ${c.d}`);
  if (x.entry != null) L.push(`Plan: entry ${f(x.entry)}, stop ${f(x.sl)} (${Math.round(x.slPips)} pips), target ${f(x.tp)}. Current price ${f(x.price)}.`);
  if (x.lecture?.text) L.push(`Lecture view: ${x.lecture.text}`);
  if (x.approx) L.push('Note: prices come from a futures or cash-index feed, not the trader\'s broker.');
  if (strength && CURS.includes(inst.base) && CURS.includes(inst.quote)) L.push(`Currency strength over 5 days: ${inst.base} ${strength[inst.base].w1}%, ${inst.quote} ${strength[inst.quote].w1}%.`);
  else if (strength) L.push(`USD strength over 5 days: ${strength.USD.w1}%.`);
  const curs = [inst.base, inst.quote].filter(c => CURS.includes(c));
  const soon = (news || []).filter(e => (curs.length ? curs : ['USD']).includes(e.cur)).map(e => ({ ...e, m: Math.round((new Date(e.t).getTime() - nowMs) / 60000) })).filter(e => e.m > -30 && e.m < 24 * 60);
  L.push(soon.length ? `High-impact news in the next 24h: ${soon.map(e => `${e.cur} ${e.title} in ${e.m} min`).join('; ')}.` : 'No high-impact news for these currencies in the next 24h.');
  return L.join('\n');
}

// Small per-instance budget so a public page cannot burn through the free allowance.
const calls = [];
export function underBudget(max = 40, windowMs = 3600e3) {
  const now = Date.now();
  while (calls.length && now - calls[0] > windowMs) calls.shift();
  if (calls.length >= max) return false;
  calls.push(now);
  return true;
}

export async function ask(p, factSheet) {
  const r = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: p.model, max_tokens: 220, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: factSheet }] }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `model answered HTTP ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') throw new Error('empty answer from the model');
  return text.trim().slice(0, 900);
}
