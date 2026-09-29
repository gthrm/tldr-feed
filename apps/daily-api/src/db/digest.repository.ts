import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DbService } from './db.service.js';
import { digest, type DigestRow, type NewDigestRow } from './schema.js';

/**
 * The (day, url) index is unique, and one duplicate anywhere in the batch aborts
 * the whole insert — a single link carried by two feeds must not cost the night.
 * The first row wins, which is the higher-ranked one.
 */
export function uniqueByUrl(rows: NewDigestRow[]): NewDigestRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

@Injectable()
export class DigestRepository {
  constructor(private readonly db: DbService) {}

  /**
   * The day is replaced, not appended to: a re-run after a failure must leave
   * exactly the day it just built. Both statements travel in one batch, so this
   * is still a single round trip — and round trips are what Neon charges for.
   */
  async saveDay(day: string, rows: NewDigestRow[]): Promise<number> {
    rows = uniqueByUrl(rows);
    if (!rows.length) return 0;
    const [, inserted] = await this.db.query('digest.saveDay', (db) =>
      db.batch([
        db.delete(digest).where(eq(digest.day, day)),
        db.insert(digest).values(rows).returning({ id: digest.id }),
      ]),
    );
    return inserted.length;
  }

  async day(day: string): Promise<DigestRow[]> {
    return this.db.query('digest.day', (db) =>
      db
        .select()
        .from(digest)
        .where(eq(digest.day, day))
        .orderBy(asc(digest.position), asc(digest.publishedAt)),
    );
  }

  /** Every day that has something, newest first — the archive page. */
  async days(): Promise<{ day: string; count: number }[]> {
    return this.db.query('digest.days', (db) =>
      db
        .select({ day: digest.day, count: sql<number>`count(*)::int` })
        .from(digest)
        .groupBy(digest.day)
        .orderBy(desc(digest.day)),
    );
  }

  async latestDay(): Promise<string | null> {
    const [row] = await this.db.query('digest.latestDay', (db) =>
      db.select({ day: digest.day }).from(digest).orderBy(desc(digest.day)).limit(1),
    );
    return row?.day ?? null;
  }

  async hasDay(day: string): Promise<boolean> {
    const [row] = await this.db.query('digest.hasDay', (db) =>
      db.select({ id: digest.id }).from(digest).where(and(eq(digest.day, day))).limit(1),
    );
    return Boolean(row);
  }
}
