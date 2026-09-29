/**
 * Ported from the bot's pipeline: the same proven rules, running on their own.
 * A deliberate copy, not a shared dependency - the two apps share the source
 * list and nothing else, so neither can break the other.
 */
// Turning whatever a source gave us into one Item shape, with a clean URL.
import { createHash } from 'node:crypto';
import { UA } from './feed.js';

export type Item = {
  id: string; // sha1 of the canonical url
  source: string; // source id from sources.yaml
  section: string;
  weight: number;
  title: string;
  url: string; // canonical, tracking-free, points at the article
  domain: string;
  publishedAt: Date | null;
  rawSummary: string; // whatever the feed gave; a fallback for extraction
  points?: number; // engagement signal, used for ranking only
};

const TRACKING = [
  /^utm_/i,
  /^at_/i,
  /^mc_/i,
  /^_hs/i,
  /^pk_/i,
  /^ref$/i,
  /^ref_src$/i,
  /^refsrc$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^igshid$/i,
  /^twclid$/i,
  /^cmpid$/i,
  /^ncid$/i,
  /^sr_share$/i,
  /^guccounter$/i,
  /^guce_referrer/i,
  /^campaign_id$/i,
  /^__twitter_impression$/i,
  /^s$/i,
  /^smid$/i,
  /^partner$/i,
];

/** Strip tracking junk and normalise the shape so the same article hashes the same. */
export function canonicalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';

  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.searchParams.sort();

  // /amp, /amp/, .amp — same article, different renderer
  u.pathname = u.pathname.replace(/\/amp\/?$/i, '/').replace(/\.amp$/i, '');
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');

  let out = u.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

/** True when the url is just a site root — the thing we must never link to. */
export function isDomainRoot(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.pathname === '/' || u.pathname === '';
  } catch {
    return false;
  }
}

/** Follow redirect shims (feedproxy, t.co, news.google) to the real article. */
export async function resolveRedirects(url: string, timeoutMs = 10000): Promise<string> {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const isShim =
    /(^|\.)(feedproxy\.google\.com|news\.google\.com|t\.co|bit\.ly|buff\.ly|trib\.al|dlvr\.it|ift\.tt)$/i.test(
      host,
    );
  if (!isShim) return url;

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

export function hashUrl(canonical: string): string {
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Outlets append their own name to feed titles; it is noise for comparison. */
const OUTLET_SUFFIX =
  /\s*[|–—-]\s*(techcrunch|the verge|ars technica|wired|engadget|the register|venturebeat|infoq|bleepingcomputer|reuters|bloomberg|cnbc|zdnet)\s*$/i;

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'as',
  'that',
  'this',
  'these',
  'those',
  'new',
  'now',
  'how',
  'why',
  'what',
  'says',
  'said',
  'will',
  'has',
  'have',
  'after',
  'over',
]);

export function normalizeTitle(title: string): string {
  return title
    .replace(OUTLET_SUFFIX, '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9\s.'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

/** Capitalised words, version numbers, product names — what actually names a story. */
export function entityTokens(title: string): Set<string> {
  const cleaned = title.replace(OUTLET_SUFFIX, '');
  const out = new Set<string>();
  for (const m of cleaned.matchAll(/\b([A-Z][A-Za-z0-9.+-]{1,}|\d+(?:\.\d+)+)\b/g)) {
    const tok = m[1].toLowerCase();
    if (!STOPWORDS.has(tok) && tok.length > 1) out.add(tok);
  }
  return out;
}
