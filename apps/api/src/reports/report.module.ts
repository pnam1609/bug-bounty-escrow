import { Module } from '@nestjs/common';
import { API_CONFIG } from '../config/api-config.module.js';
import { AppLogger } from '../logging/app-logger.service.js';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';
import { AiReviewWorker, createTriageProvider, type AiProviderName } from '@bug-bounty-escrow/ai';

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
import { SupabaseAiReviewQueueRepository } from './ai-review.repository.js';
import { AiReviewWorkerRunner } from './ai-review.worker-runner.js';
import { AI_REVIEW_WORKER } from './ai-review.tokens.js';

function createWorker(
  config: ApiEnvironment,
  queue: SupabaseAiReviewQueueRepository,
  logger: AppLogger,
): AiReviewWorker {
  const providerName: AiProviderName =
    config.AI_PROVIDER === 'gemini'
      ? 'gemini'
      : config.AI_PROVIDER === 'deepseek'
        ? 'deepseek'
        : 'mock';
  const providerKey = providerName === 'gemini' ? config.GEMINI_API_KEY : config.DEEPSEEK_API_KEY;
  const provider =
    config.AI_PROVIDER === 'disabled'
      ? null
      : createTriageProvider({
          provider: providerName,
          ...(providerKey === undefined ? {} : { apiKey: providerKey }),
          ...(config.AI_MODEL === undefined ? {} : { model: config.AI_MODEL }),
          ...(config.AI_API_BASE_URL === undefined ? {} : { baseUrl: config.AI_API_BASE_URL }),
          privacyMode: config.AI_PRIVACY_MODE,
          timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
          maxRetries: config.AI_MAX_RETRIES,
        });
  queue.configureProvider(provider?.name ?? 'disabled', provider?.model ?? 'disabled');
  return new AiReviewWorker(queue, provider, {
    privacyMode: config.AI_PRIVACY_MODE,
    onMetric: (event) =>
      logger.info(
        {
          aiProvider: event.provider,
          aiPhase: event.phase,
          aiOutcome: event.outcome,
          aiDurationMs: event.durationMs,
          ...(event.errorCode === undefined ? {} : { aiErrorCode: event.errorCode }),
        },
        'AI review telemetry',
      ),
  });
}

@Module({
  controllers: [
    ReportSummaryController,
    ReportController,
    ProgramReportController,
    ProgramDisclosureController,
    CollaborationController,
  ],
  providers: [
    ReportRepository,
    ReportService,
    ReportSummaryRepository,
    ReportSummaryService,
    SupabaseAiReviewQueueRepository,
    {
      provide: AI_REVIEW_WORKER,
      inject: [API_CONFIG, SupabaseAiReviewQueueRepository, AppLogger],
      useFactory: (
        config: ApiEnvironment,
        queue: SupabaseAiReviewQueueRepository,
        logger: AppLogger,
      ) => createWorker(config, queue, logger),
    },
    AiReviewWorkerRunner,
  ],
  exports: [
    ReportRepository,
    ReportService,
    ReportSummaryRepository,
    ReportSummaryService,
    AI_REVIEW_WORKER,
    AiReviewWorkerRunner,
  ],
})
export class ReportModule {}
