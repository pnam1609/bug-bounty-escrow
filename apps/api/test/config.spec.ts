import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { Test } from '@nestjs/testing';
import {
  CORRELATION_ID_HEADER,
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
});
