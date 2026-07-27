import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import type { LogLevel } from '@bug-bounty-escrow/shared';
import pino, { type DestinationStream, type Logger } from 'pino';

import { redactSensitiveData } from './redaction.js';

export const PINO_LOGGER = Symbol('PINO_LOGGER');

export function createPinoLogger(level: LogLevel, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: null,
      messageKey: 'message',
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'authorization',
          'cookie',
          'headers.authorization',
          'headers.cookie',
          'req.headers.authorization',
          'req.headers.cookie',
          'SUPABASE_ANON_KEY',
          'SUPABASE_SERVICE_ROLE_KEY',
          'GEMINI_API_KEY',
          'signedUrl',
          'report.title',
          'report.content',
          'report.impact',
          'report.reproduction',
          'report.reproductionSteps',
        ],
        censor: '[REDACTED]',
      },
    },
    destination,
  );
}

@Injectable()
export class AppLogger implements LoggerService {
  public constructor(@Inject(PINO_LOGGER) private readonly logger: Logger) {}

  public log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  public error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  public warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  public debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  public verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }

  public info(bindings: Record<string, unknown>, message: string): void {
    this.logger.info(redactSensitiveData(bindings) as Record<string, unknown>, message);
  }

  public warnEvent(bindings: Record<string, unknown>, message: string): void {
    this.logger.warn(redactSensitiveData(bindings) as Record<string, unknown>, message);
  }

  public errorEvent(bindings: Record<string, unknown>, message: string): void {
    this.logger.error(redactSensitiveData(bindings) as Record<string, unknown>, message);
  }

  private write(
    level: 'debug' | 'error' | 'info' | 'trace' | 'warn',
    message: unknown,
    optionalParams: readonly unknown[],
  ): void {
    const context = [...optionalParams].reverse().find((value) => typeof value === 'string');
    const bindings = {
      ...(context === undefined ? {} : { context }),
      ...(typeof message === 'string' ? {} : { data: redactSensitiveData(message) }),
    };
    const logMessage = typeof message === 'string' ? message : 'Application event';

    this.logger[level](bindings, logMessage);
  }
}
