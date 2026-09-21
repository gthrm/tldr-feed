// Assembling the digest. Every item renders identically, whichever source it
// came from: the headline is the only link and it points at the article.
export type Entry = {
  title: string;
  url: string;
  domain: string;
  summary: string;
  minutes: number;
  section: string;
};

const TELEGRAM_LIMIT = 4096;

const SECTIONS: [string, string][] = [
  ['bigtech', '🚀 BIG TECH &amp; STARTUPS'],
  ['science', '🔬 SCIENCE &amp; FUTURISTIC TECHNOLOGY'],
  ['programming', '⚙️ PROGRAMMING, DESIGN &amp; DATA SCIENCE'],
  ['yc', '🆕 YC LAUNCHES'],
];

/** Telegram's HTML parse mode only forgives these three. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function header(now = new Date(), tz = 'Europe/Belgrade'): string {
  const d = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
  }).format(now);
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const abbr =
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'CET';
  return `🗞 <b>TLDR · ${d}, ${t} ${abbr}</b>`;
}

function renderEntry(e: Entry): string {
  return (
    `<b><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a></b> (${e.minutes} min read)\n` +
    `${escapeHtml(e.summary)}\n` +
    `<i>${escapeHtml(e.domain)}</i>`
  );
}

/**
 * Every new item goes out. Telegram caps a message at 4096 characters, so a
 * long digest becomes several messages, split between items and never inside
 * one. Parts after the first carry a continuation marker instead of the header.
 */
export function formatDigest(entries: Entry[], now = new Date(), tz = 'Europe/Belgrade'): string[] {
  // Each block carries a flag: a section header must never be the last thing in
  // a message, with its items stranded under "…continued" in the next one.
  const blocks: { text: string; isHeader: boolean }[] = [];
  for (const [key, label] of SECTIONS) {
    const inSection = entries.filter((e) => e.section === key);
    if (!inSection.length) continue;
    blocks.push({ text: `<b>${label}</b>`, isHeader: true });
    for (const e of inSection) blocks.push({ text: renderEntry(e), isHeader: false });
  }

  const messages: string[] = [];
  let current = header(now, tz);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const candidate = `${current}\n\n${block.text}`;
    const next = blocks[i + 1];
    const headerWouldBeOrphaned =
      block.isHeader && next && `${candidate}\n\n${next.text}`.length > TELEGRAM_LIMIT;

    if (candidate.length <= TELEGRAM_LIMIT && !headerWouldBeOrphaned) {
      current = candidate;
      continue;
    }
    messages.push(current);
    current = `<i>…continued</i>\n\n${block.text}`;
    // A single item longer than the limit cannot be split without cutting a
    // sentence, so it is trimmed on a word boundary as a last resort.
    if (current.length > TELEGRAM_LIMIT) {
      current = current.slice(0, TELEGRAM_LIMIT - 1).replace(/\s\S*$/, '') + '…';
    }
  }
  messages.push(current);
  return messages;
}
