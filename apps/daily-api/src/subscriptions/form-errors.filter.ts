import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { pageBadEmail, pageTooMany } from './pages.js';

/**
 * The sign-up form is plain HTML with no JavaScript, so whatever comes back is
 * what the reader sees. Without this, a mistyped address answers with Nest's
 * `{"statusCode":400,...}` to someone who was on a styled page a moment ago.
 */
@Catch(BadRequestException, ThrottlerException)
export class FormErrorsFilter implements ExceptionFilter {
  constructor(private readonly config: ConfigService) {}

  catch(exception: BadRequestException | ThrottlerException, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const siteUrl = this.config.get<string>('siteUrl') ?? 'https://tldr.cdroma.me';
    const tooMany = exception instanceof ThrottlerException;

    void reply
      .status(tooMany ? 429 : 400)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(tooMany ? pageTooMany(siteUrl) : pageBadEmail(siteUrl));
  }
}
