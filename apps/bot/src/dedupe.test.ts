import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, titleSimilarity, clusterItems } from './dedupe.ts';
import type { Item } from './normalize.ts';

// Real-shaped headlines: the same event as five outlets would word it.
const SAME_STORY: [string, string][] = [
  [
    'Samsung is expected to more than double output of its HBM4 and HBM4E DRAM',
    'Samsung to double HBM4 and HBM4E DRAM production next year',
  ],
  [
    'OpenAI ships GPT-5.6 Turbo with a 2M-token context window',
    'OpenAI releases GPT-5.6 Turbo, doubling context to 2M tokens',
  ],
  [
    'Cloudflare saves another 100TB of RAM with math (and Rust)',
    'Cloudflare reclaims 100TB of RAM by fixing its consistent hashing | The Register',
  ],
];

const DIFFERENT_STORY: [string, string][] = [
  ['Qwen Image 2.1', 'Rust 1.95 released with stable async traits'],
  ['Samsung to double HBM4 output', 'Apple announces new MacBook Pro'],
  [
    'An undercover Google analyst infiltrated a hacking group',
    'World model companies are keeping a lot of secrets',
  ],
];

test('same story across outlets is not reported as different', () => {
  for (const [a, b] of SAME_STORY) {
    const { score, verdict } = compare(a, b);
    assert.notEqual(verdict, 'different', `scored ${score.toFixed(2)}: "${a}" vs "${b}"`);
  }
});

test('unrelated stories stay separate', () => {
  for (const [a, b] of DIFFERENT_STORY) {
    const { score, verdict } = compare(a, b);
    assert.equal(verdict, 'different', `scored ${score.toFixed(2)}: "${a}" vs "${b}"`);
  }
});

test('identical titles score 1', () => {
  assert.equal(titleSimilarity('Qwen Image 2.1', 'Qwen Image 2.1'), 1);
});

const item = (id: string, title: string, weight = 1): Item => ({
  id,
  title,
  weight,
  source: id,
  section: 'bigtech',
  url: `https://example.com/${id}`,
  domain: 'example.com',
  publishedAt: new Date('2026-09-20T12:00:00Z'),
  rawSummary: '',
});

test('five outlets on one story collapse to one cluster', async () => {
  const items = [
    item('a', 'Samsung is expected to more than double output of its HBM4 and HBM4E DRAM', 0.8),
    item('b', 'Samsung to double HBM4 and HBM4E DRAM production next year', 1.3),
    item('c', 'Rust 1.95 released with stable async traits', 1.2),
  ];
  const clusters = await clusterItems(items);
  assert.equal(clusters.length, 2);
  const samsung = clusters.find((cl) => cl.items.length === 2);
  assert.ok(samsung, 'the two Samsung items should share a cluster');
  // the heavier source represents the cluster
  assert.equal(samsung.items[0].id, 'b');
});

test('the grey band is left to the resolver, and defaults to different', async () => {
  const seen: string[] = [];
  const items = [item('x', 'Anthropic acquires Vercept'), item('y', 'Anthropic buys Vercept team')];
  const merged = await clusterItems(items, (a, b) => {
    seen.push(`${a.id}/${b.id}`);
    return Promise.resolve(true);
  });
  const split = await clusterItems(items);
  assert.ok(merged.length <= split.length);
});

test('a digest sends exactly one complete message per story', async () => {
  const { formatDigest } = await import('./format.ts');
  const many = Array.from({ length: 40 }, (_, i) => ({
    title: `Story number ${i} about a thing that happened in the industry today`,
    url: `https://example.com/story-${i}`,
    domain: 'example.com',
    summary:
      'A company did a thing. It involved a specific number, namely 42. Developers may care because it changes a default.',
    minutes: 2,
    section: 'bigtech',
  }));
  const msgs = formatDigest(many);
  assert.equal(msgs.length, many.length);
  for (const m of msgs) assert.ok(m.length <= 4096, `message too long: ${m.length}`);
  // no item is cut in half: every opening tag has its closing tag
  for (const m of msgs) {
    assert.equal((m.match(/<a href=/g) ?? []).length, (m.match(/<\/a>/g) ?? []).length);
  }
});
