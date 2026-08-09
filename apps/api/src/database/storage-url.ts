/**
 * Supabase signs storage URLs from the server's API origin. On the VPS that origin is the private
 * `supabase-kong` Docker hostname, which must never be returned to a browser. Keep the signed path
 * and query untouched while replacing only the origin with the public Supabase gateway.
 */
export function publicStorageUrl(url: string, publicSupabaseUrl: string | undefined): string {
  if (publicSupabaseUrl === undefined) {
    return url;
  }

  try {
    const signed = new URL(url);
    const publicOrigin = new URL(publicSupabaseUrl);
    const basePath = publicOrigin.pathname.replace(/\/$/, '');

    signed.protocol = publicOrigin.protocol;
    signed.hostname = publicOrigin.hostname;
    signed.port = publicOrigin.port;
    signed.pathname = `${basePath}${signed.pathname}`;

    return signed.toString();
  } catch {
    // A malformed provider URL should not turn a successful API response into a crash. The
    // Supabase client normally returns an absolute URL; retain it for the caller to report.
    return url;
  }
}
