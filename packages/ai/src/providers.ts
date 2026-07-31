import {
  AiProviderError,
  assertProviderConfig,
  duplicateComparisonResultSchema,
  reportFingerprintSchema,
  reportTriageResultSchema,
  type AiProviderConfig,
  type DuplicateComparisonResult,
  type ReportFingerprint,
  type ReportTriageResult,
  type TriageCandidateInput,
  type TriageProvider,
  type TriageReportInput,
} from './contracts.js';
import { extractGeminiText, extractOpenAiText, requestJson } from './http.js';
import { buildDuplicatePrompt, buildFingerprintPrompt, redactSensitiveText } from './prompt.js';

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

function unique(values: readonly string[], limit = 12): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function inferFunctions(text: string): string[] {
  const explicit = [
    ...text.matchAll(/\b(?:function|method|endpoint|route)\s*[`'"(]?([A-Za-z_$][\w$.-]*)/gi),
  ].map((match) => match[1] ?? '');
  const identifiers = [...text.matchAll(/\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)?\s*\(/g)].map(
    (match) => (match[0] ?? '').replace(/\s*\($/, ''),
  );
  return unique([...explicit, ...identifiers]);
}

function inferClasses(text: string): string[] {
  const labels: Array<[RegExp, string]> = [
    [/access[ -]?control|authorization|privilege|unauthori[sz]ed/i, 'access_control'],
    [/reentrancy|re-entrant/i, 'reentrancy'],
    [/injection|sql|xss|cross[- ]site/i, 'injection'],
    [/oracle|price manipulation|stale price/i, 'oracle_manipulation'],
    [/signature|replay|nonce/i, 'signature_replay'],
    [/integer|overflow|underflow|rounding/i, 'arithmetic'],
    [/ssrf|server[- ]side request/i, 'ssrf'],
  ];
  return labels.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function inferAttackVector(text: string): string {
  const normalized = text.toLowerCase();
  if (/withdraw|transfer|drain|steal|loss of funds/.test(normalized))
    return 'unauthorized asset transfer';
  if (/read|leak|expos|disclos|sensitive/.test(normalized)) return 'unauthorized data exposure';
  if (/execute|call|invoke|admin|privilege/.test(normalized))
    return 'unauthorized privileged action';
  return 'unspecified security impact';
}

function inferImpacts(text: string): string[] {
  const normalized = text.toLowerCase();
  const impacts: string[] = [];
  if (/withdraw|transfer|drain|steal|fund|money|asset/.test(normalized))
    impacts.push('loss_of_funds');
  if (/read|leak|expos|disclos|sensitive/.test(normalized)) impacts.push('data_exposure');
  if (/denial|dos|unavailable|availability/.test(normalized)) impacts.push('availability');
  return impacts.length > 0 ? impacts : ['unspecified'];
}

function severityForInput(input: TriageReportInput): ReportTriageResult['suggestedSeverity'] {
  const normalized =
    `${input.title} ${input.description} ${input.reproductionSteps ?? ''}`.toLowerCase();
  if (/loss of funds|drain|remote code|arbitrary code/.test(normalized)) return 'critical';
  if (/unauthori[sz]ed|bypass|account takeover|privilege/.test(normalized)) return 'high';
  if (/denial|data exposure|leak/.test(normalized)) return 'medium';
  return input.proposedSeverity;
}

function fingerprintFor(input: TriageReportInput): ReportFingerprint {
  const text = redactSensitiveText(
    [input.title, input.description, input.reproductionSteps ?? '', input.affectedScope.name].join(
      ' ',
    ),
  );
  const classNames = inferClasses(text);
  const impacts = inferImpacts(text);
  const functions = inferFunctions(text);
  const components = unique([
    input.affectedScope.name,
    input.affectedScope.contractAddress ?? '',
    ...functions,
  ]);
  const attackVector = inferAttackVector(text);
  return reportFingerprintSchema.parse({
    affectedComponents: components.length > 0 ? components : ['unspecified component'],
    functions,
    attackVector,
    vulnerabilityClasses: classNames.length > 0 ? classNames : ['unspecified'],
    prerequisites: [],
    securityImpacts: impacts,
    normalizedSummary: `${attackVector}; ${classNames.join(', ') || 'unspecified class'}; ${impacts.join(', ')}`,
  });
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left.map((value) => value.toLowerCase()));
  const b = new Set(right.map((value) => value.toLowerCase()));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / new Set([...a, ...b]).size;
}

function candidateFingerprint(candidate: TriageCandidateInput): ReportFingerprint {
  return candidate.fingerprint ?? fingerprintFor(candidate);
}

export class MockTriageProvider implements TriageProvider {
  public readonly name = 'mock' as const;
  public readonly model = 'mock-triage-v1';

  public async fingerprint(input: TriageReportInput): Promise<ReportTriageResult> {
    const fingerprint = fingerprintFor(input);
    const missingInformation: string[] = [];
    if (input.reproductionSteps === undefined) missingInformation.push('reproduction steps');
    if (input.description.length < 80)
      missingInformation.push('a more detailed impact description');
    const completenessScore = Math.max(0, 1 - missingInformation.length * 0.25);
    return reportTriageResultSchema.parse({
      schemaVersion: 1,
      summary: fingerprint.normalizedSummary,
      completenessScore,
      suggestedSeverity: severityForInput(input),
      scopeAssessment: 'uncertain',
      missingInformation,
      confidence: 0.65,
      fingerprint,
    });
  }

  public async compareDuplicate(
    current: TriageReportInput & { fingerprint: ReportFingerprint },
    candidates: readonly TriageCandidateInput[],
  ): Promise<DuplicateComparisonResult> {
    const results = candidates
      .map((candidate) => {
        const fingerprint = candidateFingerprint(candidate);
        const score =
          jaccard(current.fingerprint.functions, fingerprint.functions) * 0.35 +
          jaccard(current.fingerprint.vulnerabilityClasses, fingerprint.vulnerabilityClasses) *
            0.25 +
          jaccard(current.fingerprint.securityImpacts, fingerprint.securityImpacts) * 0.2 +
          jaccard(current.fingerprint.affectedComponents, fingerprint.affectedComponents) * 0.2;
        return { candidate, score };
      })
      .filter(({ score }) => score >= 0.25)
      .sort((left, right) => right.score - left.score)
      .slice(0, 20)
      .map(({ candidate, score }) => ({
        candidateReportId: candidate.reportId,
        assessment: score >= 0.65 ? ('likely' as const) : ('possible' as const),
        reason:
          'Semantic fingerprint overlap in affected component, vulnerability class, impact, or function.',
        confidence: Math.min(1, Math.max(0, score)),
      }));
    const top = results[0];
    return duplicateComparisonResultSchema.parse({
      schemaVersion: 1,
      duplicateAssessment: top?.assessment ?? 'none',
      duplicateConfidence: top?.confidence ?? 0,
      candidates: results,
    });
  }
}

abstract class HttpTriageProvider implements TriageProvider {
  public abstract readonly name: 'gemini' | 'deepseek';
  private readonly configuredModel: string;
  protected readonly config: Required<
    Pick<AiProviderConfig, 'apiKey' | 'timeoutMs' | 'maxRetries'>
  > &
    AiProviderConfig;

  public constructor(config: AiProviderConfig, defaultModel: string) {
    assertProviderConfig(config);
    this.configuredModel = config.model ?? defaultModel;
    this.config = {
      ...config,
      apiKey: config.apiKey as string,
      timeoutMs: config.timeoutMs ?? 15_000,
      maxRetries: config.maxRetries ?? 2,
    };
  }

  public get model(): string {
    return this.configuredModel;
  }

  protected abstract request(prompt: string, schema: unknown): Promise<unknown>;

  public async fingerprint(input: TriageReportInput): Promise<ReportTriageResult> {
    const result = await this.request(buildFingerprintPrompt(input), 'triage');
    return reportTriageResultSchema.parse(result);
  }

  public async compareDuplicate(
    current: TriageReportInput & { fingerprint: ReportFingerprint },
    candidates: readonly TriageCandidateInput[],
  ): Promise<DuplicateComparisonResult> {
    const result = await this.request(buildDuplicatePrompt(current, candidates), 'duplicate');
    return duplicateComparisonResultSchema.parse(result);
  }
}

export class GeminiTriageProvider extends HttpTriageProvider {
  public readonly name = 'gemini' as const;

  public constructor(config: AiProviderConfig) {
    super(config, DEFAULT_GEMINI_MODEL);
  }

  protected async request(prompt: string): Promise<unknown> {
    const baseUrl = (this.config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(
      /\/$/,
      '',
    );
    const payload = await requestJson({
      url: `${baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`,
      headers: {},
      body: {
        systemInstruction: { parts: [{ text: 'Return JSON only.' }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // The provider's JSON mode is deliberately paired with application-side Zod validation.
        // Keeping the provider schema out of this request avoids accepting a provider-specific
        // schema dialect as a security boundary.
        generationConfig: { responseMimeType: 'application/json' },
      },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      ...(this.config.fetchImpl === undefined ? {} : { fetchImpl: this.config.fetchImpl }),
    });
    return extractGeminiText(payload);
  }
}

export class DeepSeekTriageProvider extends HttpTriageProvider {
  public readonly name = 'deepseek' as const;

  public constructor(config: AiProviderConfig) {
    super(config, DEFAULT_DEEPSEEK_MODEL);
  }

  protected async request(prompt: string): Promise<unknown> {
    const baseUrl = (this.config.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '');
    const payload = await requestJson({
      url: `${baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: {
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return JSON only. Do not expose credentials or identities.' },
          { role: 'user', content: prompt },
        ],
      },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      ...(this.config.fetchImpl === undefined ? {} : { fetchImpl: this.config.fetchImpl }),
    });
    return extractOpenAiText(payload);
  }
}

export function createTriageProvider(config: AiProviderConfig): TriageProvider | null {
  if (config.provider === 'mock') return new MockTriageProvider();
  if (config.provider === 'gemini') return new GeminiTriageProvider(config);
  if (config.provider === 'deepseek') return new DeepSeekTriageProvider(config);
  throw new AiProviderError('invalid_config', 'Unsupported AI provider');
}
