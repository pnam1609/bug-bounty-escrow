/**
 * Stable machine-readable error codes returned in `error.code` of an API error response.
 *
 * Business rules live in PostgreSQL atomic RPCs, which raise them as the `detail` payload of the
 * error. The API surfaces that value verbatim so a client can branch on state (for example, show
 * the "program closed" screen instead of a generic retry) without parsing human-readable text.
 */
export const API_ERROR_CODES = Object.freeze([
  // Generic transport / validation
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable_entity',
  'too_many_requests',
  'internal_server_error',
  'database_unavailable',
  'business_rule_violation',

  // Onboarding
  'onboarding_already_completed',
  'role_not_self_assignable',
  'profile_not_found',
  'display_name_invalid',

  // Program lifecycle
  'program_not_accessible',
  'program_not_accepting_reports',
  'invalid_program_transition',
  'program_not_ready_to_publish',
  'program_escrow_not_deployed',
  'program_escrow_already_deployed',
  'wallet_control_challenge_not_found',
  'wallet_control_challenge_binding_mismatch',
  'wallet_control_challenge_invalidated',
  'wallet_control_challenge_expired',
  'wallet_control_challenge_replayed',
  'wallet_control_signature_invalid',
  'withdrawal_program_not_ended',
  'program_scope_in_use',
  'owner_role_required',
  'reviewer_role_required',

  // Program configuration
  'impact_coverage_missing',
  'reward_tier_coverage_missing',
  'duplicate_impact_title',
  'duplicate_reward_tier',
  'invalid_reward_calculation',
  'asset_type_not_available',

  // Report lifecycle
  'report_not_accessible',
  'invalid_report_transition',
  'researcher_role_required',
  'scope_not_eligible',
  'impact_not_eligible',
  'custom_impact_not_allowed',
  'impact_selection_required',
  'reproduction_steps_required',
  'duplicate_target_invalid',

  // Settlement
  'reward_out_of_bounds',
  'reward_amount_required',
  'reward_basis_required',
  'insufficient_available_pool',
  'reward_already_paid',
  'funding_amount_invalid',
  'payout_wallet_not_required',
  'wallet_address_invalid',
  'wallet_change_confirmation_required',

  // Disclosure
  'disclosure_not_allowed_yet',
  'disclosure_already_decided',

  // Attachments
  'attachment_not_accessible',
  'attachment_already_uploaded',
  'attachment_object_missing',
] as const);

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const API_ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(API_ERROR_CODES);

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return API_ERROR_CODE_SET.has(value);
}
