import type { FactoryProvider } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

import { API_CONFIG } from '../config/api-config.module.js';

export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');
export const SUPABASE_CLIENT_FACTORY = Symbol('SUPABASE_CLIENT_FACTORY');

export type SupabaseClientFactory = typeof createClient;

export function createServerSupabaseClient(
  config: ApiEnvironment,
  factory: SupabaseClientFactory,
): SupabaseClient {
  return factory(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
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
}

export const supabaseClientFactoryProvider: FactoryProvider<SupabaseClient> = {
  provide: SUPABASE_CLIENT,
  inject: [API_CONFIG, SUPABASE_CLIENT_FACTORY],
  useFactory: (config: ApiEnvironment, factory: SupabaseClientFactory): SupabaseClient =>
    createServerSupabaseClient(config, factory),
};
