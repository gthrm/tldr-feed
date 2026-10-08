import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Item } from './normalize.ts';

test('daily pipeline caps the ranking and remembers partial Telegram sends', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'newsbot-pipeline-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.DRY_RUN = '0';
  process.env.TZ_NAME = 'Europe/Belgrade';
  process.env.MIN_ITEMS = '1';
  process.env.PIPELINE_CONCURRENCY = '6';
  process.env.MAX_MODEL_CALLS_PER_DAY = '100';
  process.env.MAX_ITEMS_PER_SLOT = '200'; // obsolete settings cannot raise the cap
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHANNEL_ID = 'test-channel';
  const { runSlot } = await import('./index.ts');
  const { db, recordNew, closeDb } = await import('./db.ts');
  t.after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  const titles = [
    'Coupon discounts for shoppers',
    'Rust memory ownership',
    'Samsung semiconductor fabrication',
    'Astronomy telescope observations',
    'Medieval manuscript restoration',
    'Nintendo game design',
    'Postgres query execution',
    'Battery chemistry experiments',
    'Typography letter spacing',
    'Ocean submarine exploration',
    'Linux kernel scheduling',
    'Mathematical prime conjectures',
    'Photography camera lenses',
    'Robotics motion controllers',
  ];
  const items: Item[] = titles.map((title, index) => ({
    id: `story-${index}`,
    source: 'test',
    section: 'bigtech',
    title,
    url: `https://example.com/story-${index}.pdf`,
    domain: 'example.com',
    publishedAt: new Date(),
    rawSummary:
      'A detailed description of a discovery with evidence and specific technical details. '.repeat(
        5,
      ),
    weight: 100 - index,
  }));
  let sent: string[] = [];
  let requests = 0;
  let failAt = Infinity;
  t.mock.method(globalThis, 'fetch', (url: string, options: RequestInit) => {
    requests++;
    assert.ok(typeof options.body === 'string');
    if (url.startsWith('https://api.telegram.org/')) {
      if (sent.length === failAt)
        return Promise.resolve(Response.json({ description: 'test failure' }, { status: 400 }));
      const body = JSON.parse(options.body) as { text: string };
      sent.push(body.text);
      return Promise.resolve(Response.json({ ok: true }));
    }
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body) as { messages: { content: string }[] };
    const prompt = body.messages[0].content;
    const content = prompt.startsWith('Classify')
      ? prompt.includes(titles[0])
        ? 'SKIP, BIGTECH, PROMO'
        : 'RELEVANT, SCIENCE, NEWS'
      : prompt.startsWith('Do these two')
        ? 'NO'
        : 'A specific discovery was made. Researchers measured the result.';
    return Promise.resolve(Response.json({ choices: [{ message: { content } }] }));
  });

  recordNew(items);
  await runSlot();
  assert.equal(sent.length, 10);
  sent.forEach((message, index) => {
    assert.ok(
      message.includes(`>${titles[index + 1]}</a>`),
      'highest relevant stories in rank order',
    );
    assert.equal((message.match(/<a href=/g) ?? []).length, 1);
  });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM posted').get() as { n: number }).n, 10);
  const requestsBeforeRetry = requests;
  await runSlot();
  assert.equal(requests, requestsBeforeRetry, 'repeat run makes no model or Telegram calls');

  db.exec('DELETE FROM posted; DELETE FROM daily_publications; DELETE FROM model_calls;');
  const legacyPost = db.prepare('INSERT INTO posted VALUES (?, ?, ?, ?)');
  for (let index = 0; index < 4; index++) {
    legacyPost.run(`legacy-${index}`, `legacy-${index}`, `Old bulletin ${index}`, Date.now());
  }
  sent = [];
  await runSlot();
  assert.equal(sent.length, 0, 'ordinary run respects legacy posts');
  await runSlot({ rebuildToday: true });
  assert.equal(
    sent.length,
    10,
    'explicit today rebuild reconsiders consumed stories and sends a fresh ten',
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM posted').get() as { n: number }).n, 14);
  const requestsAfterRebuild = requests;
  await runSlot({ rebuildToday: true });
  assert.equal(
    requests,
    requestsAfterRebuild,
    'today rebuild still cannot repeat the new daily batch',
  );

  db.exec(
    'DELETE FROM items; DELETE FROM posted; DELETE FROM daily_publications; DELETE FROM model_calls;',
  );
  sent = [];
  failAt = 3;
  recordNew(items);
  await assert.rejects(runSlot(), /Telegram 400/);
  assert.equal(sent.length, 3);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM posted').get() as { n: number }).n, 3);
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS n FROM items WHERE consumed_at IS NOT NULL').get() as {
        n: number;
      }
    ).n,
    3,
  );
  const requestsAfterFailure = requests;
  await runSlot();
  assert.equal(
    requests,
    requestsAfterFailure,
    'partial failure does not start another batch today',
  );
});
