import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuration } from './configuration.js';

afterEach(() => vi.unstubAllEnvs());

describe('workspace paths', () => {
  it('resolves defaults from the application, independently of the working directory', () => {
    vi.stubEnv('DATA_DIR', undefined);
    vi.stubEnv('SITE_DIR', undefined);
    const { paths } = configuration();
    expect(isAbsolute(paths.data)).toBe(true);
    expect(isAbsolute(paths.site)).toBe(true);
    const api = JSON.parse(
      readFileSync(join(dirname(paths.data), 'package.json'), 'utf8'),
    );
    const site = JSON.parse(
      readFileSync(join(paths.site, 'package.json'), 'utf8'),
    );
    expect(api.name).toBe('@tldr/daily-api');
    expect(site.name).toBe('@tldr/daily-web');
  });

  it('keeps explicit deployment paths', () => {
    vi.stubEnv('DATA_DIR', '/app/data');
    vi.stubEnv('SITE_DIR', '/app/apps/daily-web');
    expect(configuration().paths).toEqual({
      data: '/app/data',
      site: '/app/apps/daily-web',
    });
  });
});
