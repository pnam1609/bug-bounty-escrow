import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT = Symbol('RATE_LIMIT');

export interface RateLimitPolicy {
  readonly limit: number;
  readonly windowMs: number;
}

export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT, policy);
