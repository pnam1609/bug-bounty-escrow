import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_TITLE,
  decideRouteAccess,
  forbiddenAccessMessage,
  forbiddenMessageForPath,
  type RouteAccessInput,
} from '../src/components/role-guard-model';

/*
 * ONB-06 §6.9: the four verdicts of the shared route guard — anonymous, authenticated but not
 * onboarded, wrong role, right role — in the contractual order session → onboarding → role.
 * The walk-through example is the flow doc's own: an anonymous click on the report composer.
 */

const composer = '/reports/new?programSlug=aegis-protocol';

/** A signed-in, onboarded researcher standing on the composer route — overridden per case. */
function onComposer(overrides: Partial<RouteAccessInput> = {}): RouteAccessInput {
  return {
    allow: ['researcher'],
    authLoading: false,
    hasSession: true,
    location: composer,
    pathname: '/reports/new',
    profile: { onboardingComplete: true, role: 'researcher' },
    profileError: false,
    profileLoading: false,
    ...overrides,
  };
}

describe('branch 1 — anonymous', () => {
  it('redirects to /login with the internal path and query encoded into returnTo', () => {
    const decision = decideRouteAccess(onComposer({ hasSession: false, profile: undefined }));
    expect(decision).toMatchObject({
      kind: 'redirect-login',
      href: `/login?returnTo=${encodeURIComponent(composer)}`,
    });
    // The doc's literal example: §6.9 spells this exact URL out.
    expect(decision).toHaveProperty(
      'href',
      '/login?returnTo=%2Freports%2Fnew%3FprogramSlug%3Daegis-protocol',
    );
  });

  it('judges the session before anything else, even a stale cached profile', () => {
    const decision = decideRouteAccess(
      onComposer({
        hasSession: false,
        profile: { onboardingComplete: false, role: 'owner' },
      }),
    );
    expect(decision.kind).toBe('redirect-login');
  });

  it('preserves the rewards destination without exposing any reward data', () => {
    const decision = decideRouteAccess(
      onComposer({
        hasSession: false,
        location: '/rewards',
        pathname: '/rewards',
        profile: undefined,
      }),
    );

    expect(decision).toMatchObject({
      kind: 'redirect-login',
      href: '/login?returnTo=%2Frewards',
    });
  });
});

describe('branch 2 — authenticated but not onboarded', () => {
  it('redirects every protected route to /onboarding, carrying the destination', () => {
    const decision = decideRouteAccess(
      onComposer({ profile: { onboardingComplete: false, role: 'researcher' } }),
    );
    expect(decision).toMatchObject({
      kind: 'redirect-onboarding',
      href: `/onboarding?returnTo=${encodeURIComponent(composer)}`,
    });
  });

  it('checks onboarding before role: an unfinished profile is never judged forbidden', () => {
    // The placeholder role would fail `allow`, but §6.9 sends them to onboarding instead.
    const decision = decideRouteAccess(
      onComposer({
        allow: ['owner'],
        location: '/owner/programs',
        pathname: '/owner/programs',
        profile: { onboardingComplete: false, role: 'researcher' },
      }),
    );
    expect(decision.kind).toBe('redirect-onboarding');
  });

  it('does not redirect /onboarding to itself', () => {
    const decision = decideRouteAccess(
      onComposer({
        allow: ['researcher'],
        location: '/onboarding',
        pathname: '/onboarding',
        profile: { onboardingComplete: false, role: 'researcher' },
      }),
    );
    expect(decision.kind).toBe('allow');
  });
});

