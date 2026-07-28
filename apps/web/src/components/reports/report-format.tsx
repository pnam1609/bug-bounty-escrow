import type { ReportSummary, Severity } from '@bug-bounty-escrow/shared';

import { ApiClientError } from '@/lib/api-client';

/*
 * No Figma source — shared vocabulary for the report surfaces.
 *
 * Formatting, the review timeline and every failure message live here so a figure, a stage name or
 * an error can never read one way on `/reports` and another way on `/review`.
 *
 * Two rules shape the module:
 *   - `error.code` is the only thing branched on. A raw server message is never rendered: it is
 *     not a stable contract and it is not written for this reader.
 *   - a report is identified by its real id. The Figma frame shows a friendly `BBE-4821`, but the
 *     API issues UUIDs, so the surfaces show a truncated real id and copy the full one rather than
 *     inventing a second identifier that resolves to nothing.
 */

/** `ReportStatus` lives in `@bug-bounty-escrow/domain`, which the web app does not depend on. */
export type ReportStatus = ReportSummary['status'];

const ABSOLUTE_TIMESTAMP = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const RELATIVE = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function formatUsdc(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const visibleFraction = fraction.replace(/0+$/, '');

  return `${visibleFraction === '' ? groupedWhole : `${groupedWhole}.${visibleFraction}`} USDC`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? 'Unknown date' : ABSOLUTE_TIMESTAMP.format(date);
}

const RELATIVE_DIVISIONS: readonly {
  readonly amount: number;
  readonly unit: Intl.RelativeTimeFormatUnit;
}[] = Object.freeze([
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]);

/** Under 45 seconds reads as "just now" — the wording the SR-07 frame uses on a fresh report. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  let delta = (date.getTime() - now) / 1000;
  if (Math.abs(delta) < 45) return 'just now';

  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(delta) < division.amount) {
      return RELATIVE.format(Math.round(delta), division.unit);
    }
    delta /= division.amount;
  }

  return ABSOLUTE_TIMESTAMP.format(date);
}

/** Relative for the eye, absolute for the tooltip and the accessible name. */
export interface TimeDisplay {
  readonly text: string;
  readonly absolute: string;
}

export function describeTime(iso: string | undefined, now?: number): TimeDisplay | undefined {
  if (iso === undefined) return undefined;

  return { text: formatRelativeTime(iso, now), absolute: formatTimestamp(iso) };
}

/**
 * Display form of a report id: enough characters to tell two reports apart in a breadcrumb, with
 * the full value always reachable through the copy action and the accessible name.
 */
export function shortReportId(id: string): string {
  return id.slice(0, 8);
}

/**
 * A shortened UUID is presentation only. Assistive technology always receives the canonical
 * server-issued UUID so two visually similar references remain unambiguous.
 */
export function reportReferenceAriaLabel(id: string): string {
  return `Full report ID ${id}`;
}

/* ── Review timeline ──────────────────────────────────────────────────────────────────────── */

