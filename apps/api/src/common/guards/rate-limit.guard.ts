import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import type { AuthenticatedRequest } from '../auth/authenticated-request.js';
import { RATE_LIMIT, type RateLimitPolicy } from '../decorators/rate-limit.decorator.js';

interface RateWindow {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, RateWindow>();

  public constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (policy === undefined) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { method?: string; route?: { path?: string } }>();
    const response = context.switchToHttp().getResponse<Response>();
    const principalId = request.principal?.userId;

    if (principalId === undefined) {
      return true;
    }

    const routeKey = `${request.method ?? 'UNKNOWN'}:${request.route?.path ?? context.getHandler().name}`;
    const key = `${principalId}:${routeKey}`;
    const now = Date.now();
    const current = this.windows.get(key);
    const window =
      current === undefined || current.resetAt <= now
        ? { count: 0, resetAt: now + policy.windowMs }
        : current;

    window.count += 1;
    this.windows.set(key, window);

    const remaining = Math.max(0, policy.limit - window.count);
    response.setHeader('RateLimit-Limit', String(policy.limit));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil(window.resetAt / 1000)));

    if (window.count > policy.limit) {
      const retryAfter = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        {
          code: 'rate_limit_exceeded',
          message: 'Too many requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    if (this.windows.size < 1_000) {
      return;
    }

    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
