import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { Test } from '@nestjs/testing';
import {
  CORRELATION_ID_HEADER,
  EnvironmentValidationError,
  IDEMPOTENCY_KEY_HEADER,
  parseApiEnvironment,
  type ApiEnvironment,
} from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { API_CONFIG, ApiConfigModule } from '../src/config/api-config.module.js';
import { createCorsOptions } from '../src/config/cors.js';

const config = parseApiEnvironment({
  NODE_ENV: 'test',
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

type OriginCallback = (error: Error | null, allowed?: boolean) => void;
type OriginResolver = (origin: string | undefined, callback: OriginCallback) => void;

describe('API configuration', () => {
  it('provides only the validated, normalized environment object', async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config)],
    }).compile();

    const injected = module.get<ApiEnvironment>(API_CONFIG);

    expect(Object.isFrozen(injected)).toBe(true);
    expect(injected.PORT).toBe(3001);
    expect(injected).not.toHaveProperty('UNRECOGNIZED_SECRET');
    await module.close();
  });

  it('allows only the configured browser origin', () => {
    const options = createCorsOptions(config);
    const resolveOrigin = options.origin as OriginResolver;
    const allowed = vi.fn<OriginCallback>();
    const disallowed = vi.fn<OriginCallback>();

    resolveOrigin(config.WEB_APP_ORIGIN, allowed);
    resolveOrigin('https://attacker.example.test', disallowed);

    expect(allowed).toHaveBeenCalledWith(null, true);
    expect(disallowed).toHaveBeenCalledWith(expect.any(Error), false);
    expect(options.allowedHeaders).toEqual(
      expect.arrayContaining(['Authorization', CORRELATION_ID_HEADER, IDEMPOTENCY_KEY_HEADER]),
    );
    expect(options.methods).toEqual(
      expect.arrayContaining(['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']),
    );
  });

  it('permits requests without an Origin header for non-browser clients', () => {
    const options: CorsOptions = createCorsOptions(config);
    const callback = vi.fn<OriginCallback>();

    (options.origin as OriginResolver)(undefined, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('fails closed when Circle contracts are enabled without finalized Gateway webhooks', () => {
    expect(() =>
      parseApiEnvironment({
        ...config,
        CIRCLE_CONTRACTS_ENABLED: true,
        CIRCLE_API_KEY: 'circle-api-key',
        CIRCLE_ENTITY_SECRET: 'circle-entity-secret',
        CIRCLE_DEPLOYMENT_WALLET_ID: '31000000-0000-4000-8000-000000000001',
        CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: '',
        ARC_CHAIN_ID: 5_042_002,
        USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
      }),
    ).toThrow(
      expect.objectContaining({
        name: EnvironmentValidationError.name,
        message: expect.stringContaining('CIRCLE_GATEWAY_WEBHOOKS_ENABLED'),
      }),
    );
  });

  it('requires exactly one stable Gateway subscription when webhooks are enabled', () => {
    expect(() =>
      parseApiEnvironment({
        ...config,
        CIRCLE_GATEWAY_WEBHOOKS_ENABLED: true,
        CIRCLE_API_KEY: 'circle-api-key',
        CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS:
          '31000000-0000-4000-8000-000000000001,31000000-0000-4000-8000-000000000002',
      }),
    ).toThrow(
      expect.objectContaining({
        name: EnvironmentValidationError.name,
        message: expect.stringContaining('CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS'),
      }),
    );
  });

  it('bounds Gateway request timeout to the durable subscription lease budget', () => {
    expect(() =>
      parseApiEnvironment({
        ...config,
        CIRCLE_GATEWAY_WEBHOOKS_ENABLED: true,
        CIRCLE_API_KEY: 'circle-api-key',
        CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: '31000000-0000-4000-8000-000000000001',
        CIRCLE_REQUEST_TIMEOUT_MS: 58_001,
      }),
    ).toThrow(
      expect.objectContaining({
        name: EnvironmentValidationError.name,
        message: expect.stringContaining('CIRCLE_REQUEST_TIMEOUT_MS'),
      }),
    );
  });

  it('supports disabled webhook bootstrap with an API key and no known subscription id', () => {
    const bootstrap = parseApiEnvironment({
      ...config,
      CIRCLE_GATEWAY_WEBHOOKS_ENABLED: false,
      CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: '',
      CIRCLE_API_KEY: 'circle-api-key',
    });

    expect(bootstrap).toMatchObject({
      CIRCLE_GATEWAY_WEBHOOKS_ENABLED: false,
      CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: [],
      CIRCLE_API_KEY: 'circle-api-key',
    });
  });
});
