/**
 * The day's page and email, by hand (the stories come from the bot, in Postgres):
 *   npm run job -- --day 2026-09-28 --dry-run   full run, writes and sends nothing
 *   npm run job -- --day 2026-09-28             the real thing
 *   npm run job -- --build-only                 rebuild the site from what is on disk
 *   npm run job -- --mail-to you@example.com    send one day to one address, once
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DailyJob } from '../jobs/daily.job.js';
import { MailService } from '../mail/mail.service.js';
import { SiteService } from '../site/site.service.js';
import { formatDayTitle, today, yesterday } from '../shared/day.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const log = new Logger('run-day');
  const day = arg('day') ?? (process.argv.includes('--yesterday') ? yesterday() : today());
  const dryRun = process.argv.includes('--dry-run');
  const skipBuild = process.argv.includes('--skip-build');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // The first live send goes to one address by hand, before any subscriber is
  // ever mailed. Reads the day from disk: no pipeline, no database, no list.
  const mailTo = arg('mail-to');
  if (mailTo) {
    const content = app.get(SiteService).readDay(day);
    if (!content?.entries.length) {
      log.error(`nothing on disk for ${day} — run the job first`);
      await app.close();
      process.exitCode = 1;
      return;
    }
    const report = await app
      .get(MailService)
      .sendDigest(day, content.entries, [{ email: mailTo, token: 'one-off-test' }]);
    log.log(`${formatDayTitle(day)}: sent ${report.sent.length}, failed ${report.failed.length}`);
    await app.close();
    return;
  }

  // Rebuilding without running the pipeline: after a deploy, or when the site
  // has to come back without spending anything on summaries.
  if (process.argv.includes('--build-only')) {
    const site = app.get(SiteService);
    site.rebuildIndex();
    await site.build();
    await app.close();
    return;
  }

  const entries = await app.get(DailyJob).run(day, { dryRun, skipBuild });
  console.log(`\n${formatDayTitle(day)} — ${entries.length} items`);
  await app.close();
}

await main();
