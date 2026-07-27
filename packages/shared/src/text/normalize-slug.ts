/**
 * Produces a lowercase, hyphen-delimited slug from ASCII input.
 *
 * Non-ASCII characters are treated as separators rather than transliterated.
 * Inputs containing no supported letters or digits normalize to an empty string.
 */
export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
