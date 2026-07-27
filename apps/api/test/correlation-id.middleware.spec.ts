import { CORRELATION_ID_HEADER } from '@bug-bounty-escrow/shared';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import {
  CorrelationIdMiddleware,
  type CorrelatedRequest,
} from '../src/common/middleware/correlation-id.middleware.js';

function createResponse(): Response {
  return {
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe('CorrelationIdMiddleware', () => {
  it('accepts a valid incoming identifier and returns it to the caller', () => {
    const request = {
      headers: { [CORRELATION_ID_HEADER]: 'request-123' },
    } as unknown as CorrelatedRequest;
    const response = createResponse();
    const next = vi.fn() as unknown as NextFunction;

    new CorrelationIdMiddleware().use(request, response, next);

    expect(request.correlationId).toBe('request-123');
    expect(response.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'request-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces an unsafe incoming value with a generated UUID', () => {
    const request = {
      headers: { [CORRELATION_ID_HEADER]: 'bad value with spaces' },
    } as unknown as Request & CorrelatedRequest;
    const response = createResponse();

    new CorrelationIdMiddleware().use(request, response, vi.fn());

    expect(request.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(response.setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, request.correlationId);
  });
});
