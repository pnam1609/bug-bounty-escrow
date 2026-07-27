import { Controller, Get, Inject, UnauthorizedException } from '@nestjs/common';
import {
  researcherReportSummaryResponseSchema,
  type RequestPrincipal,
  type ResearcherReportSummaryResponse,
} from '@bug-bounty-escrow/shared';

import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiZodResponse } from '../openapi/zod-openapi.js';
import { ReportSummaryService } from './report-summary.service.js';

@Controller('reports')
export class ReportSummaryController {
  public constructor(
    @Inject(ReportSummaryService) private readonly service: ReportSummaryService,
  ) {}

  @Roles('researcher')
  @Get('summary')
  @ApiZodResponse(
    200,
    'Whole-result-set report metrics for the authenticated researcher',
    researcherReportSummaryResponseSchema,
  )
  public getSummary(
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ResearcherReportSummaryResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return this.service.getSummary(principal);
  }
}
