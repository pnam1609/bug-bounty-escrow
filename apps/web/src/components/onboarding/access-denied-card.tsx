'use client';

import { Button, Card } from '@bug-bounty-escrow/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { BrandLockup, ShortFooter } from './onboarding-shell';
import { ROLE_LANDING_PATHS, ROLE_WORKSPACE_LABELS, SUPPORT_HREF } from './role-options';
import { useCurrentUser } from '@/hooks/use-current-user';
import { FORBIDDEN_TITLE, forbiddenMessageForPath } from '@/components/role-guard-model';
import { safeReturnPath } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';

/*
 * ACCESS-01 · Forbidden (82:414).
 *
 * §3 forbids leaking whether a resource exists, so this screen never fetches the route the user
 * asked for — it only echoes the path back. Heading and body are the verbatim ACCESS-01 copy
 * (SR-12/CP-09) from `role-guard-model`, naming the role the blocked *area* requires; the CTA's
 * own-workspace destination comes from `GET /api/me`, never from the URL.
 */

function ForbiddenFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col bg-background">
      <div className="px-2xl py-xl">
        <Link href="/" className="inline-flex rounded-md">
          <BrandLockup />
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-xl pb-3xl">
        {/* 620px content column, node 82:415. */}
        <div className="w-full max-w-[620px]">{children}</div>
      </div>
      <ShortFooter />
    </div>
  );
}

export function AccessDeniedCard() {
  const auth = useAuth();
  const user = useCurrentUser();
  const search = useSearchParams();

  const rawFrom = search.get('from');
  // Only echo a path that is already safe to navigate to; anything else is dropped rather than
  // rendered back to the user.
  const requestedPath = rawFrom !== null && safeReturnPath(rawFrom) === rawFrom ? rawFrom : null;

  const isBootstrapping = auth.loading || (auth.session !== null && user.isLoading);

  return (
    <ForbiddenFrame>
      <Card padding="lg" className="items-center gap-xl text-center">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full border border-error text-error"
        >
          <CircleAlert className="size-8" />
        </span>

        {isBootstrapping ? (
          <p role="status" className="text-body-sm text-text-muted">
            Checking access…
          </p>
        ) : auth.session === null || user.data === undefined ? (
          <>
            <h1 className="text-h1 text-text">{FORBIDDEN_TITLE}</h1>
            <p className="text-body text-text-muted">
              Sign in to see which workspace your account has access to.
            </p>
            {requestedPath === null ? null : (
              <p className="text-label-md text-text-muted">Requested route: {requestedPath}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-md">
              <Button size="lg" asChild>
                <Link href={`/login?returnTo=${encodeURIComponent(requestedPath ?? '/programs')}`}>
                  Sign in
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-h1 text-text">{FORBIDDEN_TITLE}</h1>
            <p className="text-body text-text-muted">{forbiddenMessageForPath(requestedPath)}</p>
            {requestedPath === null ? null : (
              <p className="text-label-md text-text-muted">Requested route: {requestedPath}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-md">
              <Button variant="ghost" size="lg" asChild>
                <Link href={SUPPORT_HREF}>Contact support</Link>
              </Button>
              <Button size="lg" asChild>
                <Link href={ROLE_LANDING_PATHS[user.data.role]}>
                  Go to {ROLE_WORKSPACE_LABELS[user.data.role]}
                </Link>
              </Button>
            </div>
          </>
        )}
      </Card>
    </ForbiddenFrame>
  );
}
