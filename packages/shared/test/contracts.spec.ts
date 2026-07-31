import { describe, expect, it } from 'vitest';

import {
  approveRewardRequestSchema,
  API_ERROR_CODES,
  attachmentUploadRequestSchema,
  createProgramRequestSchema,
  createReportRequestSchema,
  onboardingRequestSchema,
  programSlugParamsSchema,
  reportDetailSchema,
  updateProfileRequestSchema,
  isApiErrorCode,
} from '../src/index.js';

/** Minimal payload that satisfies every Create Program rule; tests break one rule at a time. */
function validCreateProgram() {
  return {
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Bounties for the Aegis vault contracts and dapp.',
    description: 'Long-form overview researchers read before testing.',
    websiteUrl: 'https://aegis.example.test',
    tags: ['DeFi', 'Solidity'],
    deadline: '2030-01-01T00:00:00.000Z',
    resources: [
      {
        resourceType: 'documentation',
        title: 'Protocol docs',
        url: 'https://aegis.example.test/docs',
        sortOrder: 0,
      },
    ],
    scopes: [
      { assetType: 'smart_contract', assetName: 'Vault', isInScope: true, sortOrder: 0 },
      { assetType: 'website', assetName: 'Dapp', isInScope: true, sortOrder: 1 },
    ],
    impacts: [
      {
        assetType: 'smart_contract',
        severity: 'critical',
        title: 'Theft of user funds',
        enabled: true,
        sortOrder: 0,
      },
      {
        assetType: 'website',
        severity: 'high',
        title: 'Account takeover',
        enabled: true,
        sortOrder: 0,
      },
    ],
    rewardTiers: [
      {
        assetType: 'smart_contract',
        severity: 'critical',
        calculationType: 'range',
        minReward: '1000',
        maxReward: '50000',
      },
      { assetType: 'website', severity: 'high', calculationType: 'flat', flatAmount: '2500' },
    ],
    rules: { rewardPolicy: 'First valid report per root cause is rewarded.' },
  };
}

