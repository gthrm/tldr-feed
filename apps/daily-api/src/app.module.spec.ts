import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ApiModule, AppModule } from './app.module.js';

describe('schedule ownership', () => {
  it('does not start scheduled jobs in a CLI application', async () => {
    const app = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    try {
      await app.init();
      expect(() => app.get(SchedulerRegistry)).toThrow();
    } finally {
      await app.close();
    }
  });

  it('registers the evening job in the HTTP daemon', async () => {
    const app = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();
    try {
      await app.init();
      expect(app.get(SchedulerRegistry).getCronJobs().size).toBe(1);
    } finally {
      await app.close();
    }
  });
});
