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

/** Escape text and quoted link attributes for Telegram's HTML parse mode. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/** Trim plain text before assembling HTML, preserving tags and entities. */
function escapedText(text: string, limit: number): string {
  const escaped = escapeHtml(text);
  if (escaped.length <= limit) return escaped;
  let result = '';
  for (const char of text) {
    const part = escapeHtml(char);
    if (result.length + part.length > limit - 1) break;
    result += part;
  }
  return result.trimEnd() + '…';
}

/**
 * One story per message, in ranking order. Every message is complete on its
 * own, including the date, section, article link and summary.
 */
export function formatDigest(entries: Entry[], now = new Date(), tz = 'Europe/Belgrade'): string[] {
  return entries.map((entry) => {
    const section = SECTIONS.find(([key]) => key === entry.section)?.[1];
    const prefix =
      header(now, tz) +
      (section ? `\n\n<b>${section}</b>` : '') +
      `\n\n<b><a href="${escapeHtml(entry.url)}">${escapedText(entry.title, 512)}</a></b>` +
      ` (${entry.minutes} min read)\n`;
    const suffix = `\n<i>${escapedText(entry.domain, 256)}</i>`;
    const available = TELEGRAM_LIMIT - prefix.length - suffix.length;
    if (available < 1) throw new Error(`Article link too long for Telegram: ${entry.domain}`);
    return prefix + escapedText(entry.summary, available) + suffix;
  });
}
