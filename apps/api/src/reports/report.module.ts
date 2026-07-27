import { Module } from '@nestjs/common';

import { CollaborationController } from './collaboration.controller.js';
import {
  ProgramDisclosureController,
  ProgramReportController,
  ReportController,
} from './report.controller.js';
import { ReportRepository } from './report.repository.js';
import { ReportSummaryController } from './report-summary.controller.js';
import { ReportSummaryRepository } from './report-summary.repository.js';
import { ReportSummaryService } from './report-summary.service.js';
import { ReportService } from './report.service.js';

@Module({
  controllers: [
    ReportSummaryController,
    ReportController,
    ProgramReportController,
    ProgramDisclosureController,
    CollaborationController,
  ],
  providers: [ReportRepository, ReportService, ReportSummaryRepository, ReportSummaryService],
  exports: [ReportRepository, ReportService, ReportSummaryRepository, ReportSummaryService],
})
export class ReportModule {}
