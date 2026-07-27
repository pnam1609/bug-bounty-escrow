import { updateProfileRequestSchema } from '@bug-bounty-escrow/shared';

import { ApiClientError } from '@/lib/api-client';

/*
 * ACC-01 … ACC-06 form and recovery model, extracted from the screen so the rules that decide
 * whether a profile edit may be sent — trim, validity, pending — and the rules that decide which
 * recovery state a failed request belongs to are pure functions under unit test rather than
 * behaviour only a browser can exercise. Same split as `role-guard-model.ts`.
 *
 * Source: docs/flow/account-settings-researcher-flow-for-figma.md §3.1, §8 (ACC-00 … ACC-06),
 * §9 and §10.
 */

/**
 * §2 "Routes". `/account/settings` is the target route; every shell links here through this
 * constant so a second settings path can never drift into the app.
 */
export const ACCOUNT_SETTINGS_PATH = '/account/settings';

/** §8 ACC-05: the destination the load-error state offers beside `Try again`. */
export const PROGRAMS_PATH = '/programs';

/** §3.1: 1–120 characters after trimming — the bound `updateProfileRequestSchema` enforces. */
export const DISPLAY_NAME_MAX_LENGTH = 120;

/**
 * §8 ACC-02: "tự đóng sau thời gian hợp lý". Long enough to read three words after focus has
 * already moved on, short enough that the confirmation cannot outlive the save that produced it.
 */
export const SAVED_MESSAGE_DURATION_MS = 6_000;

/**
 * Copy that the flow doc pins verbatim (§3.2, §3.3, §8). Held here rather than inline in JSX so a
 * test can assert the exact bytes, and so the immutable-role sentence cannot be re-worded or split
 * around a link the next time the card is touched.
 */
export const ACCOUNT_SETTINGS_COPY = Object.freeze({
  title: 'Account settings',
  supporting: 'Manage how your profile appears across BountyEscrow.',
  profileHeading: 'Profile information',
  displayNameLabel: 'Display name',
  displayNameHelper: 'Shown in your workspace and researcher activity.',
  emailLabel: 'Email',
  emailHelper: 'Managed by your authentication provider.',
  accountTypeLabel: 'Account type',
  /** §3.2. One sentence, no inline link: the support affordance lives in the Need help card. */
  accountTypeImmutable:
    'Account type cannot be changed from settings in the MVP. Contact support if your account was set up incorrectly.',
  cancel: 'Cancel',
  save: 'Save changes',
  saving: 'Saving…',
  /** §8 ACC-02. */
  saved: 'Profile changes saved',
  /** §8 ACC-03. */
  displayNameRequired: 'Display name is required.',
  displayNameTooLong: `Display name must be ${String(DISPLAY_NAME_MAX_LENGTH)} characters or fewer.`,
  /**
   * §8 ACC-04, "map error về Display name khi có thể": what a server rejection of the one editable
   * field says when the client cannot restate the rule that was broken.
   */
  displayNameRejected: 'That display name was not accepted. Choose a different name.',
  /** §8 ACC-04. */
  saveError: "We couldn't save your profile. Your changes are still here.",
  /** §8 ACC-04 and ACC-05 share one retry label. */
  tryAgain: 'Try again',
  /** §8 ACC-05. */
  loadError: "We couldn't load your account settings.",
  backToPrograms: 'Back to programs',
  /** §8 ACC-06. */
  sessionExpired: 'Your session expired. Sign in again to manage your account.',
  signIn: 'Sign in',
  /** §8 ACC-00. The skeleton holds the layout; this is what a screen reader is told instead. */
  loading: 'Loading your account settings…',
  securityHeading: 'Account & security',
  logOut: 'Log out',
  /** §8 ACC-07 / ACC-08. */
  loggingOut: 'Logging out…',
  logOutError: "We couldn't log you out. Try again.",
  /** §8 "Need help card". */
  helpHeading: 'Need help with your account?',
  helpAction: 'Contact support',
} as const);

/**
 * §3.1 and §8 ACC-03. The shared contract schema is the authority on what the API will accept, so
 * validity is decided by parsing against it; the branch below only chooses which of the two
 * documented sentences explains the rejection.
 */
export function validateDisplayName(value: string): string | null {
  if (updateProfileRequestSchema.safeParse({ displayName: value }).success) return null;
  return value.trim().length === 0
    ? ACCOUNT_SETTINGS_COPY.displayNameRequired
    : ACCOUNT_SETTINGS_COPY.displayNameTooLong;
}

/* ── Failure routing (§8 ACC-03 · ACC-04 · ACC-05 · ACC-06, §10) ─────────────────────────── */

