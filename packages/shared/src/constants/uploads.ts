export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export const SAFE_UPLOAD_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type SafeUploadMimeType = (typeof SAFE_UPLOAD_MIME_TYPES)[number];
