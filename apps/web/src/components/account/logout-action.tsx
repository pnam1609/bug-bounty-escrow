'use client';

import { DropdownMenuItem } from '@bug-bounty-escrow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';

import { ACCOUNT_SETTINGS_COPY as COPY } from './account-settings-model';
import { useAuth } from '@/providers/auth-provider';

export const LOGOUT_DESTINATION = '/login';

export type LogoutResult = 'failed' | 'ignored' | 'signed-out';

export interface LogoutDependencies {
  readonly auth: {
    readonly getSession: () => Promise<unknown | null>;
    readonly signOut: () => Promise<void>;
  };
  readonly queryCache: {
    readonly clear: () => void;
  };
  readonly router: {
    readonly replace: (href: string) => void;
  };
}

export interface LogoutController {
  readonly isPending: () => boolean;
  readonly run: () => Promise<LogoutResult>;
}

/**
 * ACC-07/08 session orchestration.
 *
 * This controller deliberately owns the ordering instead of `AuthProvider.signOut`: signing out
 * confirms the auth mutation, while clearing protected client state and choosing a destination are
 * application concerns. Keeping the three dependencies explicit also makes every branch
 * independently testable without a browser.
 */
export function createLogoutController({
  auth,
  queryCache,
  router,
}: LogoutDependencies): LogoutController {
  let pending = false;

  return {
    isPending: () => pending,
    run: async () => {
      // The UI is disabled while pending; this synchronous lock also covers two calls in the same
      // event turn, before React has had a chance to paint that disabled state.
      if (pending) return 'ignored';
      pending = true;

      try {
        let sessionInvalidated = false;

        try {
          await auth.signOut();
          sessionInvalidated = true;
        } catch {
          // A provider/network error is not proof that the local session survived. Supabase may
          // already have removed it and then failed its remote request, so read the actual local
          // auth state before deciding whether protected UI may remain.
          try {
            sessionInvalidated = (await auth.getSession()) === null;
          } catch {
            // If the actual state cannot be confirmed, fail closed: keep the page and its cache.
            sessionInvalidated = false;
          }
        }

        if (!sessionInvalidated) return 'failed';

        // ACC-07 pins this order: auth invalidation first, protected cache second, replacement last.
        queryCache.clear();
        router.replace(LOGOUT_DESTINATION);
        return 'signed-out';
      } finally {
        pending = false;
      }
    },
  };
}

export interface LogoutAction {
  readonly error: string | null;
  readonly isPending: boolean;
  readonly logOut: () => Promise<LogoutResult>;
}

/** One reactive adapter shared by the header menu, mobile presentation, account card and route. */
export function useLogoutAction(): LogoutAction {
  const { getSession, signOut } = useAuth();
  const queryCache = useQueryClient();
  const router = useRouter();
  const [status, setStatus] = useState<'error' | 'idle' | 'pending'>('idle');

  const controller = useMemo(
    () =>
      createLogoutController({
        auth: { getSession, signOut },
        queryCache: { clear: () => queryCache.clear() },
        router: { replace: (href) => router.replace(href) },
      }),
    [getSession, queryCache, router, signOut],
  );

  const logOut = useCallback(async () => {
    if (controller.isPending()) return 'ignored';
    setStatus('pending');
    const result = await controller.run();
    if (result === 'failed') setStatus('error');
    if (result === 'signed-out') setStatus('idle');
    return result;
  }, [controller]);

  return {
    error: status === 'error' ? COPY.logOutError : null,
    isPending: status === 'pending',
    logOut,
  };
}

/**
 * The common final menu row. `preventDefault` keeps the menu mounted while pending and, on an
 * error, leaves the exact retry copy visible. Radix still owns Arrow keys, Enter/Space and Escape.
 */
export function LogoutMenuItem() {
  const logout = useLogoutAction();
  const errorId = useId();

  return (
    <>
      {logout.error === null ? null : (
        <p className="px-md py-sm text-label-md text-error" id={errorId} role="alert">
          {logout.error}
        </p>
      )}
      <DropdownMenuItem
        aria-busy={logout.isPending || undefined}
        aria-describedby={logout.error === null ? undefined : errorId}
        className="justify-center"
        disabled={logout.isPending}
        onSelect={(event) => {
          event.preventDefault();
          void logout.logOut();
        }}
        variant="destructive"
      >
        {logout.isPending ? COPY.loggingOut : COPY.logOut}
      </DropdownMenuItem>
    </>
  );
}
