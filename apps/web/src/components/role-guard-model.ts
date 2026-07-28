import type { ApplicationRole } from '@bug-bounty-escrow/shared';

import { guardedRolesFor, withReturnTo } from './auth/use-auth-redirect';
import { ROLE_LABELS, ROLE_LANDING_PATHS, ROLE_WORKSPACE_LABELS } from './onboarding/role-options';

/*
 * The route-guard decision, extracted from `RoleGuard` so the four-way matrix — anonymous, not
 * onboarded, wrong role, right role — is a pure function under unit test rather than logic that
 * only a browser can exercise.
 *
 * The order is contractual (`docs/flow/onboarding-role-flow-for-figma.md` §3, §6.9) and must not
 * be reshuffled: session first, then onboarding, then role. Everything the decision reads comes
 * from the server profile (`GET /api/me`); no client-supplied role is ever an input here.
 */

export interface RouteAccessInput {
  /** Roles the server profile must hold for this route group. */
  readonly allow: readonly ApplicationRole[];
  readonly authLoading: boolean;
  readonly hasSession: boolean;
  /** Current internal path *plus query string* — what `returnTo` must bring the user back to. */
  readonly location: string;
  /** Path only. The `/onboarding` route itself is exempt from the onboarding redirect. */
  readonly pathname: string;
  /** The server profile, or `undefined` until it is known. Never a client-asserted role. */
  readonly profile:
    { readonly onboardingComplete: boolean; readonly role: ApplicationRole } | undefined;
  readonly profileError: boolean;
  readonly profileLoading: boolean;
}

export interface ForbiddenLanding {
  readonly href: string;
  readonly label: string;
}

export type RouteAccessDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'forbidden';
      readonly landing: ForbiddenLanding;
      readonly message: string;
      readonly title: string;
    }
  | { readonly kind: 'loading'; readonly label: string }
  | { readonly kind: 'profile-error' }
  | { readonly kind: 'redirect-login'; readonly href: string; readonly label: string }
  | { readonly kind: 'redirect-onboarding'; readonly href: string; readonly label: string };

/** ACCESS-01 heading, verbatim from the flow docs (SR-12, CP-09) — typographic apostrophe. */
export const FORBIDDEN_TITLE = 'This workspace isn’t available';

/**
 * `Your account does not have <Role> access.` where `<Role>` names the role the *area* requires
 * (SR-12: "Security researcher", CP-09: "Program owner") — never the resource behind the route,
 * so the copy cannot leak whether that resource exists (§3).
 */
export function forbiddenAccessMessage(allow: readonly ApplicationRole[]): string {
  const labels = Array.from(new Set(allow), (role) => ROLE_LABELS[role]);
  const requirement = labels.length === 0 ? 'the required' : labels.join(' or ');
  return `Your account does not have ${requirement} access.`;
}

/**
 * The same sentence for surfaces that only know the blocked *path* — the `/access-denied` page —
 * derived from the shared guarded-prefix table, so the named role can never drift from what the
 * route group actually enforces. An unguarded or unknown path yields the generic requirement.
 */
export function forbiddenMessageForPath(path: string | null): string {
  return forbiddenAccessMessage(path === null ? [] : (guardedRolesFor(path) ?? []));
}

/**
 * The one CTA on the forbidden state (SR-12): the viewer's own role landing when the profile is
 * known, otherwise the public program list. Both destinations are theirs already — the CTA never
 * points into the area that was just denied.
 */
function forbiddenLanding(role: ApplicationRole | undefined): ForbiddenLanding {
  if (role === undefined) return { href: '/programs', label: 'Browse programs' };
  return { href: ROLE_LANDING_PATHS[role], label: `Go to ${ROLE_WORKSPACE_LABELS[role]}` };
}

function forbidden(
  allow: readonly ApplicationRole[],
  role: ApplicationRole | undefined,
): RouteAccessDecision {
  return {
    kind: 'forbidden',
    landing: forbiddenLanding(role),
    message: forbiddenAccessMessage(allow),
    title: FORBIDDEN_TITLE,
  };
}

export function decideRouteAccess(input: RouteAccessInput): RouteAccessDecision {
  const { allow, authLoading, hasSession, location, pathname, profile } = input;

  // Until the session and profile are settled, the only honest answer is a full-page loading
  // state — never a frame of protected content, and never a premature verdict (§3).
  if (authLoading || (hasSession && input.profileLoading)) {
    return { kind: 'loading', label: 'Checking access…' };
  }
  if (!hasSession) {
    // Anonymous: sign in first, carrying the full internal location (path + query) so e.g.
    // `/reports/new?programSlug=…` survives the round trip (§6.9).
    return {
      kind: 'redirect-login',
      href: withReturnTo('/login', location),
      label: 'Redirecting to sign in…',
    };
  }
  if (input.profileError) return { kind: 'profile-error' };
  if (profile === undefined) {
    // A settled query with no profile grants nothing: deny by default.
    return forbidden(allow, undefined);
  }
  // §6.9 orders the checks "onboarding, then role": before onboarding completes the profile's role
  // is only a placeholder, so judging `allow` against it would flash a forbidden state at someone
  // who simply has not chosen an account type yet. Every protected route funnels them to
  // `/onboarding` instead (§3), and the guarded destination rides along so finishing setup lands
  // back here — e.g. the composer the researcher was heading to — not the generic role landing.
  if (!profile.onboardingComplete && pathname !== '/onboarding') {
    return {
      kind: 'redirect-onboarding',
      href: withReturnTo('/onboarding', location),
      label: 'Finishing account setup…',
    };
  }
  if (!allow.includes(profile.role)) return forbidden(allow, profile.role);

  return { kind: 'allow' };
}
