import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from './db.service.js';
import { mailLog, subscribers, type Subscriber } from './schema.js';

export type SignupResult = 'created' | 'pending' | 'active' | 'resubscribed';

@Injectable()
export class SubscribersRepository {
  constructor(private readonly db: DbService) {}

  static token(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * One round trip. The answer the caller shows is the same either way, so a
   * stranger cannot use the form to find out who is subscribed.
   */
  async signup(email: string): Promise<{ outcome: SignupResult; token: string }> {
    const token = SubscribersRepository.token();
    const [row] = await this.db.query('subscribers.signup', (db) =>
      db
        .insert(subscribers)
        .values({ email, token, status: 'pending' })
        .onConflictDoUpdate({
          target: subscribers.email,
          // An unsubscribed address may come back; an active one is left alone.
          set: {
            status: sql`case when ${subscribers.status} = 'unsubscribed' then 'pending' else ${subscribers.status} end`,
            unsubscribedAt: null,
          },
        })
        .returning(),
    );
    // The row comes back from the same statement, so the caller never needs a
    // second round trip just to learn the token: one signup, one wake-up.
    if (!row) return { outcome: 'pending', token };
    if (row.status === 'active') return { outcome: 'active', token: row.token };
    return { outcome: row.confirmedAt ? 'resubscribed' : 'created', token: row.token };
  }

  async byToken(token: string): Promise<Subscriber | null> {
    const [row] = await this.db.query('subscribers.byToken', (db) =>
      db.select().from(subscribers).where(eq(subscribers.token, token)).limit(1),
    );
    return row ?? null;
  }

  async confirm(token: string): Promise<boolean> {
    const rows = await this.db.query('subscribers.confirm', (db) =>
      db
        .update(subscribers)
        .set({ status: 'active', confirmedAt: new Date() })
        .where(and(eq(subscribers.token, token), inArray(subscribers.status, ['pending', 'active'])))
        .returning({ email: subscribers.email }),
    );
    return rows.length > 0;
  }

  async unsubscribe(token: string): Promise<boolean> {
    const rows = await this.db.query('subscribers.unsubscribe', (db) =>
      db
        .update(subscribers)
        .set({ status: 'unsubscribed', unsubscribedAt: new Date() })
        .where(eq(subscribers.token, token))
        .returning({ email: subscribers.email }),
    );
    return rows.length > 0;
  }

  /** Everyone who should get today's email, in one query. */
  async active(): Promise<{ email: string; token: string }[]> {
    return this.db.query('subscribers.active', (db) =>
      db
        .select({ email: subscribers.email, token: subscribers.token })
        .from(subscribers)
        .where(eq(subscribers.status, 'active')),
    );
  }

  /** Who already got this day — the restart guard, one query for the whole day. */
  async mailedOn(day: string): Promise<Set<string>> {
    const rows = await this.db.query('mailLog.day', (db) =>
      db.select({ email: mailLog.email }).from(mailLog).where(eq(mailLog.day, day)),
    );
    return new Set(rows.map((r) => r.email));
  }

  async recordMailed(day: string, emails: string[]): Promise<void> {
    if (!emails.length) return;
    await this.db.query('mailLog.record', (db) =>
      db
        .insert(mailLog)
        .values(emails.map((email) => ({ day, email })))
        .onConflictDoNothing(),
    );
  }
}
