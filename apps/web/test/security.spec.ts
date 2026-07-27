import { attachmentUploadRequestSchema, onboardingRequestSchema } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

describe('browser security boundaries', () => {
  it('never offers reviewer as a self-assignable role', () => {
    expect(
      onboardingRequestSchema.safeParse({
        role: 'reviewer',
        displayName: 'Reviewer',
      }).success,
    ).toBe(false);
  });

  it('blocks traversal, invalid MIME and oversized upload metadata before requesting a URL', () => {
    expect(
      attachmentUploadRequestSchema.safeParse({
        filename: '../escape',
        mimeType: 'application/octet-stream',
        sizeBytes: 99_999_999,
      }).success,
    ).toBe(false);
  });
});
