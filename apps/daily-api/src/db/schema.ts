/**
 * The site and the mailing. `digest` is written by the Telegram bot, one row per
 * posted story; the bot's own tables (bot_*) live in the same database.
 */
import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const digest = pgTable(
  'digest',
  {
    id: serial('id').primaryKey(),
    /** Calendar day in Europe/Belgrade, decided once at write time. */
    day: date('day').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    /** 'HH:mm' local — shown next to the headline, like the channel does. */
    slot: varchar('slot', { length: 5 }).notNull(),
    section: varchar('section', { length: 32 }).notNull(),
    title: text('title').notNull(),
    /** The article itself. Never a domain root, never a discussion thread. */
    url: text('url').notNull(),
    domain: text('domain').notNull(),
    summary: text('summary').notNull(),
    minutes: integer('minutes').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('digest_day_url').on(t.day, t.url), index('digest_day').on(t.day)],
);

export const subscribers = pgTable('subscribers', {
  email: text('email').primaryKey(),
  /** Unguessable, and the same token both confirms and unsubscribes. */
  token: text('token').notNull().unique(),
  status: varchar('status', { length: 16 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
});

/** A restart at 21:11 must not send the same digest twice. */
export const mailLog = pgTable(
  'mail_log',
  {
    day: date('day').notNull(),
    email: text('email').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.email] })],
);

export type DigestRow = typeof digest.$inferSelect;
export type NewDigestRow = typeof digest.$inferInsert;
export type Subscriber = typeof subscribers.$inferSelect;
