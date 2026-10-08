import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MAX_DAILY_POSTS, publicationDay } from './publication.ts';

test('the publication day follows Belgrade midnight in winter and summer', () => {
  assert.equal(MAX_DAILY_POSTS, 10);
  assert.equal(publicationDay(new Date('2026-01-01T23:30:00Z'), 'Europe/Belgrade'), '2026-01-02');
  assert.equal(publicationDay(new Date('2026-07-01T22:30:00Z'), 'Europe/Belgrade'), '2026-07-02');
  assert.equal(publicationDay(new Date('2026-07-01T21:30:00Z'), 'Europe/Belgrade'), '2026-07-01');
});

test('one persistent claim per day, including legacy posts on upgrade day', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'newsbot-publication-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.TZ_NAME = 'Europe/Belgrade';
  const { db, claimDailyPublication, spendModelCall, closeDb } = await import('./db.ts');
  t.after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });
  const morning = new Date('2026-10-08T08:00:00Z');
  assert.equal(claimDailyPublication(morning), true);
  assert.equal(claimDailyPublication(morning), false);
  const restarted = new Database(process.env.DB_PATH);
  try {
    assert.deepEqual(restarted.prepare('SELECT day FROM daily_publications').get(), {
      day: '2026-10-08',
    });
    assert.equal(
      restarted
        .prepare('INSERT OR IGNORE INTO daily_publications VALUES (?, ?)')
        .run('2026-10-08', morning.getTime()).changes,
      0,
    );
  } finally {
    restarted.close();
  }
  assert.equal(claimDailyPublication(new Date('2026-10-09T08:00:00Z')), true);
  db.prepare('INSERT INTO posted VALUES (?, ?, ?, ?)').run(
    'legacy',
    'legacy',
    'Already posted',
    new Date('2026-10-10T07:00:00Z').getTime(),
  );
  assert.equal(claimDailyPublication(new Date('2026-10-10T08:00:00Z')), false);
  assert.equal(claimDailyPublication(new Date('2026-10-10T08:00:00Z'), true), true);
  assert.equal(claimDailyPublication(new Date('2026-10-10T08:00:00Z'), true), false);

  // Dedup stops before consuming publication budget; ordinary calls can use it.
  assert.equal(spendModelCall(3, 2), true);
  assert.equal(spendModelCall(3, 2), false);
  assert.equal(spendModelCall(3), true);
  assert.equal(spendModelCall(3), true);
  assert.equal(spendModelCall(3), false);
});
