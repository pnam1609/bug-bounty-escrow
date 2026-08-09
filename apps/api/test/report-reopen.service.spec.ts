import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReportRepository } from '../src/reports/report.repository.js';
import { ReportService } from '../src/reports/report.service.js';

const owner = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: 'owner' as const,
};
const reviewer = {
  ...owner,
  userId: '10000000-0000-4000-8000-000000000002',
  role: 'reviewer' as const,
};
const researcher = {
  ...owner,
  userId: '10000000-0000-4000-8000-000000000003',
  role: 'researcher' as const,
};

describe('owner-only duplicate reopen', () => {
  it('calls the guarded repository transition and refreshes the detail for the owner', async () => {
    const repository = {
      reopenDuplicate: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReportRepository;
    const service = new ReportService(repository);
    const detail = { id: '10000000-0000-4000-8000-000000000010' };
    vi.spyOn(service, 'get').mockResolvedValue(detail as never);

    await expect(
      service.reopenDuplicate(owner, detail.id, { reason: 'Recheck the duplicate evidence' }),
    ).resolves.toBe(detail);

    expect(repository.reopenDuplicate).toHaveBeenCalledWith(owner, detail.id, {
      reason: 'Recheck the duplicate evidence',
    });
    expect(service.get).toHaveBeenCalledWith(owner, detail.id);
  });

  it.each([reviewer, researcher])(
    'rejects %s before touching the repository',
    async (principal) => {
      const repository = { reopenDuplicate: vi.fn() } as unknown as ReportRepository;
      const service = new ReportService(repository);

      await expect(
        service.reopenDuplicate(principal, '10000000-0000-4000-8000-000000000010', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.reopenDuplicate).not.toHaveBeenCalled();
    },
  );
});
