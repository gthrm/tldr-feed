/**
 * Resend, with the limits it documents: at most 100 messages per batch call, at
 * most 50 addresses per message, ten requests a second. Each batch carries an
 * idempotency key, which Resend honours for 24 hours — the second guard after
 * mail_log, so a restart mid-send cannot mail anyone twice.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Resend } from 'resend';
import { renderConfirm, renderDigest, type MailEntry } from './template.js';
import { formatDayTitle } from '../shared/day.js';

const BATCH = 100;
/** Stands in for the unsubscribe link while the digest is rendered once. */
const UNSUB_TOKEN = 'https://unsubscribe.invalid/__TOKEN__';
const PACE_MS = 150; // ten requests a second, with room to spare

export type SendReport = { sent: string[]; failed: string[] };

type Recipient = { email: string; token: string };

@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private client?: Resend;

  constructor(private readonly config: ConfigService) {}

  get dryRun(): boolean {
    return this.config.get<boolean>('mail.dryRun') ?? false;
  }

  get configured(): boolean {
    return Boolean(this.config.get<string>('mail.apiKey'));
  }

  private get resend(): Resend {
    if (!this.client) {
      const key = this.config.get<string>('mail.apiKey');
      if (!key) throw new Error('RESEND_API_KEY is not set');
      this.client = new Resend(key);
    }
    return this.client;
  }

  private get from(): string {
    return this.config.get<string>('mail.from') ?? 'TLDR <daily@tldr.cdroma.me>';
  }

  private get siteUrl(): string {
    return this.config.get<string>('siteUrl') ?? 'https://tldr.cdroma.me';
  }

  unsubscribeUrl(token: string): string {
    return `${this.siteUrl}/api/subscriptions/unsubscribe/${token}`;
  }

  confirmUrl(token: string): string {
    return `${this.siteUrl}/api/subscriptions/confirm/${token}`;
  }

  /** One address at a time: the confirmation is a reply to a single action. */
  async sendConfirmation(email: string, token: string): Promise<void> {
    const mail = await renderConfirm({ confirmUrl: this.confirmUrl(token), siteUrl: this.siteUrl });
    if (this.dryRun) {
      this.log.warn(`[dry run] confirmation for ${email}: ${this.confirmUrl(token)}`);
      return;
    }
    await this.withRetries(() =>
      this.resend.emails.send({
        from: this.from,
        to: [email],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    );
  }

  async sendDigest(
    day: string,
    entries: MailEntry[],
    to: Recipient[],
    opts: { dryRun?: boolean } = {},
  ): Promise<SendReport> {
    if (!to.length) return { sent: [], failed: [] };
    // The caller's dry run wins over the environment: `--dry-run` must never
    // send, not even after MAIL_DRY_RUN has been turned off for production.
    const dryRun = opts.dryRun || this.dryRun;

    const dayTitle = formatDayTitle(day);
    // The full form, not /21-09: an email is read years later, and the short
    // form only ever points at the most recent day with that day-and-month.
    const dayPath = `/${day}`;

    if (dryRun) {
      const sample = await renderDigest({
        day,
        dayTitle,
        entries,
        siteUrl: this.siteUrl,
        dayPath,
        unsubscribeUrl: this.unsubscribeUrl(to[0].token),
      });
      this.log.warn(`[dry run] ${to.length} recipients would get "${sample.subject}"`);
      console.log(`\n${'='.repeat(70)}\n${sample.text}\n${'='.repeat(70)}\n`);
      console.log(`HTML: ${sample.html.length} bytes`);
      return { sent: [], failed: [] };
    }

    if (!this.configured) throw new Error('RESEND_API_KEY is not set');

    // Rendered once. Only the unsubscribe link differs between recipients, and
    // compiling the same MJML document a hundred times on a Pi is pure waste.
    const template = await renderDigest({
      day,
      dayTitle,
      entries,
      siteUrl: this.siteUrl,
      dayPath,
      unsubscribeUrl: UNSUB_TOKEN,
    });

    const sent: string[] = [];
    const failed: string[] = [];

    for (let i = 0; i < to.length; i += BATCH) {
      const chunk = to.slice(i, i + BATCH);
      const payload = chunk.map((r) => {
        const link = this.unsubscribeUrl(r.token);
        return {
          from: this.from,
          to: [r.email],
          subject: template.subject,
          html: template.html.replaceAll(UNSUB_TOKEN, link),
          text: template.text.replaceAll(UNSUB_TOKEN, link),
          headers: {
            // Without these two, Gmail and Outlook treat the mail as less
            // trustworthy however clean the list is.
            'List-Unsubscribe': `<${link}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        };
      });

      const key = `daily-${day}-${createHash('sha1').update(chunk.map((c) => c.email).join(',')).digest('hex').slice(0, 16)}`;

      try {
        await this.withRetries(() => this.resend.batch.send(payload, { idempotencyKey: key }));
        sent.push(...chunk.map((c) => c.email));
      } catch (err) {
        this.log.error(`batch of ${chunk.length} failed: ${String(err)}`);
        failed.push(...chunk.map((c) => c.email));
      }
      if (i + BATCH < to.length) await new Promise((r) => setTimeout(r, PACE_MS));
    }

    this.log.log(`digest for ${day}: ${sent.length} sent, ${failed.length} failed`);
    return { sent, failed };
  }

  /** Four attempts, backing off — the same discipline the bot uses for Telegram. */
  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = (await fn()) as T & { error?: { message?: string; name?: string } };
        if (result?.error) throw new Error(result.error.message ?? result.error.name ?? 'send failed');
        return result;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const retriable = /rate|429|5\d\d|timeout|fetch failed/i.test(message);
        if (!retriable || attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
