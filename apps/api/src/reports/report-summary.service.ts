import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { RequestPrincipal, ResearcherReportSummaryResponse } from '@bug-bounty-escrow/shared';

import { ReportSummaryRepository } from './report-summary.repository.js';

@Injectable()
export class ReportSummaryService {
  public constructor(
    @Inject(ReportSummaryRepository) private readonly repository: ReportSummaryRepository,
  ) {}

  public async getSummary(principal: RequestPrincipal): Promise<ResearcherReportSummaryResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    return {
      success: true,
      data: {
        ...(await this.repository.summarizeForResearcher(principal.userId)),
        paymentToken: 'USDC',
        calculatedAt: new Date().toISOString(),
      },
    };
  }
}
