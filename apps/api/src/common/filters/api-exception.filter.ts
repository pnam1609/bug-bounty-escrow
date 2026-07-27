import {
  Catch,
  HttpException,
  Inject,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorResponse, JsonValue } from '@bug-bounty-escrow/shared';
import type { Response } from 'express';

import { DatabaseError } from '../../database/database-error.js';
import { AppLogger } from '../../logging/app-logger.service.js';
import { createApiErrorResponse } from '../http/api-error.js';
import {
  getCorrelationId,
  type CorrelatedRequest,
} from '../middleware/correlation-id.middleware.js';

interface ResolvedException {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
}

const HTTP_ERROR_MAP: Readonly<Record<number, Omit<ResolvedException, 'status'>>> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'bad_request',
    message: 'The request is invalid',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: 'unauthorized',
    message: 'Authentication is required',
  },
  [HttpStatus.FORBIDDEN]: {
    code: 'forbidden',
    message: 'The request is not allowed',
  },
  [HttpStatus.NOT_FOUND]: {
    code: 'not_found',
    message: 'The requested resource was not found',
  },
  [HttpStatus.CONFLICT]: {
    code: 'conflict',
    message: 'The request conflicts with current state',
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    code: 'unprocessable_entity',
    message: 'The request could not be processed',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'too_many_requests',
    message: 'Too many requests',
  },
};

function isStableApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('success' in value) || value.success !== false || !('error' in value)) {
    return false;
  }

  const error = value.error;

  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

function resolveDatabaseException(exception: DatabaseError): ResolvedException {
  switch (exception.code) {
    case 'not_found':
      return {
        status: HttpStatus.NOT_FOUND,
        code: exception.reason ?? 'database_not_found',
        message: 'The requested record was not found',
      };
    case 'unauthenticated':
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: 'unauthorized',
        message: 'Authentication is required',
      };
    case 'forbidden':
      // Deliberately generic: never confirm that a record the actor cannot reach exists.
      return {
        status: HttpStatus.FORBIDDEN,
        code: exception.reason ?? 'forbidden',
        message: 'The request is not allowed',
      };
    case 'business_rule_violation':
      // The RPC rejected a valid-looking request because of current state, not bad input.
      // `reason` is the stable code the client branches on (e.g. program_not_accepting_reports).
      return {
        status: HttpStatus.CONFLICT,
        code: exception.reason ?? 'business_rule_violation',
        message: 'The request conflicts with current state',
      };
    case 'check_violation':
    case 'conflict':
    case 'foreign_key_violation':
    case 'unique_violation':
      return {
        status: HttpStatus.CONFLICT,
        code: exception.reason ?? `database_${exception.code}`,
        message: 'The database operation conflicts with current state',
      };
    case 'database_unavailable':
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'database_unavailable',
        message: 'The database is temporarily unavailable',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'internal_server_error',
        message: 'Internal server error',
      };
  }
}

function resolveException(exception: unknown): ResolvedException {
  if (exception instanceof DatabaseError) {
    return resolveDatabaseException(exception);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();

    if (isStableApiErrorResponse(response)) {
      return {
        status,
        code: response.error.code,
        message: response.error.message,
        ...('details' in response.error ? { details: response.error.details as JsonValue } : {}),
      };
    }

    const mapped = HTTP_ERROR_MAP[status] ?? {
      code: 'request_failed',
      message: 'The request failed',
    };

    return { status, ...mapped };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'internal_server_error',
    message: 'Internal server error',
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  // Explicit token: tsx/esbuild emits no `design:paramtypes`, so type-only injection silently
  // yields undefined under `pnpm dev`. See request-logging.middleware.ts.
  public constructor(@Inject(AppLogger) private readonly logger: AppLogger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();
    const correlationId = getCorrelationId(request);
    const resolved = resolveException(exception);
    const logContext = {
      correlationId,
      errorCode: resolved.code,
      method: request.method,
      path: request.originalUrl.split('?')[0],
      statusCode: resolved.status,
    };

    if (resolved.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.errorEvent(logContext, 'Request failed');
    } else {
      this.logger.warnEvent(logContext, 'Request rejected');
    }

    response
      .status(resolved.status)
      .json(
        createApiErrorResponse(resolved.code, resolved.message, correlationId, resolved.details),
      );
  }
}
