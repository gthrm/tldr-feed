import { describe, expect, it, vi } from 'vitest';
import { DailyJob } from './daily.job.js';
import type { DayEntry } from '../pipeline/pipeline.service.js';

/**
 * The budget is the requirement: Neon suspends after five minutes of inactivity,
 * so what costs money is the number of times it is woken, not the number of rows.
 * The evening run must therefore stay one window of a handful of statements.
 */
const entry = (i: number): DayEntry => ({
  day: '2026-09-28',
  publishedAt: new Date('2026-09-28T12:00:00Z'),
  slot: '14:00',
  section: 'bigtech',
  title: `Story ${i}`,
  url: `https://example.com/${i}`,
  domain: 'example.com',
  summary: 'Something happened, and here is the detail that matters.',
  minutes: 3,
  position: i,
});

function harness(entries: DayEntry[]) {
  const calls: string[] = [];
  const sendDigest = vi.fn(async () => ({ sent: ['a@example.com'], failed: [] }));
  const track =
    (label: string, result: unknown = undefined) =>
    async () => {
      calls.push(label);
      return result;
    };

  const job = new DailyJob(
    { get: (key: string) => (key === 'tz' ? 'Europe/Belgrade' : undefined) } as never,
    { run: vi.fn(async () => entries) } as never,
    { saveDay: track('digest.saveDay', 1) } as never,
    {
      active: track('subscribers.active', [{ email: 'a@example.com', token: 't' }]),
      mailedOn: track('mailLog.day', new Set<string>()),
      recordMailed: track('mailLog.record'),
    } as never,
    { writeDay: vi.fn(), build: vi.fn(async () => undefined) } as never,
    { sendDigest } as never,
    { configured: true, resetStats: vi.fn(), logStats: vi.fn() } as never,
  );

  return { job, calls, sendDigest };
}

describe('the evening run', () => {
  it('touches the database four times, whatever the day holds', async () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(i));
    const { job, calls } = harness(many);

    await job.run('2026-09-28');

    // Sixty stories and a mailing list, in four statements: save, read the list,
    // read who already got it, record who just did.
    expect(calls).toEqual([
      'digest.saveDay',
      'subscribers.active',
      'mailLog.day',
      'mailLog.record',
    ]);
  });

  it('writes nothing and sends nothing on an empty day', async () => {
    const { job, calls } = harness([]);
    await job.run('2026-09-28');
    expect(calls).toEqual([]);
  });

  it('never touches the database on a dry run', async () => {
    const { job, calls } = harness([entry(0)]);
    await job.run('2026-09-28', { dryRun: true });
    expect(calls).toEqual([]);
  });

  it('tells the mailer it is a dry run, whatever MAIL_DRY_RUN says', async () => {
    // The mailer has its own environment flag. Once that is off for production,
    // only this argument stands between `--dry-run` and a real send.
    const { job, sendDigest } = harness([entry(0)]);
    await job.run('2026-09-28', { dryRun: true });
    expect(sendDigest).toHaveBeenCalledWith(
      '2026-09-28',
      expect.anything(),
      expect.anything(),
      { dryRun: true },
    );
  });
});
