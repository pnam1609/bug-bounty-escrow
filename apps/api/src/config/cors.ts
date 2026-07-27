import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import {
  CORRELATION_ID_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  type ApiEnvironment,
} from '@bug-bounty-escrow/shared';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  CORRELATION_ID_HEADER,
  IDEMPOTENCY_KEY_HEADER,
];

export function createCorsOptions(config: ApiEnvironment): CorsOptions {
  return {
    origin(origin, callback) {
      if (origin === undefined || origin === config.WEB_APP_ORIGIN) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed'), false);
    },
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: [CORRELATION_ID_HEADER],
    credentials: true,
    maxAge: 600,
  };
}
