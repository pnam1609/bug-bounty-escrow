import { describe, expect, it, vi } from 'vitest';

import {
  AiProviderError,
  APPROVED_AI_MODELS,
  buildDuplicatePrompt,
  buildFingerprintPrompt,
  DeepSeekTriageProvider,
  GeminiTriageProvider,
  MockTriageProvider,
  redactSensitiveText,
  reportTriageResultSchema,
  triageReportInputSchema,
} from '../src/index.js';

const report = triageReportInputSchema.parse({
  title: 'Unauthorized withdrawFunds',
  description:
    'An attacker can call withdrawFunds() without authorization and drain the vault. The selected metadata is intentionally wrong.',
  reproductionSteps: 'Call withdrawFunds() from an untrusted account.',
  affectedScope: { assetType: 'website', name: 'Wrong selected scope' },
  selectedImpacts: ['UI issue'],
  proposedSeverity: 'low',
});

describe('provider-neutral AI contracts', () => {
  it('prompts hosted providers with the nested advisory response contract', () => {
    const fingerprintPrompt = buildFingerprintPrompt(report);
    expect(fingerprintPrompt).toContain('completeness');
    expect(fingerprintPrompt).toContain('suggestedSeverity');
    expect(fingerprintPrompt).toContain('scopeAssessment');
    const duplicatePrompt = buildDuplicatePrompt(
      {
        ...report,
        fingerprint: {
          affectedComponents: ['vault'],
          functions: ['withdrawFunds'],
          attackVector: 'unauthorized asset transfer',
          vulnerabilityClasses: ['access_control'],
          prerequisites: [],
          securityImpacts: ['loss_of_funds'],
          normalizedSummary: 'unauthorized withdrawal',
        },
      },
      [],
    );
    expect(duplicatePrompt).toContain('matchingReasons');
    expect(duplicatePrompt).toContain('candidateRef');
  });

  it('redacts common credentials without changing safe identifiers', () => {
    const value = redactSensitiveText(
      'api_key=sk-1234567890123456789 contract withdrawFunds 0x1111111111111111111111111111111111111111',
    );
    expect(value).toContain('[REDACTED]');
    expect(value).toContain('withdrawFunds');
    expect(value).toContain('0x1111111111111111111111111111111111111111');
    expect(value).not.toContain('sk-1234567890123456789');
  });

  it('redacts hosted-provider URLs and markup/script payloads', () => {
    const value = redactSensitiveText(
      '<script>alert(1)</script><img src="https://private.example/proof"> See https://example.test/report',
    );
    expect(value).toBe('[REDACTED_SCRIPT][REDACTED_HTML] See [REDACTED_URL]');
    expect(value).not.toContain('private.example');
    expect(value).not.toContain('alert(1)');
  });

  it('exposes only exact provider/model allowlist entries', () => {
    expect(APPROVED_AI_MODELS.gemini).toEqual(['gemini-3.5-flash']);
    expect(
      () =>
        new GeminiTriageProvider({
          provider: 'gemini',
          model: 'gemini-flash-latest',
          apiKey: 'test-key',
          privacyMode: 'paid',
        }),
    ).toThrow(AiProviderError);
    expect(
      () =>
        new DeepSeekTriageProvider({
          provider: 'deepseek',
          model: 'deepseek-chat',
          apiKey: 'test-key',
          privacyMode: 'paid',
        }),
    ).toThrow(AiProviderError);
  });

  it('mock pass one derives semantic function/class independent of selected metadata', async () => {
    const provider = new MockTriageProvider();
    const result = await provider.fingerprint(report);
    expect(result.fingerprint.functions).toContain('withdrawFunds');
    expect(result.fingerprint.vulnerabilityClasses).toContain('access_control');
    expect(result.suggestedSeverity.level).toBe('critical');
  });

  it('rejects arbitrary AI response schema versions', async () => {
    const provider = new MockTriageProvider();
    const result = await provider.fingerprint(report);
    expect(
      reportTriageResultSchema.safeParse({ ...result, schemaVersion: 'ai-review-v2' }).success,
    ).toBe(false);
    expect(result.schemaVersion).toBe('ai-review-v1');
  });

  it('mock pass two can identify overlap despite different selected scope/impact', async () => {
    const provider = new MockTriageProvider();
    const fingerprint = await provider.fingerprint(report);
    const comparison = await provider.compareDuplicate(
      { ...report, fingerprint: fingerprint.fingerprint },
      [
        {
          reportId: '10000000-0000-4000-8000-000000000001',
          submissionSequence: 1,
          ...report,
          affectedScope: { assetType: 'smart_contract', name: 'Vault contract' },
          selectedImpacts: ['Loss of funds'],
        },
      ],
    );
    expect(comparison.duplicateAssessment.assessment).toBe('likely');
    expect(comparison.duplicateAssessment.candidates[0]?.candidateRef).toBe(
      '10000000-0000-4000-8000-000000000001',
    );
  });
});

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('hosted adapters', () => {
  it('retries malformed JSON, response shape, and Zod output within a bounded limit', async () => {
    const valid = {
      summary: 'Unauthorized withdrawal',
      completeness: {
        score: 0.8,
        checks: [{ key: 'reproduction_steps', status: 'present', reason: 'present' }],
      },
      suggestedSeverity: { level: 'critical', confidence: 0.8, rationale: 'impact' },
      scopeAssessment: { result: 'uncertain', confidence: 0.6, rationale: 'human review' },
      missingInformation: [],
      fingerprint: {
        affectedComponents: ['vault'],
        functions: ['withdrawFunds'],
        attackVector: 'unauthorized asset transfer',
        vulnerabilityClasses: ['access_control'],
        prerequisites: [],
        securityImpacts: ['loss_of_funds'],
        normalizedSummary: 'unauthorized withdrawal',
      },
    };
    const gemini = (text: string): Response =>
      okResponse({ candidates: [{ content: { parts: [{ text }] } }] });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(gemini('not-json'))
      .mockResolvedValueOnce(gemini(JSON.stringify({ ...valid, summary: undefined })))
      .mockResolvedValueOnce(gemini(JSON.stringify(valid)));
    const provider = new GeminiTriageProvider({
      provider: 'gemini',
      apiKey: 'test-key',
      privacyMode: 'paid',
      maxRetries: 99,
      fetchImpl,
    });

    await expect(provider.fingerprint(report)).resolves.toMatchObject({
      suggestedSeverity: { level: 'critical', confidence: 0.8, rationale: 'impact' },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('uses Gemini JSON mode and validates the provider result', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      okResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Unauthorized withdrawal',
                    completeness: {
                      score: 0.8,
                      checks: [{ key: 'reproduction_steps', status: 'present', reason: 'present' }],
                    },
                    suggestedSeverity: { level: 'critical', confidence: 0.8, rationale: 'impact' },
                    scopeAssessment: {
                      result: 'uncertain',
                      confidence: 0.6,
                      rationale: 'human review',
                    },
                    missingInformation: [],
                    fingerprint: {
                      affectedComponents: ['vault'],
                      functions: ['withdrawFunds'],
                      attackVector: 'unauthorized asset transfer',
                      vulnerabilityClasses: ['access_control'],
                      prerequisites: [],
                      securityImpacts: ['loss_of_funds'],
                      normalizedSummary: 'unauthorized withdrawal',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    );
    const provider = new GeminiTriageProvider({
      provider: 'gemini',
      apiKey: 'test-key',
      privacyMode: 'paid',
      fetchImpl,
    });
    const result = await provider.fingerprint(report);
    expect(result.suggestedSeverity.level).toBe('critical');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/v1beta/models/gemini-3.5-flash:generateContent?key=test-key'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('retries DeepSeek 429 and then parses OpenAI-compatible JSON', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        okResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  duplicateAssessment: {
                    assessment: 'none',
                    confidence: 0,
                    matchingReasons: [],
                    candidates: [],
                  },
                }),
              },
            },
          ],
        }),
      );
    const provider = new DeepSeekTriageProvider({
      provider: 'deepseek',
      apiKey: 'test-key',
      privacyMode: 'paid',
      timeoutMs: 1_000,
      fetchImpl,
    });
    const result = await provider.compareDuplicate(
      {
        ...report,
        fingerprint: await new MockTriageProvider()
          .fingerprint(report)
          .then((value) => value.fingerprint),
      },
      [],
    );
    expect(result.duplicateAssessment.assessment).toBe('none');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects missing API keys before making a request', () => {
    expect(
      () =>
        new GeminiTriageProvider({
          provider: 'gemini',
          privacyMode: 'paid',
        }),
    ).toThrow(AiProviderError);
  });
});
