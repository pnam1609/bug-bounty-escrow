import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_SETTINGS_COPY,
  ACCOUNT_SETTINGS_PATH,
  DISPLAY_NAME_MAX_LENGTH,
  PROGRAMS_PATH,
  SAVED_MESSAGE_DURATION_MS,
  avatarInitials,
  describeLoadFailure,
  describeProfileForm,
  describeSaveFailure,
  validateDisplayName,
  type ProfileFormInput,
} from '../src/components/account/account-settings-model';
import { ApiClientError, safeReturnPath } from '../src/lib/api-client';

/*
 * ACC-02/ACC-03 §3.1, §8 (ACC-00 … ACC-06), §9 and §10 of
 * docs/flow/account-settings-researcher-flow-for-figma.md.
 *
 * The sample identity is the one the flow doc fixes for Figma and seed UI — `John Delph` / `JD` /
 * `john.delph@example.com` — never a real project member's name (§3.1).
 */

const SAMPLE_NAME = 'John Delph';

/** An untouched form sitting on the profile the server last returned. */
function form(overrides: Partial<ProfileFormInput> = {}): ProfileFormInput {
  return { draft: null, isPending: false, serverDisplayName: SAMPLE_NAME, ...overrides };
}

describe('route', () => {
  it('names the single target route from §2', () => {
    expect(ACCOUNT_SETTINGS_PATH).toBe('/account/settings');
  });

  it('offers only internal paths the returnTo filter already accepts (§8 ACC-05/ACC-06)', () => {
    // The sign-in link is built as `withReturnTo('/login', safeReturnPath(ACCOUNT_SETTINGS_PATH))`.
    // If the constant were ever changed to something the filter rewrites, the link would silently
    // start returning people to `/programs` instead of to their settings.
    expect(safeReturnPath(ACCOUNT_SETTINGS_PATH)).toBe(ACCOUNT_SETTINGS_PATH);
    expect(safeReturnPath(PROGRAMS_PATH)).toBe(PROGRAMS_PATH);
    // No query string, so no draft display name can ever ride along into the URL.
    expect(ACCOUNT_SETTINGS_PATH).not.toContain('?');
  });
});

