import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { RequestLoggingMiddleware } from './common/middleware/request-logging.middleware.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { ApiConfigModule } from './config/api-config.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthenticationGuard } from './auth/authentication.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { NotificationModule } from './notifications/notification.module.js';
import { ProgramModule } from './programs/program.module.js';
import { ReportModule } from './reports/report.module.js';
import { RewardModule } from './rewards/reward.module.js';

@Module({})
export class AppModule implements NestModule {
  public static forRoot(config: ApiEnvironment): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ApiConfigModule.forRoot(config),
        LoggingModule.forRoot(config.LOG_LEVEL),
        DatabaseModule,
        AuthModule,
        HealthModule,
        ProgramModule,
        ReportModule,
        RewardModule,
        NotificationModule,
      ],
      providers: [
        {
          provide: APP_FILTER,
          useClass: ApiExceptionFilter,
        },
        {
          provide: APP_GUARD,
          useExisting: AuthenticationGuard,
        },
        {
          provide: APP_GUARD,
          useExisting: RolesGuard,
        },
        RateLimitGuard,
        {
          provide: APP_GUARD,
          useExisting: RateLimitGuard,
        },
      ],
    };
  }

  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware, RequestLoggingMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
