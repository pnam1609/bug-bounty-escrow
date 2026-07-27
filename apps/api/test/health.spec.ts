import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { parseApiEnvironment } from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { configureApiApplication } from '../src/bootstrap.js';
import {
  DATABASE_READINESS_CHECKER,
  type DependencyReadinessChecker,
} from '../src/health/database-readiness.checker.js';
import { HEALTH_CHECK_TIMEOUT } from '../src/health/health.service.js';

const config = parseApiEnvironment({
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
});

const applications: INestApplication[] = [];

async function createTestApp(checker: DependencyReadinessChecker) {
  const moduleReference = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  })
    .overrideProvider(DATABASE_READINESS_CHECKER)
    .useValue(checker)
    .overrideProvider(HEALTH_CHECK_TIMEOUT)
    .useValue(20)
    .compile();
  const app = moduleReference.createNestApplication({ logger: false });

  configureApiApplication(app, config);
  await app.init();

  return app;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => app.close()));
});

describe('GET /api/health', () => {
  it('returns minimal public readiness without calling a real dependency', async () => {
    const checker = { check: vi.fn().mockResolvedValue(true) };
    const app = await createTestApp(checker);

    applications.push(app);
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      ready: true,
      dependencies: { database: 'ready' },
    });
    expect(checker.check).toHaveBeenCalledOnce();
  });

  it('returns a documented non-ready response when the dependency fails', async () => {
    const checker = {
      check: vi.fn().mockRejectedValue(new Error('private connection failure')),
    };
    const app = await createTestApp(checker);

    applications.push(app);
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'degraded',
      ready: false,
      dependencies: { database: 'not_ready' },
    });
    expect(JSON.stringify(response.body)).not.toContain('private connection failure');
  });

  it('bounds a dependency check that never settles', async () => {
    const checker = {
      check: vi.fn(
        () =>
          new Promise<boolean>(() => {
            // Intentionally never resolves; the service timeout must win.
          }),
      ),
    };
    const app = await createTestApp(checker);

    applications.push(app);
    const startedAt = performance.now();
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(503);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
