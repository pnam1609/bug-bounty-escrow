'use client';

import { currentUserResponseSchema, type ApplicationRole } from '@bug-bounty-escrow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import { ApiClientError, apiRequest, safeReturnPath } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/**
 * Post-authentication routing, per `docs/flow/onboarding-role-flow-for-figma.md` §6.2.
 *
 * The destination is decided from the server profile and nothing else: never from the form, never
 * from the email address, never from the URL. The form only supplies the access token.
 */

const ROLE_LANDING: Readonly<Record<ApplicationRole, string>> = Object.freeze({
  owner: '/owner/programs',
  researcher: '/programs',
  reviewer: '/review',
});

/**
 * Mirrors the `RoleGuard allow={…}` lists on the protected route groups. Checking here means a
 * `returnTo` the role cannot open sends them to their own landing page instead of flashing a
 * forbidden state on arrival (§3, §6.2 step 5).
 */
const GUARDED_PREFIXES: readonly (readonly [string, readonly ApplicationRole[]])[] = Object.freeze([
  ['/owner', Object.freeze(['owner'] as const)],
  ['/reports', Object.freeze(['researcher'] as const)],
  ['/rewards', Object.freeze(['researcher'] as const)],
  ['/review', Object.freeze(['owner', 'reviewer'] as const)],
]);

function isUnder(path: string, prefix: string): boolean {
  // `/ownership` must not match `/owner`, so only a boundary character continues the segment.
  if (path === prefix) return true;
  const next = path.charAt(prefix.length);
  return path.startsWith(prefix) && (next === '/' || next === '?' || next === '#');
}

/**
 * The allow-list a path's route group enforces, or `null` when the path is not role-guarded.
 * Exported so the ACCESS-01 copy can name the role an area requires without a second prefix table.
 */
export function guardedRolesFor(path: string): readonly ApplicationRole[] | null {
  const guard = GUARDED_PREFIXES.find(([prefix]) => isUnder(path, prefix));
  return guard === undefined ? null : guard[1];
}

/** Exported for the onboarding flow, which routes off the same role/prefix table (§6.2 step 5). */
export function canRoleEnter(role: ApplicationRole, path: string): boolean {
  const roles = guardedRolesFor(path);
  return roles === null || roles.includes(role);
}

/**
 * `safeReturnPath` collapses anything unsafe — absolute, protocol-relative, backslash-escaped —
 * to `/programs`. A value that survives it unchanged is therefore exactly the set of safe internal
 * paths, so the rule is reused rather than restated here.
 */
export function readSafeReturnTo(requested: string | null): string | null {
  if (requested === null || requested === '') return null;
  return safeReturnPath(requested) === requested ? requested : null;
}

export interface AuthRedirect {
  /** Sends a freshly authenticated user to the right place. Rejects if the profile call fails. */
  readonly toWorkspace: (accessToken: string) => Promise<void>;
  /** Raw `returnTo`, already filtered to safe internal paths. Used to keep it across auth links. */
  readonly safeReturnTo: string | null;
}

export function useAuthRedirect(): AuthRedirect {
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = useSearchParams();
  const safeReturnTo = readSafeReturnTo(search.get('returnTo'));

  const toWorkspace = useCallback(
    async (accessToken: string): Promise<void> => {
      let profile;
      try {
        profile = (await apiRequest('/api/me', currentUserResponseSchema, { token: accessToken }))
          .data;
      } catch (error) {
        // The API answers 409 "Profile is not initialized" when the profile row is not there yet.
        // Onboarding is where that gets fixed, so route there rather than failing the sign-in.
        if (error instanceof ApiClientError && error.status === 409) {
          router.replace(withReturnTo('/onboarding', safeReturnTo));
          return;
        }
        throw error;
      }

      queryClient.setQueryData(queryKeys.me(profile.id), profile);

      if (!profile.onboardingComplete) {
        // Keep the journey alive through onboarding: a researcher who was heading to the
        // composer returns there once the profile is complete (onboarding flow §8 example).
        router.replace(withReturnTo('/onboarding', safeReturnTo));
        return;
      }

      const landing = ROLE_LANDING[profile.role];
      router.replace(
        safeReturnTo !== null && canRoleEnter(profile.role, safeReturnTo) ? safeReturnTo : landing,
      );
    },
    [queryClient, router, safeReturnTo],
  );

  return { safeReturnTo, toWorkspace };
}

/** Appends the current safe `returnTo` to the sibling auth route so the journey survives a detour. */
export function withReturnTo(path: string, returnTo: string | null): string {
  if (returnTo === null) return path;
  return `${path}?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * Where onboarding's session-expired `Back to sign in` points (ONB-06S, flow doc §6.8): `/login`,
 * returning to the *current* `/onboarding` visit. Any safe `returnTo` already riding on the
 * onboarding query string is nested inside the destination, so a journey that started at e.g. a
 * report composer still completes after the extra sign-in round trip (§6.2 step 5) instead of
 * being cut down to a bare `/onboarding`. `readSafeReturnTo` re-filters the value, so nothing
 * unsafe on the query string survives into the link.
 */
export function buildSessionExpiredLoginHref(search: string): string {
  const returnTo = readSafeReturnTo(new URLSearchParams(search).get('returnTo'));
  return withReturnTo('/login', withReturnTo('/onboarding', returnTo));
}
