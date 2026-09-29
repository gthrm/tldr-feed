import { describe, expect, it } from 'vitest';
import { dayBounds, dayOf, formatDayTitle, parseDayParam, shortDay, slotOf, yesterday } from './day.js';

const TZ = 'Europe/Belgrade';
const at = (iso: string) => new Date(iso).getTime();

describe('calendar days in Europe/Belgrade', () => {
  it('puts a late-evening moment in the local day, not the UTC one', () => {
    // 22:30 CEST on 21 Sep is 20:30 UTC — same day here, and still 21st locally.
    expect(dayOf(at('2026-09-21T20:30:00Z'), TZ)).toBe('2026-09-21');
    // 00:30 CEST on 22 Sep is 22:30 UTC on the 21st: the local day has moved on.
    expect(dayOf(at('2026-09-21T22:30:00Z'), TZ)).toBe('2026-09-22');
  });

  it('survives the autumn DST change', () => {
    // Clocks go back on 25 Oct 2026: that day is 25 hours long.
    const { startMs, endMs } = dayBounds('2026-10-25', TZ);
    expect(endMs - startMs).toBe(25 * 3600_000);
    expect(dayOf(startMs, TZ)).toBe('2026-10-25');
    expect(dayOf(endMs - 1, TZ)).toBe('2026-10-25');
  });

  it('reports the slot in local time', () => {
    expect(slotOf(at('2026-09-21T12:20:00Z'), TZ)).toBe('14:20');
  });

  it('knows what yesterday was across a month boundary', () => {
    expect(yesterday(TZ, at('2026-10-01T06:00:00Z'))).toBe('2026-09-30');
  });
});

describe('day parameters in URLs', () => {
  const now = at('2026-09-21T10:00:00Z');

  it('reads the short form as this year', () => {
    expect(parseDayParam('21-09', TZ, now)).toBe('2026-09-21');
    expect(parseDayParam('03-01', TZ, now)).toBe('2026-01-03');
  });

  it('reads a short form still ahead of us as last year', () => {
    // /31-12 in September must lead to the December that happened.
    expect(parseDayParam('31-12', TZ, now)).toBe('2025-12-31');
  });

  it('accepts the full form and rejects nonsense', () => {
    expect(parseDayParam('2024-02-29', TZ, now)).toBe('2024-02-29');
    expect(parseDayParam('99-99', TZ, now)).toBeNull();
    expect(parseDayParam('2026-02-30', TZ, now)).toBeNull();
    expect(parseDayParam('', TZ, now)).toBeNull();
    expect(parseDayParam('../etc/passwd', TZ, now)).toBeNull();
  });

  it('renders the forms used in links and headings', () => {
    expect(shortDay('2026-09-21')).toBe('21-09');
    expect(formatDayTitle('2026-09-21', TZ)).toBe('21 September 2026');
  });
});