/**
 * §10 maps a missing or expired session to ACC-06 for both `GET` and `PATCH /api/me`. The status
 * is what the contract promises; the code is checked too so a proxy that rewrites the status still
 * lands on the sign-in state rather than on a retry the user can never win.
 */
function isExpiredSession(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 401 || error.code === 'unauthorized');
}

/**
 * Where a failed `PATCH /api/me` belongs on the screen.
 *
 * `field` is §8 ACC-04's "map error về Display name khi có thể", `page` its page-level alert, and
 * `session-expired` is ACC-06 — which is deliberately not a retry, because no number of attempts
 * fixes a dead session.
 */
export type SaveFailure =
  | { readonly kind: 'field'; readonly message: string }
  | { readonly kind: 'page'; readonly message: string }
  | { readonly kind: 'session-expired' };

/**
 * The request carries exactly one field, so any rejection the server frames as *validation* can
 * only be about the display name — that is what makes ACC-04's "map về Display name khi có thể"
 * decidable here. `validation_error` is what the API's Zod pipe raises and `display_name_invalid`
 * what the profile RPC raises; the two statuses cover a server rule stricter than the client
 * schema that answers with neither code.
 */
function isDisplayNameRejection(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.status === 400 ||
      error.status === 422 ||
      error.code === 'display_name_invalid' ||
      error.code === 'validation_error')
  );
}

/**
 * §8 ACC-04. Everything that is not a session expiry or a display-name rejection — conflict, a
 * vanished profile, 5xx, a dropped connection — is the one page-level sentence the flow doc pins,
 * never a message taken from the response body: `error.code` is a machine contract, the text
 * beside it is not, and a sentence written for another screen ("this report") must never surface
 * here.
 *
 * `attemptedDisplayName` is the trimmed value that was sent, so a server rule the client schema
 * does not know about is still explained with the client's own wording when the value visibly
 * breaks a documented rule.
 */
export function describeSaveFailure(error: unknown, attemptedDisplayName: string): SaveFailure {
  if (isExpiredSession(error)) return { kind: 'session-expired' };
  if (isDisplayNameRejection(error)) {
    return {
      kind: 'field',
      message:
        validateDisplayName(attemptedDisplayName) ?? ACCOUNT_SETTINGS_COPY.displayNameRejected,
    };
  }
  return { kind: 'page', message: ACCOUNT_SETTINGS_COPY.saveError };
}

/** §8 ACC-05 vs ACC-06 for a failed `GET /api/me`. */
export type LoadFailure = 'load-error' | 'session-expired';

/**
 * §8 ACC-05/ACC-06. A dead session is offered a sign-in, everything else a retry — so the retry
 * button only ever appears where retrying can actually succeed.
 */
export function describeLoadFailure(error: unknown): LoadFailure {
  return isExpiredSession(error) ? 'session-expired' : 'load-error';
}

/* ── Form state (§8 ACC-01 · ACC-02 · ACC-03, §9) ────────────────────────────────────────── */

export interface ProfileFormInput {
  /**
   * What the user has typed, or `null` while the field still mirrors the server. Keeping the
   * pristine state as `null` — rather than a copy taken once at mount — is what makes Cancel reset
   * to the *latest* profile response instead of a stale initial value (§9).
   */
  readonly draft: string | null;
  /** `PATCH /api/me` in flight. §8: a pending mutation disables Save. */
  readonly isPending: boolean;
  /** `displayName` from the most recent `GET`/`PATCH /api/me` response. Already trimmed server-side. */
  readonly serverDisplayName: string;
}

export interface ProfileFormState {
  /** §8: enabled only when the trimmed value differs, the form is valid and nothing is in flight. */
  readonly canSave: boolean;
  /** The trimmed value a save would send. Never the raw input. */
  readonly displayNameToSend: string;
  /** Inline validation message, or `null`. Only ever shown once the field has been touched. */
  readonly error: string | null;
  readonly isDirty: boolean;
  /** What the input renders. */
  readonly value: string;
}

export function describeProfileForm({
  draft,
  isPending,
  serverDisplayName,
}: ProfileFormInput): ProfileFormState {
  const value = draft ?? serverDisplayName;
  const trimmed = value.trim();
  // Compared after trimming on both sides: typing a trailing space is not a change worth a request.
  const isDirty = trimmed !== serverDisplayName.trim();
  // An untouched field is not "wrong" yet, so a profile the server itself considers odd never
  // greets the reader with a red error the moment the page paints.
  const error = draft === null ? null : validateDisplayName(value);

  return {
    canSave: isDirty && error === null && !isPending,
    displayNameToSend: trimmed,
    error,
    isDirty,
    value,
  };
}

/** §8 "Account & security card": the `JD` avatar mark, derived from the name the server returned. */
export function avatarInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return initials === '' ? '?' : initials;
}
