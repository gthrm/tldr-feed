// Fetching and parsing a feed, tolerant of the ways real feeds are broken.
// Shared by the pipeline and by scripts/check-sources.ts.
import Parser from 'rss-parser';

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*';

const parser = new Parser({ headers: { 'User-Agent': UA, Accept: ACCEPT }, timeout: 20000 });

// Some feeds ship raw `&` inside text (DeepSeek does), which is not valid XML.
// Escape any ampersand that does not already start a character or named entity.
export function sanitizeXml(xml: string): string {
  return xml.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});)/g, '&amp;');
}

export type FeedItem = {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
};

export type FeedResult = { items: FeedItem[]; sanitized: boolean };

export async function fetchFeed(url: string, etag?: string, lastModified?: string) {
  const headers: Record<string, string> = { 'User-Agent': UA, Accept: ACCEPT };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (res.status === 304) return { notModified: true, items: [], sanitized: false };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  let sanitized = false;
  let feed;
  try {
    feed = await parser.parseString(xml);
  } catch {
    // second chance: repair the ampersands and parse again
    feed = await parser.parseString(sanitizeXml(xml));
    sanitized = true;
  }

  return {
    notModified: false,
    items: feed.items ?? [],
    sanitized,
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
  };
}
