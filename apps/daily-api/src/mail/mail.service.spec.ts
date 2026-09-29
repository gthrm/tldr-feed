import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MailService } from './mail.service.js';
import type { MailEntry } from './template.js';

const { send, batchSend } = vi.hoisted(() => ({
  send: vi.fn(),
  batchSend: vi.fn(),
}));

// Keep the real MJML renderer: mocking it would hide asynchronous rendering bugs.
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
    batch = { send: batchSend };
  },
}));

const entry: MailEntry = {
  slot: '14:00',
  section: 'bigtech',
  title: 'A story worth reading',
  url: 'https://example.com/story',
  domain: 'example.com',
  summary: 'The detail that matters.',
  minutes: 3,
};

function mailer(dryRun = false, apiKey = 're_test'): MailService {
  return new MailService(
    new ConfigService({
      siteUrl: 'https://tldr.example.com',
      mail: { apiKey, from: 'TLDR <daily@example.com>', dryRun },
    }),
  );
}

describe('mail delivery', () => {
  beforeEach(() => {
    send
      .mockReset()
      .mockResolvedValue({ data: { id: 'confirmation-id' }, error: null });
    batchSend.mockReset().mockResolvedValue({
      data: { data: [{ id: 'first-digest-id' }, { id: 'second-digest-id' }] },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the confirmation with compiled HTML and a working confirmation link', async () => {
    await mailer().sendConfirmation('reader@example.com', 'confirm-token');

    expect(send).toHaveBeenCalledOnce();
    const [payload] = send.mock.calls[0];
    expect(payload.to).toEqual(['reader@example.com']);
    expect(payload.html).toContain('<!doctype html>');
    expect(payload.html).toContain(
      'https://tldr.example.com/api/subscriptions/confirm/confirm-token',
    );
    expect(payload.html).not.toContain('<mjml>');
    expect(payload.text).toContain('/confirm/confirm-token');
  });

  it('sends compiled digest HTML with a separate unsubscribe link for each reader', async () => {
    const recipients = [
      { email: 'first@example.com', token: 'first-token' },
      { email: 'second@example.com', token: 'second-token' },
    ];
    const report = await mailer().sendDigest('2026-09-28', [entry], recipients);

    expect(report).toEqual({
      sent: recipients.map((r) => r.email),
      failed: [],
    });
    expect(batchSend).toHaveBeenCalledOnce();
    const [payload, options] = batchSend.mock.calls[0];
    expect(payload).toHaveLength(2);
    for (const [index, recipient] of recipients.entries()) {
      const link = `https://tldr.example.com/api/subscriptions/unsubscribe/${recipient.token}`;
      expect(payload[index].to).toEqual([recipient.email]);
      expect(payload[index].html).toContain('<!doctype html>');
      expect(payload[index].html).toContain(entry.title);
      expect(payload[index].html).toContain(link);
      expect(payload[index].html).not.toContain('unsubscribe.invalid');
      expect(payload[index].text).toContain(link);
      expect(payload[index].headers['List-Unsubscribe']).toBe(`<${link}>`);
    }
    expect(payload[0].html).not.toContain('second-token');
    expect(payload[1].html).not.toContain('first-token');
    expect(options.idempotencyKey).toMatch(/^daily-2026-09-28-/);
  });

  it.each(['environment', 'caller'] as const)(
    'renders a digest without sending when the %s requests a dry run',
    async (source) => {
      const output = vi
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      const service = mailer(source === 'environment');
      const report = await service.sendDigest(
        '2026-09-28',
        [entry],
        [{ email: 'reader@example.com', token: 'reader-token' }],
        { dryRun: source === 'caller' },
      );

      expect(report).toEqual({ sent: [], failed: [] });
      expect(batchSend).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(output).toHaveBeenCalledWith(
        expect.stringMatching(/^HTML: [1-9]\d* bytes$/),
      );
    },
  );

  it('does not send a confirmation when MAIL_DRY_RUN is enabled', async () => {
    await mailer(true).sendConfirmation('reader@example.com', 'confirm-token');
    expect(send).not.toHaveBeenCalled();
  });

  it('fails a live confirmation if the Resend key is missing', async () => {
    await expect(
      mailer(false, '').sendConfirmation('reader@example.com', 'token'),
    ).rejects.toThrow('RESEND_API_KEY is not set');
    expect(send).not.toHaveBeenCalled();
  });

  it('fails a live digest if the Resend key is missing', async () => {
    await expect(
      mailer(false, '').sendDigest(
        '2026-09-28',
        [entry],
        [{ email: 'reader@example.com', token: 'token' }],
      ),
    ).rejects.toThrow('RESEND_API_KEY is not set');
    expect(batchSend).not.toHaveBeenCalled();
  });

  it('allows an explicit dry run without a Resend key', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = mailer(true, '');
    await service.sendConfirmation('reader@example.com', 'token');
    await expect(
      service.sendDigest(
        '2026-09-28',
        [entry],
        [{ email: 'reader@example.com', token: 'token' }],
      ),
    ).resolves.toEqual({ sent: [], failed: [] });
    expect(send).not.toHaveBeenCalled();
    expect(batchSend).not.toHaveBeenCalled();
  });
});
