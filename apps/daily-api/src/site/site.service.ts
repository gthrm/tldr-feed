/**
 * The site is built from plain JSON on disk, not from the database: the pages are
 * static, so the reader never costs a query and the build never needs Neon awake.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DayEntry } from '../shared/entry.js';

const run = promisify(execFile);

export type SiteEntry = {
  slot: string;
  section: string;
  title: string;
  url: string;
  domain: string;
  summary: string;
  minutes: number;
};

export type SiteDay = { day: string; builtAt: string; entries: SiteEntry[] };

@Injectable()
export class SiteService {
  private readonly log = new Logger(SiteService.name);

  constructor(private readonly config: ConfigService) {}

  private get root(): string {
    return resolve(this.config.get<string>('paths.data') ?? 'data', 'site');
  }

  private write(relative: string, body: unknown): string {
    const path = join(this.root, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(body, null, 2));
    return path;
  }

  writeDay(day: string, entries: DayEntry[]): string {
    const body: SiteDay = {
      day,
      // Written here, where the zone is known, so the feed does not have to
      // guess an offset that is wrong for half the year.
      builtAt: new Date().toISOString(),
      entries: entries.map((e) => ({
        slot: e.slot,
        section: e.section,
        title: e.title,
        url: e.url,
        domain: e.domain,
        summary: e.summary,
        minutes: e.minutes,
      })),
    };
    const path = this.write(join('days', `${day}.json`), body);
    this.log.log(`${entries.length} entries -> ${path}`);
    this.rebuildIndex();
    return path;
  }

  /** The archive index, derived from whatever day files exist. */
  rebuildIndex(): { day: string; count: number }[] {
    let files: string[] = [];
    try {
      files = readdirSync(join(this.root, 'days')).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    const days = files
      .map((f) => {
        const day = f.replace(/\.json$/, '');
        try {
          const raw = JSON.parse(readFileSync(join(this.root, 'days', f), 'utf8')) as SiteDay;
          return { day, count: raw.entries?.length ?? 0 };
        } catch {
          return { day, count: 0 }; // a half-written file must not break the build
        }
      })
      .filter((d) => d.count > 0)
      .sort((a, b) => (a.day < b.day ? 1 : -1));

    this.write('index.json', days);
    return days;
  }
  /** A day as it was written for the site — no database, no pipeline. */
  readDay(day: string): SiteDay | null {
    try {
      return JSON.parse(readFileSync(join(this.root, 'days', `${day}.json`), 'utf8')) as SiteDay;
    } catch {
      return null;
    }
  }

  /**
   * Rebuilds the static site from the JSON on disk. Only the days that exist are
   * prerendered, and the previous output is kept, so an archive of a thousand
   * days never makes the nightly build slower.
   */
  async build(): Promise<void> {
    const cwd = resolve(this.config.get<string>('paths.site') ?? '../daily-web');
    const out = process.env.SITE_OUT ?? join(cwd, 'build');
    const started = Date.now();

    // The site is built beside the live one, never on top of it: the static
    // adapter empties its output directory first, and that directory is what
    // Caddy is serving this very second. Building into a staging directory and
    // then moving the result in keeps the site up throughout.
    //
    // The staging directory lives inside the output directory on purpose. When
    // the output is a mounted volume, a sibling on the container's own layer is
    // a different filesystem and every rename fails with EXDEV.
    const staging = join(out, '.staging');
    mkdirSync(out, { recursive: true });
    rmSync(staging, { recursive: true, force: true });

    const { stdout, stderr } = await run('npm', ['run', 'build'], {
      cwd,
      env: { ...process.env, SITE_DATA_DIR: this.root, SITE_OUT: staging },
      maxBuffer: 8 * 1024 * 1024,
      // A wedged build must not hang the job forever: the schedule guard would
      // then skip every following night without saying why.
      timeout: 15 * 60_000,
    });

    const fresh = new Set(readdirSync(staging));
    for (const name of fresh) {
      rmSync(join(out, name), { recursive: true, force: true });
      renameSync(join(staging, name), join(out, name));
    }
    // Anything the new build no longer produces goes, so a removed page cannot
    // linger and be served forever.
    for (const name of readdirSync(out)) {
      if (name === '.staging' || fresh.has(name)) continue;
      rmSync(join(out, name), { recursive: true, force: true });
    }
    rmSync(staging, { recursive: true, force: true });

    const tail = (stdout + stderr).trim().split('\n').slice(-3).join(' | ');
    this.log.log(`site rebuilt in ${Date.now() - started} ms into ${out}: ${tail}`);
  }
}
