import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

/**
 * Everything reaches this service through the Cloudflare tunnel, so the socket
 * address is always the tunnel's. CF-Connecting-IP is the real client — and it
 * can be trusted precisely because no other path into the container exists.
 */
@Injectable()
export class CloudflareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: FastifyRequest): Promise<string> {
    const header = req.headers['cf-connecting-ip'];
    const forwarded = req.headers['x-forwarded-for'];
    const first = (v: unknown): string | undefined =>
      Array.isArray(v) ? v[0] : typeof v === 'string' ? v.split(',')[0]?.trim() : undefined;
    return first(header) ?? first(forwarded) ?? req.ip;
  }
}
