/** The same four sections, in the same order, as the channel and the email. */
export const SECTIONS: [string, string][] = [
	['bigtech', '🚀 BIG TECH & STARTUPS'],
	['science', '🔬 SCIENCE & FUTURISTIC TECHNOLOGY'],
	['programming', '⚙️ PROGRAMMING, DESIGN & DATA SCIENCE'],
	['yc', '🆕 YC LAUNCHES']
];

/** '2026-09-21' -> '21-09', the short form used in links. */
export function shortDay(day: string): string {
	const [, month, dayOfMonth] = day.split('-');
	return `${dayOfMonth}-${month}`;
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** '2026-09-21' -> '21 September 2026'. Pure string work: the day is already local. */
export function formatDay(day: string): string {
	const [year, month, dayOfMonth] = day.split('-');
	return `${Number(dayOfMonth)} ${MONTHS[Number(month) - 1]} ${year}`;
}
