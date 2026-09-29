import { archive, latestDay, readDay } from '$lib/server/data.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = () => {
	const days = archive();
	const day = latestDay();
	return { day: day ? readDay(day) : null, previous: days[1]?.day ?? null };
};
