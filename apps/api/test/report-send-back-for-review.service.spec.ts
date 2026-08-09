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

describe('owner-only validated report recovery', () => {
  it('calls the guarded repository transition and refreshes the owner detail', async () => {
    const repository = {
      sendBackForReview: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReportRepository;
    const service = new ReportService(repository);
    const detail = { id: '10000000-0000-4000-8000-000000000010' };
    vi.spyOn(service, 'get').mockResolvedValue(detail as never);
    const input = { reason: 'Recheck the final severity before reward approval' };

    await expect(service.sendBackForReview(owner, detail.id, input)).resolves.toBe(detail);

    expect(repository.sendBackForReview).toHaveBeenCalledWith(owner, detail.id, input);
    expect(service.get).toHaveBeenCalledWith(owner, detail.id);
  });

  it.each([reviewer, researcher])(
    'rejects %s before touching the repository',
    async (principal) => {
      const repository = { sendBackForReview: vi.fn() } as unknown as ReportRepository;
      const service = new ReportService(repository);

      await expect(
        service.sendBackForReview(principal, '10000000-0000-4000-8000-000000000010', {
          reason: 'Recheck evidence',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repository.sendBackForReview).not.toHaveBeenCalled();
    },
  );
});
