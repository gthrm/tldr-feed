import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { SourcesService } from './sources.service.js';

const service = (sourcesPath: string | null = null) =>
  new SourcesService({ get: () => sourcesPath } as unknown as ConfigService);

describe('the shared source list', () => {
  it('is found by walking up to packages/sources, from anywhere in the repo', () => {
    const { sources } = service().load();
    expect(sources.length).toBeGreaterThan(40);
    // The bot reads the very same file: a source added there shows up here.
    expect(sources.map((s: { id: string }) => s.id)).toContain('hn');
  });

  it('merges the defaults into every entry', () => {
    const { sources } = service().load();
    expect(sources.every((s) => typeof s.weight === 'number')).toBe(true);
    expect(sources.every((s) => typeof s.max_age_hours === 'number')).toBe(true);
  });

  it('honours SOURCES_PATH, which is how the container points at the mount', () => {
    const explicit = service('../../packages/sources/sources.yaml');
    expect(explicit.load().sources.length).toBeGreaterThan(40);
  });

  it('says what it looked for when the list is missing', () => {
    expect(() => service('/nowhere/sources.yaml').load()).toThrow();
  });
});
