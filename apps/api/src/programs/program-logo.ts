import type { SupabaseClient } from '@supabase/supabase-js';

export const PROGRAM_LOGO_BUCKET = 'program-logos';

/**
 * Object key layout enforced by the `program_logo_objects_write_owner` storage policy:
 * `programs/<programId>/<filename>`.
 */
export function buildLogoStoragePath(programId: string, filename: string): string {
  return `programs/${programId}/${filename}`;
}

/**
 * The logo bucket is public-read on purpose (see the STO-003 migration comment), so a listing can
 * render every row's logo without signing one URL per row. Callers must still only pass paths
 * belonging to a program the requester is allowed to see.
 */
export function publicLogoUrl(
  client: SupabaseClient,
  storagePath: string | null,
): string | undefined {
  if (storagePath === null || storagePath.length === 0) {
    return undefined;
  }

  const { data } = client.storage.from(PROGRAM_LOGO_BUCKET).getPublicUrl(storagePath);

  return data.publicUrl;
}
