// Walks sources.yaml and checks every source with a live request.
// Doubles as the regression check for when a site breaks its feed.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { fetchFeed, UA } from '../src/fetch/parse-feed.ts';
import { fetchSitemap } from '../src/fetch/sitemap.ts';
import { fetchWithBrowser, closeBrowser } from '../src/fetch/browser.ts';

const cfg = parse(readFileSync(new URL('../src/sources.yaml', import.meta.url), 'utf8'));
const rsshubBase = process.env.RSSHUB_BASE_URL ?? 'http://localhost:1200';
const hours = (d) => (Date.now() - d.getTime()) / 3.6e6;

async function checkFeed(url) {
  const feed = await fetchFeed(url);
  const items = feed.items ?? [];
  const dates = items
    .map((i) => new Date(i.isoDate ?? i.pubDate ?? NaN))
    .filter((d) => !Number.isNaN(d.getTime()));
  return {
    count: items.length,
    freshest: dates.length ? Math.min(...dates.map(hours)) : null,
    sanitized: feed.sanitized,
  };
}

async function checkApi(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  // HN Algolia -> {hits}, YC launches -> {hits}, HF daily papers -> []
  const arr = Array.isArray(body) ? body : (body.hits ?? body.data ?? []);
  return { count: arr.length, freshest: null };
}

async function check(src) {
  const t0 = Date.now();
  try {
    let r;
    if (src.kind === 'feed') r = await checkFeed(src.url);
    else if (src.kind === 'api') r = await checkApi(src.url);
    else if (src.kind === 'rsshub') r = await checkFeed(`${rsshubBase}${src.route}`);
    else if (src.kind === 'browser') {
      const items = await fetchWithBrowser({
        url: src.url, itemSelector: src.itemSelector, titleSelector: src.titleSelector,
        dateSelector: src.dateSelector, limit: src.limit,
      });
      const dates = items.map((i) => new Date(i.isoDate ?? NaN)).filter((d) => !Number.isNaN(d.getTime()));
      r = { count: items.length, freshest: dates.length ? Math.min(...dates.map(hours)) : null };
    }
    else if (src.kind === 'sitemap') {
      const items = await fetchSitemap({ sitemap: src.sitemap, include: src.include, limit: src.limit ?? 5 });
      const dates = items.map((i) => new Date(i.isoDate ?? NaN)).filter((d) => !Number.isNaN(d.getTime()));
      r = { count: items.length, freshest: dates.length ? Math.min(...dates.map(hours)) : null };
    }
    else throw new Error(`unknown kind ${src.kind}`);
    return { ...src, ok: true, ...r, ms: Date.now() - t0 };
  } catch (err) {
    return { ...src, ok: false, err: String(err.message ?? err).slice(0, 70), ms: Date.now() - t0 };
  }
}

// bounded concurrency so we do not hammer 50 hosts at once
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) out.push(await fn(items[i++]));
    }),
  );
  return out;
}

const results = await pool(cfg.sources, 8, check);
results.sort((a, b) => Number(a.ok) - Number(b.ok) || a.id.localeCompare(b.id));

let bad = 0;
let rsshubDown = 0;
for (const r of results) {
  if (r.ok) {
    const fresh = r.freshest === null ? '   n/a' : `${r.freshest.toFixed(0).padStart(4)}h`;
    const note = r.sanitized ? '  [xml repaired]' : r.freshest !== null && r.freshest > 720 ? '  [STALE >30d]' : '';
    console.log(`  OK   ${r.id.padEnd(22)} ${String(r.count).padStart(3)} items  freshest ${fresh}  ${String(r.ms).padStart(5)}ms${note}`);
  } else {
    if (r.kind === 'rsshub') rsshubDown++;
    else bad++;
    console.log(`  FAIL ${r.id.padEnd(22)} ${r.kind.padEnd(7)} ${r.err}`);
  }
}

await closeBrowser();

const ok = results.filter((r) => r.ok).length;
console.log(`\n  ${ok}/${results.length} OK, ${bad} broken, ${rsshubDown} waiting on RSSHub (${rsshubBase})`);
if (bad > 0) process.exitCode = 1;
