/**
 * The whole product, once a day. Everything that needs the database happens in
 * this one window: Neon wakes, four statements run, and it sleeps until tomorrow.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DbService } from '../db/db.service.js';
import { DigestRepository } from '../db/digest.repository.js';
import { SubscribersRepository } from '../db/subscribers.repository.js';
import { MailService } from '../mail/mail.service.js';
import { PipelineService, type DayEntry } from '../pipeline/pipeline.service.js';
import { SiteService } from '../site/site.service.js';
import { today } from '../shared/day.js';

export type RunOptions = {
  /** Collect and render, but write nothing and send nothing. */
  dryRun?: boolean;
  /** Skip the site rebuild — useful when only the mail is being tested. */
  skipBuild?: boolean;
  limit?: number;
};

@Injectable()
export class DailyJob {
  private readonly log = new Logger(DailyJob.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly pipeline: PipelineService,
    private readonly digests: DigestRepository,
    private readonly subscribers: SubscribersRepository,
    private readonly site: SiteService,
    private readonly mail: MailService,
    private readonly db: DbService,
  ) {}

  /**
   * 21:10, after the day's last news has landed. Earlier would cut the evening
   * off; later would push the email past the hour anyone reads it.
   */
  @Cron('10 21 * * *', { timeZone: process.env.TZ_NAME ?? 'Europe/Belgrade' })
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

    const entries = await this.pipeline.run(day, { limit: opts.limit });
    if (!entries.length) {
      this.log.log('nothing survived — no page, no email, and nothing written');
      return [];
    }

    if (dryRun) {
      await this.mail.sendDigest(day, entries, [{ email: 'dry@run', token: 'dry-run-token' }], {
        dryRun: true,
      });
      this.log.log(`dry run: ${entries.length} entries, nothing written`);
      return entries;
    }

    // 1. The database, in one statement.
    if (this.db.configured) {
      const saved = await this.digests.saveDay(
        day,
        entries.map((e) => ({
          day: e.day,
          publishedAt: e.publishedAt,
          slot: e.slot,
          section: e.section,
          title: e.title,
          url: e.url,
          domain: e.domain,
          summary: e.summary,
          minutes: e.minutes,
          position: e.position,
        })),
      );
      this.log.log(`${saved} new rows in the database`);
    } else {
      this.log.warn('DATABASE_URL is not set — the run continues without storing anything');
    }

    // 2. The page.
    this.site.writeDay(day, entries);
    if (!opts.skipBuild) await this.site.build();

    // 3. The email, to everyone who has not had this day already.
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
    return entries;
  }
}