describe('branch 3 — wrong role', () => {
  it('shows the verbatim ACCESS-01 copy naming the role the area requires', () => {
    const decision = decideRouteAccess(
      onComposer({
        allow: ['owner'],
        location: '/owner/programs',
        pathname: '/owner/programs',
      }),
    );
    expect(decision).toMatchObject({
      kind: 'forbidden',
      title: 'This workspace isn’t available',
      message: 'Your account does not have Program owner access.',
    });
  });

  it('names the researcher requirement for the report surfaces (SR-12)', () => {
    const decision = decideRouteAccess(
      onComposer({ profile: { onboardingComplete: true, role: 'owner' } }),
    );
    expect(decision).toMatchObject({
      kind: 'forbidden',
      title: FORBIDDEN_TITLE,
      message: 'Your account does not have Security researcher access.',
    });
  });

  it('uses the same safe researcher-only guard for the reward dashboard', () => {
    const decision = decideRouteAccess(
      onComposer({
        location: '/rewards',
        pathname: '/rewards',
        profile: { onboardingComplete: true, role: 'owner' },
      }),
    );

    expect(decision).toMatchObject({
      kind: 'forbidden',
      title: FORBIDDEN_TITLE,
      message: 'Your account does not have Security researcher access.',
    });
  });

  it('joins multi-role areas, e.g. the review inbox', () => {
    expect(forbiddenAccessMessage(['owner', 'reviewer'])).toBe(
      'Your account does not have Program owner or Reviewer access.',
    );
  });

  it('derives the same sentence from a blocked path on the /access-denied page', () => {
    // One prefix table drives both the guard and this copy, so the two can never disagree.
    expect(forbiddenMessageForPath('/owner/programs/abc/edit')).toBe(
      'Your account does not have Program owner access.',
    );
    expect(forbiddenMessageForPath(composer)).toBe(
      'Your account does not have Security researcher access.',
    );
    expect(forbiddenMessageForPath('/review')).toBe(
      'Your account does not have Program owner or Reviewer access.',
    );
    expect(forbiddenMessageForPath('/rewards')).toBe(
      'Your account does not have Security researcher access.',
    );
    // `/ownership` is not `/owner`, and an unguarded path names no role at all.
    expect(forbiddenMessageForPath('/ownership')).toBe(
      'Your account does not have the required access.',
    );
    expect(forbiddenMessageForPath(null)).toBe('Your account does not have the required access.');
  });

  it('reveals nothing about the requested resource, and routes the CTA to the viewer’s own landing', () => {
    const requested = '/owner/programs/3f8a1f6e-1111-4222-8333-944445555666/edit';
    const decision = decideRouteAccess(
      onComposer({ allow: ['owner'], location: requested, pathname: requested }),
    );
    if (decision.kind !== 'forbidden') throw new Error(`expected forbidden, got ${decision.kind}`);
    // §3: no leaking whether the resource exists — the copy never echoes the path or its ids.
    expect(decision.title).not.toContain('3f8a1f6e');
    expect(decision.message).not.toContain('3f8a1f6e');
    expect(decision.message).not.toContain(requested);
    // The researcher is offered their own workspace, not the denied one.
    expect(decision.landing).toEqual({ href: '/programs', label: 'Go to researcher workspace' });
  });

  it('denies by default when the profile query settles empty', () => {
    const decision = decideRouteAccess(onComposer({ profile: undefined }));
    expect(decision).toMatchObject({
      kind: 'forbidden',
      title: FORBIDDEN_TITLE,
      landing: { href: '/programs', label: 'Browse programs' },
    });
  });
});

describe('branch 4 — right role', () => {
  it('lets the researcher back into the composer after the round trip', () => {
    expect(decideRouteAccess(onComposer()).kind).toBe('allow');
  });

  it('admits each allowed role of a multi-role area', () => {
    for (const role of ['owner', 'reviewer'] as const) {
      const decision = decideRouteAccess(
        onComposer({
          allow: ['owner', 'reviewer'],
          location: '/review',
          pathname: '/review',
          profile: { onboardingComplete: true, role },
        }),
      );
      expect(decision.kind).toBe('allow');
    }
  });
});

describe('while the profile is unknown', () => {
  it('stays on the full-page loading state while auth is loading', () => {
    const decision = decideRouteAccess(onComposer({ authLoading: true }));
    expect(decision).toEqual({ kind: 'loading', label: 'Checking access…' });
  });

  it('stays loading while the profile query is in flight — never a frame of content', () => {
    const decision = decideRouteAccess(onComposer({ profile: undefined, profileLoading: true }));
    expect(decision.kind).toBe('loading');
  });

  it('surfaces a retryable error state when the profile fetch fails', () => {
    const decision = decideRouteAccess(onComposer({ profile: undefined, profileError: true }));
    expect(decision).toEqual({ kind: 'profile-error' });
  });
});
