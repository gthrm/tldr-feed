import { describe, expect, it } from 'vitest';
import { uniqueByUrl } from './digest.repository.js';
import type { NewDigestRow } from './schema.js';

const row = (url: string, position: number): NewDigestRow => ({
  day: '2026-09-28',
  publishedAt: new Date(),
  slot: '14:00',
  section: 'bigtech',
  title: `Story ${position}`,
  url,
  domain: 'example.com',
  summary: 'A thing happened.',
  minutes: 2,
  position,
});

describe('writing a day', () => {
  it('keeps the higher-ranked row when one link arrives twice', () => {
    const rows = [
      row('https://example.com/a', 0),
      row('https://example.com/b', 1),
      row('https://example.com/a', 2), // same story, second feed
    ];
    const out = uniqueByUrl(rows);
    expect(out.map((r) => r.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(out[0].position).toBe(0);
  });

  it('leaves a clean day untouched', () => {
    const rows = [row('https://example.com/a', 0), row('https://example.com/b', 1)];
    expect(uniqueByUrl(rows)).toHaveLength(2);
  });
});
