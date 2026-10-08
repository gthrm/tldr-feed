export const MAX_DAILY_POSTS = 10;
export const TZ = process.env.TZ_NAME ?? 'Europe/Belgrade';

/** Calendar day in the publication timezone, independent of the host's timezone. */
export function publicationDay(now = new Date(), tz = TZ): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now);
}
