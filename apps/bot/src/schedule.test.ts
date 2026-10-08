import { test } from 'node:test';
import assert from 'node:assert/strict';
import cron from 'node-cron';
import { SLOTS, startSchedule, TZ } from './schedule.ts';

test('publishes once at 10:00, with quiet collection on a separate timer', async (t) => {
  const scheduled: { expression: string; run: () => void; timezone?: string }[] = [];
  t.mock.method(
    cron,
    'schedule',
    (expression: string, run: () => void, options: cron.ScheduleOptions) => {
      scheduled.push({ expression, run, timezone: options.timezone });
    },
  );
  const calls: string[] = [];
  const publish = () => {
    calls.push('publish');
    return Promise.resolve();
  };
  const poll = () => {
    calls.push('poll');
    return Promise.resolve();
  };
  startSchedule(publish, poll);
  assert.deepEqual(SLOTS, [[10, 0]]);
  assert.deepEqual(
    scheduled.map((job) => job.expression),
    ['0 10 * * *', '*/20 * * * *'],
  );
  assert.ok(scheduled.every((job) => job.timezone === TZ));

  scheduled[1].run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['poll']);
  calls.length = 0;
  scheduled[0].run();
  scheduled[0].run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['poll', 'publish']);
});
