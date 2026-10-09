/**
 * The day's page and email, built from the ten stories the Telegram bot posted.
 * Neon wakes, four statements run, and it sleeps again.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DbService } from '../db/db.service.js';
import { DigestRepository } from '../db/digest.repository.js';
import { SubscribersRepository } from '../db/subscribers.repository.js';
import { MailService } from '../mail/mail.service.js';
import type { DayEntry } from '../shared/entry.js';
import { SiteService } from '../site/site.service.js';
import { today } from '../shared/day.js';

export type RunOptions = {
  /** Read and render, but write nothing and send nothing. */
  dryRun?: boolean;
  /** Skip the site rebuild — useful when only the mail is being tested. */
  skipBuild?: boolean;
};

@Injectable()
export class DailyJob {
  private readonly log = new Logger(DailyJob.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly digests: DigestRepository,
    private readonly subscribers: SubscribersRepository,
    private readonly site: SiteService,
    private readonly mail: MailService,
    private readonly db: DbService,
  ) {}

  /** 10:30, after the bot's 10:00 top ten has gone out to Telegram. */
  @Cron('30 10 * * *', { timeZone: process.env.TZ_NAME ?? 'Europe/Belgrade' })
  async scheduled(): Promise<void> {
    if (this.running) {
      this.log.warn('previous run still going — skipping this one');
      return;
    }
    this.running = true;
    try {
      await this.run(today(this.config.get<string>('tz')));
    } catch (err) {
      this.log.error(`evening run failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  async run(day: string, opts: RunOptions = {}): Promise<DayEntry[]> {
    const dryRun = opts.dryRun ?? false;
    this.db.resetStats();
    this.log.log(`evening run for ${day}${dryRun ? ' (dry run)' : ''}`);

    // The page carries exactly what the Telegram bot posted this morning: the
    // bot writes each story into `digest`. This app selects nothing itself.
    const entries: DayEntry[] = this.db.configured
      ? (await this.digests.day(day)).map((r, position) => ({
          day: r.day,
          publishedAt: r.publishedAt,
          slot: r.slot,
          section: r.section,
          title: r.title,
          url: r.url,
          domain: r.domain,
          summary: r.summary,
          minutes: r.minutes,
          position,
        }))
      : [];
    if (!entries.length) {
      this.log.warn('the bot posted nothing for this day — no page, no email');
      return [];
    }

    if (dryRun) {
      await this.mail.sendDigest(day, entries, [{ email: 'dry@run', token: 'dry-run-token' }], {
        dryRun: true,
      });
      this.log.log(`dry run: ${entries.length} entries, nothing written`);
      return entries;
    }

    // 1. The page.
    this.site.writeDay(day, entries);
    if (!opts.skipBuild) await this.site.build();

    // 2. The email, to everyone who has not had this day already.
    if (this.db.configured) {
      const [active, alreadyMailed] = [
        await this.subscribers.active(),
        await this.subscribers.mailedOn(day),
      ];
      const recipients = active.filter((r) => !alreadyMailed.has(r.email));
      this.log.log(`${recipients.length} of ${active.length} subscribers still to mail`);

      if (recipients.length) {
        const report = await this.mail.sendDigest(day, entries, recipients);
        if (report.sent.length) await this.subscribers.recordMailed(day, report.sent);
      }
    }

    this.db.logStats(`evening run ${day}`);
    // The line the "Daily Digest Missing" alert in Grafana waits for.
    this.log.log(`evening run ${day} done: ${entries.length} entries`);
    return entries;
  }
}
