import { Body, Controller, Get, Header, Param, Post, Res, UseFilters } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { SubscribeDto } from './subscribe.dto.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { FormErrorsFilter } from './form-errors.filter.js';
import { pageBadLink, pageConfirmed, pageSubmitted, pageUnsubscribed } from './pages.js';

@Controller('subscriptions')
@UseFilters(FormErrorsFilter)
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  private get siteUrl(): string {
    return this.config.get<string>('siteUrl') ?? 'https://tldr.cdroma.me';
  }

  /** Five an hour per address behind the form; the page itself is static. */
  @Post()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  async subscribe(@Body() dto: SubscribeDto): Promise<string> {
    // A filled honeypot is a bot. It gets the same page as everyone else and
    // nothing at all happens — no database round trip, no email.
    if (!dto.website) await this.subscriptions.signup(dto.email);
    return pageSubmitted(this.siteUrl);
  }

  @Get('confirm/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async confirm(@Param('token') token: string): Promise<string> {
    const ok = await this.subscriptions.confirm(token);
    return ok ? pageConfirmed(this.siteUrl) : pageBadLink(this.siteUrl);
  }

  @Get('unsubscribe/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Param('token') token: string): Promise<string> {
    const ok = await this.subscriptions.unsubscribe(token);
    return ok ? pageUnsubscribed(this.siteUrl) : pageBadLink(this.siteUrl);
  }

  /**
   * One-click unsubscribe: the List-Unsubscribe-Post header makes Gmail and
   * Outlook send a POST here, with no page ever shown to the reader.
   */
  @Post('unsubscribe/:token')
  async unsubscribeOneClick(
    @Param('token') token: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.subscriptions.unsubscribe(token);
    await reply.status(200).send();
  }
}
