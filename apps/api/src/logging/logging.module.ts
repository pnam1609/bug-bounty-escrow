import { DynamicModule, Global, Module } from '@nestjs/common';
import type { LogLevel } from '@bug-bounty-escrow/shared';

import { AppLogger, createPinoLogger, PINO_LOGGER } from './app-logger.service.js';

@Global()
@Module({})
export class LoggingModule {
  public static forRoot(level: LogLevel): DynamicModule {
    return {
      module: LoggingModule,
      providers: [
        {
          provide: PINO_LOGGER,
          useFactory: () => createPinoLogger(level),
        },
        AppLogger,
      ],
      exports: [AppLogger, PINO_LOGGER],
    };
  }
}
