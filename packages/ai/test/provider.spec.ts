import { describe, expect, it, vi } from 'vitest';

import {
  AiProviderError,
  DeepSeekTriageProvider,
  GeminiTriageProvider,
  MockTriageProvider,
  redactSensitiveText,
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
  it('redacts common credentials without changing safe identifiers', () => {
    const value = redactSensitiveText(
      'api_key=sk-1234567890123456789 contract withdrawFunds 0x1111111111111111111111111111111111111111',
    );
    expect(value).toContain('[REDACTED]');
    expect(value).toContain('withdrawFunds');
    expect(value).toContain('0x1111111111111111111111111111111111111111');
    expect(value).not.toContain('sk-1234567890123456789');
  });

  it('mock pass one derives semantic function/class independent of selected metadata', async () => {
    const provider = new MockTriageProvider();
    const result = await provider.fingerprint(report);
    expect(result.fingerprint.functions).toContain('withdrawFunds');
    expect(result.fingerprint.vulnerabilityClasses).toContain('access_control');
    expect(result.suggestedSeverity).toBe('critical');
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
    expect(comparison.duplicateAssessment).toBe('likely');
    expect(comparison.candidates[0]?.candidateReportId).toBe(
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
                    completenessScore: 0.8,
                    suggestedSeverity: 'critical',
                    scopeAssessment: 'uncertain',
                    missingInformation: [],
                    confidence: 0.7,
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
    expect(result.suggestedSeverity).toBe('critical');
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
                  duplicateAssessment: 'none',
                  duplicateConfidence: 0,
                  candidates: [],
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
    expect(result.duplicateAssessment).toBe('none');
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
