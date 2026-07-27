import { Global, Module } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

import {
  SUPABASE_CLIENT,
  SUPABASE_CLIENT_FACTORY,
  supabaseClientFactoryProvider,
} from './supabase.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT_FACTORY,
      useValue: createClient,
    },
    supabaseClientFactoryProvider,
  ],
  exports: [SUPABASE_CLIENT],
})
export class DatabaseModule {}
