'use client';

import { Button, Callout } from '@bug-bounty-escrow/ui';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AuthCard } from './auth-card';
import { hasOAuthCallbackFailure } from './oauth';
import { useAuthRedirect, withReturnTo } from './use-auth-redirect';
import { useAuth } from '@/providers/auth-provider';

export function OAuthCallback() {
  const auth = useAuth();
  const search = useSearchParams();
  const { safeReturnTo, toWorkspace } = useAuthRedirect();
  const attemptedTokenRef = useRef<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (hasOAuthCallbackFailure(search.toString(), window.location.hash)) {
      setFailure('Google sign-in was cancelled or could not be completed.');
      return;
    }
    if (auth.loading) return;
    if (auth.error !== null) {
      setFailure(auth.error);
      return;
    }

    const accessToken = auth.session?.access_token;
    if (accessToken === undefined) {
      setFailure('Google sign-in returned no session. Please try again.');
      return;
    }
    if (attemptedTokenRef.current === accessToken) return;
    attemptedTokenRef.current = accessToken;

    void toWorkspace(accessToken).catch(() => {
      attemptedTokenRef.current = null;
      setFailure('Your Google account is connected, but your workspace could not be opened.');
    });
  }, [auth.error, auth.loading, auth.session, search, toWorkspace]);

  return (
    <AuthCard
      description="Securely finishing the Google sign-in and opening the correct workspace."
      title={failure === null ? 'Signing you in' : 'Sign-in needs attention'}
    >
      {failure === null ? (
        <div
          aria-live="polite"
          className="flex min-h-28 items-center justify-center gap-sm text-body-sm text-text-muted"
          role="status"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-5 text-primary motion-safe:animate-spin"
          />
          Verifying your session…
        </div>
      ) : (
        <Callout variant="danger">
          <p>{failure}</p>
          <Button asChild className="mt-sm" variant="ghost">
            <Link href={withReturnTo('/login', safeReturnTo)}>Back to sign in</Link>
          </Button>
        </Callout>
      )}
    </AuthCard>
  );
}
