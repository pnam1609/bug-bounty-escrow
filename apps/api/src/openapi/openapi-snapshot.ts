import type { OpenAPIObject } from '@nestjs/swagger';

import { createApiApplication } from '../bootstrap.js';
import { createOpenApiDocumentFor } from './openapi.js';

/*
 * Builds the checked-in `openapi.json` by booting the real application and reading its routes.
 *
 * Separate from `openapi.ts` because that module is imported by `bootstrap` to serve the docs page;
 * keeping the app-booting half here means the two never import each other in a cycle.
 */

/** Parses cleanly and reaches nothing real, so generating the spec never touches a live service. */
export const OPENAPI_SAFE_ENVIRONMENT = Object.freeze({
  NODE_ENV: 'test',
  PORT: '3001',
  WEB_APP_ORIGIN: 'https://web.example.test',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'openapi-anon-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'openapi-service-role-placeholder',
  ARC_RPC_URL: 'https://rpc.example.test',
  ARC_CHAIN_ID: '5042002',
  USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
  AI_PROVIDER: 'disabled',
  LOG_LEVEL: 'silent',
});

export async function createOpenApiDocument(): Promise<OpenAPIObject> {
  const { app } = await createApiApplication(OPENAPI_SAFE_ENVIRONMENT);

  try {
    await app.init();

    return createOpenApiDocumentFor(app);
  } finally {
    await app.close();
  }
}
