/**
 * The knobs this application reads through Nest. Missing secrets are not fatal
 * at boot: a dry run must work on a laptop with an empty .env, and the job fails
 * loudly only when it actually needs the key.
 *
 * Two settings deliberately live outside it. OPENAI_API_KEY and OPENAI_MODEL are
 * read by summarize.ts, which is a plain module copied from the bot and has no
 * injector; SITE_OUT is read by the site's own build config. Anything listed
 * here is wired to something — a key nobody reads is worse than no key at all.
 */
import { fileURLToPath } from 'node:url';

export type Config = ReturnType<typeof configuration>;

export const configuration = () => ({
  tz: process.env.TZ_NAME ?? 'Europe/Belgrade',
  siteUrl: process.env.SITE_URL ?? 'https://tldr.cdroma.me',
  port: Number(process.env.API_PORT ?? 3090),

  /** The list shared with the bot. One file, two consumers. */
  sourcesPath: process.env.SOURCES_PATH ?? null,

  databaseUrl: process.env.DATABASE_URL ?? '',

  mail: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.MAIL_FROM ?? 'TLDR <daily@tldr.cdroma.me>',
    dryRun: process.env.MAIL_DRY_RUN === '1',
  },

  /** Where the evening run leaves data for the site build, and the built site. */
  paths: {
    data: process.env.DATA_DIR ?? fileURLToPath(new URL('../../data', import.meta.url)),
    site: process.env.SITE_DIR ?? fileURLToPath(new URL('../../../daily-web', import.meta.url)),
  },

  pipeline: {
    concurrency: Number(process.env.PIPELINE_CONCURRENCY ?? 6),
    /** Ceiling on grey-band "same story?" calls in one run — see pipeline.service. */
    resolverCalls: Number(process.env.RESOLVER_CALLS ?? 200),
    /**
     * How many stories a day's page carries. The channel posts everything; the
     * daily is a selection — the twenty best of the day and nothing more.
     */
    dailyLimit: Number(process.env.DAILY_LIMIT ?? 20),
  },
});
