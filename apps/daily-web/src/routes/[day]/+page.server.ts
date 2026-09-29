import { error } from '@sveltejs/kit';
import { archive, readDay, resolveDayParam } from '$lib/server/data.js';
import type { EntryGenerator, PageServerLoad } from './$types.js';

export const load: PageServerLoad = ({ params }) => {
	const day = resolveDayParam(params.day);
	const content = day ? readDay(day) : null;
	if (!content) error(404, 'No digest for that day');

	const days = archive().map((d) => d.day);
	const index = days.indexOf(content.day);
	return {
		day: content,
		newer: index > 0 ? days[index - 1] : null,
		older: index >= 0 && index < days.length - 1 ? days[index + 1] : null
	};
};

/**
 * Every day gets its full form, which is unambiguous forever. The short form is
 * built only for the most recent day carrying that day-and-month: two years of
 * archive both claim /21-09, and one file would otherwise overwrite the other
 * and quietly serve the wrong year.
 */
export const entries: EntryGenerator = () => {
	const days = archive().map((d) => d.day);
	const shortTaken = new Set<string>();
	const out: { day: string }[] = [];

	for (const day of days) {
		out.push({ day });
		const short = `${day.slice(8)}-${day.slice(5, 7)}`;
		if (!shortTaken.has(short)) {
			shortTaken.add(short);
			out.push({ day: short });
		}
	}
	return out;
};
