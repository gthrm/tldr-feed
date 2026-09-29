import { archive, readDay } from '$lib/server/data.js';
import { formatDay } from '$lib/sections.js';

export const prerender = true;

const SITE = process.env.SITE_URL ?? 'https://tldr.cdroma.me';

const escape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET() {
	const items = archive()
		.slice(0, 30)
		.map(({ day }) => {
			const content = readDay(day);
			if (!content) return '';
			// The run stamps the file when it writes it; a day from before that
			// field existed falls back to midday, which is never an hour wrong in
			// the way a hardcoded +02:00 offset is for half the year.
			const published = content.builtAt ?? `${day}T12:00:00Z`;
			const body = content.entries
				.map((e) => `${escape(e.title)} — ${escape(e.summary)} (${escape(e.domain)})`)
				.join('\n\n');
			return `<item>
      <title>${escape(formatDay(day))}</title>
      <link>${SITE}/${day}</link>
      <guid isPermaLink="false">tldr-${day}</guid>
      <pubDate>${new Date(published).toUTCString()}</pubDate>
      <description>${escape(body)}</description>
    </item>`;
		})
		.join('\n');

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>TLDR daily</title>
    <link>${SITE}</link>
    <description>One page a day of tech, science and the odd corners of the web.</description>
${items}
</channel></rss>`,
		{ headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
	);
}
