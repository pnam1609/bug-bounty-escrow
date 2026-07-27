import { BadRequestException, type ArgumentsHost, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { createApiErrorResponse } from '../src/common/http/api-error.js';
import type { CorrelatedRequest } from '../src/common/middleware/correlation-id.middleware.js';
import { DatabaseError } from '../src/database/database-error.js';
import type { AppLogger } from '../src/logging/app-logger.service.js';

function createHarness(): {
  host: ArgumentsHost;
  response: Response;
  logger: AppLogger;
} {
  const request = {
    correlationId: 'request-123',
    method: 'POST',
    originalUrl: '/api/reports?unsafe=value',
  } as CorrelatedRequest;
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getRequest: <T extends Request>() => request as unknown as T,
      getResponse: <T extends Response>() => response as unknown as T,
      getNext: () => undefined,
    }),
  } as ArgumentsHost;
  const logger = {
    errorEvent: vi.fn(),
    warnEvent: vi.fn(),
  } as unknown as AppLogger;

  return { host, response, logger };
}

describe('ApiExceptionFilter', () => {
  it('preserves stable validation errors and correlation context', () => {
    const { host, response, logger } = createHarness();
    const exception = new BadRequestException(
      createApiErrorResponse('validation_error', 'Request validation failed', undefined, {
        fields: [],
      }),
    );

    new ApiExceptionFilter(logger).catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: { fields: [] },
      },
      correlationId: 'request-123',
    });
    expect(logger.warnEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'request-123',
        path: '/api/reports',
      }),
      'Request rejected',
    );
  });

  it('maps typed database errors without exposing database details', () => {
    const { host, response, logger } = createHarness();

    new ApiExceptionFilter(logger).catch(
      new DatabaseError({
        code: 'unique_violation',
        databaseCode: '23505',
        message: 'A unique database constraint was violated',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'database_unique_violation',
        message: 'The database operation conflicts with current state',
      },
      correlationId: 'request-123',
    });
  });

  it('maps a violated business rule to a conflict carrying the rule code', () => {
    const { host, response, logger } = createHarness();

    // Without this mapping the atomic RPCs' 22023 raises collapsed into a 500 and the client
    // could not tell "program stopped accepting reports" from a transient failure.
    new ApiExceptionFilter(logger).catch(
      new DatabaseError({
        code: 'business_rule_violation',
        databaseCode: '22023',
        message: 'The operation is not allowed in the current state',
        reason: 'program_not_accepting_reports',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'program_not_accepting_reports',
        message: 'The request conflicts with current state',
      },
      correlationId: 'request-123',
    });
    expect(logger.errorEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', '42501', HttpStatus.FORBIDDEN, 'report_not_accessible'],
    ['not_found', 'P0002', HttpStatus.NOT_FOUND, 'profile_not_found'],
  ] as const)('maps a %s database error to its HTTP status', (code, databaseCode, status, reason) => {
    const { host, response, logger } = createHarness();

    new ApiExceptionFilter(logger).catch(
      new DatabaseError({ code, databaseCode, message: 'Rejected', reason }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(status);
    expect(vi.mocked(response.json).mock.calls[0]?.[0]).toMatchObject({
      error: { code: reason },
    });
  });

  it('falls back to a generic code when a database error carries no rule code', () => {
    const { host, response, logger } = createHarness();

    new ApiExceptionFilter(logger).catch(
      new DatabaseError({
        code: 'business_rule_violation',
        databaseCode: '22023',
        message: 'The operation is not allowed in the current state',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(vi.mocked(response.json).mock.calls[0]?.[0]).toMatchObject({
      error: { code: 'business_rule_violation' },
    });
  });

  it('uses a generic 500 response and log context for unknown failures', () => {
    const { host, response, logger } = createHarness();
    const secret = 'postgres://admin:password@example.test/private';

    new ApiExceptionFilter(logger).catch(new Error(secret), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'internal_server_error',
        message: 'Internal server error',
      },
      correlationId: 'request-123',
    });
    expect(JSON.stringify(vi.mocked(response.json).mock.calls)).not.toContain(secret);
    expect(logger.errorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'request-123' }),
      'Request failed',
    );
  });
});
