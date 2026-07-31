import { z } from 'zod';

export const AI_SCHEMA_VERSION = 1 as const;

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedList = z.array(boundedText(300)).max(32);

export const reportFingerprintSchema = z
  .object({
    affectedComponents: boundedList,
    functions: boundedList,
    attackVector: boundedText(500),
    vulnerabilityClasses: boundedList,
    prerequisites: boundedList,
    securityImpacts: boundedList,
    normalizedSummary: boundedText(2_000),
  })
  .strict();

export const scopeAssessmentSchema = z.enum(['in_scope', 'out_of_scope', 'uncertain']);
export const duplicateAssessmentSchema = z.enum(['none', 'possible', 'likely']);
export const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'informational']);

export const reportTriageResultSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(AI_SCHEMA_VERSION),
    summary: boundedText(4_000),
    completenessScore: z.number().min(0).max(1),
    suggestedSeverity: severitySchema,
    scopeAssessment: scopeAssessmentSchema,
    missingInformation: z.array(boundedText(500)).max(32),
    confidence: z.number().min(0).max(1),
    fingerprint: reportFingerprintSchema,
  })
  .strict();

export const duplicateCandidateResultSchema = z
  .object({
    candidateReportId: z.string().uuid(),
    assessment: duplicateAssessmentSchema.exclude(['none']),
    reason: boundedText(1_000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const duplicateComparisonResultSchema = z
  .object({
    schemaVersion: z.number().int().positive().default(AI_SCHEMA_VERSION),
    duplicateAssessment: duplicateAssessmentSchema,
    duplicateConfidence: z.number().min(0).max(1),
    candidates: z.array(duplicateCandidateResultSchema).max(20),
  })
  .strict();

/**
 * Only these fields may be sent to an AI provider. Identity, attachments, signed URLs, and
 * secret-Gist URLs intentionally do not have a slot in this contract.
 */
export const triageReportInputSchema = z
  .object({
    title: boundedText(300),
    description: boundedText(50_000),
    reproductionSteps: boundedText(50_000).optional(),
    affectedScope: z
      .object({
        assetType: boundedText(64),
        name: boundedText(300),
        contractAddress: z.string().max(128).optional(),
      })
      .strict(),
    selectedImpacts: z.array(boundedText(300)).max(20),
    proposedSeverity: severitySchema,
  })
  .strict();

export const triageCandidateInputSchema = z
  .object({
    reportId: z.string().uuid(),
    submissionSequence: z.number().int().positive(),
    title: boundedText(300),
    description: boundedText(50_000),
    reproductionSteps: boundedText(50_000).optional(),
    affectedScope: triageReportInputSchema.shape.affectedScope,
    selectedImpacts: z.array(boundedText(300)).max(20),
    proposedSeverity: severitySchema,
    fingerprint: reportFingerprintSchema.optional(),
  })
  .strict();

export const aiReviewStatusSchema = z.enum(['processing', 'ready', 'unavailable']);

export type ReportFingerprint = z.infer<typeof reportFingerprintSchema>;
export type ScopeAssessment = z.infer<typeof scopeAssessmentSchema>;
export type DuplicateAssessment = z.infer<typeof duplicateAssessmentSchema>;
export type ReportTriageResult = z.infer<typeof reportTriageResultSchema>;
export type DuplicateCandidateResult = z.infer<typeof duplicateCandidateResultSchema>;
export type DuplicateComparisonResult = z.infer<typeof duplicateComparisonResultSchema>;
export type TriageReportInput = z.infer<typeof triageReportInputSchema>;
export type TriageCandidateInput = z.infer<typeof triageCandidateInputSchema>;
export type AiReviewStatus = z.infer<typeof aiReviewStatusSchema>;

export type AiProviderName = 'mock' | 'gemini' | 'deepseek';
export type AiPrivacyMode = 'demo' | 'paid';

export interface TriageProvider {
  readonly name: AiProviderName;
  readonly model: string;
  fingerprint(input: TriageReportInput): Promise<ReportTriageResult>;
  compareDuplicate(
    current: TriageReportInput & { fingerprint: ReportFingerprint },
    candidates: readonly TriageCandidateInput[],
  ): Promise<DuplicateComparisonResult>;
}

export interface AiProviderConfig {
  readonly provider: AiProviderName;
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly privacyMode?: AiPrivacyMode;
  /** Test seam; production callers use the global fetch implementation. */
  readonly fetchImpl?: typeof fetch;
}

export type AiFailureCode =
  | 'invalid_config'
  | 'invalid_request'
  | 'invalid_response'
  | 'timeout'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'unauthorized';

export class AiProviderError extends Error {
  public constructor(
    public readonly code: AiFailureCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function assertProviderConfig(config: AiProviderConfig): void {
  if (config.provider === 'mock') return;
  if (config.apiKey === undefined || config.apiKey.trim().length === 0) {
    throw new AiProviderError('invalid_config', `${config.provider} API key is required`);
  }
  if (config.privacyMode === undefined) {
    throw new AiProviderError('invalid_config', 'AI privacy mode is required');
  }
}
