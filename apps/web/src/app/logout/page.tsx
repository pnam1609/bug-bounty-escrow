'use client';

import { Button, SiteBrand } from '@bug-bounty-escrow/ui';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { ACCOUNT_SETTINGS_COPY as COPY } from '@/components/account/account-settings-model';
import { useLogoutAction } from '@/components/account/logout-action';

/*
 * Compatibility route for direct `/logout` visits. It uses the same ACC-07/08 action as the menu
 * and account card, including the retry state when the provider says the local session survived.
 */

export default function LogoutPage() {
  const logout = useLogoutAction();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void logout.logOut();
  }, [logout.logOut]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2xl bg-background px-lg py-3xl">
      <SiteBrand />
      <div
        aria-live="polite"
        className="flex w-full max-w-md flex-col items-center gap-md rounded-lg border border-border bg-surface p-2xl text-center shadow-subtle"
      >
        {logout.error === null ? (
          <>
            <LoaderCircle
              aria-hidden="true"
              className="size-6 text-primary motion-safe:animate-spin"
            />
            <p className="text-h3 text-text">{COPY.loggingOut}</p>
            <p className="text-body-sm text-text-muted">
              Clearing your session and protected data from this browser.
            </p>
          </>
        ) : (
          <>
            <p className="text-body-sm text-error" role="alert">
              {logout.error}
            </p>
            <Button disabled={logout.isPending} onClick={() => void logout.logOut()}>
              {COPY.logOut}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
