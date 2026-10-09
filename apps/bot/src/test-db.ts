// Tests run against a throwaway Postgres (TEST_DATABASE_URL), never against Neon.
// The digest table belongs to daily-api; its shape is copied here for the tests.
export async function useTestDb(): Promise<typeof import('./db.ts')> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set — tests need a scratch Postgres');
  process.env.DATABASE_URL = url;
  const db = await import('./db.ts');
  await db.sql`DROP TABLE IF EXISTS bot_items, bot_posted, bot_runs, digest`;
  await db.sql`
    CREATE TABLE digest (
      id serial PRIMARY KEY, day date NOT NULL, published_at timestamptz NOT NULL,
      slot varchar(5) NOT NULL, section varchar(32) NOT NULL, title text NOT NULL,
      url text NOT NULL, domain text NOT NULL, summary text NOT NULL,
      minutes integer NOT NULL, position integer NOT NULL
    )`;
  await db.sql`CREATE UNIQUE INDEX digest_day_url ON digest (day, url)`;
  await db.initDb();
  return db;
}
