import { Module } from '@nestjs/common';

import {
  DATABASE_READINESS_CHECKER,
  DatabaseReadinessChecker,
} from './database-readiness.checker.js';
import { HealthController } from './health.controller.js';
import {
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_CHECK_TIMEOUT,
  HealthService,
} from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: DATABASE_READINESS_CHECKER,
      useClass: DatabaseReadinessChecker,
    },
    {
      provide: HEALTH_CHECK_TIMEOUT,
      useValue: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    },
    HealthService,
  ],
})
export class HealthModule {}
