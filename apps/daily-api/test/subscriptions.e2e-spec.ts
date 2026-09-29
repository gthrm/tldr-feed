import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { SubscribersRepository } from '../src/db/subscribers.repository.js';
import { MailService } from '../src/mail/mail.service.js';

/**
 * The public surface: a form anyone on the internet can post to. The database is
 * replaced by a fake, so the test can assert exactly how often it would be
 * touched — a spam wave must not turn into a wave of Neon wake-ups.
 */
describe('subscriptions', () => {
  let app: NestFastifyApplication;
  const db = { signups: 0, confirms: 0 };
  const sentTo: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SubscribersRepository)
      .useValue({
        signup: vi.fn(async (email: string) => {
          db.signups++;
          return { outcome: email === 'known@example.com' ? 'active' : 'created', token: 'tok-123' };
        }),
        confirm: vi.fn(async (token: string) => {
          db.confirms++;
          return token === 'tok-123';
        }),
        unsubscribe: vi.fn(async (token: string) => token === 'tok-123'),
      })
      .overrideProvider(MailService)
      .useValue({
        sendConfirmation: vi.fn(async (email: string) => {
          sentTo.push(email);
        }),
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('takes a form post and promises nothing until the link is clicked', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/subscriptions')
      .type('form')
      .send({ email: 'Reader@Example.com ' });

    expect(res.status).toBe(201);
    expect(res.text).toContain('Check your inbox');
    // Lower-cased and trimmed before it ever reaches the database.
    expect(sentTo).toContain('reader@example.com');
  });

  it('answers an address that is already subscribed exactly the same way', async () => {
    const before = sentTo.length;
    const res = await request(app.getHttpServer())
      .post('/api/subscriptions')
      .type('form')
      .send({ email: 'known@example.com' });

    expect(res.text).toContain('Check your inbox'); // no hint that it is known
    expect(sentTo.length).toBe(before); // and no second confirmation email
  });

  it('answers a malformed address with a page, not a JSON error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/subscriptions')
      .type('form')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    // The form has no JavaScript: whatever comes back is what the reader sees.
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('looks wrong');
    expect(res.text).not.toContain('statusCode');
  });

  it('ignores a bot that fills the honeypot, without touching the database', async () => {
    const before = db.signups;
    const res = await request(app.getHttpServer())
      .post('/api/subscriptions')
      .type('form')
      .send({ email: 'bot@example.com', website: 'https://spam.example' });

    expect(res.status).toBe(201);
    expect(res.text).toContain('Check your inbox');
    expect(db.signups).toBe(before);
  });

  it('confirms a good token and refuses a bad one', async () => {
    const good = await request(app.getHttpServer()).get('/api/subscriptions/confirm/tok-123');
    expect(good.text).toContain('You are in');

    const bad = await request(app.getHttpServer()).get('/api/subscriptions/confirm/nope');
    expect(bad.text).toContain('does not work');
  });

  it('unsubscribes from a link, and from the one-click POST mail clients send', async () => {
    const link = await request(app.getHttpServer()).get('/api/subscriptions/unsubscribe/tok-123');
    expect(link.text).toContain('Unsubscribed');

    const oneClick = await request(app.getHttpServer()).post('/api/subscriptions/unsubscribe/tok-123');
    expect(oneClick.status).toBe(200);
  });

  it('serves health without going near the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
