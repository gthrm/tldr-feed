// Sources that refuse plain HTTP clients and need a real browser.
// VentureBeat is the case this was written for: it answers 429 to any HTTP
// client, cookie jar and full Chrome headers included, but 200 to Chromium.
import { chromium, type Browser } from 'playwright';

export type BrowserItem = { title: string; link: string; isoDate?: string; contentSnippet: string };

export type BrowserConfig = {
  url: string;
  itemSelector: string;           // one listing entry
  titleSelector: string;          // anchor inside the entry: text + href
  dateSelector?: string;          // element carrying a datetime attribute
  limit?: number;
};

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  // Without this guard, six concurrent pipeline workers each launch their own
  // Chromium and all but one leak as zombies on an 8 GB Pi.
  if (!launching) {
    launching = chromium
      .launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
      .then((b) => {
        browser = b;
        return b;
      })
      .finally(() => {
        launching = null;
      });
  }
  return launching;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

export async function fetchWithBrowser(cfg: BrowserConfig): Promise<BrowserItem[]> {
  const ctx = await (await getBrowser()).newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  // Images and fonts are dead weight when we only want links and titles.
  // abort() rejects if the request was already handled or the context closed;
  // unhandled, that rejection is fatal to the process.
  await ctx.route('**/*.{png,jpg,jpeg,gif,webp,avif,svg,woff,woff2,ttf,mp4}',
    (r) => { void r.abort().catch(() => {}); });

  const page = await ctx.newPage();
  try {
    const res = await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status() ?? 'no response'}`);
    await page.waitForSelector(cfg.itemSelector, { timeout: 15000 });

    const items = await page.evaluate(
      ({ itemSelector, titleSelector, dateSelector, origin }) => {
        const out: { title: string; link: string; isoDate?: string; contentSnippet: string }[] = [];
        for (const el of document.querySelectorAll(itemSelector)) {
          const a = el.querySelector(titleSelector) as HTMLAnchorElement | null;
          const href = a?.getAttribute('href');
          const title = (a?.textContent ?? '').trim();
          if (!href || title.length < 10) continue;
          const t = dateSelector ? el.querySelector(dateSelector) : null;
          const isoDate = t?.getAttribute('datetime') ?? undefined;
          const snippet = (el.querySelector('p')?.textContent ?? '').trim();
          out.push({
            title,
            link: href.startsWith('http') ? href : new URL(href, origin).toString(),
            isoDate,
            contentSnippet: snippet,
          });
        }
        return out;
      },
      {
        itemSelector: cfg.itemSelector,
        titleSelector: cfg.titleSelector,
        dateSelector: cfg.dateSelector ?? null,
        origin: new URL(cfg.url).origin,
      },
    );

    // the same story can appear twice on a listing page (hero + grid)
    const seen = new Set<string>();
    return items.filter((i) => !seen.has(i.link) && seen.add(i.link)).slice(0, cfg.limit ?? 20);
  } finally {
    await ctx.close();
  }
}

/** Raw HTML of one page, for sites that refuse plain clients (extract.ts fallback). */
export async function fetchHtmlWithBrowser(url: string): Promise<string> {
  const ctx = await (await getBrowser()).newContext({ locale: 'en-US' });
  await ctx.route('**/*.{png,jpg,jpeg,gif,webp,avif,svg,woff,woff2,ttf,mp4}',
    (r) => { void r.abort().catch(() => {}); });
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Reddit redirects after first paint, and page.content() throws if it lands
    // mid-navigation. Let the page settle, then retry once.
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {
      // networkidle never arrives on pages that poll; the settle below is enough
    }
    await page.waitForTimeout(1200);

    try {
      return await page.content();
    } catch {
      await page.waitForTimeout(2500);
      return await page.content();
    }
  } finally {
    await ctx.close();
  }
}