export interface TimelineStage {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** The five stages drawn in SR-07 `151:105`, labels and sub-labels verbatim. */
export const REPORT_TIMELINE: readonly TimelineStage[] = Object.freeze([
  { id: 'submitted', label: 'Submitted', detail: 'Private report received' },
  { id: 'triage', label: 'Triage', detail: 'Completeness and scope assessment' },
  {
    id: 'decision',
    label: 'Review decision',
    detail: 'Validate, reject, duplicate or request info',
  },
  { id: 'reward', label: 'Reward approval', detail: 'Final severity and USDC amount' },
  { id: 'payment', label: 'Payment', detail: 'Escrow releases USDC' },
]);

/** How many of the five stages the report has finished. */
const COMPLETED_STAGES: Readonly<Record<ReportStatus, number>> = Object.freeze({
  draft: 0,
  submitted: 1,
  triaged: 2,
  // A reviewer has read it and asked a question, so triage is behind it; the decision is not.
  needs_information: 2,
  rejected: 3,
  duplicate: 3,
  validated: 3,
  reward_approved: 4,
  payment_pending: 4,
  paid: 5,
});

/** Rejected and duplicate close the report at the decision stage; nothing after it will happen. */
const CLOSED_STATUSES: readonly ReportStatus[] = Object.freeze(['rejected', 'duplicate']);

export interface TimelineProgress {
  readonly completed: number;
  /** Index of the stage the report is waiting on, or `null` when the flow has stopped. */
  readonly next: number | null;
  readonly closed: boolean;
}

export function timelineProgress(status: ReportStatus): TimelineProgress {
  const completed = COMPLETED_STAGES[status];
  const closed = CLOSED_STATUSES.includes(status);
  const next = closed || completed >= REPORT_TIMELINE.length ? null : completed;

  return { completed, next, closed };
}

/**
 * Filterable statuses, in lifecycle order. `draft` is absent on purpose: the API creates a report
 * already submitted, so a draft filter would only ever return nothing.
 */
export const REPORT_STATUS_OPTIONS: readonly ReportStatus[] = Object.freeze([
  'submitted',
  'triaged',
  'needs_information',
  'validated',
  'reward_approved',
  'payment_pending',
  'paid',
  'rejected',
  'duplicate',
]);

/** One line of plain-language state, paired with the badge so status is never colour alone. */
export const REPORT_STATUS_SUMMARY: Readonly<Record<ReportStatus, string>> = Object.freeze({
  draft: 'Not submitted yet. Only you can see it.',
  submitted: 'Waiting for a reviewer to pick it up.',
  triaged: 'Triaged for completeness and scope. A decision comes next.',
  needs_information: 'A reviewer asked for more information. Answer to move it forward.',
  rejected: 'Closed. A reviewer decided it is not eligible for this program.',
  duplicate: 'Closed as a duplicate of an earlier report.',
  validated: 'Accepted. A reward decision comes next.',
  reward_approved: 'A reward is approved and reserved against the program pool.',
  payment_pending: 'Payment is on chain and waiting for confirmations.',
  paid: 'Settled. The escrow released the reward.',
});

/* ── Failure copy ─────────────────────────────────────────────────────────────────────────── */

/**
 * `error.code` is a stable machine contract (`packages/shared/src/contracts/errors.ts`); the
 * accompanying message is not, so it is never shown. Anything unrecognised falls back to the
 * caller's own sentence.
 */
const ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  invalid_report_transition:
    'This report has already moved on. Refresh to see where it is now, then choose again.',
  report_not_accessible: 'This report is not available to your account.',
  reviewer_role_required: 'Only an owner or an assigned reviewer can act on this report.',
  researcher_role_required: 'Only the researcher who filed this report can do that.',
  owner_role_required: 'Only the program owner can do that.',
  duplicate_target_invalid:
    'That original report id does not point to a report in this program that can absorb this one.',
  reward_amount_required:
    'This tier is decided by the reviewer. Enter the reward amount you settled on.',
  reward_basis_required:
    'This is a percentage tier. Enter the verified funds at risk — the server derives the reward from it.',
  reward_out_of_bounds:
    'That amount falls outside the reward tier for this severity and asset type.',
  insufficient_available_pool:
    'The program pool no longer has enough unreserved USDC to cover this reward.',
  reward_already_paid: 'This reward has already been paid.',
  attachment_not_accessible: 'That attachment is no longer available.',
  not_found: 'That record no longer exists.',
  forbidden: 'You are not allowed to do that.',
  unauthorized: 'Your session expired. Sign in again to continue.',
  conflict: 'Someone else changed this report first. Refresh and try again.',
  too_many_requests: 'Too many attempts. Wait a moment, then try again.',
  bad_request: 'Some of the details are not valid. Check the fields and try again.',
  unprocessable_entity: 'Some of the details are not valid. Check the fields and try again.',
  business_rule_violation: 'A program rule blocked that action.',
  database_unavailable: 'The service is briefly unavailable. Try again in a moment.',
});

export function describeReportError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) {
    return 'We could not reach the server. Check your connection and try again.';
  }

  if (error instanceof ApiClientError) {
    return ERROR_MESSAGES[error.code] ?? fallback;
  }

  return fallback;
}

/* ── Severity ─────────────────────────────────────────────────────────────────────────────── */

export const SEVERITY_OPTIONS: readonly Severity[] = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
  'informational',
]);

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
});

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
