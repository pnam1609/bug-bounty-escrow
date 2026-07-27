'use client';

import type { ApplicationRole } from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { decideRouteAccess } from './role-guard-model';
import { ErrorState, LoadingState } from './states';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useAuth } from '@/providers/auth-provider';

/**
 * `usePathname` drops the query string, but e.g. `/reports/new?programId=…` must survive the
 * sign-in round trip — the anonymous `Submit a private report` CTA has to come back to the same
 * composer (submit-bug flow §2, onboarding flow §8). Reading `window.location.search` is safe
 * here: callers only run this after mount, never during server rendering.
 */
function currentLocation(pathname: string): string {
  return typeof window === 'undefined' ? pathname : `${pathname}${window.location.search}`;
}

/**
 * Route-specific stand-ins for the two waiting-room states, for screens the flow docs give their
 * own copy — e.g. account settings, whose ACC-00 skeleton and ACC-05/ACC-06 recovery copy are
 * pinned by `docs/flow/account-settings-researcher-flow-for-figma.md` §8.
 *
 * Only these two are overridable: the redirects and the ACCESS-01 forbidden surface are the guard's
 * security answer and stay identical everywhere. Omit either and the shared surface is used, so no
 * existing route changes.
 */
export interface RoleGuardFallback {
  /** Route-specific forbidden copy/action. It still replaces children completely. */
  readonly forbidden?: ReactNode | undefined;
  /** Shown while the session and profile settle, and during the redirect to sign in. */
  readonly loading?: ReactNode | undefined;
  /** Shown when `GET /api/me` fails. Read the `me` query directly for the reason and the retry. */
  readonly profileError?: ReactNode | undefined;
}

/**
 * The shared protected-route gate (flow doc §3, §6.9). All judgement lives in
 * `decideRouteAccess` — session first, then onboarding, then role, each read from the server
 * profile — so this component only maps the decision onto redirects and the ACCESS-01 surfaces.
 * `children` render on `allow` and nothing else: no branch below ever paints protected content.
 */
export function RoleGuard({
  allow,
  children,
  fallback,
}: {
  readonly allow: readonly ApplicationRole[];
  readonly children: ReactNode;
  readonly fallback?: RoleGuardFallback | undefined;
}) {
  const { loading, session } = useAuth();
  const user = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();

  const decision = decideRouteAccess({
    allow,
    authLoading: loading,
    hasSession: session !== null,
    location: currentLocation(pathname),
    pathname,
    profile: user.data,
    profileError: user.isError,
    profileLoading: user.isLoading,
  });

  const loginHref = decision.kind === 'redirect-login' ? decision.href : null;
  useEffect(() => {
    if (loginHref !== null) router.replace(loginHref);
  }, [loginHref, router]);

  switch (decision.kind) {
    case 'loading':
    case 'redirect-login':
      // A route's own waiting surface, when it has one, keeps the layout it is about to fill —
      // but it is still a surface that paints no protected content, exactly like the shared one.
      return fallback?.loading ?? <LoadingState label={decision.label} />;
    case 'profile-error':
      return (
        fallback?.profileError ?? (
          <ErrorState
            message="Your profile could not be loaded."
            retry={() => void user.refetch()}
          />
        )
      );
    case 'redirect-onboarding':
      router.replace(decision.href);
      return <LoadingState label={decision.label} />;
    case 'forbidden':
      // ACCESS-01 rendered in place: the URL stays put, nothing behind the route is fetched, and
      // the copy names only the role the area requires — never the resource behind it (§3).
      return fallback?.forbidden ?? (
        <ErrorState
          title={decision.title}
          message={decision.message}
          action={
            <Button asChild>
              <Link href={decision.landing.href}>{decision.landing.label}</Link>
            </Button>
          }
        />
      );
    case 'allow':
      return children;
  }
}
