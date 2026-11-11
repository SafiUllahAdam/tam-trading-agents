# Trading Mastery Dashboard

The original Trading Mastery dashboard (sessions, planner, rules) plus three agents that read
live markets and check every setup against the checklist and "My 3 rules".

Demo first. Nothing here is financial advice.

## The three agents

| Agent | Runs | What it does |
|---|---|---|
| **1. Scout** | server (`/api/scan`, `/api/calendar`, `/api/chart`) | Live candles for the watched instruments, Heikin Ashi colour, Alligator (13/8/5 smoothed, shifted 8/5/3), peaks and dips, RSI divergence, currency strength from the 7 USD pairs, red news. A peak or dip counts only after price turns by 2 × ATR (1.5 × on the entry chart), so small wiggles are ignored. |
| **2. Strategist** | server | Applies the method: bigger chart gives the only allowed direction, entry chart must print one finished candle past the last peak / dip. First close = ready, two closes = missed. Stop beyond the last dip / bounce, target 1:1. Also shows what the Sarmaya lectures would do on the same chart (scenario 1/2/3, stop order, limit order on a fair value gap). |
| **3. Risk Guard** | your browser | Time rule, loss rule, same-currency rule, 3% open-risk cap, home session, strong vs weak, red news, lot size from your balance. Verdict: TAKE / TAKE WITH CARE / NO TRADE. |

Optional **AI analyst** (`/api/brief`): a language model writes a three-line second opinion on a
ready setup. It never decides. It is off unless a free model is reachable (see below).

Every row of the market board has a **show proof** view: the exact candles, Alligator lines and
counted peaks and dips behind the reading, plus a link to the same chart on TradingView.

Balance, stop-loss count, open trades and the Telegram token stay in the browser (`localStorage`).
The server only ever sees which markets and charts you asked for.

## Run it locally

Needs Node 20 or newer. No packages to install.

```
node scripts/dev-server.js        # http://localhost:3000
node scripts/scan-once.js H1 fx -v   # print one scan in the terminal
node --test                       # unit tests
```

## Deploy (free)

Vercel Hobby plan, no database, no paid add-ons.

```
npx vercel login
npx vercel link --yes --project trading-mastery --scope <your-team-slug>
npx vercel deploy --prod --scope <your-team-slug>
```

`public/` is served as the site, `api/*.js` become serverless functions.

### AI analyst (optional, still free)

Any one of these turns it on (Vercel project → Settings → Environment Variables, then redeploy):

- `GROQ_API_KEY` or `GEMINI_API_KEY` with a free-tier key. No card needed for either.
- `AI_GATEWAY=1` to use Vercel AI Gateway with the function's own token. Vercel only serves
  gateway requests for accounts with a card on file, so this is off by default.
- `AI_MODEL` overrides the model id if the default one is no longer offered.

## Free data sources and their limits

- Candles: Yahoo Finance chart endpoint. Unofficial, no key, can lag a few seconds or refuse
  requests. Prices can differ from your MT4 broker by a pip or two.
- Gold and silver: futures candles shifted onto the Swissquote spot quote. Oil and US indices are
  futures, UK100 and GER40 are cash indices (session hours only). Always confirm levels on MT4.
- Red news: ForexFactory weekly calendar export.
- H4 and D1 candles are cut on the MT4 clock used in the dashboard (Paris + 1 hour).

The agents only work while a dashboard tab is open: the page asks the server once a minute and
12 seconds after each candle closes. Vercel Hobby cron runs once a day at most, so there are no
alerts when the tab is closed.

## Where the rules live

| File | Content |
|---|---|
| `public/lib/core.js` | instruments, sessions, risk table, time helpers |
| `public/lib/indicators.js` | Heikin Ashi, Alligator, ATR, RSI, swings, fair value gaps |
| `lib/agents.js` | Scout + Strategist, thresholds in `CFG` |
| `public/lib/guard.js` | Risk Guard |
| `lib/feeds.js` | live feeds and caching |
| `lib/analyst.js` | optional AI analyst |
| `public/index.html`, `public/app.js` | the dashboard |