describe('off-chain shared contracts', () => {
  it('keeps attachment object loss as a stable API error code', () => {
    expect(API_ERROR_CODES).toContain('attachment_object_missing');
    expect(isApiErrorCode('attachment_object_missing')).toBe(true);
  });

  it('accepts canonical program slugs and rejects the legacy id parameter shape', () => {
    expect(programSlugParamsSchema.parse({ slug: 'aegis-protocol' })).toEqual({
      slug: 'aegis-protocol',
    });
    expect(
      programSlugParamsSchema.safeParse({
        id: '31000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
    expect(programSlugParamsSchema.safeParse({ slug: 'Aegis_Protocol' }).success).toBe(false);
    expect(programSlugParamsSchema.safeParse({ slug: ' aegis-protocol' }).success).toBe(false);
  });

  it('prevents reviewer self-assignment and unknown onboarding fields', () => {
    expect(
      onboardingRequestSchema.safeParse({
        role: 'reviewer',
        displayName: 'Forged reviewer',
      }).success,
    ).toBe(false);
    expect(
      onboardingRequestSchema.safeParse({
        role: 'researcher',
        displayName: 'Researcher',
        ownerId: 'forged',
      }).success,
    ).toBe(false);
  });

  it('keeps account settings to a trimmed display name and nothing else', () => {
    // ACC-01: the display name is the whole editable surface. Anything else must be rejected, not
    // stripped — Zod's default would drop these keys and report success.
    for (const forged of [
      { displayName: 'Mallory', role: 'owner' },
      { displayName: 'Mallory', email: 'attacker@example.test' },
      { displayName: 'Mallory', walletAddress: `0x${'a'.repeat(40)}` },
      { displayName: 'Mallory', onboardingComplete: true },
      { displayName: 'Mallory', id: '10000000-0000-4000-8000-000000000001' },
    ]) {
      expect(updateProfileRequestSchema.safeParse(forged).success).toBe(false);
    }

    // Trim happens before the length checks, so 124 raw characters trimming to 120 is valid and
    // whitespace-only is not.
    const trimmed = updateProfileRequestSchema.safeParse({
      displayName: `  ${'a'.repeat(120)}  `,
    });

    expect(trimmed.success).toBe(true);
    expect(trimmed.data?.displayName).toBe('a'.repeat(120));
    expect(updateProfileRequestSchema.safeParse({ displayName: 'a'.repeat(121) }).success).toBe(
      false,
    );
    expect(updateProfileRequestSchema.safeParse({ displayName: '   ' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({}).success).toBe(false);
  });

  it('requires canonical monetary strings', () => {
    expect(approveRewardRequestSchema.safeParse({ amount: '1000.000000' }).success).toBe(true);
    expect(approveRewardRequestSchema.safeParse({ amount: 1000 }).success).toBe(false);
    expect(approveRewardRequestSchema.safeParse({ amount: '01.00' }).success).toBe(false);
  });

  it('keeps transition, report, program and attachment inputs strict', () => {
    expect(
      createReportRequestSchema.safeParse({
        affectedScopeId: '10000000-0000-4000-8000-000000000001',
        title: 'Issue',
        description: 'Description',
        impact: 'Impact',
        reproductionSteps: 'Steps',
        proposedSeverity: 'high',
        researcherId: 'forged',
      }).success,
    ).toBe(false);
    expect(
      createProgramRequestSchema.safeParse({
        name: 'Program',
        slug: 'program',
        description: 'Description',
        scopes: [],
        rewardTiers: [],
      }).success,
    ).toBe(false);
    expect(
      attachmentUploadRequestSchema.safeParse({
        filename: '../private.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
      }).success,
    ).toBe(false);
  });

  it('requires at least one structured impact on a report submission', () => {
    const base = {
      affectedScopeId: '10000000-0000-4000-8000-000000000001',
      title: 'Issue',
      description: 'Description',
      reproductionSteps: 'Steps',
      proposedSeverity: 'high',
    };

    // No free-text fallback exists: the selection is relational or researcher-proposed.
    expect(createReportRequestSchema.safeParse(base).success).toBe(false);
    expect(
      createReportRequestSchema.safeParse({
        ...base,
        programImpactIds: ['10000000-0000-4000-8000-000000000002'],
      }).success,
    ).toBe(true);
    expect(
      createReportRequestSchema.safeParse({
        ...base,
        customImpacts: ['Researcher proposed impact'],
      }).success,
    ).toBe(true);
    // Whitespace does not count as a custom impact.
    expect(
      createReportRequestSchema.safeParse({ ...base, customImpacts: ['   '] }).success,
    ).toBe(false);
  });

  it('parses a complete create-program payload and applies the rules defaults', () => {
    const parsed = createProgramRequestSchema.parse(validCreateProgram());

    expect(parsed.rules.pocPolicy).toBe('required');
    expect(parsed.rules.allowCustomImpact).toBe(true);
    expect(parsed.rules.prohibitedActivities).toEqual([]);
    expect(parsed.scopes[0]?.isInScope).toBe(true);
    expect(parsed.deadline).toBe('2030-01-01T00:00:00.000Z');
  });

  it.each([
    ['name above 200 characters', { name: 'x'.repeat(201) }],
    ['empty name', { name: '   ' }],
    ['slug with invalid characters', { slug: 'Bad_Slug' }],
    ['slug above 120 characters', { slug: 'a'.repeat(121) }],
    ['short summary above 280 characters', { shortSummary: 'x'.repeat(281) }],
    ['description above 20000 characters', { description: 'x'.repeat(20_001) }],
    ['plain-http website', { websiteUrl: 'http://aegis.example.test' }],
    ['empty tag list', { tags: [] }],
    ['more than 10 tags', { tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`) }],
    ['tag above 40 characters', { tags: ['x'.repeat(41)] }],
    ['deadline in the past', { deadline: '2020-01-01T00:00:00.000Z' }],
    ['deadline that is not an ISO date-time', { deadline: 'tomorrow' }],
  ] as const)('rejects identity payloads with %s', (_case, override) => {
    expect(
      createProgramRequestSchema.safeParse({ ...validCreateProgram(), ...override }).success,
    ).toBe(false);
  });

  it('accepts an omitted deadline as an open-ended program', () => {
    const { deadline: _deadline, ...openEnded } = validCreateProgram();
    void _deadline;

    expect(createProgramRequestSchema.safeParse(openEnded).success).toBe(true);
  });

  it('rejects empty, oversized and enum-only scope lists', () => {
    const program = validCreateProgram();
    const scope = program.scopes[0] as Record<string, unknown>;

    expect(createProgramRequestSchema.safeParse({ ...program, scopes: [] }).success).toBe(false);
    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        scopes: Array.from({ length: 51 }, (_, index) => ({ ...scope, assetName: `A${index}` })),
      }).success,
    ).toBe(false);

    // `api` and `mobile` stay enum-only until the product enables them.
    for (const assetType of ['api', 'mobile']) {
      expect(
        createProgramRequestSchema.safeParse({
          ...program,
          scopes: [{ ...scope, assetType }],
        }).success,
      ).toBe(false);
    }
  });

  it('requires an enabled impact for every in-scope asset type', () => {
    const program = validCreateProgram();

    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        impacts: program.impacts.filter((impact) => impact.assetType !== 'website'),
      }).success,
    ).toBe(false);
    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        impacts: program.impacts.map((impact) =>
          impact.assetType === 'website' ? { ...impact, enabled: false } : impact,
        ),
      }).success,
    ).toBe(false);
  });

  it('requires a reward tier for every in-scope asset type', () => {
    const program = validCreateProgram();

    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        rewardTiers: program.rewardTiers.filter((tier) => tier.assetType !== 'website'),
      }).success,
    ).toBe(false);
  });

  it.each([
    [
      'a duplicate (asset type, severity) pair',
      (program: ReturnType<typeof validCreateProgram>) => ({
        rewardTiers: [
          ...program.rewardTiers,
          { assetType: 'smart_contract', severity: 'critical', calculationType: 'flat', flatAmount: '10' },
        ],
      }),
    ],
    [
      'a range tier whose minimum exceeds its maximum',
      () => ({
        rewardTiers: [
          { assetType: 'smart_contract', severity: 'critical', calculationType: 'range', minReward: '100', maxReward: '10' },
          { assetType: 'website', severity: 'high', calculationType: 'flat', flatAmount: '2500' },
        ],
      }),
    ],
    [
      'a flat tier without a positive amount',
      () => ({
        rewardTiers: [
          { assetType: 'smart_contract', severity: 'critical', calculationType: 'flat', flatAmount: '0' },
          { assetType: 'website', severity: 'high', calculationType: 'flat', flatAmount: '2500' },
        ],
      }),
    ],
    [
      'a percentage tier with out-of-range basis points',
      () => ({
        rewardTiers: [
          { assetType: 'smart_contract', severity: 'critical', calculationType: 'percentage', percentageBps: 10_001, maxRewardCap: '1000' },
          { assetType: 'website', severity: 'high', calculationType: 'flat', flatAmount: '2500' },
        ],
      }),
    ],
    [
      'a percentage tier without a cap',
      () => ({
        rewardTiers: [
          { assetType: 'smart_contract', severity: 'critical', calculationType: 'percentage', percentageBps: 1_000 },
          { assetType: 'website', severity: 'high', calculationType: 'flat', flatAmount: '2500' },
        ],
      }),
    ],
    [
      'a range tier smuggling a flat amount',
      (program: ReturnType<typeof validCreateProgram>) => ({
        rewardTiers: [
          { ...program.rewardTiers[0], flatAmount: '10' },
          ...program.rewardTiers.slice(1),
        ],
      }),
    ],
  ] as const)('rejects reward tiers with %s', (_case, override) => {
    const program = validCreateProgram();

    expect(
      createProgramRequestSchema.safeParse({ ...program, ...override(program) }).success,
    ).toBe(false);
  });

  it('rejects impact titles that collide after database normalization', () => {
    const program = validCreateProgram();

    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        impacts: [
          ...program.impacts,
          {
            assetType: 'smart_contract',
            severity: 'high',
            title: 'THEFT-of-user-funds!',
            enabled: true,
            sortOrder: 2,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects impacts and reward tiers for asset types with no scope entry', () => {
    const program = validCreateProgram();
    const smartContractOnly = {
      ...program,
      scopes: program.scopes.filter((scope) => scope.assetType === 'smart_contract'),
    };

    // The website impact/tier rows stay behind while the website scope disappears.
    expect(createProgramRequestSchema.safeParse(smartContractOnly).success).toBe(false);
  });

  it('bounds the rules payload', () => {
    const program = validCreateProgram();

    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        rules: { ...program.rules, rewardPolicy: '   ' },
      }).success,
    ).toBe(false);
    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        rules: { ...program.rules, pocPolicy: 'mandatory' },
      }).success,
    ).toBe(false);
    expect(
      createProgramRequestSchema.safeParse({
        ...program,
        rules: {
          ...program.rules,
          prohibitedActivities: Array.from({ length: 21 }, (_, index) => `Rule ${index}`),
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    'totalPaid',
    'medianResolutionTime',
    'researcherQuota',
    'walletAddress',
    'platformAcknowledgment',
    'status',
    'totalPool',
    'remainingPool',
    'contractAddress',
    'kycRequired',
    'knownIssues',
  ])('rejects the platform-owned or unsupported field %s', (field) => {
    expect(
      createProgramRequestSchema.safeParse({ ...validCreateProgram(), [field]: 'forged' }).success,
    ).toBe(false);
  });

  it('does not permit storage paths or signed URLs in report responses', () => {
    const result = reportDetailSchema.safeParse({
      id: '10000000-0000-4000-8000-000000000001',
      programId: '10000000-0000-4000-8000-000000000002',
      researcherId: '10000000-0000-4000-8000-000000000003',
      affectedScopeId: '10000000-0000-4000-8000-000000000004',
      title: 'Issue',
      description: 'Description',
      impact: 'Impact',
      reproductionSteps: 'Steps',
      proposedSeverity: 'high',
      status: 'submitted',
      updatedAt: '2026-07-25T00:00:00.000Z',
      attachments: [
        {
          id: '10000000-0000-4000-8000-000000000005',
          filename: 'proof.txt',
          mimeType: 'text/plain',
          sizeBytes: 10,
          createdAt: '2026-07-25T00:00:00.000Z',
          storagePath: 'private/path',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
