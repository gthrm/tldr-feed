/**
 * Calendar days in one timezone. Naive arithmetic is wrong twice a year, so
 * every conversion goes through Luxon and the zone is explicit.
 */
import { DateTime } from 'luxon';

export const TZ = process.env.TZ_NAME ?? 'Europe/Belgrade';

/** 'YYYY-MM-DD' for the calendar day a moment belongs to. */
export function dayOf(ms: number, tz: string = TZ): string {
  return DateTime.fromMillis(ms, { zone: tz }).toISODate()!;
}

export function today(tz: string = TZ, now: number = Date.now()): string {
  return dayOf(now, tz);
}

export function yesterday(tz: string = TZ, now: number = Date.now()): string {
  return DateTime.fromMillis(now, { zone: tz }).minus({ days: 1 }).toISODate()!;
}

/** 'HH:mm' local time — the slot a story was published in. */
export function slotOf(ms: number, tz: string = TZ): string {
  return DateTime.fromMillis(ms, { zone: tz }).toFormat('HH:mm');
}

/** Half-open [start, end) of a calendar day, in epoch milliseconds. */
export function dayBounds(day: string, tz: string = TZ): { startMs: number; endMs: number } {
  const start = DateTime.fromISO(day, { zone: tz }).startOf('day');
  return { startMs: start.toMillis(), endMs: start.plus({ days: 1 }).toMillis() };
}

/**
 * URLs are written the short way, `/21-09`. A bare day-month means this year,
 * unless that date is still in the future — then it is last year's, so `/31-12`
 * in January leads to December rather than to nothing.
 */
export function parseDayParam(raw: string, tz: string = TZ, now: number = Date.now()): string | null {
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const full = DateTime.fromISO(s, { zone: tz });
    return full.isValid ? full.toISODate() : null;
  }

  if (/^\d{2}-\d{2}$/.test(s)) {
    const ref = DateTime.fromMillis(now, { zone: tz });
    const guess = DateTime.fromFormat(`${s}-${ref.year}`, 'dd-LL-yyyy', { zone: tz });
    if (!guess.isValid) return null;
    return (guess.startOf('day') > ref.startOf('day') ? guess.minus({ years: 1 }) : guess).toISODate();
  }

  return null;
}

/** '2026-09-21' -> '21-09', the form used in links. */
export function shortDay(day: string): string {
  const [, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}-${month}`;
}

/** '2026-09-21' -> '21 September 2026', the form used in headings. */
export function formatDayTitle(day: string, tz: string = TZ): string {
  return DateTime.fromISO(day, { zone: tz }).toFormat('d LLLL yyyy');
}
