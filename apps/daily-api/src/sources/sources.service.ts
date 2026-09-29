/**
 * The source list is shared with the bot: one file, two consumers, so adding or
 * dropping a source changes both. Only the list is shared — no code is.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export type SourceKind = 'feed' | 'api' | 'rsshub' | 'sitemap' | 'browser';

export type Source = {
  id: string;
  kind: SourceKind;
  url?: string;
  route?: string;
  sitemap?: string;
  include?: string;
  limit?: number;
  itemSelector?: string;
  titleSelector?: string;
  dateSelector?: string;
  weight: number;
  section: string;
  min_points?: number;
  max_age_hours?: number;
};

type SourcesFile = { defaults?: Partial<Source>; sources: Source[] };

const SHARED = join('packages', 'sources', 'sources.yaml');

/** Walks up from a starting directory until the shared list turns up. */
function findSharedList(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, SHARED);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

@Injectable()
export class SourcesService {
  private readonly log = new Logger(SourcesService.name);

  constructor(private readonly config: ConfigService) {}

  /** Absolute path of the list actually in use — logged, so it is never a guess. */
  path(): string {
    const configured = this.config.get<string | null>('sourcesPath');
    if (configured) return resolve(configured);

    const here = dirname(fileURLToPath(import.meta.url));
    const found = findSharedList(process.cwd()) ?? findSharedList(here);
    if (!found) {
      throw new Error(
        `Shared source list not found. Looked for ${SHARED} above ${process.cwd()}; ` +
          'set SOURCES_PATH to point at it.',
      );
    }
    return found;
  }

  load(): { defaults: Partial<Source>; sources: Source[] } {
    const path = this.path();
    const cfg = parse(readFileSync(path, 'utf8')) as SourcesFile;
    const defaults = cfg.defaults ?? {};
    const sources = cfg.sources.map((src) => ({ ...defaults, ...src }));
    this.log.log(`${sources.length} sources from ${path}`);
    return { defaults, sources };
  }
}
