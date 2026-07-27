import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseApiEnvironment } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiConfigModule } from '../src/config/api-config.module.js';
import { DatabaseModule } from '../src/database/database.module.js';
import {
  SUPABASE_CLIENT,
  SUPABASE_CLIENT_FACTORY,
  createServerSupabaseClient,
  type SupabaseClientFactory,
} from '../src/database/supabase.provider.js';

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

describe('Supabase server provider', () => {
  it('wires validated server credentials into a replaceable client factory', () => {
    const fakeClient = { rpc: vi.fn() } as unknown as SupabaseClient;
    const factory = vi.fn(() => fakeClient) as unknown as SupabaseClientFactory;

    expect(createServerSupabaseClient(config, factory)).toBe(fakeClient);
    expect(factory).toHaveBeenCalledWith(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          'X-Client-Info': 'bug-bounty-escrow-api',
        },
      },
    });
  });

  it('exposes a typed client token that can be replaced without network access', async () => {
    const fakeClient = { rpc: vi.fn() } as unknown as SupabaseClient;
    const factory = vi.fn(() => fakeClient) as unknown as SupabaseClientFactory;
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), DatabaseModule],
    })
      .overrideProvider(SUPABASE_CLIENT_FACTORY)
      .useValue(factory)
      .compile();

    expect(module.get<SupabaseClient>(SUPABASE_CLIENT)).toBe(fakeClient);
    expect(factory).toHaveBeenCalledOnce();
    await module.close();
  });
});
