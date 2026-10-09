import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DbService } from './db.service.js';
import { digest, type DigestRow } from './schema.js';

@Injectable()
export class DigestRepository {
  constructor(private readonly db: DbService) {}

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
