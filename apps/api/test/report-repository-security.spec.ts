import { describe, expect, it, vi } from 'vitest';

import { ReportRepository } from '../src/reports/report.repository.js';

const principal = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};

describe('report repository storage boundary', () => {
  it('uses the server RPC canonical path for signed upload creation', async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.test/upload?token=private' },
      error: null,
    });
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: 'report-id/server-generated-object-id',
        error: null,
      }),
      storage: {
        from: vi.fn().mockReturnValue({ createSignedUploadUrl }),
      },
    };
    const repository = new ReportRepository(client as never);
    const result = await repository.createUploadUrl(
      principal,
      '10000000-0000-4000-8000-000000000100',
      {
        filename: 'proof.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
      },
    );

    expect(client.rpc).toHaveBeenCalledWith(
      'prepare_report_attachment_atomic',
      expect.objectContaining({
        actor_id: principal.userId,
        target_report_id: '10000000-0000-4000-8000-000000000100',
        filename: 'proof.txt',
      }),
    );
    // upsert lets the SR-09 retry re-sign the same object instead of duplicating the attachment.
    expect(createSignedUploadUrl).toHaveBeenCalledWith('report-id/server-generated-object-id', {
      upsert: true,
    });
    expect(result).not.toHaveProperty('storagePath');
  });

  it('does not touch Storage for a cross-report or inaccessible download', async () => {
    const storageFrom = vi.fn();
    const repository = new ReportRepository({
      storage: { from: storageFrom },
    } as never);
    vi.spyOn(repository, 'findAccessible').mockResolvedValue(null);

    await expect(
      repository.createDownloadUrl(
        principal,
        '10000000-0000-4000-8000-000000000100',
        '10000000-0000-4000-8000-000000000200',
      ),
    ).resolves.toBeNull();
    expect(storageFrom).not.toHaveBeenCalled();
  });
});
