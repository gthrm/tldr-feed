/**
 * Ported from the bot's pipeline: the same proven rules, running on their own.
 * A deliberate copy, not a shared dependency - the two apps share the source
 * list and nothing else, so neither can break the other.
 */
// Article text for the summariser. Readability first; a browser only when the
// site refuses plain clients, because launching Chromium is expensive.
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createHash } from 'node:crypto';
import { UA } from './feed.js';

export type Article = { text: string; words: number; minutes: number; hash: string };

const WORDS_PER_MINUTE = 220;

function finish(text: string, url = ''): Article {
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = clean ? clean.split(' ').length : 0;
  return {
    text: clean.slice(0, 12000),
    words,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    hash: createHash('sha1')
      .update(`${url}\u0000${clean.slice(0, 12000)}`)
      .digest('hex')
      .slice(0, 20),
  };
}

function readable(html: string, url: string): string {
  // jsdom is noisy about the CSS and JS on news sites; none of it matters here.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {});
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, { url, virtualConsole });
  const parsed = new Readability(dom.window.document).parse();
  return parsed?.textContent ?? '';
}

/**
 * `fallbackText` is the feed description: used when the page cannot be read,
 * so a source never disappears from the digest over one unreachable article.
 */
/** Many pages that defeat Readability still describe themselves honestly. */
function metaDescription(html: string): string {
  for (const re of [
    /<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i,
    /<meta[^>]*content="([^"]*)"[^>]*property="og:description"/i,
    /<meta[^>]*name="description"[^>]*content="([^"]*)"/i,
  ]) {
    const m = html.match(re);
    if (m?.[1] && m[1].trim().length > 40) {
      return m[1]
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    }
  }
  return '';
}

export async function extractArticle(
  url: string,
  fallbackText = '',
  useBrowser?: (url: string) => Promise<string>,
): Promise<Article & { ok: boolean }> {
  // A PDF has no HTML to parse; the feed description is all we get.
  if (/\.pdf($|\?)/i.test(url)) {
    const a = finish(fallbackText, url);
    return { ...a, ok: a.words >= 40 };
  }

  // A relative or malformed link survives canonicalizeUrl; new URL() throws on
  // it, and outside the try that killed the whole slot before markConsumed ran.
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return { ...finish(fallbackText, url), ok: fallbackText.trim().length > 120 };
  }
  if (/(^|\.)reddit\.com$/i.test(host)) {
    // The subreddit feed already carries the post body, and Reddit answers
    // every other route with 403 or a "prove your humanity" challenge — even to
    // a real browser. So the feed text is the whole story for a text post.
    if (fallbackText.trim().length > 120) {
      return { ...finish(fallbackText, url), ok: true };
    }
    const a = finish(fallbackText, url);
    return { ...a, ok: a.words >= 20 };
  }
  const target = url;

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    if (res.status === 429 || res.status === 403) {
      if (useBrowser) {
        const html = await useBrowser(url);
        const text = readable(html, url);
        if (text.length > 400) return { ...finish(text, url), ok: true };
      }
      return { ...finish(fallbackText, url), ok: false };
    }

    // A dead link must not reach the channel.
    if (!res.ok) return { ...finish(fallbackText, url), ok: false };

    const html = await res.text();
    const text = readable(html, url);
    if (text.length > 400) return { ...finish(text, url), ok: true };

    // 200 but almost no text means the page renders client-side (Qwen does this).
    if (useBrowser) {
      try {
        const renderedHtml = await useBrowser(target);
        const rendered = readable(renderedHtml, url);
        if (rendered.length > 400) return { ...finish(rendered, url), ok: true };
        const renderedMeta = metaDescription(renderedHtml);
        if (renderedMeta) return { ...finish(renderedMeta, url), ok: true };
      } catch {
        // fall through
      }
    }

    // Product pages and app shells defeat Readability but still carry a usable
    // og:description. Thin is better than dropping the item entirely.
    const meta = metaDescription(html);
    if (meta) return { ...finish(meta, url), ok: true };

    const best = [fallbackText, text].sort((a, b) => b.length - a.length)[0];
    return { ...finish(best, url), ok: best.trim().length > 120 };
  } catch {
    return { ...finish(fallbackText, url), ok: false };
  }
}
