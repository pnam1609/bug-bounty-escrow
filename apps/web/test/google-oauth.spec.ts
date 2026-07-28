import { describe, expect, it } from 'vitest';

import {
  buildGoogleOAuthCallbackUrl,
  GOOGLE_OAUTH_CALLBACK_PATH,
  hasOAuthCallbackFailure,
} from '../src/components/auth/oauth';

describe('Google OAuth callback URL', () => {
  it('uses the allow-listed callback path when no protected destination is pending', () => {
    expect(buildGoogleOAuthCallbackUrl('http://localhost:3000', null)).toBe(
      `http://localhost:3000${GOOGLE_OAUTH_CALLBACK_PATH}`,
    );
  });

  it('preserves a safe returnTo journey through the provider round trip', () => {
    const returnTo = '/reports/new?programSlug=aegis-protocol';
    const callback = new URL(buildGoogleOAuthCallbackUrl('http://127.0.0.1:3000', returnTo));

    expect(callback.pathname).toBe(GOOGLE_OAUTH_CALLBACK_PATH);
    expect(callback.searchParams.get('returnTo')).toBe(returnTo);
  });
});

describe('Google OAuth callback failures', () => {
  it('recognizes provider failures in either the query or URL fragment', () => {
    expect(hasOAuthCallbackFailure('?error=access_denied', '')).toBe(true);
    expect(hasOAuthCallbackFailure('', '#error_description=Access+denied')).toBe(true);
  });

  it('does not mistake a normal returnTo query for an OAuth failure', () => {
    expect(hasOAuthCallbackFailure('?returnTo=%2Fprograms', '')).toBe(false);
  });
});
