import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDigest, type Entry } from './format.ts';

const entry = (title: string, section = 'bigtech'): Entry => ({
  title,
  section,
  url: 'https://example.com/article',
  domain: 'example.com',
  summary: 'A useful summary. With specific details.',
  minutes: 2,
});

test('one message per entry preserves ranking across sections', () => {
  const entries = [entry('First', 'yc'), entry('Second', 'science'), entry('Third')];
  const messages = formatDigest(entries);
  assert.equal(messages.length, 3);
  messages.forEach((message, index) => {
    assert.ok(message.includes(`>${entries[index].title}</a>`));
    assert.equal((message.match(/<a href=/g) ?? []).length, 1);
    assert.ok(message.includes('🗞'));
    assert.ok(message.includes(entries[index].summary));
  });
});

test('empty digest sends nothing, unknown sections still render the story', () => {
  assert.deepEqual(formatDigest([]), []);
  assert.ok(formatDigest([entry('Unknown', 'other')])[0].includes('>Unknown</a>'));
});

test('an oversized story stays in one message with valid HTML and complete entities', () => {
  const story = entry('<&"😀'.repeat(1000));
  story.summary = '<&"😀'.repeat(3000);
  story.domain = 'x'.repeat(1000);
  story.url += '?q="quoted"&page=1';
  const [message] = formatDigest([story]);
  assert.ok(message.length <= 4096);
  assert.ok(message.includes('q=&quot;quoted&quot;&amp;page=1'));
  assert.equal((message.match(/<b>/g) ?? []).length, (message.match(/<\/b>/g) ?? []).length);
  assert.equal((message.match(/<a /g) ?? []).length, (message.match(/<\/a>/g) ?? []).length);
  assert.ok(!/&(?!(?:amp|lt|gt|quot);)/.test(message));
  assert.ok(message.endsWith('</i>'));
});
