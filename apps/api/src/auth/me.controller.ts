import { Controller, Get, Inject, Patch, UnauthorizedException } from '@nestjs/common';
import {
  onboardingRequestSchema,
  updateProfileRequestSchema,
  type CurrentUserResponse,
  type OnboardingRequest,
  type OnboardingResponse,
  type RequestPrincipal,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
} from '@bug-bounty-escrow/shared';

import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { ZodBody } from '../openapi/zod-openapi.js';
import { AuthService } from './auth.service.js';

@Controller('me')
export class MeController {
  public constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get()
  public async getMe(
    @CurrentPrincipal() principal: RequestPrincipal | undefined,
  ): Promise<CurrentUserResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return {
      success: true,
      data: await this.authService.getCurrentUser(principal),
    };
  }

  @Patch()
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async updateProfile(
    @CurrentPrincipal() principal: RequestPrincipal | undefined,
    @ZodBody(updateProfileRequestSchema) input: UpdateProfileRequest,
  ): Promise<UpdateProfileResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return {
      success: true,
      data: await this.authService.updateProfile(principal, input),
    };
  }

  @Patch('onboarding')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  public async onboard(
    @CurrentPrincipal() principal: RequestPrincipal | undefined,
    @ZodBody(onboardingRequestSchema) input: OnboardingRequest,
  ): Promise<OnboardingResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return {
      success: true,
      data: await this.authService.completeOnboarding(principal, input),
    };
  }
}