describe('copy pinned by the flow doc', () => {
  it('carries the immutable account-type callout verbatim (§3.2)', () => {
    expect(ACCOUNT_SETTINGS_COPY.accountTypeImmutable).toBe(
      'Account type cannot be changed from settings in the MVP. Contact support if your account was set up incorrectly.',
    );
  });

  it('carries the title, supporting copy and field helpers verbatim (§8 ACC-01)', () => {
    expect(ACCOUNT_SETTINGS_COPY.title).toBe('Account settings');
    expect(ACCOUNT_SETTINGS_COPY.supporting).toBe(
      'Manage how your profile appears across BountyEscrow.',
    );
    expect(ACCOUNT_SETTINGS_COPY.profileHeading).toBe('Profile information');
    expect(ACCOUNT_SETTINGS_COPY.displayNameHelper).toBe(
      'Shown in your workspace and researcher activity.',
    );
    expect(ACCOUNT_SETTINGS_COPY.emailHelper).toBe('Managed by your authentication provider.');
    expect(ACCOUNT_SETTINGS_COPY.helpHeading).toBe('Need help with your account?');
    expect(ACCOUNT_SETTINGS_COPY.helpAction).toBe('Contact support');
  });

  it('carries the saved, save-error and load-error copy verbatim (§8 ACC-02/04/05)', () => {
    expect(ACCOUNT_SETTINGS_COPY.saved).toBe('Profile changes saved');
    expect(ACCOUNT_SETTINGS_COPY.saveError).toBe(
      "We couldn't save your profile. Your changes are still here.",
    );
    expect(ACCOUNT_SETTINGS_COPY.loadError).toBe("We couldn't load your account settings.");
  });

  it('carries the recovery action labels and the session sentence verbatim (§8 ACC-04/05/06)', () => {
    expect(ACCOUNT_SETTINGS_COPY.tryAgain).toBe('Try again');
    expect(ACCOUNT_SETTINGS_COPY.backToPrograms).toBe('Back to programs');
    expect(ACCOUNT_SETTINGS_COPY.sessionExpired).toBe(
      'Your session expired. Sign in again to manage your account.',
    );
    expect(ACCOUNT_SETTINGS_COPY.signIn).toBe('Sign in');
  });

  it('closes the saved confirmation by itself within a readable window (§8 ACC-02)', () => {
    expect(SAVED_MESSAGE_DURATION_MS).toBeGreaterThanOrEqual(3_000);
    expect(SAVED_MESSAGE_DURATION_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('display name validation (§3.1, §8 ACC-03)', () => {
  it('accepts a trimmed name of 1 to 120 characters', () => {
    expect(validateDisplayName(SAMPLE_NAME)).toBeNull();
    expect(validateDisplayName('a')).toBeNull();
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBeNull();
  });

  it('rejects a blank or whitespace-only name with the documented sentence', () => {
    expect(validateDisplayName('')).toBe('Display name is required.');
    expect(validateDisplayName('   ')).toBe('Display name is required.');
    expect(validateDisplayName('\t\n ')).toBe('Display name is required.');
  });

  it('rejects a name longer than 120 characters after trimming', () => {
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe(
      'Display name must be 120 characters or fewer.',
    );
    // Surrounding whitespace is not what makes it too long, so it is trimmed away first.
    expect(validateDisplayName(`  ${'a'.repeat(DISPLAY_NAME_MAX_LENGTH)}  `)).toBeNull();
  });
});

describe('save gating (§8 ACC-01)', () => {
  it('starts clean: nothing typed, nothing to send, no error shown', () => {
    const state = describeProfileForm(form());
    expect(state.value).toBe(SAMPLE_NAME);
    expect(state.isDirty).toBe(false);
    expect(state.error).toBeNull();
    expect(state.canSave).toBe(false);
  });

  it('stays disabled when the only change is whitespace around the same name', () => {
    const state = describeProfileForm(form({ draft: `  ${SAMPLE_NAME}  ` }));
    expect(state.isDirty).toBe(false);
    expect(state.canSave).toBe(false);
  });

  it('enables once the trimmed value actually differs, and sends the trimmed value', () => {
    const state = describeProfileForm(form({ draft: '  Delph Researcher  ' }));
    expect(state.isDirty).toBe(true);
    expect(state.error).toBeNull();
    expect(state.canSave).toBe(true);
    expect(state.displayNameToSend).toBe('Delph Researcher');
  });

  it('stays disabled while the form is invalid, and explains why beside the field', () => {
    const state = describeProfileForm(form({ draft: '   ' }));
    expect(state.error).toBe('Display name is required.');
    expect(state.canSave).toBe(false);
  });

  it('stays disabled while the mutation is pending, so a submit cannot double-fire', () => {
    const state = describeProfileForm(form({ draft: 'Delph Researcher', isPending: true }));
    expect(state.isDirty).toBe(true);
    expect(state.error).toBeNull();
    expect(state.canSave).toBe(false);
  });

  it('never shows an error before the field is touched', () => {
    // A profile the client rule would reject is still not the reader's mistake on arrival.
    expect(describeProfileForm(form({ serverDisplayName: 'a'.repeat(200) })).error).toBeNull();
  });
});

describe('cancel and the server baseline (§9)', () => {
  it('clearing the draft restores the latest server profile without a request', () => {
    const edited = describeProfileForm(form({ draft: 'Something else' }));
    expect(edited.value).toBe('Something else');

    const cancelled = describeProfileForm(form({ draft: null }));
    expect(cancelled.value).toBe(SAMPLE_NAME);
    expect(cancelled.isDirty).toBe(false);
    expect(cancelled.canSave).toBe(false);
  });

  it('follows the newest server profile rather than a value captured at mount', () => {
    // The baseline after a successful PATCH, or after any refetch, is whatever the server said
    // last — so an untouched form shows the new name and Cancel resets to it, not to the old one.
    const state = describeProfileForm(form({ serverDisplayName: 'Delph Researcher' }));
    expect(state.value).toBe('Delph Researcher');
    expect(state.isDirty).toBe(false);
  });

  it('keeps a dirty draft when the server value moves underneath it', () => {
    const state = describeProfileForm(
      form({ draft: 'Half-typed name', serverDisplayName: 'Delph Researcher' }),
    );
    expect(state.value).toBe('Half-typed name');
    expect(state.isDirty).toBe(true);
  });
});

describe('save failure routing (§8 ACC-03/ACC-04/ACC-06, §10)', () => {
  function apiError(status: number, code: string): ApiClientError {
    return new ApiClientError(status, code, 'Request failed');
  }

  it('sends a dead session to ACC-06 rather than to a retry that cannot win', () => {
    expect(describeSaveFailure(apiError(401, 'unauthorized'), SAMPLE_NAME)).toEqual({
      kind: 'session-expired',
    });
    // A proxy that rewrote the status still lands on the sign-in state, not on a retry loop.
    expect(describeSaveFailure(apiError(500, 'unauthorized'), SAMPLE_NAME)).toEqual({
      kind: 'session-expired',
    });
  });

  it('maps a server validation error back onto Display name (§8 ACC-04)', () => {
    // The request carries one field, so a validation rejection can only be about that field.
    for (const error of [
      apiError(400, 'validation_error'),
      apiError(422, 'unprocessable_entity'),
      apiError(409, 'display_name_invalid'),
    ]) {
      expect(describeSaveFailure(error, 'Delph Researcher')).toEqual({
        kind: 'field',
        message: 'That display name was not accepted. Choose a different name.',
      });
    }
  });

  it('restates the client rule when the rejected value visibly breaks one', () => {
    // A server stricter than the client schema still gets explained in the documented words when
    // the value itself says why — rather than with a sentence about "that display name".
    expect(describeSaveFailure(apiError(400, 'validation_error'), '')).toEqual({
      kind: 'field',
      message: 'Display name is required.',
    });
    expect(
      describeSaveFailure(
        apiError(400, 'validation_error'),
        'a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1),
      ),
    ).toEqual({ kind: 'field', message: 'Display name must be 120 characters or fewer.' });
  });

  it('gives everything else the one page-level sentence §8 ACC-04 pins', () => {
    const expected = {
      kind: 'page',
      message: "We couldn't save your profile. Your changes are still here.",
    };

    // Conflict, a vanished profile, 5xx, a dropped connection and a rate limit all read the same:
    // the response body's own message is never shown, so copy written for another screen — the
    // report vocabulary in `report-format.tsx`, for one — cannot surface on this page.
    expect(describeSaveFailure(apiError(409, 'conflict'), SAMPLE_NAME)).toEqual(expected);
    expect(describeSaveFailure(apiError(404, 'profile_not_found'), SAMPLE_NAME)).toEqual(expected);
    expect(describeSaveFailure(apiError(500, 'internal_server_error'), SAMPLE_NAME)).toEqual(
      expected,
    );
    expect(describeSaveFailure(apiError(429, 'too_many_requests'), SAMPLE_NAME)).toEqual(expected);
    expect(describeSaveFailure(new TypeError('Failed to fetch'), SAMPLE_NAME)).toEqual(expected);
    expect(describeSaveFailure(null, SAMPLE_NAME)).toEqual(expected);
  });
});

describe('load failure routing (§8 ACC-05/ACC-06)', () => {
  it('separates the session that expired from the load that failed', () => {
    expect(describeLoadFailure(new ApiClientError(401, 'unauthorized', 'x'))).toBe(
      'session-expired',
    );
    expect(describeLoadFailure(new ApiClientError(500, 'internal_server_error', 'x'))).toBe(
      'load-error',
    );
    // A profile row that is not there yet answers 409; retrying is still the honest offer.
    expect(describeLoadFailure(new ApiClientError(409, 'conflict', 'x'))).toBe('load-error');
    expect(describeLoadFailure(new TypeError('Failed to fetch'))).toBe('load-error');
    expect(describeLoadFailure(null)).toBe('load-error');
  });
});

describe('avatar initials (§8 "Account & security card")', () => {
  it('derives JD from the sample identity', () => {
    expect(avatarInitials(SAMPLE_NAME)).toBe('JD');
  });

  it('takes at most two initials and ignores extra whitespace', () => {
    expect(avatarInitials('  john   delph  reyes ')).toBe('JD');
    expect(avatarInitials('Delph')).toBe('D');
  });

  it('falls back rather than rendering an empty avatar', () => {
    expect(avatarInitials('   ')).toBe('?');
  });
});
