import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

export interface DependencyReadinessChecker {
  check(): Promise<boolean>;
}

export const DATABASE_READINESS_CHECKER = Symbol('DATABASE_READINESS_CHECKER');

@Injectable()
export class DatabaseReadinessChecker implements DependencyReadinessChecker {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  public async check(): Promise<boolean> {
    const result = await this.client
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    return result.error === null;
  }
}
