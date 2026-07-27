import type { AuthorableAssetType, Program, Severity } from '@bug-bounty-escrow/shared';
import { createProgramRequestSchema } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

import {
  assetTypeForErrorKey,
  buildCreatePayload,
  createEmptyDraft,
  createTierRow,
  draftFromProgram,
  firstErrorAssetType,
  nextRowId,
  saveErrorHint,
  seedImpacts,
  validateImpacts,
  validateOverview,
  validateRewards,
  validateRules,
  validateScope,
  validateScopeRow,
  PLATFORM_PROHIBITED_ACTIVITIES,
  type ProgramDraft,
  type ScopeRow,
  type TierRow,
} from '@/components/owner/program-draft';

/*
 * CP-03 — the wizard converts its client draft to the API contract only at Review, so every rule
 * `createProgramRequestSchema` tightened in CP-02 must already hold for a draft that passed the
 * per-step validators. A divergence here surfaces as the generic CP-07 save error instead of a
 * field-level message on the step that owns the mistake.
 */

function validDraft(): ProgramDraft {
  const empty = createEmptyDraft();
  const base: ProgramDraft = {
    ...empty,
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Bounties for the Aegis core contracts.',
    websiteUrl: 'https://aegis.xyz',
    description: 'Long-form overview researchers read before testing.',
    tags: ['DeFi'],
    scopes: [
      {
        rowId: nextRowId('scope'),
        assetType: 'smart_contract',
        assetName: 'Aegis Core',
        assetUrl: '',
        contractAddress: '',
        isInScope: true,
        description: '',
      },
    ],
    rules: { ...empty.rules, rewardPolicy: 'Rewards follow the tier table.' },
  };
  const seeded: ProgramDraft = { ...base, impacts: seedImpacts(base) };

  return {
    ...seeded,
    rewardTiers: [
      { ...createTierRow('smart_contract', []), minReward: '1000', maxReward: '50000' },
    ],
  };
}

