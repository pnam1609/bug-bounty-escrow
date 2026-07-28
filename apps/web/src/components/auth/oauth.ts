import { withReturnTo } from './use-auth-redirect';

export const GOOGLE_OAUTH_CALLBACK_PATH = '/auth/callback';

/**
 * Supabase must redirect to an absolute allow-listed URL. `returnTo` has already passed the auth
 * flow's same-origin path filter before it reaches this helper, and is carried through the callback
 * so social sign-in preserves the journey just like email/password sign-in.
 */
export function buildGoogleOAuthCallbackUrl(origin: string, returnTo: string | null): string {
  return new URL(withReturnTo(GOOGLE_OAUTH_CALLBACK_PATH, returnTo), origin).toString();
}

/** Google or Supabase may place an OAuth failure in either the query string or URL fragment. */
export function hasOAuthCallbackFailure(search: string, hash: string): boolean {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return query.has('error') || query.has('error_description') || fragment.has('error_description');
}
