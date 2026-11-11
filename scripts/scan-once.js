// Run the Scout + Strategist once from the terminal and print what they see.
// Usage: node scripts/scan-once.js [modes] [groups]   e.g. node scripts/scan-once.js H1,M15 fx,metals
import { runScan } from '../lib/agents.js';
import { getCalendar } from '../lib/feeds.js';

const modes = (process.argv[2] || 'H1').split(',');
const groups = (process.argv[3] || 'fx').split(',');
const r = await runScan({ modes, groups });
for (const l of r.log) console.log(`[${l.a}] ${l.m}`);
if (r.errors.length) console.log('errors:', r.errors);
console.log('');
for (const x of r.items) {
  console.log(`${x.sym.padEnd(7)} ${x.mode.padEnd(3)} ${String(x.dir || '-').padEnd(4)} ${x.stage.padEnd(7)} ${x.why}`);
  if (process.argv.includes('-v')) for (const c of x.checks) console.log(`          ${c.ok === true ? 'ok ' : c.ok === false ? 'NO ' : '.. '} ${c.t} | ${c.d}`);
}
console.log('\nstrength (5 days):', r.strength && Object.entries(r.strength).sort((a, b) => b[1].w1 - a[1].w1).map(([c, v]) => `${c} ${v.w1 > 0 ? '+' : ''}${v.w1.toFixed(2)}%`).join('  '));
try {
  const ev = await getCalendar();
  console.log(`red news this week: ${ev.length}; next: ${ev.filter(e => new Date(e.t) > new Date()).slice(0, 3).map(e => `${e.cur} ${e.title} ${e.t}`).join(' | ')}`);
} catch (e) { console.log('calendar error:', e.message); }
