import { USER_ROLES } from '@bug-bounty-escrow/domain';
import { z } from 'zod';

import {
  evmAddressSchema,
  nonEmptyTrimmedTextSchema,
  uuidSchema,
} from '../schemas/primitives.js';

export const applicationRoleSchema = z.enum(USER_ROLES);
export const selfAssignableRoleSchema = z.enum(['owner', 'researcher']);
export const authenticationStateSchema = z.enum([
  'anonymous',
  'authenticated',
  'onboarding_required',
]);

export const requestPrincipalSchema = z
  .object({
    userId: uuidSchema,
    email: z.string().email(),
    role: applicationRoleSchema,
  })
  .strict();

export const currentUserSchema = z
  .object({
    id: uuidSchema,
    email: z.string().email(),
    role: applicationRoleSchema,
    displayName: nonEmptyTrimmedTextSchema,
    walletAddress: evmAddressSchema.optional(),
    avatarUrl: z.string().url().optional(),
    onboardingComplete: z.boolean(),
  })
  .strict();

export const currentUserResponseSchema = z
  .object({
    success: z.literal(true),
    data: currentUserSchema,
  })
  .strict();

export const onboardingRequestSchema = z
  .object({
    role: selfAssignableRoleSchema,
    displayName: nonEmptyTrimmedTextSchema.max(120),
  })
  .strict();

export const onboardingResponseSchema = currentUserResponseSchema;

/**
 * Account settings. Only the display name is editable: role is fixed after onboarding, email
 * belongs to the auth provider, and the payout wallet is collected by the reward flow instead.
 */
export const updateProfileRequestSchema = z
  .object({ displayName: nonEmptyTrimmedTextSchema.max(120) })
  .strict();

export const updateProfileResponseSchema = currentUserResponseSchema;

export type ApplicationRole = z.output<typeof applicationRoleSchema>;
export type AuthenticationState = z.output<typeof authenticationStateSchema>;
export type RequestPrincipal = z.output<typeof requestPrincipalSchema>;
export type CurrentUser = z.output<typeof currentUserSchema>;
export type CurrentUserResponse = z.output<typeof currentUserResponseSchema>;
export type OnboardingRequest = z.output<typeof onboardingRequestSchema>;
export type OnboardingResponse = z.output<typeof onboardingResponseSchema>;
export type UpdateProfileRequest = z.output<typeof updateProfileRequestSchema>;
export type UpdateProfileResponse = z.output<typeof updateProfileResponseSchema>;
