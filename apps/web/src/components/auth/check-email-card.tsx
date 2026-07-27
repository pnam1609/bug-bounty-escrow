'use client';

import { Button, Callout } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AuthCard } from './auth-card';
import { useAuthRedirect, withReturnTo } from './use-auth-redirect';

/**
 * AUTH-03 — the card at `/register/check-email` (§5, §6.1 "Check-email success").
 *
 * The account exists but there is no session yet, so the address cannot be fetched from a profile.
 * The sign-up form leaves it in `sessionStorage` for this card: a query param would write the
 * address into browser history and request logs, and per-tab storage still survives a reload of
 * this page. When the address is missing — a direct visit, or another tab — the copy degrades to
 * "your email address" instead of blocking the screen.
 */

const CONFIRMATION_EMAIL_KEY = 'register-confirmation-email';

/** Called by the sign-up form just before it navigates here. */
export function rememberConfirmationEmail(address: string): void {
  try {
    window.sessionStorage.setItem(CONFIRMATION_EMAIL_KEY, address);
  } catch {
    // Private-mode or quota failures degrade to the generic copy, never to a thrown render.
  }
}

function readConfirmationEmail(): string | null {
  try {
    return window.sessionStorage.getItem(CONFIRMATION_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function CheckEmailCard() {
  const { safeReturnTo } = useAuthRedirect();
  const signInHref = withReturnTo('/login', safeReturnTo);
  const registerHref = withReturnTo('/register', safeReturnTo);

  // Read after mount: the page is prerendered without access to storage, so reading during render
  // would make the server and client disagree about the first paint.
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    setAddress(readConfirmationEmail());
  }, []);

  return (
    <AuthCard
      description="Your account is created. One click confirms it."
      title="Check your email"
    >
      <Callout title="Confirmation sent" variant="info">
        <p>
          We sent a confirmation link to{' '}
          {address === null ? (
            'your email address'
          ) : (
            <strong className="text-text">{address}</strong>
          )}
          . Open it to activate your account, then sign in to choose your account type.
        </p>
      </Callout>

      <p className="text-body-sm text-text-muted">
        No email after a minute? Check your spam folder, or{' '}
        <Link className="underline hover:text-text" href={registerHref}>
          try again with a different address
        </Link>
        .
      </p>

      <Button asChild className="w-full" size="lg">
        <Link href={signInHref}>Go to sign in</Link>
      </Button>
    </AuthCard>
  );
}
