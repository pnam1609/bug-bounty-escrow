import type { ReportStatus } from '@bug-bounty-escrow/shared';

/*
 * The reviewer decision map, kept out of the component so it stays plain data: it is the thing a
 * test can check against the domain state machine without rendering anything.
 */

export type ActionId =
  | 'approve-reward'
  | 'confirm-payment'
  | 'mark-duplicate'
  | 'pay'
  | 'reject'
  | 'request-information'
  | 'validate';

/**
 * The report status each action moves the report to. The domain owns status -> status; this owns
 * action -> endpoint. Different shapes, so only a cross-check keeps them honest — see
 * `test/review-transitions.spec.ts`.
 */
export const ACTION_RESULT_STATUS: Readonly<Record<ActionId, ReportStatus>> = Object.freeze({
  'request-information': 'needs_information',
  validate: 'validated',
  reject: 'rejected',
  'mark-duplicate': 'duplicate',
  'approve-reward': 'reward_approved',
  pay: 'payment_pending',
  'confirm-payment': 'paid',
});

/** Which decisions the current status permits. `needs_information` waits on the researcher. */
export const ACTIONS_BY_STATUS: Readonly<Record<ReportStatus, readonly ActionId[]>> = Object.freeze(
  {
    draft: [],
    submitted: ['validate', 'request-information', 'reject', 'mark-duplicate'],
    triaged: ['validate', 'request-information', 'reject', 'mark-duplicate'],
    needs_information: [],
    rejected: [],
    duplicate: [],
    validated: ['approve-reward'],
    reward_approved: ['pay'],
    payment_pending: ['confirm-payment'],
    paid: [],
  },
);
