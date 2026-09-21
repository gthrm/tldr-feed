import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeUrl,
  isDomainRoot,
  normalizeTitle,
  entityTokens,
  domainOf,
} from './normalize.ts';

test('strips tracking parameters', () => {
  assert.equal(
    canonicalizeUrl(
      'https://techcrunch.com/2026/09/20/world-models/?utm_source=rss&utm_medium=feed&fbclid=xyz',
    ),
    'https://techcrunch.com/2026/09/20/world-models',
  );
});

test('keeps meaningful query parameters', () => {
  assert.equal(
    canonicalizeUrl('https://qwen.ai/blog?id=qwen-image-2.1'),
    'https://qwen.ai/blog?id=qwen-image-2.1',
  );
});

test('collapses www, trailing slash and amp to one form', () => {
  const a = canonicalizeUrl('https://www.theverge.com/2026/09/20/story/');
  const b = canonicalizeUrl('https://theverge.com/2026/09/20/story/amp/');
  assert.equal(a, b);
});

test('detects domain roots, which must never be linked', () => {
  assert.ok(isDomainRoot('https://venturebeat.com/'));
  assert.ok(isDomainRoot('https://venturebeat.com'));
  assert.ok(!isDomainRoot('https://venturebeat.com/ai/some-article'));
});

test('drops the outlet suffix feeds append to titles', () => {
  assert.equal(
    normalizeTitle('Rust 1.95 released | TechCrunch'),
    normalizeTitle('Rust 1.95 released'),
  );
});

test('entity tokens pick out the names that identify a story', () => {
  const e = entityTokens('Samsung expected to double HBM4 and HBM4E DRAM output');
  assert.ok(e.has('samsung'));
  assert.ok(e.has('hbm4'));
});

test('domainOf drops www', () => {
  assert.equal(domainOf('https://www.buchodi.com/a/b'), 'buchodi.com');
});

test('feed entities are decoded once, not escaped twice', async () => {
  const { decodeEntities } = await import('./fetch/index.ts');
  assert.equal(decodeEntities('Nvidia&#8217;s Jensen Huang'), 'Nvidia’s Jensen Huang');
  assert.equal(decodeEntities('AT&amp;T and R&amp;D'), 'AT&T and R&D');
});
