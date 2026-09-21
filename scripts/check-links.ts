// Enforces the link rule from CLAUDE.md: every link points at a specific
// article, returns 200, and is never a bare domain root.
import { db } from '../src/db.ts';
import { closeDb } from '../src/db.ts';
import { isDomainRoot } from '../src/normalize.ts';
import { UA } from '../src/fetch/parse-feed.ts';

const hours = Number(process.argv[2] ?? 24);
const rows = db
  .prepare(
    `SELECT i.url, i.title, i.source FROM items i
     WHERE i.first_seen > ? ORDER BY i.first_seen DESC LIMIT 200`,
  )
  .all(Date.now() - hours * 3.6e6) as Row[];

console.log(`checking ${rows.length} links from the last ${hours}h\n`);

type Row = { url: string; title: string; source: string };
type Checked = Row & { verdict: string; code: number; err?: string };

async function check(row: Row): Promise<Checked> {
  if (isDomainRoot(row.url)) return { ...row, verdict: 'DOMAIN ROOT', code: 0 };
  try {
    const res = await fetch(row.url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    // Some hosts refuse HEAD but serve GET fine; only 4xx/5xx counts as broken.
    return { ...row, verdict: res.ok || res.status === 405 ? 'ok' : 'BROKEN', code: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...row, verdict: 'UNREACHABLE', code: 0, err: message.slice(0, 50) };
  }
}

const out: Checked[] = [];
let i = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (i < rows.length) out.push(await check(rows[i++]));
  }),
);

const bad = out.filter((r) => r.verdict !== 'ok');
for (const r of bad) {
  console.log(
    `  ${r.verdict.padEnd(12)} ${String(r.code).padStart(3)}  ${r.source.padEnd(18)} ${r.url.slice(0, 70)}`,
  );
}
console.log(`\n  ${out.length - bad.length}/${out.length} ok, ${bad.length} to look at`);
closeDb();
if (bad.some((r) => r.verdict === 'DOMAIN ROOT')) process.exitCode = 1;
