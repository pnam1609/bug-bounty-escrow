import { describe, expect, it } from 'vitest';

import {
  buildSessionExpiredLoginHref,
  canRoleEnter,
  readSafeReturnTo,
  withReturnTo,
} from '../src/components/auth/use-auth-redirect';

/*
 * PG-DETAIL §8: an anonymous `Submit a private report` click must survive the sign-in (and, for
 * a new account, onboarding) round trip and land back on `/reports/new?programSlug=…` — but only
 * for a researcher. These are the pure rules that journey rides on.
 */
describe('submit CTA sign-in round trip', () => {
  const composer = '/reports/new?programSlug=aegis-protocol';

  it('keeps the composer path together with its programSlug query', () => {
    expect(readSafeReturnTo(composer)).toBe(composer);
  });

  it('lets a researcher return to the composer but never an owner or reviewer', () => {
    expect(canRoleEnter('researcher', composer)).toBe(true);
    expect(canRoleEnter('owner', composer)).toBe(false);
    expect(canRoleEnter('reviewer', composer)).toBe(false);
  });

  it('drops external or malformed return targets', () => {
    expect(readSafeReturnTo('https://evil.test/reports/new')).toBeNull();
    expect(readSafeReturnTo('//evil.test')).toBeNull();
    expect(readSafeReturnTo('/\\evil')).toBeNull();
    expect(readSafeReturnTo(null)).toBeNull();
  });

  it('threads the destination through the onboarding hand-off URL', () => {
    expect(withReturnTo('/onboarding', composer)).toBe(
      `/onboarding?returnTo=${encodeURIComponent(composer)}`,
    );
    expect(withReturnTo('/onboarding', null)).toBe('/onboarding');
  });
});

/*
 * ONB-06S: when the session expires mid-onboarding, `Back to sign in` must return the user to the
 * *current* onboarding visit — including any composer `returnTo` riding on its query string — not
 * to a bare `/onboarding` that severs the journey (flow doc §6.2 step 5, §6.8).
 */
describe('session-expired sign-in link', () => {
  const composer = '/reports/new?programSlug=aegis-protocol';

  it('falls back to plain onboarding when nothing rides on the URL', () => {
    expect(buildSessionExpiredLoginHref('')).toBe('/login?returnTo=%2Fonboarding');
  });

  it('nests the composer destination so it survives the login round trip', () => {
    const href = buildSessionExpiredLoginHref(`?returnTo=${encodeURIComponent(composer)}`);
    const outer = new URL(href, 'https://web.test');
    expect(outer.pathname).toBe('/login');

    const destination = outer.searchParams.get('returnTo') ?? '';
    expect(destination).toBe(`/onboarding?returnTo=${encodeURIComponent(composer)}`);
    // The intermediate hop is itself a safe internal path, and it unwraps back to the composer.
    expect(readSafeReturnTo(destination)).toBe(destination);
    expect(new URL(destination, 'https://web.test').searchParams.get('returnTo')).toBe(composer);
  });

  it('drops unsafe values instead of carrying them through login', () => {
    expect(buildSessionExpiredLoginHref('?returnTo=https%3A%2F%2Fevil.test')).toBe(
      '/login?returnTo=%2Fonboarding',
    );
    expect(buildSessionExpiredLoginHref('?returnTo=%2F%2Fevil.test')).toBe(
      '/login?returnTo=%2Fonboarding',
    );
  });
});
