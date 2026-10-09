import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DAILY_POSTS, publicationDay } from './publication.ts';
import { useTestDb } from './test-db.ts';

test('the publication day follows Belgrade midnight in winter and summer', () => {
  assert.equal(MAX_DAILY_POSTS, 10);
  assert.equal(publicationDay(new Date('2026-01-01T23:30:00Z'), 'Europe/Belgrade'), '2026-01-02');
  assert.equal(publicationDay(new Date('2026-07-01T22:30:00Z'), 'Europe/Belgrade'), '2026-07-02');
  assert.equal(publicationDay(new Date('2026-07-01T21:30:00Z'), 'Europe/Belgrade'), '2026-07-01');
});

test('one persistent claim per day, and a hard ceiling on model calls', async (t) => {
  process.env.TZ_NAME = 'Europe/Belgrade';
  const { claimDailyPublication, spendModelCall, closeDb } = await useTestDb();
  t.after(closeDb);

  const morning = new Date('2026-10-08T08:00:00Z');
  assert.equal(await claimDailyPublication(morning), true);
  assert.equal(await claimDailyPublication(morning), false);
  assert.equal(await claimDailyPublication(new Date('2026-10-08T20:00:00Z')), false);
  assert.equal(await claimDailyPublication(new Date('2026-10-09T08:00:00Z')), true);

  // Dedup stops before consuming publication budget; ordinary calls can use it.
  assert.equal(await spendModelCall(3, 2), true);
  assert.equal(await spendModelCall(3, 2), false);
  assert.equal(await spendModelCall(3), true);
  assert.equal(await spendModelCall(3), true);
  assert.equal(await spendModelCall(3), false);
});
