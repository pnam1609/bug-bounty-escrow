import { describe, expect, it, vi } from 'vitest';

import {
  AttachmentCleanupService,
  type AttachmentCleanupGateway,
} from '../src/storage/attachment-cleanup.service.js';
import { parseCleanupEnvironment } from '../scripts/cleanup-attachments.js';

function gateway(): AttachmentCleanupGateway {
  return {
    listStoredObjects: vi.fn().mockResolvedValue([
      { name: 'report-a/old.txt', createdAt: '2026-07-01T00:00:00.000Z' },
      { name: 'report-b/old.txt', createdAt: '2026-07-01T00:00:00.000Z' },
      { name: 'report-c/new.txt', createdAt: '2026-07-25T07:00:00.000Z' },
    ]),
    listReferencedPaths: vi.fn().mockResolvedValue(['report-a/old.txt']),
    removeObjects: vi.fn().mockResolvedValue(undefined),
  };
}

describe('attachment orphan cleanup', () => {
  it('is dry-run first and never selects referenced or unexpired objects', async () => {
    const mock = gateway();
    const result = await new AttachmentCleanupService(mock).run({
      dryRun: true,
      expireBefore: new Date('2026-07-25T06:00:00.000Z'),
    });

    expect(result.candidates).toEqual(['report-b/old.txt']);
    expect(result.deleted).toBe(0);
    expect(mock.removeObjects).not.toHaveBeenCalled();
  });

  it('deletes only the already filtered candidates in execute mode', async () => {
    const mock = gateway();
    const result = await new AttachmentCleanupService(mock).run({
      dryRun: false,
      expireBefore: new Date('2026-07-25T06:00:00.000Z'),
    });

    expect(mock.removeObjects).toHaveBeenCalledWith('report-attachments', ['report-b/old.txt']);
    expect(result.deleted).toBe(1);
  });

  it('requires explicit non-production mutation confirmation', () => {
    const base = {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
    };

    expect(parseCleanupEnvironment(base).dryRun).toBe(true);
    expect(() =>
      parseCleanupEnvironment({
        ...base,
        ATTACHMENT_CLEANUP_EXECUTE: 'true',
      }),
    ).toThrow('ATTACHMENT_CLEANUP_CONFIRM');
    expect(() =>
      parseCleanupEnvironment({
        ...base,
        NODE_ENV: 'production',
        ATTACHMENT_CLEANUP_EXECUTE: 'true',
        ATTACHMENT_CLEANUP_CONFIRM: 'DELETE_ORPHAN_ATTACHMENTS',
      }),
    ).toThrow('disabled in production');
  });
});
