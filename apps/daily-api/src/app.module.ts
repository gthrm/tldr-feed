import './config/environment.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration.js';
import { DbService } from './db/db.service.js';
import { DigestRepository } from './db/digest.repository.js';
import { SubscribersRepository } from './db/subscribers.repository.js';
import { HealthController } from './health/health.controller.js';
import { DailyJob } from './jobs/daily.job.js';
import { MailService } from './mail/mail.service.js';
import { FetchService } from './pipeline/fetch.service.js';
import { PipelineService } from './pipeline/pipeline.service.js';
import { SiteService } from './site/site.service.js';
import { SourcesService } from './sources/sources.service.js';
import { CloudflareThrottlerGuard } from './subscriptions/cf-throttler.guard.js';
import { FormErrorsFilter } from './subscriptions/form-errors.filter.js';
import { SubscriptionsController } from './subscriptions/subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions/subscriptions.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // A generous default; the sign-up route tightens it to five an hour.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [HealthController, SubscriptionsController],
  providers: [
    SourcesService,
    FetchService,
    PipelineService,
    SiteService,
    DbService,
    DigestRepository,
    SubscribersRepository,
    MailService,
    SubscriptionsService,
    FormErrorsFilter,
    DailyJob,
    { provide: APP_GUARD, useClass: CloudflareThrottlerGuard },
  ],
  exports: [PipelineService, SiteService, DailyJob, DbService],
})
export class AppModule {}

// Only the HTTP daemon owns the schedule. CLI previews, builds and dry runs
// must never start an independent evening job in the background.
@Module({ imports: [AppModule, ScheduleModule.forRoot()] })
export class ApiModule {}
