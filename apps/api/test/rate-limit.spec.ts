import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RateLimitGuard } from '../src/common/guards/rate-limit.guard.js';

afterEach(() => vi.useRealTimers());

describe('sensitive endpoint rate limiting', () => {
  it('keys by verified user and route, ignores spoofable forwarding headers, and returns retry hints', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'));
    const headers = new Map<string, string>();
    const request = {
      method: 'POST',
      route: { path: '/reports' },
      headers: { 'x-forwarded-for': 'spoofed' },
      principal: { userId: 'verified-user' },
    };
    const context = {
      getHandler: () => function submit() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: (key: string, value: string) => headers.set(key, value),
        }),
      }),
    } as never;
    const guard = new RateLimitGuard({
      getAllAndOverride: vi.fn().mockReturnValue({ limit: 2, windowMs: 60_000 }),
    } as unknown as Reflector);

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    expect(headers.get('Retry-After')).toBe('60');

    request.headers['x-forwarded-for'] = 'different-spoof';
    expect(() => guard.canActivate(context)).toThrow(HttpException);

    vi.advanceTimersByTime(60_001);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('does not limit routes without explicit metadata, including health', () => {
    const guard = new RateLimitGuard({
      getAllAndOverride: vi.fn().mockReturnValue(undefined),
    } as unknown as Reflector);
    const context = {
      getHandler: () => function health() {},
      getClass: () => class HealthController {},
    } as never;
    expect(guard.canActivate(context)).toBe(true);
  });
});
