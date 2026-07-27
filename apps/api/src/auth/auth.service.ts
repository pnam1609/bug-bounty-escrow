import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CurrentUser,
  OnboardingRequest,
  RequestPrincipal,
  UpdateProfileRequest,
} from '@bug-bounty-escrow/shared';

import { createApiErrorResponse } from '../common/http/api-error.js';
import { AuthRepository, type SafeProfileRow } from './auth.repository.js';

function mapCurrentUser(principal: RequestPrincipal, profile: SafeProfileRow): CurrentUser {
  return {
    id: principal.userId,
    email: principal.email,
    role: profile.role,
    displayName: profile.display_name,
    ...(profile.wallet_address === null ? {} : { walletAddress: profile.wallet_address }),
    ...(profile.avatar_url === null ? {} : { avatarUrl: profile.avatar_url }),
    onboardingComplete: profile.onboarding_completed_at !== null,
  };
}

@Injectable()
export class AuthService {
  public constructor(@Inject(AuthRepository) private readonly repository: AuthRepository) {}

  public async getCurrentUser(principal: RequestPrincipal): Promise<CurrentUser> {
    const profile = await this.repository.findProfile(principal.userId);

    if (profile === null) {
      throw new ConflictException('Profile is not initialized');
    }

    return mapCurrentUser(principal, profile);
  }

  /**
   * Account settings. Only the display name is editable — the role is fixed once onboarding
   * completes, so there is deliberately no way to change it here. The subject is always
   * `principal.userId` from the verified JWT: no request field selects whose profile is written.
   *
   * The repository's DatabaseError must reach the exception filter untouched. The RPC raises
   * `profile_not_found` (404) and `display_name_invalid` with the machine-readable reason the
   * client branches on; catching it here to re-throw a bare Nest exception would collapse that
   * reason into a generic code.
   */
  public async updateProfile(
    principal: RequestPrincipal,
    input: UpdateProfileRequest,
  ): Promise<CurrentUser> {
    // Explicit projection, not a spread: the strict schema already rejects unknown keys, and this
    // keeps the repository receiving exactly one field even if that schema is ever loosened.
    await this.repository.updateProfile(principal.userId, { displayName: input.displayName });

    const profile = await this.repository.findProfile(principal.userId);

    if (profile === null) {
      // The row was deleted between the write and this read. The flow doc (§10) maps a missing
      // profile to 404, and the code matches what the RPC raises for the same condition so the
      // client sees one code whichever side of the race it lands on.
      throw new NotFoundException(
        createApiErrorResponse('profile_not_found', 'The profile was not found'),
      );
    }

    // The stored row is the only source of role and onboarding state; nothing from the request
    // reaches either, so this response cannot echo back a forged privilege.
    return mapCurrentUser({ ...principal, role: profile.role }, profile);
  }

  public async completeOnboarding(
    principal: RequestPrincipal,
    input: OnboardingRequest,
  ): Promise<CurrentUser> {
    // The RPC decides first-time vs. same-data retry vs. conflict under a row lock, and raises
    // conflicts with the machine-readable reason (`onboarding_already_completed`) the client
    // branches on. Its DatabaseError must reach the exception filter untouched — wrapping it
    // here would collapse that reason into a generic `conflict` code.
    await this.repository.completeOnboarding(principal.userId, input);

    const profile = await this.repository.findProfile(principal.userId);

    if (profile === null) {
      throw new ConflictException('Profile is not initialized');
    }

    return mapCurrentUser({ ...principal, role: profile.role }, profile);
  }
}
