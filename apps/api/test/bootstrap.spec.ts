import { CORRELATION_ID_HEADER } from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX, createApiApplication, formatStartupError } from '../src/bootstrap.js';

const SAFE_ENVIRONMENT = {
  NODE_ENV: 'test',
  PORT: '3001',
  WEB_APP_ORIGIN: 'https://web.example.test',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ARC_RPC_URL: 'https://rpc.example.test',
  ARC_CHAIN_ID: '5042002',
  USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
  AI_PROVIDER: 'disabled',
  LOG_LEVEL: 'silent',
} as const;

const applications: Array<Awaited<ReturnType<typeof createApiApplication>>['app']> = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

describe('API bootstrap', () => {
  it('fails environment validation before creating an application', async () => {
    const result = createApiApplication({
      ...SAFE_ENVIRONMENT,
      SUPABASE_SERVICE_ROLE_KEY: '',
    });

    await expect(result).rejects.toMatchObject({
      name: 'EnvironmentValidationError',
      issues: expect.arrayContaining([
        {
          variable: 'SUPABASE_SERVICE_ROLE_KEY',
          reason: 'Missing or invalid value',
        },
      ]),
    });
    await expect(result).rejects.not.toThrow('test-service-role-key');
  });

  it('uses the Express adapter, global prefix and stable platform errors', async () => {
    const { app } = await createApiApplication(SAFE_ENVIRONMENT);
    applications.push(app);
    await app.init();

    expect(app.getHttpAdapter().getType()).toBe('express');
    expect(API_GLOBAL_PREFIX).toBe('api');

    const response = await request(app.getHttpServer()).get('/api/not-a-product-route');

    expect(response.status).toBe(404);
    expect(response.headers[CORRELATION_ID_HEADER]).toEqual(expect.any(String));
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'not_found',
        message: 'The requested resource was not found',
      },
      correlationId: response.headers[CORRELATION_ID_HEADER],
    });
  });

  it('formats unexpected startup failures without leaking their message', () => {
    expect(formatStartupError(new Error('secret connection string'))).toBe(
      'API failed to start because of an unexpected error',
    );
  });
});
