// Walks sources.yaml and checks every source with a live request.
// Doubles as the regression check for when a site breaks its feed.
import { fetchFeed } from '../src/fetch/parse-feed.ts';
import { fetchSitemap } from '../src/fetch/sitemap.ts';
import { fetchWithBrowser, closeBrowser } from '../src/fetch/browser.ts';
import { loadSources, type Source } from '../src/fetch/index.ts';

type Probe = { count: number; freshest: number | null; sanitized?: boolean };
type Result = Source & Partial<Probe> & { ok: boolean; ms: number; err?: string };

const rsshubBase = process.env.RSSHUB_BASE_URL ?? 'http://localhost:1200';

const hours = (d: Date): number => (Date.now() - d.getTime()) / 3.6e6;

function freshestOf(dates: (string | undefined)[]): number | null {
  const parsed = dates.map((d) => new Date(d ?? NaN)).filter((d) => !Number.isNaN(d.getTime()));
  return parsed.length ? Math.min(...parsed.map(hours)) : null;
}

async function checkFeed(url: string): Promise<Probe> {
  const feed = await fetchFeed(url);
  const items = feed.items ?? [];
  return {
    count: items.length,
    freshest: freshestOf(
      items.map((i: { isoDate?: string; pubDate?: string }) => i.isoDate ?? i.pubDate),
    ),
    sanitized: feed.sanitized,
  };
}

async function checkApi(url: string): Promise<Probe> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  // HN Algolia and YC launches answer {hits}, HF daily papers answers an array.
  const arr = Array.isArray(body)
    ? body
    : ((body as { hits?: unknown[]; data?: unknown[] })?.hits ??
      (body as { data?: unknown[] })?.data ??
      []);
  return { count: arr.length, freshest: null };
}

async function probe(src: Source): Promise<Probe> {
  switch (src.kind) {
    case 'feed':
      return checkFeed(src.url!);
    case 'api':
      return checkApi(src.url!);
    case 'rsshub':
      return checkFeed(`${rsshubBase}${src.route}`);
    case 'sitemap': {
      const items = await fetchSitemap({
        sitemap: src.sitemap!,
        include: src.include!,
        limit: src.limit ?? 5,
      });
      return { count: items.length, freshest: freshestOf(items.map((i) => i.isoDate)) };
    }
    case 'browser': {
      const items = await fetchWithBrowser({
        url: src.url!,
        itemSelector: src.itemSelector!,
        titleSelector: src.titleSelector!,
        dateSelector: src.dateSelector,
        limit: src.limit,
      });
      return { count: items.length, freshest: freshestOf(items.map((i) => i.isoDate)) };
    }
    default:
      throw new Error(`unknown kind ${String(src.kind)}`);
  }
}

async function check(src: Source): Promise<Result> {
  const t0 = Date.now();
  try {
    return { ...src, ok: true, ...(await probe(src)), ms: Date.now() - t0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...src, ok: false, err: message.slice(0, 70), ms: Date.now() - t0 };
  }
}

/** Bounded concurrency, so we do not open a socket to every host at once. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) out.push(await fn(items[i++]));
    }),
  );
  return out;
}

const { sources } = loadSources();
const results = await pool(sources, 8, check);
results.sort((a, b) => Number(a.ok) - Number(b.ok) || a.id.localeCompare(b.id));

await closeBrowser();

let broken = 0;
let rsshubDown = 0;

for (const r of results) {
  if (r.ok) {
    const fresh = r.freshest == null ? '   n/a' : `${r.freshest.toFixed(0).padStart(4)}h`;
    const note = r.sanitized
      ? '  [xml repaired]'
      : r.freshest != null && r.freshest > 720
        ? '  [STALE >30d]'
        : '';
    console.log(
      `  OK   ${r.id.padEnd(22)} ${String(r.count).padStart(3)} items  freshest ${fresh}  ${String(r.ms).padStart(5)}ms${note}`,
    );
  } else {
    if (r.kind === 'rsshub') rsshubDown++;
    else broken++;
    console.log(`  FAIL ${r.id.padEnd(22)} ${r.kind.padEnd(7)} ${r.err}`);
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(
  `\n  ${ok}/${results.length} OK, ${broken} broken, ${rsshubDown} waiting on RSSHub (${rsshubBase})`,
);
if (broken > 0) process.exitCode = 1;
