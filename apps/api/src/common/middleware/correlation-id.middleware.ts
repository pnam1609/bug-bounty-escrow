import { Injectable, type NestMiddleware } from '@nestjs/common';
import { CORRELATION_ID_HEADER, stringIdentifierSchema } from '@bug-bounty-escrow/shared';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface CorrelatedRequest extends Request {
  correlationId?: string;
}

function readIncomingCorrelationId(request: Request): string | undefined {
  const header = request.headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value !== 'string') {
    return undefined;
  }

  const result = stringIdentifierSchema.safeParse(value);

  return result.success ? result.data : undefined;
}

export function getCorrelationId(request: CorrelatedRequest): string {
  return request.correlationId ?? randomUUID();
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  public use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    const correlationId = readIncomingCorrelationId(request) ?? randomUUID();

    request.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}
