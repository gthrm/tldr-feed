/**
 * The evening run leaves JSON on disk; the build turns it into pages. Nothing
 * here touches a database, which is why a page view costs nothing at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ArchiveDay, Day } from '../types.js';

const ROOT = resolve(process.env.SITE_DATA_DIR ?? '../daily-api/data/site');

export function archive(): ArchiveDay[] {
	const path = join(ROOT, 'index.json');
	if (!existsSync(path)) return [];
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as ArchiveDay[];
	} catch {
		return [];
	}
}

export function readDay(day: string): Day | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null; // never build a path from junk
	const path = join(ROOT, 'days', `${day}.json`);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Day;
	} catch {
		return null;
	}
}

export function latestDay(): string | null {
	return archive()[0]?.day ?? null;
}

/**
 * A short '21-09' means that date in the current year, unless it is still ahead
 * of us — then last year's, so /31-12 in January leads to December.
 */
export function resolveDayParam(param: string, days = archive()): string | null {
	if (/^\d{4}-\d{2}-\d{2}$/.test(param)) return param;
	if (!/^\d{2}-\d{2}$/.test(param)) return null;
	const [dayOfMonth, month] = param.split('-');
	const match = days.find((d) => d.day.endsWith(`-${month}-${dayOfMonth}`));
	return match?.day ?? null;
}
