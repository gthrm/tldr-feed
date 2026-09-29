/**
 * Neon over HTTP: no pool, no idle connection. That matters more than it looks —
 * on the free plan the compute suspends after five minutes of inactivity, and an
 * idle socket would keep it awake and burn the monthly compute hours.
 *
 * Every round trip goes through `query()`, which counts them. The evening run
 * logs the count, and a test asserts it: "one window a day" is a requirement, so
 * it is measured rather than hoped for.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

export type Db = NeonHttpDatabase<typeof schema>;

@Injectable()
export class DbService {
  private readonly log = new Logger(DbService.name);
  private client?: Db;
  private counts = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get<string>('databaseUrl'));
  }

  private get db(): Db {
    if (!this.client) {
      const url = this.config.get<string>('databaseUrl');
      if (!url) {
        throw new Error('DATABASE_URL is not set — a dry run works without it, a real run does not');
      }
      this.client = drizzle(neon(url), { schema });
    }
    return this.client;
  }

  /** The only way to touch the database, so the count is always the truth. */
  async query<T>(label: string, fn: (db: Db) => Promise<T>): Promise<T> {
    this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
    return fn(this.db);
  }

  /** Round trips since the last reset, for the log line and for the test. */
  stats(): { total: number; byLabel: Record<string, number> } {
    const byLabel = Object.fromEntries(this.counts);
    return { total: [...this.counts.values()].reduce((a, b) => a + b, 0), byLabel };
  }

  resetStats(): void {
    this.counts.clear();
  }

  logStats(context: string): void {
    const { total, byLabel } = this.stats();
    this.log.log(`${context}: ${total} database round trips ${JSON.stringify(byLabel)}`);
  }
}
