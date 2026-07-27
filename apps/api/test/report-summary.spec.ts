import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReportSummaryRepository } from '../src/reports/report-summary.repository.js';
import { ReportSummaryService } from '../src/reports/report-summary.service.js';

const researcher = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};

function repositoryFor(row: {
  readonly all_reports: string | number;
  readonly needs_information: string | number;
  readonly under_review: string | number;
  readonly rewards_paid: string | number;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });

  return {
    rpc,
    repository: new ReportSummaryRepository({ rpc } as never),
  };
}

describe('MR-01 researcher report summary dependency', () => {
  it('uses the database aggregate result rather than a paginated report slice', async () => {
    const fixture = repositoryFor({
      all_reports: '1007',
      needs_information: '17',
      under_review: '88',
      rewards_paid: '1249.750000',
    });

    await expect(fixture.repository.summarizeForResearcher(researcher.userId)).resolves.toEqual({
      allReports: 1007,
      needsInformation: 17,
      underReview: 88,
      rewardsPaid: '1249.750000',
    });
  });

  it('derives the privacy boundary from the authenticated principal only', async () => {
    const fixture = repositoryFor({
      all_reports: 0,
      needs_information: 0,
      under_review: 0,
      rewards_paid: 0,
    });
    const service = new ReportSummaryService(fixture.repository);

    const response = await service.getSummary(researcher);

    expect(fixture.rpc).toHaveBeenCalledOnce();
    expect(fixture.rpc).toHaveBeenCalledWith('researcher_report_summary', {
      actor_id: researcher.userId,
    });
    expect(response.data).toMatchObject({
      allReports: 0,
      needsInformation: 0,
      underReview: 0,
      rewardsPaid: '0.000000',
      paymentToken: 'USDC',
    });
    expect(new Date(response.data.calculatedAt).toISOString()).toBe(response.data.calculatedAt);
  });

  it('rejects non-researcher principals before querying report data', async () => {
    const repository = {
      summarizeForResearcher: vi.fn(),
    };
    const service = new ReportSummaryService(repository as never);

    await expect(service.getSummary({ ...researcher, role: 'owner' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.summarizeForResearcher).not.toHaveBeenCalled();
  });
});
