import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  /**
   * Deliberately does not touch the database. A container healthcheck runs every
   * thirty seconds; if it queried Neon, the compute would never be allowed to
   * sleep and the monthly allowance would be gone in days.
   */
  @Get()
  check(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