describe('buildCreatePayload against createProgramRequestSchema', () => {
  it('produces a payload the tightened schema accepts', () => {
    const draft = validDraft();

    expect(validateOverview(draft)).toEqual({});
    expect(validateImpacts(draft)).toEqual({});
    expect(validateRewards(draft)).toEqual({});

    const parsed = createProgramRequestSchema.safeParse(buildCreatePayload(draft));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('never sends cross-shape tier fields left over from a calculation-type switch', () => {
    const draft = validDraft();
    // The owner tried flat and percentage first, then settled on range: stale values remain in
    // client state but must not reach the API, which rejects foreign shapes outright.
    const tier = draft.rewardTiers[0];
    if (tier === undefined) throw new Error('expected a seeded tier');

    const withStaleShapes: ProgramDraft = {
      ...draft,
      rewardTiers: [{ ...tier, flatAmount: '25000', percentage: '10', maxRewardCap: '99999' }],
    };

    const payload = buildCreatePayload(withStaleShapes) as {
      rewardTiers: Record<string, unknown>[];
    };
    expect(payload.rewardTiers[0]).not.toHaveProperty('flatAmount');
    expect(payload.rewardTiers[0]).not.toHaveProperty('percentageBps');
    expect(payload.rewardTiers[0]).not.toHaveProperty('maxRewardCap');

    expect(createProgramRequestSchema.safeParse(payload).success).toBe(true);
  });
});

describe('step validators mirror the schema', () => {
  it('flags impact titles the schema normalises to the same value', () => {
    const draft = validDraft();
    const duplicated: ProgramDraft = {
      ...draft,
      impacts: [
        {
          rowId: nextRowId('impact'),
          assetType: 'smart_contract',
          severity: 'critical',
          title: 'Reentrancy attack',
          description: '',
          enabled: true,
        },
        {
          rowId: nextRowId('impact'),
          assetType: 'smart_contract',
          severity: 'high',
          title: '  reentrancy—ATTACK!! ',
          description: '',
          enabled: true,
        },
      ],
    };

    const errors = validateImpacts(duplicated);
    expect(Object.values(errors)).toContain('This impact is already listed for this asset type.');
  });

  it('keys the missing-impact error by asset type so the tab marker and the message share a key', () => {
    const draft = validDraft();
    const allDisabled: ProgramDraft = {
      ...draft,
      impacts: draft.impacts.map((impact) => ({ ...impact, enabled: false })),
    };

    // CP-02I paints the error indicator on the asset-type tab, so the key must be the asset type:
    // a row-keyed message would stay hidden inside the panel the owner is not looking at.
    expect(validateImpacts(allDisabled)).toEqual({
      'impacts.smart_contract': 'Add at least one impact for this asset type.',
    });
  });

  it('rejects a percentage that rounds below one basis point', () => {
    const draft = validDraft();
    const tier = {
      ...createTierRow('smart_contract', []),
      calculationType: 'percentage' as const,
      percentage: '0.004',
      maxRewardCap: '1000',
    };
    const errors = validateRewards({ ...draft, rewardTiers: [tier] });

    expect(errors[`rewardTiers.${tier.rowId}.percentage`]).toBe(
      'Enter a percentage greater than 0% and no more than 100%.',
    );
  });

  it('accepts the one-basis-point floor the schema stores', () => {
    const draft = validDraft();
    const tier = {
      ...createTierRow('smart_contract', []),
      calculationType: 'percentage' as const,
      percentage: '0.01',
      maxRewardCap: '1000',
    };
    const errors = validateRewards({ ...draft, rewardTiers: [tier] });

    expect(errors[`rewardTiers.${tier.rowId}.percentage`]).toBeUndefined();
  });

  it('rejects a past deadline exactly like the schema does', () => {
    const draft: ProgramDraft = { ...validDraft(), deadline: '2020-01-01' };

    expect(validateOverview(draft)['deadline']).toBe(
      'Choose a valid future date or leave it empty.',
    );
  });

  it('validates a scope row with the verbatim CP-02V messages', () => {
    const row: ScopeRow = {
      rowId: nextRowId('scope'),
      assetType: 'smart_contract',
      assetName: 'Aegis Core',
      assetUrl: 'https://app.aegis.xyz',
      contractAddress: '0x52908400098527886E0F7030069857D2E4169EE7',
      isInScope: true,
      description: 'Primary protocol contracts.',
    };
    expect(validateScopeRow(row)).toEqual({});

    expect(validateScopeRow({ ...row, assetName: '   ' })['assetName']).toBe(
      'Enter an asset name.',
    );
    expect(validateScopeRow({ ...row, assetUrl: 'not a url' })['assetUrl']).toBe(
      'Enter a valid URL.',
    );
    // Same rule as `evmAddressSchema`: 0x + 40 hex characters, no checksum requirement.
    for (const invalid of [
      '0x123',
      '52908400098527886E0F7030069857D2E4169EE7',
      '0xZZ08400098527886E0F7030069857D2E4169EE7',
    ]) {
      expect(validateScopeRow({ ...row, contractAddress: invalid })['contractAddress']).toBe(
        'Enter a valid EVM contract address.',
      );
    }
  });

  it('reports the scope list boundaries with the verbatim CP-02V messages', () => {
    const empty = { ...validDraft(), scopes: [] };
    expect(validateScope(empty)).toEqual({ scopes: 'Add at least one scope item.' });

    const template = validDraft().scopes[0];
    if (template === undefined) throw new Error('expected a seeded scope');

    const overLimit: ProgramDraft = {
      ...validDraft(),
      scopes: Array.from({ length: 51 }, (_, index) => ({
        ...template,
        rowId: `scope-limit-${index}`,
      })),
    };
    expect(validateScope(overLimit)).toEqual({
      scopes: 'A program can contain up to 50 scope items.',
    });
  });

  it('keys scope row errors by row in list order so submit focuses the first invalid card', () => {
    const base = validDraft();
    const template = base.scopes[0];
    if (template === undefined) throw new Error('expected a seeded scope');

    const first: ScopeRow = { ...template, rowId: 'scope-a', contractAddress: '0xnothex' };
    const second: ScopeRow = { ...template, rowId: 'scope-b', assetName: '' };

    expect(Object.keys(validateScope({ ...base, scopes: [first, second] }))).toEqual([
      'scopes.scope-a',
      'scopes.scope-b',
    ]);
  });

  it('inserts overview error keys in on-screen field order so submit focuses the first invalid control', () => {
    const rowId = nextRowId('resource');
    const draft: ProgramDraft = {
      ...validDraft(),
      deadline: '2020-01-01',
      resources: [
        { rowId, resourceType: 'documentation', title: '', url: 'http://insecure.example' },
      ],
    };

    // CP-01 renders `Submission deadline` above `Resources`; the failed-submit focus follows
    // the first key of the error object, so the validator must write keys in that order.
    expect(Object.keys(validateOverview(draft))).toEqual(['deadline', `resources.${rowId}`]);
  });
});

/* ── CP-07 — reward tiers ──────────────────────────────────────────────────────────────────── */

/** Both authorable asset types in scope, so `(asset type, severity)` uniqueness is observable. */
function twoTypeDraft(): ProgramDraft {
  const base = validDraft();
  const smartContract = base.scopes[0];
  if (smartContract === undefined) throw new Error('expected a seeded scope');

  const scoped: ProgramDraft = {
    ...base,
    scopes: [
      smartContract,
      {
        rowId: nextRowId('scope'),
        assetType: 'website',
        assetName: 'app.aegis.xyz',
        assetUrl: 'https://app.aegis.xyz',
        contractAddress: '',
        isInScope: true,
        description: '',
      },
    ],
  };

  return { ...scoped, impacts: seedImpacts(scoped) };
}

/** A filled-in `range` row; `patch` swaps in whichever shape the case under test needs. */
function tier(
  assetType: AuthorableAssetType,
  severity: Severity,
  patch: Partial<TierRow> = {},
): TierRow {
  return {
    ...createTierRow(assetType, []),
    severity,
    minReward: '1000',
    maxReward: '50000',
    ...patch,
  };
}

describe('reward tier validation (CP-03V)', () => {
  it('scopes severity uniqueness to the asset type, not the whole program', () => {
    const draft = twoTypeDraft();

    // The same severity priced on both tabs is the normal case — the constraint is the triple
    // `(program, asset type, severity)`.
    expect(
      validateRewards({
        ...draft,
        rewardTiers: [tier('smart_contract', 'critical'), tier('website', 'critical')],
      }),
    ).toEqual({});

    const first = tier('smart_contract', 'high');
    const repeat = tier('smart_contract', 'high');
    const errors = validateRewards({
      ...draft,
      rewardTiers: [first, repeat, tier('website', 'high')],
    });

    expect(errors[`rewardTiers.${repeat.rowId}.severity`]).toBe(
      'Each severity can only be used once per asset type.',
    );
    // Keyed on the asset type as well, so the tab marker and the panel message share a key.
    expect(errors['rewardTiers.smart_contract']).toBe(
      'Each severity can only be used once per asset type.',
    );
    expect(errors[`rewardTiers.${first.rowId}.severity`]).toBeUndefined();
    expect(errors['rewardTiers.website']).toBeUndefined();
  });

  it('reports the amount messages for every calculation shape verbatim', () => {
    const draft = twoTypeDraft();
    const range = tier('smart_contract', 'critical', { minReward: '', maxReward: '' });
    const flat = tier('smart_contract', 'high', {
      calculationType: 'flat',
      minReward: '',
      maxReward: '',
    });
    const percentage = tier('website', 'critical', {
      calculationType: 'percentage',
      minReward: '',
      maxReward: '',
    });

    const errors = validateRewards({ ...draft, rewardTiers: [range, flat, percentage] });

    expect(errors[`rewardTiers.${range.rowId}.minReward`]).toBe('Enter a valid USDC amount.');
    expect(errors[`rewardTiers.${range.rowId}.maxReward`]).toBe('Enter a valid USDC amount.');
    expect(errors[`rewardTiers.${flat.rowId}.flatAmount`]).toBe('Enter a valid USDC amount.');
    expect(errors[`rewardTiers.${percentage.rowId}.percentage`]).toBe(
      'Enter a percentage greater than 0% and no more than 100%.',
    );
    expect(errors[`rewardTiers.${percentage.rowId}.maxRewardCap`]).toBe(
      'Enter the maximum USDC reward for this calculation.',
    );
  });

  it('judges only the fields the selected calculation type owns', () => {
    const draft = twoTypeDraft();
    // The owner tried range and percentage before settling on flat. The stale values stay in
    // client state and the schema would reject them outright, but `tierPayload` strips them —
    // so they must not raise a field error the owner has no visible control to fix.
    const flat = tier('smart_contract', 'critical', {
      calculationType: 'flat',
      flatAmount: '25000',
      minReward: 'not a number',
      maxReward: '',
      percentage: '0',
      maxRewardCap: '',
    });

    expect(validateRewards({ ...draft, rewardTiers: [flat, tier('website', 'critical')] })).toEqual(
      {},
    );
  });

  it('flags a maximum below the minimum but accepts a zero minimum', () => {
    const draft = twoTypeDraft();
    const inverted = tier('smart_contract', 'critical', { minReward: '5000', maxReward: '1000' });

    expect(
      validateRewards({ ...draft, rewardTiers: [inverted, tier('website', 'critical')] })[
        `rewardTiers.${inverted.rowId}.maxReward`
      ],
    ).toBe('Maximum reward must not be below minimum reward.');

    // §3 calls the minimum a non-negative monetary amount, so an explicit 0 is a real value.
    for (const minReward of ['0', '0.00']) {
      const free = tier('smart_contract', 'critical', { minReward, maxReward: '1000' });
      expect(
        validateRewards({ ...draft, rewardTiers: [free, tier('website', 'critical')] }),
      ).toEqual({});
    }
  });

  it('bounds the percentage at 100% inclusive', () => {
    const draft = twoTypeDraft();
    const percent = (value: string) =>
      tier('smart_contract', 'critical', {
        calculationType: 'percentage',
        percentage: value,
        maxRewardCap: '250000',
      });

    const accepted = percent('100');
    expect(
      validateRewards({ ...draft, rewardTiers: [accepted, tier('website', 'critical')] }),
    ).toEqual({});

    const rejected = percent('100.5');
    expect(
      validateRewards({ ...draft, rewardTiers: [rejected, tier('website', 'critical')] })[
        `rewardTiers.${rejected.rowId}.percentage`
      ],
    ).toBe('Enter a percentage greater than 0% and no more than 100%.');
  });

  it('reports both empty-state messages, step-level key first', () => {
    const errors = validateRewards({ ...twoTypeDraft(), rewardTiers: [] });

    // The step-level key drives the validation summary; the asset-type keys are what light the
    // tab markers and give the failed submit something to focus inside the panel.
    expect(Object.keys(errors)).toEqual([
      'rewardTiers',
      'rewardTiers.smart_contract',
      'rewardTiers.website',
    ]);
    expect(errors['rewardTiers']).toBe('Add at least one reward tier.');
    expect(errors['rewardTiers.smart_contract']).toBe(
      'Add at least one reward tier for this asset type.',
    );
  });

  it('ignores tier rows whose asset type is no longer in scope', () => {
    const draft = twoTypeDraft();
    // The owner went back and took websites out of scope. The row survives in client state, the
    // Rewards step stops drawing a Websites tab and `tierPayload` drops it — so an error on it
    // would block the step forever on a field that is not on screen.
    const contractsOnly: ProgramDraft = {
      ...draft,
      scopes: draft.scopes.map((scope) =>
        scope.assetType === 'website' ? { ...scope, isInScope: false } : scope,
      ),
      rewardTiers: [
        tier('smart_contract', 'critical'),
        tier('website', 'critical', { minReward: '', maxReward: '' }),
      ],
    };

    expect(validateRewards(contractsOnly)).toEqual({});
  });

  it('emits row keys in panel order so submit focuses the first invalid control', () => {
    const draft = twoTypeDraft();
    const first = tier('smart_contract', 'critical', { maxReward: '' });
    const second = tier('smart_contract', 'high', { minReward: '' });

    expect(
      Object.keys(
        validateRewards({
          ...draft,
          rewardTiers: [first, second, tier('website', 'critical')],
        }),
      ),
    ).toEqual([`rewardTiers.${first.rowId}.maxReward`, `rewardTiers.${second.rowId}.minReward`]);
  });
});

describe('failed-submit tab routing', () => {
  it('resolves group keys and row keys, and leaves untabbed keys alone', () => {
    const draft = twoTypeDraft();
    const websiteImpact = draft.impacts.find((impact) => impact.assetType === 'website');
    const websiteTier = tier('website', 'critical');
    const routed: ProgramDraft = { ...draft, rewardTiers: [websiteTier] };
    if (websiteImpact === undefined) throw new Error('expected a seeded website impact');

    expect(assetTypeForErrorKey(routed, 'rewardTiers.website')).toBe('website');
    expect(assetTypeForErrorKey(routed, `rewardTiers.${websiteTier.rowId}.maxReward`)).toBe(
      'website',
    );
    expect(assetTypeForErrorKey(routed, `impacts.${websiteImpact.rowId}`)).toBe('website');

    // Step-level keys and untabbed steps must never move a tab.
    for (const key of [
      'rewardTiers',
      'impacts',
      'name',
      'scopes.scope-404',
      'rewardTiers.gone.x',
    ]) {
      expect(assetTypeForErrorKey(routed, key)).toBeNull();
    }
  });

  it('opens the tab of the earliest failing key, skipping keys that own no tab', () => {
    const draft = twoTypeDraft();
    const websiteTier = tier('website', 'critical');
    const routed: ProgramDraft = { ...draft, rewardTiers: [websiteTier] };

    expect(
      firstErrorAssetType(routed, {
        rewardTiers: 'Add at least one reward tier.',
        [`rewardTiers.${websiteTier.rowId}.maxReward`]: 'Enter a valid USDC amount.',
      }),
    ).toBe('website');

    expect(firstErrorAssetType(routed, {})).toBeNull();
    expect(firstErrorAssetType(routed, { name: 'Enter a program name.' })).toBeNull();
  });

  it('sends a rewards submit failure to the tab that owns the first invalid row', () => {
    const draft: ProgramDraft = {
      ...twoTypeDraft(),
      rewardTiers: [
        tier('smart_contract', 'critical'),
        tier('website', 'critical', { maxReward: '' }),
      ],
    };

    // Smart contracts is the first tab and it is valid, so without this the shell would try to
    // focus a control Radix has not mounted.
    expect(firstErrorAssetType(draft, validateRewards(draft))).toBe('website');
  });

  it('sends an impacts submit failure to the tab that owns the empty catalogue (CP-06)', () => {
    const draft = twoTypeDraft();
    const disabled: ProgramDraft = {
      ...draft,
      impacts: draft.impacts.map((impact) =>
        impact.assetType === 'website' ? { ...impact, enabled: false } : impact,
      ),
    };

    expect(firstErrorAssetType(disabled, validateImpacts(disabled))).toBe('website');
  });
});

/* ── CP-08 — rules and policies ────────────────────────────────────────────────────────────── */

/** Swaps one rules patch into an otherwise valid draft. */
function withRules(patch: Partial<ProgramDraft['rules']>): ProgramDraft {
  const draft = validDraft();
  return { ...draft, rules: { ...draft.rules, ...patch } };
}

function customRule(body: string) {
  return { rowId: nextRowId('rule'), body };
}

describe('rules validation (CP-03RV)', () => {
  it('passes a filled-in draft', () => {
    expect(validateRules(validDraft())).toEqual({});
  });

  it('reports the three flow-document messages verbatim', () => {
    const blank = customRule('   ');
    const errors = validateRules(
      withRules({
        rewardPolicy: '   ',
        prohibitedActivities: [blank],
        submissionAcknowledgment: 'a'.repeat(1_001),
      }),
    );

    expect(errors['rules.rewardPolicy']).toBe('Describe reward eligibility and exclusions.');
    expect(errors[`rules.prohibited.${blank.rowId}`]).toBe('Enter a rule or remove this row.');
    expect(errors['rules.submissionAcknowledgment']).toBe(
      'Keep the acknowledgment within 1,000 characters.',
    );
  });

  /*
   * The acknowledgment message has exactly one branch. While the textarea carried
   * `maxLength={1000}` the branch was unreachable, so a message CP-03RV requires could never
   * appear on screen: every limit is judged here and no control truncates on the owner's behalf.
   */
  it('judges each character limit itself rather than leaning on a truncating control', () => {
    expect(validateRules(withRules({ pocPolicyNote: 'a'.repeat(2_000) }))).toEqual({});
    expect(validateRules(withRules({ pocPolicyNote: 'a'.repeat(2_001) }))).toEqual({
      'rules.pocPolicyNote': 'Keep the policy note within 2,000 characters.',
    });

    expect(validateRules(withRules({ testingRestrictions: 'a'.repeat(10_000) }))).toEqual({});
    expect(validateRules(withRules({ testingRestrictions: 'a'.repeat(10_001) }))).toEqual({
      'rules.testingRestrictions': 'Keep testing restrictions within 10,000 characters.',
    });

    expect(validateRules(withRules({ submissionAcknowledgment: 'a'.repeat(1_000) }))).toEqual({});
    // Trimmed before counting, exactly like `programRulesInputSchema`, so a draft that clears the
    // step can never be rejected by the payload parse at Review.
    expect(
      validateRules(withRules({ submissionAcknowledgment: `  ${'a'.repeat(1_000)}  ` })),
    ).toEqual({});
  });

  it('emits rules keys in on-screen order so submit focuses the first invalid control', () => {
    const first = customRule('');
    const second = customRule(' ');

    // Screen order: policy note, reward policy, custom rules, testing restrictions, acknowledgment.
    expect(
      Object.keys(
        validateRules(
          withRules({
            pocPolicyNote: 'a'.repeat(2_001),
            rewardPolicy: '',
            prohibitedActivities: [first, second],
            testingRestrictions: 'a'.repeat(10_001),
            submissionAcknowledgment: 'a'.repeat(1_001),
          }),
        ),
      ),
    ).toEqual([
      'rules.pocPolicyNote',
      'rules.rewardPolicy',
      `rules.prohibited.${first.rowId}`,
      `rules.prohibited.${second.rowId}`,
      'rules.testingRestrictions',
      'rules.submissionAcknowledgment',
    ]);
  });
});

/** A saved program, used to check what `Edit program` puts back into the rules editors. */
function savedProgram(): Program {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: '22222222-2222-4222-8222-222222222222',
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Bounties for the Aegis core contracts.',
    description: 'Long-form overview researchers read before testing.',
    status: 'draft',
    publicStatus: null,
    tags: ['DeFi'],
    totalPool: '0',
    reservedPool: '0',
    remainingPool: '0',
    totalPaid: null,
    totalPaidVisibility: 'private',
    paidReportCount: null,
    maxBounty: '0',
    inScopeAssetTypes: ['smart_contract'],
    rewardSeverities: ['critical'],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    scopes: [],
    impacts: [],
    rewardTiers: [],
    resources: [],
    rules: {
      pocPolicy: 'required',
      rewardPolicy: 'Rewards follow the tier table.',
      allowCustomImpact: true,
      prohibitedActivities: [
        ...PLATFORM_PROHIBITED_ACTIVITIES.map((body, index) => ({
          id: `33333333-3333-4333-8333-00000000000${index}`,
          source: 'platform_default' as const,
          ruleKey: `rule_${index}`,
          body,
          sortOrder: index,
        })),
        {
          id: '44444444-4444-4444-8444-444444444444',
          source: 'custom' as const,
          body: 'No testing on the checkout flow between 09:00 and 17:00 UTC.',
          sortOrder: 100,
        },
      ],
    },
    metrics: { totalAssetsInScope: 0, medianResolutionSeconds: null },
  };
}

describe('prohibited activities (CP-03R)', () => {
  it('ships the five platform defaults the flow document names', () => {
    expect(PLATFORM_PROHIBITED_ACTIVITIES.length).toBeGreaterThanOrEqual(5);

    for (const pattern of [
      /social engineering/i,
      /denial of service/i,
      /automated scanning or high-volume/i,
      /mainnet or public deployments/i,
      /public disclosure of an unpatched vulnerability/i,
    ]) {
      expect(PLATFORM_PROHIBITED_ACTIVITIES.some((body) => pattern.test(body))).toBe(true);
    }
  });

  /*
   * The locked defaults are rendered straight from the catalogue and re-snapshotted server-side.
   * If one ever landed in `rules.prohibitedActivities` the owner would get a delete button for a
   * rule that cannot be deleted, and five of the twenty custom slots would already be spent.
   */
  it('keeps the locked defaults out of the owner-editable rows', () => {
    expect(createEmptyDraft().rules.prohibitedActivities).toEqual([]);

    const rehydrated = draftFromProgram(savedProgram()).rules.prohibitedActivities;
    expect(rehydrated.map((rule) => rule.body)).toEqual([
      'No testing on the checkout flow between 09:00 and 17:00 UTC.',
    ]);
    for (const body of PLATFORM_PROHIBITED_ACTIVITIES) {
      expect(rehydrated.some((rule) => rule.body === body)).toBe(false);
    }
  });

  it('sends owner rules only, drops empty rows and mirrors the schema limit of twenty', () => {
    const bodies = (list: readonly string[]): ProgramDraft =>
      withRules({ prohibitedActivities: list.map(customRule) });

    const payload = buildCreatePayload(bodies(['  No load testing.  ', '   '])) as {
      rules: { prohibitedActivities: string[] };
    };
    expect(payload.rules.prohibitedActivities).toEqual(['No load testing.']);

    // `MAX_CUSTOM_RULES` in the step disables `Add prohibited activity` at twenty; this is the
    // schema rule that constant mirrors, and the platform defaults are not part of the count.
    const twenty = Array.from({ length: 20 }, (_, index) => `Custom rule ${index + 1}.`);
    expect(createProgramRequestSchema.safeParse(buildCreatePayload(bodies(twenty))).success).toBe(
      true,
    );
    expect(
      createProgramRequestSchema.safeParse(buildCreatePayload(bodies([...twenty, 'One too many.'])))
        .success,
    ).toBe(false);
  });
});

describe('rules payload (CP-03R)', () => {
  it('defaults PoC policy to required and custom impacts to allowed', () => {
    const empty = createEmptyDraft().rules;
    expect(empty.pocPolicy).toBe('required');
    expect(empty.allowCustomImpact).toBe(true);

    const payload = buildCreatePayload(validDraft()) as { rules: Record<string, unknown> };
    expect(payload.rules['pocPolicy']).toBe('required');
    expect(payload.rules['allowCustomImpact']).toBe(true);
  });

  it('omits the optional rules text instead of sending empty strings the schema rejects', () => {
    const payload = buildCreatePayload(validDraft()) as { rules: Record<string, unknown> };

    expect(payload.rules).not.toHaveProperty('pocPolicyNote');
    expect(payload.rules).not.toHaveProperty('testingRestrictions');
    expect(payload.rules).not.toHaveProperty('submissionAcknowledgment');

    const filled = buildCreatePayload(
      withRules({
        pocPolicy: 'optional',
        pocPolicyNote: '  A screenshot is enough.  ',
        testingRestrictions: '  Use the staging tenant.  ',
        submissionAcknowledgment: '  I tested only in-scope assets.  ',
      }),
    ) as { rules: Record<string, unknown> };

    expect(filled.rules['pocPolicy']).toBe('optional');
    expect(filled.rules['pocPolicyNote']).toBe('A screenshot is enough.');
    expect(filled.rules['testingRestrictions']).toBe('Use the staging tenant.');
    expect(filled.rules['submissionAcknowledgment']).toBe('I tested only in-scope assets.');
    expect(createProgramRequestSchema.safeParse(filled).success).toBe(true);
  });
});

/*
 * CP-09 — the Review step is the only caller of `POST /api/programs`, so it is also the only place
 * a rejected payload surfaces. The flow document fixes the CP-07 sentence verbatim; the hint is an
 * addition beside it, and it is only useful if it covers the codes the create path can raise.
 */
describe('save-error hints (CP-07)', () => {
  it('names every rule create_program_atomic can raise', () => {
    const createPathCodes = [
      'deadline_not_in_future',
      'asset_type_not_enabled',
      'reward_tier_duplicate',
      'impact_title_duplicate',
      'impact_asset_type_not_in_scope',
      'reward_tier_asset_type_not_in_scope',
      'impact_coverage_missing',
      'reward_tier_coverage_missing',
    ];

    for (const code of createPathCodes) {
      const hint = saveErrorHint(code);
      expect(hint, code).not.toBeNull();
      expect(hint, code).not.toBe('');
    }
  });

  it('covers both shapes of the owner-role rejection', () => {
    // The roles guard answers a non-owner with a bare 403 (`forbidden`); the contract also reserves
    // `owner_role_required`. Neither may fall through to the generic surface alone.
    expect(saveErrorHint('forbidden')).toBe(saveErrorHint('owner_role_required'));
    expect(saveErrorHint('forbidden')).not.toBeNull();
  });

  it('stays silent for a code it has nothing specific to add about', () => {
    expect(saveErrorHint('internal_server_error')).toBeNull();
    expect(saveErrorHint('constructor')).toBeNull();
    expect(saveErrorHint('')).toBeNull();
  });
});
