'use client';

import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import { ApiClientError } from '@/lib/api-client';

/**
 * Validation rules and failure copy for the two auth screens.
 *
 * Everything a user can be told about a failed sign-in or sign-up is decided here so the two forms
 * stay consistent, and so each message can name the field it belongs to — `Field` links it with
 * `aria-describedby` and pairs it with an icon, never colour alone.
 */

/** Field a failure attaches to. `null` means it belongs to the form-level alert. */
export type AuthFieldName = 'email' | 'password' | 'terms';

export interface AuthFailure {
  readonly field: AuthFieldName | null;
  readonly message: string;
  /** Offer "Sign in instead" alongside the alert — used when the email is already registered. */
  readonly offerSignIn: boolean;
}

/**
 * Deliberately loose: the server owns address validity. This only catches shapes that cannot be an
 * address at all, so a legitimate but unusual mailbox is never blocked in the browser.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Supabase's own floor and the length the previous form enforced. */
export const PASSWORD_MIN_LENGTH = 8;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(trimmed)) {
    return 'Enter a valid email address, for example you@company.com.';
  }
  return null;
}

export function validateCurrentPassword(value: string): string | null {
  if (value === '') return 'Enter your password.';
  return null;
}

/**
 * Length only. The rest of the strength policy lives on the Supabase project, which answers with
 * `weak_password`; enforcing a stricter rule in the browser would reject passwords the server
 * accepts and lock people out of their own accounts.
 */
export function validateNewPassword(value: string): string | null {
  if (value === '') return 'Create a password.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`;
  }
  return null;
}

export function validateTermsAccepted(accepted: boolean): string | null {
  if (!accepted) return 'Accept the Terms and Privacy Policy to continue.';
  return null;
}

const NETWORK_FAILURE: AuthFailure = Object.freeze({
  field: null,
  message: 'We could not reach the server. Check your connection and try again.',
  offerSignIn: false,
});

function isNetworkFailure(error: unknown): boolean {
  // A failed `fetch` rejects with a TypeError; Supabase wraps its own retryable transport errors.
  return isAuthRetryableFetchError(error) || error instanceof TypeError;
}

/**
 * Turns whatever the auth or profile call threw into one message the user can act on. Supabase
 * error codes are matched first because they are stable; the message text is not.
 */
export function describeAuthFailure(error: unknown, mode: 'sign-in' | 'sign-up'): AuthFailure {
  if (isNetworkFailure(error)) return NETWORK_FAILURE;

  if (isAuthError(error)) {
    switch (error.code) {
      case 'email_exists':
      case 'identity_already_exists':
      case 'user_already_exists':
        return {
          field: 'email',
          message: 'An account already uses this email address.',
          offerSignIn: true,
        };
      case 'weak_password':
        return {
          field: 'password',
          message: 'Choose a stronger password: 8+ characters with at least one number.',
          offerSignIn: false,
        };
      case 'invalid_credentials':
        return {
          field: null,
          message: 'That email address and password do not match an account.',
          offerSignIn: false,
        };
      case 'email_not_confirmed':
        return {
          field: null,
          message:
            'Confirm your email address before signing in. Open the confirmation link we sent you.',
          offerSignIn: false,
        };
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return {
          field: null,
          message: 'Too many attempts. Wait a minute, then try again.',
          offerSignIn: false,
        };
      case 'email_provider_disabled':
      case 'signup_disabled':
        return {
          field: null,
          message: 'New accounts are not being accepted right now.',
          offerSignIn: false,
        };
      case 'validation_failed':
        return {
          field: 'email',
          message: 'Check the email address and try again.',
          offerSignIn: false,
        };
      default:
        break;
    }
  }

  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return {
        field: null,
        message: 'Your session expired. Sign in again to continue.',
        offerSignIn: false,
      };
    }
    return {
      field: null,
      message: 'We could not load your profile. Try again.',
      offerSignIn: false,
    };
  }

  return {
    field: null,
    message:
      mode === 'sign-in'
        ? 'Sign-in failed. Check your details and try again.'
        : 'We could not create your account. Try again.',
    offerSignIn: false,
  };
}
