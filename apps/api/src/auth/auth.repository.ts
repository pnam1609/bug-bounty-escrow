import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApplicationRole,
  OnboardingRequest,
  UpdateProfileRequest,
} from '@bug-bounty-escrow/shared';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

export interface SafeProfileRow {
  readonly id: string;
  readonly role: ApplicationRole;
  readonly display_name: string;
  readonly wallet_address: string | null;
  readonly avatar_url: string | null;
  readonly onboarding_completed_at: string | null;
}

@Injectable()
export class AuthRepository {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  public async findProfile(userId: string): Promise<SafeProfileRow | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id,role,display_name,wallet_address,avatar_url,onboarding_completed_at')
      .eq('id', userId)
      .maybeSingle();

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data as SafeProfileRow | null;
  }

  public async updateProfile(userId: string, input: UpdateProfileRequest): Promise<void> {
    const { error } = await this.client.rpc('update_profile_display_name_atomic', {
      actor_id: userId,
      new_display_name: input.displayName,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async completeOnboarding(userId: string, input: OnboardingRequest): Promise<void> {
    const { error } = await this.client.rpc('complete_profile_onboarding_for_user', {
      target_user_id: userId,
      selected_role: input.role,
      selected_display_name: input.displayName,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }
}
