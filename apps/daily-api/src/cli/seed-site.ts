/**
 * Two days of invented entries, so the site can be built and looked at without
 * waiting for an evening or spending a cent on summaries.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { SiteService } from '../site/site.service.js';
import type { DayEntry } from '../pipeline/pipeline.service.js';
import { DateTime } from 'luxon';

const SAMPLE: Omit<DayEntry, 'day' | 'publishedAt' | 'position'>[] = [
  {
    slot: '09:00',
    section: 'bigtech',
    title: 'MongoDB CEO resigns to join Meta',
    url: 'https://example.com/mongodb-ceo',
    domain: 'reuters.com',
    summary:
      'MongoDB said its chief executive is leaving to run Meta enterprise platform work. The company named its finance chief as interim head while the board searches.',
    minutes: 2,
  },
  {
    slot: '11:40',
    section: 'science',
    title: 'Thinking fast and slow in AI: the role of metacognition',
    url: 'https://example.com/metacognition',
    domain: 'arxiv.org',
    summary:
      'A survey argues that systems reasoning about their own reasoning close a gap current benchmarks miss. It proposes a taxonomy separating monitoring from control.',
    minutes: 8,
  },
  {
    slot: '14:20',
    section: 'programming',
    title: 'Parley: federated chat that still speaks plain IRC',
    url: 'https://example.com/parley',
    domain: 'git.mills.io',
    summary:
      'Parley bridges a federated protocol to unmodified IRC clients, so old clients connect without patches. The author reports a single binary and no database.',
    minutes: 4,
  },
  {
    slot: '19:40',
    section: 'yc',
    title: 'Dreamscale Labs: robot brains in the cloud',
    url: 'https://example.com/dreamscale',
    domain: 'ycombinator.com',
    summary:
      'The team offers hosted inference for robot control policies, so a robot does not carry the compute on board. Latency is claimed under 40 ms on a local network.',
    minutes: 1,
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'error'] });
  const site = app.get(SiteService);

  for (const back of [1, 0]) {
    const day = DateTime.now().setZone('Europe/Belgrade').minus({ days: back }).toISODate()!;
    const entries: DayEntry[] = SAMPLE.map((e, i) => ({
      ...e,
      day,
      publishedAt: DateTime.fromISO(day, { zone: 'Europe/Belgrade' })
        .set({ hour: Number(e.slot.slice(0, 2)), minute: Number(e.slot.slice(3)) })
        .toJSDate(),
      position: i,
    })).slice(0, back === 1 ? 3 : 4);
    site.writeDay(day, entries);
  }
  await app.close();
}

await main();
