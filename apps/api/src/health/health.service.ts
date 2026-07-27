import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  DATABASE_READINESS_CHECKER,
  type DependencyReadinessChecker,
} from './database-readiness.checker.js';

export const HEALTH_CHECK_TIMEOUT = Symbol('HEALTH_CHECK_TIMEOUT');
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 1_000;

export const readyHealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    ready: z.literal(true),
    dependencies: z.object({ database: z.literal('ready') }).strict(),
  })
  .strict();

export const notReadyHealthResponseSchema = z
  .object({
    status: z.literal('degraded'),
    ready: z.literal(false),
    dependencies: z.object({ database: z.literal('not_ready') }).strict(),
  })
  .strict();

export const healthResponseSchema = z.union([
  readyHealthResponseSchema,
  notReadyHealthResponseSchema,
]);

export type HealthResponse = z.output<typeof healthResponseSchema>;

async function withinTimeout<T>(operation: Promise<T>, timeoutMilliseconds: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Dependency readiness check timed out'));
        }, timeoutMilliseconds);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class HealthService {
  public constructor(
    @Inject(DATABASE_READINESS_CHECKER)
    private readonly databaseReadiness: DependencyReadinessChecker,
    @Inject(HEALTH_CHECK_TIMEOUT) private readonly timeoutMilliseconds: number,
  ) {}

  public async check(): Promise<HealthResponse> {
    let databaseReady: boolean;

    try {
      databaseReady = await withinTimeout(this.databaseReadiness.check(), this.timeoutMilliseconds);
    } catch {
      databaseReady = false;
    }

    if (databaseReady) {
      return {
        status: 'ok',
        ready: true,
        dependencies: { database: 'ready' },
      };
    }

    return {
      status: 'degraded',
      ready: false,
      dependencies: { database: 'not_ready' },
    };
  }
}
