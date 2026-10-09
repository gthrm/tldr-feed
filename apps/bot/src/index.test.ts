import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Item } from './normalize.ts';
import { useTestDb } from './test-db.ts';

test('daily pipeline caps the ranking and remembers partial Telegram sends', async (t) => {
  process.env.DRY_RUN = '0';
  process.env.TZ_NAME = 'Europe/Belgrade';
  process.env.MIN_ITEMS = '1';
  process.env.PIPELINE_CONCURRENCY = '6';
  process.env.MAX_MODEL_CALLS_PER_DAY = '100';
  process.env.MAX_ITEMS_PER_SLOT = '200'; // obsolete settings cannot raise the cap
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHANNEL_ID = 'test-channel';
  const { sql, saveItems, closeDb } = await useTestDb();
  const { runSlot } = await import('./index.ts');
  t.after(closeDb);
  const count = async (table: string) =>
    Number((await sql`SELECT count(*)::int AS n FROM ${sql(table)}`)[0].n);

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

  const collect = () => saveItems(items).then(() => undefined);
  await runSlot(collect);
  assert.equal(sent.length, 10);
  sent.forEach((message, index) => {
    assert.ok(
      message.includes(`>${titles[index + 1]}</a>`),
      'highest relevant stories in rank order',
    );
    assert.equal((message.match(/<a href=/g) ?? []).length, 1);
  });
  assert.equal(await count('bot_posted'), 10);
  const page = await sql<{ title: string }[]>`SELECT title FROM digest ORDER BY position`;
  assert.deepEqual(
    page.map((r) => r.title),
    titles.slice(1, 11),
    'the page gets exactly the ten the channel got',
  );
  const requestsBeforeRetry = requests;
  await runSlot(collect);
  assert.equal(requests, requestsBeforeRetry, 'repeat run makes no model or Telegram calls');

  // Tomorrow: the same stories are still in the feeds but must not go out again.
  await sql`DELETE FROM bot_runs`;
  sent = [];
  await runSlot(collect);
  assert.equal(sent.length, 3, 'only the stories not posted yesterday');
  assert.ok(sent.every((m) => !titles.slice(1, 11).some((title) => m.includes(`>${title}</a>`))));

  await sql`DELETE FROM bot_items; DELETE FROM bot_posted; DELETE FROM bot_runs; DELETE FROM digest`.simple();
  sent = [];
  failAt = 3;
  await assert.rejects(runSlot(collect), /Telegram 400/);
  assert.equal(sent.length, 3);
  assert.equal(await count('bot_posted'), 3);
  const requestsAfterFailure = requests;
  await runSlot(collect);
  assert.equal(
    requests,
    requestsAfterFailure,
    'partial failure does not start another batch today',
  );
});
