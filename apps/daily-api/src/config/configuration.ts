/**
 * The knobs this application reads through Nest. Missing secrets are not fatal
 * at boot: a dry run must work on a laptop with an empty .env, and the job fails
 * loudly only when it actually needs the key.
 *
 * SITE_OUT deliberately lives outside it: the site's own build config reads it.
 * This app calls no model; the stories come from the bot. Anything listed
 * here is wired to something — a key nobody reads is worse than no key at all.
 */
import { fileURLToPath } from 'node:url';

export type Config = ReturnType<typeof configuration>;

export const configuration = () => ({
  tz: process.env.TZ_NAME ?? 'Europe/Belgrade',
  siteUrl: process.env.SITE_URL ?? 'https://tldr.cdroma.me',
  port: Number(process.env.API_PORT ?? 3090),

  databaseUrl: process.env.DATABASE_URL ?? '',

  mail: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.MAIL_FROM ?? 'TLDR <daily@tldr.cdroma.me>',
    dryRun: process.env.MAIL_DRY_RUN === '1',
  },

  /** Where the daily run leaves data for the site build, and the built site. */
  paths: {
    data: process.env.DATA_DIR ?? fileURLToPath(new URL('../../data', import.meta.url)),
    site: process.env.SITE_DIR ?? fileURLToPath(new URL('../../../daily-web', import.meta.url)),
  },
});
