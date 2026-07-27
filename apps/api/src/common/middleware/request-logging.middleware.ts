import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import { AppLogger } from '../../logging/app-logger.service.js';
import type { CorrelatedRequest } from './correlation-id.middleware.js';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  /*
   * The token is explicit because `pnpm dev` runs on tsx, and esbuild does not emit
   * `design:paramtypes` whatever `emitDecoratorMetadata` says. Without it Nest has no type to
   * resolve, injects nothing, and the first request dies on `undefined.info` — while `pnpm build`
   * (tsc, which does emit metadata) stays green. Every other injected class here does the same.
   */
  public constructor(@Inject(AppLogger) private readonly logger: AppLogger) {}

  public use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const startedAt = performance.now();

    response.once('finish', () => {
      this.logger.info(
        {
          correlationId: request.correlationId,
          durationMs: Math.round(performance.now() - startedAt),
          method: request.method,
          path: request.originalUrl.split('?')[0],
          statusCode: response.statusCode,
        },
        'HTTP request completed',
      );
    });

    next();
  }
}
