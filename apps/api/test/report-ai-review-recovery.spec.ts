import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReportService } from '../src/reports/report.service.js';

const researcher = {
  userId: '10000000-0000-4000-8000-000000000002',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};

const report = {
  id: '10000000-0000-4000-8000-000000000300',
  programId: '10000000-0000-4000-8000-000000000100',
  contentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

describe('ReportService AI review recovery', () => {
  it('requeues the current revision and returns the persisted processing projection', async () => {
    const repository = {
      findAccessible: vi.fn().mockResolvedValue(report),
    };
    const aiReviewRepository = {
      retryReview: vi.fn().mockResolvedValue('10000000-0000-4000-8000-000000000301'),
      getReview: vi.fn().mockResolvedValue({ status: 'processing' }),
    };
    const service = new ReportService(repository as never, aiReviewRepository as never);

    await expect(service.generateAiReview(researcher, report.id, {})).resolves.toEqual({
      ...report,
      aiReview: { status: 'processing' },
    });
    expect(aiReviewRepository.retryReview).toHaveBeenCalledWith(
      report.id,
      report.programId,
      report.contentHash,
    );
    expect(repository.findAccessible).toHaveBeenCalledTimes(2);
  });

  it('does not permit unauthorized roles to enqueue recovery', async () => {
    const repository = { findAccessible: vi.fn() };
    const service = new ReportService(repository as never, {} as never);
    const admin = { ...researcher, role: 'admin' as const } as never;

    await expect(service.generateAiReview(admin, report.id, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.findAccessible).not.toHaveBeenCalled();
  });

  it('does not reveal inaccessible reports', async () => {
    const repository = { findAccessible: vi.fn().mockResolvedValue(null) };
    const service = new ReportService(repository as never, {} as never);

    await expect(service.generateAiReview(researcher, report.id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('fails clearly when the queue adapter is unavailable', async () => {
    const repository = { findAccessible: vi.fn().mockResolvedValue(report) };
    const service = new ReportService(repository as never);

    await expect(service.generateAiReview(researcher, report.id, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps an unexpected queue failure to an actionable unavailable response', async () => {
    const repository = { findAccessible: vi.fn().mockResolvedValue(report) };
    const aiReviewRepository = {
      retryReview: vi.fn().mockRejectedValue(new Error('connection reset')),
    };
    const service = new ReportService(repository as never, aiReviewRepository as never);

    await expect(service.generateAiReview(researcher, report.id, {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
