import type { ApiErrorResponse, JsonValue } from '@bug-bounty-escrow/shared';

export function createApiErrorResponse(
  code: string,
  message: string,
  correlationId?: string,
  details?: JsonValue,
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    ...(correlationId === undefined ? {} : { correlationId }),
  };
}
