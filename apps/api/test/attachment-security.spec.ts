import { MAX_UPLOAD_SIZE_BYTES, attachmentUploadRequestSchema } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

describe('attachment boundary validation', () => {
  it.each(['../secret.txt', '..\\secret.txt', '/absolute.txt', 'folder/file.txt'])(
    'rejects traversal or caller-controlled paths: %s',
    (filename) => {
      expect(
        attachmentUploadRequestSchema.safeParse({
          filename,
          mimeType: 'text/plain',
          sizeBytes: 100,
        }).success,
      ).toBe(false);
    },
  );

  it('rejects invalid MIME and oversized objects', () => {
    expect(
      attachmentUploadRequestSchema.safeParse({
        filename: 'payload.exe',
        mimeType: 'application/octet-stream',
        sizeBytes: 100,
      }).success,
    ).toBe(false);
    expect(
      attachmentUploadRequestSchema.safeParse({
        filename: 'large.pdf',
        mimeType: 'application/pdf',
        sizeBytes: MAX_UPLOAD_SIZE_BYTES + 1,
      }).success,
    ).toBe(false);
  });
});
