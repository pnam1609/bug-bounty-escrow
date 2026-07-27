import {
  MAX_UPLOAD_SIZE_BYTES,
  SAFE_UPLOAD_MIME_TYPES,
  SEVERITIES,
  type Program,
} from '@bug-bounty-escrow/shared';
import { ClipboardCheck, Crosshair, FileText, Gauge } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_SECURITY_NOTE,
  ATTACHMENT_TYPE_SUMMARY,
  BODY_MAX_LENGTH,
  characterCounter,
  commitDraftChange,
  describeUploadType,
  FIELD_FOCUS_ORDER,
  firstInvalidField,
  draftStorageKey,
  draftSuggestedSeverity,
  eligibleImpacts,
  eligibleScopes,
  EMPTY_DRAFT,
  hasSeverityMismatch,
  impactSuggestedSeverity,
  isDraftFieldKey,
  planAssetChange,
  POC_PLACEHOLDER,
  REPORT_PRIVACY_NOTICE,
  restoredDraft,
  retainedImpactIds,
  retainMismatchAcknowledgement,
  SEVERITY_DISCLAIMER,
  SEVERITY_GUIDANCE,
  severityMismatchMessage,
  staleImpactIds,
  STEP_COUNT,
  STEP_ERROR_SUMMARIES,
  STEP_HEADINGS,
  STEP_SUBTITLES,
  SUBMIT_BUG_STEPS,
  TITLE_MAX_LENGTH,
  toggleImpactId,
  touchedErrors,
  validateAssetsStep,
  validateAttachment,
  validateMainReportStep,
  validateSeverityStep,
  type FieldErrors,
  type ProgramImpact,
  type ProgramScope,
  type ReportDraft,
} from '@/components/submit-bug/submit-bug-model';

/*
 * SR-05 — composer shell, stepper and local autosave.
 * SR-06 — the Assets & Impact step: which assets and impacts are offered, what happens to the
 * selection when the affected asset changes, and the SR-01V messages.
 * SR-07 — the Severity step: what the selected impacts suggest, when that becomes a mismatch, and
 * how long an acknowledgement of one is allowed to live.
 * SR-08 — the Main Report step: the two separate content fields, the program-driven PoC rule, the
 * attachment rules and every SR-03V sentence, including the ones a `maxLength` or an `accept`
 * attribute would have made unreachable.
 *
 * These are the parts of the composer that are contracts rather than layout: the localStorage key
 * other surfaces read, the four steps the API payload depends on (Figma still shows the retired
 * Scope / Details / Proof / Review set), the field-level blur check, and above all the rule that
 * `programImpactIds` may never hold an id the form is not offering — the server rejects those with
 * `impact_not_eligible`, and the researcher can neither see nor clear them.
 */

describe('local autosave key', () => {
  it('is scoped per program and matches the published key exactly', () => {
    expect(draftStorageKey('aegis-1')).toBe('offchain-report-draft:aegis-1');
  });

  it('never collides across programs', () => {
    expect(draftStorageKey('a')).not.toBe(draftStorageKey('b'));
  });
});

describe('stepper model', () => {
  it('is the four steps from the flow doc, not the Figma set', () => {
    expect(STEP_COUNT).toBe(4);
    expect(SUBMIT_BUG_STEPS.map((step) => step.label)).toEqual([
      'Assets & Impact',
      'Severity',
      'Main Report',
      'Review',
    ]);
  });

  it('labels each node with its Lucide glyph and never a numeral', () => {
    expect(SUBMIT_BUG_STEPS.map((step) => step.icon)).toEqual([
      Crosshair,
      Gauge,
      FileText,
      ClipboardCheck,
    ]);
    for (const step of SUBMIT_BUG_STEPS) {
      expect(step.label).not.toMatch(/\d/);
    }
  });
});

describe('field-level blur validation', () => {
  it('recognises every validated field id, including one custom impact row', () => {
    expect(isDraftFieldKey('affectedScopeId')).toBe(true);
    expect(isDraftFieldKey('proposedSeverity')).toBe(true);
    expect(isDraftFieldKey('reproductionSteps')).toBe(true);
    expect(isDraftFieldKey('confirmed')).toBe(true);
    expect(isDraftFieldKey('customImpacts.2')).toBe(true);
  });

  it('ignores ids that do not name a validated field', () => {
    expect(isDraftFieldKey('')).toBe(false);
    expect(isDraftFieldKey('radix-:r1:')).toBe(false);
    expect(isDraftFieldKey('customImpacts.x')).toBe(false);
    expect(isDraftFieldKey('title-error')).toBe(false);
  });

  it('shows only the fields that already lost focus', () => {
    const errors: FieldErrors = {
      title: 'Enter a concise report title.',
      description: 'Describe the vulnerability and root cause.',
    };

    expect(touchedErrors(errors, ['title'])).toEqual({ title: 'Enter a concise report title.' });
    expect(touchedErrors(errors, [])).toEqual({});
  });

  it('drops a blurred field once it becomes valid', () => {
    expect(touchedErrors({}, ['title', 'description'])).toEqual({});
  });
});

/* ── SR-01 Assets & Impact ─────────────────────────────────────────────────────────────────── */

const marketingSite: ProgramScope = {
  id: 'scope-marketing',
  assetType: 'website',
  assetName: 'Marketing site',
  assetUrl: 'https://aegis.example',
  isInScope: true,
  sortOrder: 0,
  archived: false,
};

const dashboard: ProgramScope = {
  id: 'scope-dashboard',
  assetType: 'website',
  assetName: 'Researcher dashboard',
  assetUrl: 'https://app.aegis.example',
  isInScope: true,
  sortOrder: 1,
  archived: false,
};

const vault: ProgramScope = {
  id: 'scope-vault',
  assetType: 'smart_contract',
  assetName: 'Vault',
  contractAddress: '0xA41e5f0d2c8b9a7361f4e2d3c5b6a7980f1e2d3c',
  isInScope: true,
  sortOrder: 2,
  archived: false,
};

const outOfScope: ProgramScope = { ...dashboard, id: 'scope-blog', isInScope: false };
const archived: ProgramScope = { ...dashboard, id: 'scope-legacy', archived: true };

const xss: ProgramImpact = {
  id: 'impact-xss',
  assetType: 'website',
  severity: 'high',
  title: 'Stored XSS on an authenticated page',
  source: 'template',
  enabled: true,
  sortOrder: 1,
};

const takeover: ProgramImpact = {
  id: 'impact-takeover',
  assetType: 'website',
  severity: 'critical',
  title: 'Account takeover without user interaction',
  source: 'template',
  enabled: true,
  sortOrder: 0,
};

const retiredImpact: ProgramImpact = { ...xss, id: 'impact-retired', enabled: false };
const drain: ProgramImpact = { ...xss, id: 'impact-drain', assetType: 'smart_contract' };

/** Both eligibility helpers read only these arrays; the rest of `Program` is noise here. */
function programWith(scopes: readonly ProgramScope[], impacts: readonly ProgramImpact[]): Program {
  return { scopes, impacts } as unknown as Program;
}

function draftWith(patch: Partial<ReportDraft>): ReportDraft {
  return { ...EMPTY_DRAFT, ...patch };
}

describe('what SR-01 is allowed to offer', () => {
  it('offers only in-scope, non-archived assets', () => {
    const program = programWith([marketingSite, outOfScope, archived, vault], []);

    expect(eligibleScopes(program).map((scope) => scope.id)).toEqual([marketingSite.id, vault.id]);
  });

  it('offers only enabled impacts of the affected asset type, in the published order', () => {
    const program = programWith([marketingSite], [xss, retiredImpact, drain, takeover]);

    expect(eligibleImpacts(program, 'website').map((impact) => impact.id)).toEqual([
      takeover.id,
      xss.id,
    ]);
  });

  it('offers no impact at all until an asset is chosen', () => {
    const program = programWith([marketingSite], [xss, takeover]);

    expect(eligibleImpacts(program, undefined)).toEqual([]);
  });

  it('pre-selects neither an asset nor an impact', () => {
    expect(EMPTY_DRAFT.affectedScopeId).toBe('');
    expect(EMPTY_DRAFT.programImpactIds).toEqual([]);
  });
});

describe('impact selection', () => {
  it('adds an id once however often it is checked', () => {
    expect(toggleImpactId([], xss.id, true)).toEqual([xss.id]);
    expect(toggleImpactId([xss.id], xss.id, true)).toEqual([xss.id]);
  });

  it('removes an id on uncheck and leaves the rest in order', () => {
    expect(toggleImpactId([takeover.id, xss.id], takeover.id, false)).toEqual([xss.id]);
  });

  it('splits a selection into what the catalog still offers and what it does not', () => {
    const selected = [takeover.id, retiredImpact.id, xss.id];

    expect(retainedImpactIds(selected, [takeover, xss])).toEqual([takeover.id, xss.id]);
    expect(staleImpactIds(selected, [takeover, xss])).toEqual([retiredImpact.id]);
  });
});

/*
 * The asset-change rule from flow doc §8 SR-01. An impact row belongs to exactly one asset type,
 * so the only question each change has to answer is which selected ids survive — and whether
 * losing them needs the researcher's confirmation first.
 */
describe('changing the affected asset', () => {
  it('keeps the selected impacts when the new asset has the same type', () => {
    const plan = planAssetChange({
      current: marketingSite,
      next: dashboard,
      nextImpacts: [takeover, xss],
      selectedIds: [xss.id],
    });

    expect(plan.impactIds).toEqual([xss.id]);
    expect(plan.needsConfirmation).toBe(false);
  });

  it('clears the selection and asks first when the asset type changes', () => {
    const plan = planAssetChange({
      current: marketingSite,
      next: vault,
      nextImpacts: [drain],
      selectedIds: [takeover.id, xss.id],
    });

    expect(plan.impactIds).toEqual([]);
    expect(plan.needsConfirmation).toBe(true);
  });

  it('changes asset type without asking when the selection is empty', () => {
    const plan = planAssetChange({
      current: marketingSite,
      next: vault,
      nextImpacts: [drain],
      selectedIds: [],
    });

    expect(plan.impactIds).toEqual([]);
    expect(plan.needsConfirmation).toBe(false);
  });

  it('never asks on the first asset pick', () => {
    const plan = planAssetChange({
      current: undefined,
      next: marketingSite,
      nextImpacts: [takeover, xss],
      selectedIds: [],
    });

    expect(plan.needsConfirmation).toBe(false);
  });

  it('drops ids the catalog stopped offering instead of carrying them to the next asset', () => {
    // Same asset type, but the owner disabled one of the picked impacts in the meantime: it is no
    // longer rendered, so keeping it would leave a hidden stale id in the payload.
    const plan = planAssetChange({
      current: marketingSite,
      next: dashboard,
      nextImpacts: [takeover, xss],
      selectedIds: [xss.id, retiredImpact.id],
    });

    expect(plan.impactIds).toEqual([xss.id]);
    expect(plan.needsConfirmation).toBe(false);
  });

  it('only ever plans ids the new asset actually offers', () => {
    for (const next of [marketingSite, dashboard, vault]) {
      const nextImpacts = next.assetType === 'website' ? [takeover, xss] : [drain];
      const plan = planAssetChange({
        current: marketingSite,
        next,
        nextImpacts,
        selectedIds: [takeover.id, xss.id, retiredImpact.id, drain.id],
      });

      expect(plan.impactIds.every((id) => nextImpacts.some((impact) => impact.id === id))).toBe(
        true,
      );
    }
  });
});

describe('SR-01V validation messages', () => {
  const base = { allowCustomImpact: true, impacts: [takeover, xss], scopes: [marketingSite] };

  it('asks for an asset before anything else', () => {
    const errors = validateAssetsStep({ ...base, draft: EMPTY_DRAFT });

    expect(errors['affectedScopeId']).toBe('Choose the in-scope asset you tested.');
    expect(errors['programImpactIds']).toBe('Select at least one impact.');
  });

  it('reports an asset the owner has taken out of scope', () => {
    const errors = validateAssetsStep({
      ...base,
      draft: draftWith({ affectedScopeId: vault.id, programImpactIds: [xss.id] }),
    });

    expect(errors['affectedScopeId']).toBe(
      'This asset is no longer eligible. Refresh the program scope and choose another asset.',
    );
  });

  it('reports a selection the catalog no longer offers', () => {
    const errors = validateAssetsStep({
      ...base,
      draft: draftWith({
        affectedScopeId: marketingSite.id,
        programImpactIds: [xss.id, retiredImpact.id],
      }),
    });

    expect(errors['programImpactIds']).toBe(
      'One or more impacts no longer apply to this asset. Review your selections.',
    );
  });

  it('accepts a custom-only selection', () => {
    const errors = validateAssetsStep({
      ...base,
      draft: draftWith({
        affectedScopeId: marketingSite.id,
        customImpacts: ['Session fixation lets an attacker reuse a signed-out session'],
      }),
    });

    expect(errors).toEqual({});
  });

  it('reports a custom impact once the program stops accepting them', () => {
    const errors = validateAssetsStep({
      ...base,
      allowCustomImpact: false,
      draft: draftWith({
        affectedScopeId: marketingSite.id,
        programImpactIds: [xss.id],
        customImpacts: ['Anything at all'],
      }),
    });

    expect(errors['customImpacts']).toBe(
      'This program no longer accepts custom impacts. Remove the custom impact to continue.',
    );
  });

  it('reports an empty custom impact against its own row', () => {
    const errors = validateAssetsStep({
      ...base,
      draft: draftWith({
        affectedScopeId: marketingSite.id,
        programImpactIds: [xss.id],
        customImpacts: ['Reachable assertion', '   '],
      }),
    });

    expect(errors['customImpacts.1']).toBe('Describe the custom impact or remove this field.');
    expect(errors['customImpacts.0']).toBeUndefined();
  });
});

/* ── SR-02 Severity ────────────────────────────────────────────────────────────────────────── */

/*
 * Proposed severity is an independent field. The composer may compute what the selected impacts
 * imply and warn about a difference, but it must never derive, raise or lower the researcher's
 * proposal — the reviewer decides the final severity, and `severityMismatchAcknowledged` is only
 * an audit signal that one specific warning was read.
 */

const website = programWith([marketingSite, vault], [takeover, xss, drain]);

/** Marketing site + "Account takeover" (critical): the pair every mismatch test starts from. */
function severityDraft(patch: Partial<ReportDraft>): ReportDraft {
  return draftWith({
    affectedScopeId: marketingSite.id,
    programImpactIds: [takeover.id],
    ...patch,
  });
}

describe('what the selected impacts suggest', () => {
  it('is the highest severity among the selected program impacts', () => {
    expect(impactSuggestedSeverity([takeover, xss], [xss.id, takeover.id])).toBe('critical');
    expect(impactSuggestedSeverity([takeover, xss], [xss.id])).toBe('high');
  });

  it('ignores impacts the researcher did not select', () => {
    expect(impactSuggestedSeverity([takeover, xss], [])).toBeUndefined();
  });

  it('resolves the suggestion from the affected asset catalog alone', () => {
    // A website impact selected against the vault is not offered here, so it cannot suggest a
    // severity either — the same rule that keeps stale ids out of the payload.
    expect(draftSuggestedSeverity(website, severityDraft({}))).toBe('critical');
    expect(
      draftSuggestedSeverity(
        website,
        severityDraft({ affectedScopeId: vault.id, programImpactIds: [takeover.id] }),
      ),
    ).toBeUndefined();
  });

  it('has no suggestion at all for a custom-only selection', () => {
    // Custom impacts are researcher-proposed and carry no program-defined severity, so they must
    // never manufacture a mismatch the researcher then has to confirm.
    const customOnly = severityDraft({
      programImpactIds: [],
      customImpacts: ['Session fixation lets an attacker reuse a signed-out session'],
      proposedSeverity: 'low',
    });

    expect(draftSuggestedSeverity(website, customOnly)).toBeUndefined();
    expect(hasSeverityMismatch('low', undefined)).toBe(false);
    expect(validateSeverityStep(customOnly, undefined)).toEqual({});
  });
});

describe('the severity mismatch itself', () => {
  it('needs a proposal and a suggestion that actually differ', () => {
    expect(hasSeverityMismatch('', 'critical')).toBe(false);
    expect(hasSeverityMismatch('high', undefined)).toBe(false);
    expect(hasSeverityMismatch('high', 'high')).toBe(false);
    expect(hasSeverityMismatch('high', 'critical')).toBe(true);
  });

  it('names both values in the flow doc sentence', () => {
    expect(severityMismatchMessage('high', 'critical')).toBe(
      'Your selected impacts suggest Critical, but your proposed severity is High. Review your selection or confirm that you want to continue.',
    );
  });

  it('names both values in the other direction too', () => {
    expect(severityMismatchMessage('critical', 'informational')).toBe(
      'Your selected impacts suggest Informational, but your proposed severity is Critical. Review your selection or confirm that you want to continue.',
    );
  });
});

describe('SR-02V validation messages', () => {
  it('asks for a proposed severity before anything else', () => {
    expect(validateSeverityStep(severityDraft({}), 'critical')).toEqual({
      proposedSeverity: 'Select your proposed severity.',
    });
  });

  it('blocks Continue until an unconfirmed mismatch is confirmed', () => {
    const errors = validateSeverityStep(severityDraft({ proposedSeverity: 'high' }), 'critical');

    expect(errors['severityMismatchAcknowledged']).toBe(
      'Confirm the severity mismatch or update your selection.',
    );
    expect(errors['proposedSeverity']).toBeUndefined();
  });

  it('passes once the researcher confirms the mismatch', () => {
    const confirmed = severityDraft({
      proposedSeverity: 'high',
      severityMismatchAcknowledged: true,
    });

    expect(validateSeverityStep(confirmed, 'critical')).toEqual({});
  });

  it('never asks to confirm a proposal that matches the suggestion', () => {
    expect(
      validateSeverityStep(severityDraft({ proposedSeverity: 'critical' }), 'critical'),
    ).toEqual({});
  });

  it('summarises the step with the flow doc alert copy', () => {
    expect(STEP_ERROR_SUMMARIES[1]).toBe('Review your severity assessment before continuing.');
  });
});

/*
 * The acknowledgement answers exactly one question — "your impacts suggest X, but you propose Y" —
 * and the checkbox that clears it only exists while that question is on screen. So every draft
 * write re-asks whether the answer still applies; a `true` that outlived its pair would pass a
 * warning the researcher never read and would ship a false audit signal to the server.
 */
describe('how long a mismatch acknowledgement lives', () => {
  const acknowledged = severityDraft({
    proposedSeverity: 'low',
    severityMismatchAcknowledged: true,
  });

  function commit(patch: Partial<ReportDraft>): ReportDraft {
    return commitDraftChange(website, acknowledged, { ...acknowledged, ...patch });
  }

  it('survives a change that leaves both values standing', () => {
    expect(
      commit({ title: 'Account takeover via password reset' }).severityMismatchAcknowledged,
    ).toBe(true);
  });

  it('survives an impact added below the highest one', () => {
    // Still "impacts suggest Critical, but you propose Low": the sentence that was read is intact.
    expect(commit({ programImpactIds: [takeover.id, xss.id] }).severityMismatchAcknowledged).toBe(
      true,
    );
  });

  it('is dropped when the impacts move the suggestion to a different mismatch', () => {
    // Critical → High. Still a mismatch, but not the one that was acknowledged.
    const next = commit({ programImpactIds: [xss.id] });

    expect(draftSuggestedSeverity(website, next)).toBe('high');
    expect(next.severityMismatchAcknowledged).toBe(false);
    expect(validateSeverityStep(next, 'high')['severityMismatchAcknowledged']).toBe(
      'Confirm the severity mismatch or update your selection.',
    );
  });

  it('is dropped when the researcher changes the proposed severity', () => {
    expect(commit({ proposedSeverity: 'medium' }).severityMismatchAcknowledged).toBe(false);
  });

  it('is dropped when the mismatch disappears entirely', () => {
    expect(commit({ proposedSeverity: 'critical' }).severityMismatchAcknowledged).toBe(false);
  });

  it('is dropped when the last program impact goes', () => {
    const next = commit({ programImpactIds: [], customImpacts: ['Researcher proposed impact'] });

    expect(draftSuggestedSeverity(website, next)).toBeUndefined();
    expect(next.severityMismatchAcknowledged).toBe(false);
  });

  it('is dropped when the affected asset changes', () => {
    expect(
      commit({ affectedScopeId: vault.id, programImpactIds: [] }).severityMismatchAcknowledged,
    ).toBe(false);
  });

  it('accepts the tick the warning asks for', () => {
    const unconfirmed = severityDraft({ proposedSeverity: 'low' });
    const next = commitDraftChange(website, unconfirmed, {
      ...unconfirmed,
      severityMismatchAcknowledged: true,
    });

    expect(next.severityMismatchAcknowledged).toBe(true);
  });

  it('refuses an acknowledgement when there is no mismatch to acknowledge', () => {
    const matching = severityDraft({ proposedSeverity: 'critical' });
    const next = commitDraftChange(website, matching, {
      ...matching,
      severityMismatchAcknowledged: true,
    });

    expect(next.severityMismatchAcknowledged).toBe(false);
  });

  it('never changes the selection or the proposal while reconciling', () => {
    const next = commit({ proposedSeverity: 'medium' });

    expect(next.proposedSeverity).toBe('medium');
    expect(next.programImpactIds).toEqual([takeover.id]);
    expect(next.affectedScopeId).toBe(marketingSite.id);
  });

  it('decides on the pair alone, whatever the draft around it says', () => {
    const pair = {
      previousProposed: 'low',
      previousSuggested: 'critical',
      nextProposed: 'low',
      nextSuggested: 'critical',
    } as const;

    expect(retainMismatchAcknowledgement({ ...pair, acknowledged: true })).toBe(true);
    expect(retainMismatchAcknowledgement({ ...pair, acknowledged: false })).toBe(false);
    expect(
      retainMismatchAcknowledgement({ ...pair, acknowledged: true, nextSuggested: 'high' }),
    ).toBe(false);
    expect(
      retainMismatchAcknowledgement({ ...pair, acknowledged: true, nextProposed: 'high' }),
    ).toBe(false);
    expect(
      retainMismatchAcknowledgement({ ...pair, acknowledged: true, nextSuggested: undefined }),
    ).toBe(false);
  });

  it('is not restored from an earlier session, but the report content is', () => {
    const stored = severityDraft({
      proposedSeverity: 'low',
      severityMismatchAcknowledged: true,
      title: 'Account takeover via password reset',
      description: 'The reset token is not bound to the account.',
    });
    const restored = restoredDraft(stored);

    expect(restored.severityMismatchAcknowledged).toBe(false);
    expect(restored.proposedSeverity).toBe('low');
    expect(restored.programImpactIds).toEqual([takeover.id]);
    expect(restored.title).toBe(stored.title);
    expect(restored.description).toBe(stored.description);
  });

  it('leaves a stored draft without an acknowledgement exactly as it was', () => {
    const stored = severityDraft({ proposedSeverity: 'low' });

    expect(restoredDraft(stored)).toBe(stored);
  });
});

describe('SR-02 copy', () => {
  it('uses the flow doc heading and supporting copy', () => {
    expect(STEP_HEADINGS[1]).toBe('Choose your proposed severity');
    expect(STEP_SUBTITLES[1]).toBe(
      'Use the highest severity that matches the impacts you selected. This is your assessment; the reviewer makes the final decision.',
    );
  });

  it('always states who decides the final severity', () => {
    expect(SEVERITY_DISCLAIMER).toBe(
      'This is your assessment. The reviewer makes the final severity decision.',
    );
  });

  it('offers the five severities with guidance beside each one', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'medium', 'low', 'informational']);
    for (const severity of SEVERITIES) {
      expect(SEVERITY_GUIDANCE[severity].length).toBeGreaterThan(0);
    }
  });

  it('pre-selects no severity and no acknowledgement', () => {
    expect(EMPTY_DRAFT.proposedSeverity).toBe('');
    expect(EMPTY_DRAFT.severityMismatchAcknowledged).toBe(false);
  });
});

/* ── SR-03 Main Report ─────────────────────────────────────────────────────────────────────── */

/*
 * Every SR-03V sentence is judged here rather than by an attribute on the control. That is the
 * point of these tests: a `maxLength` on the title would silently swallow the 301st character and
 * "Keep the title within 300 characters." could never be shown, and `accept` on the file input is
 * only a filter on the OS dialog — "All files" and drag-and-drop walk straight past it.
 */

const filledReport: Partial<ReportDraft> = {
  title: 'Re-entrancy can drain the staking pool',
  description: 'withdraw() calls the receiver before it zeroes the balance, so it can re-enter.',
};

function mainReportErrors(
  patch: Partial<ReportDraft>,
  options: { readonly attachmentError?: string | null; readonly proofRequired?: boolean } = {},
): FieldErrors {
  return validateMainReportStep({
    attachmentError: options.attachmentError ?? null,
    draft: draftWith({ ...filledReport, ...patch }),
    proofRequired: options.proofRequired ?? false,
  });
}

/** `validateAttachment` reads three fields, so the 10 MB case never has to allocate 10 MB. */
function pickedFile(overrides: {
  readonly name?: string;
  readonly size?: number;
  readonly type?: string;
}): File {
  return {
    name: overrides.name ?? 'proof-of-concept.txt',
    size: overrides.size ?? 2_048,
    type: overrides.type ?? 'text/plain',
  } as File;
}

describe('SR-03 report content', () => {
  it('asks for a title and a description in the flow doc wording', () => {
    expect(mainReportErrors({ title: '', description: '' })).toEqual({
      title: 'Enter a concise report title.',
      description: 'Describe the vulnerability and root cause.',
    });
  });

  it('treats a whitespace-only field as empty', () => {
    expect(mainReportErrors({ title: '   ', description: '\n\t ' })).toEqual({
      title: 'Enter a concise report title.',
      description: 'Describe the vulnerability and root cause.',
    });
  });

  it('reports a title past 300 characters instead of truncating it', () => {
    // The regression guard for the attribute trap: this message only exists because nothing caps
    // the control, so a 301st character can be typed, pasted or rehydrated and then judged.
    const errors = mainReportErrors({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) });

    expect(errors['title']).toBe('Keep the title within 300 characters.');
  });

  it('accepts a title of exactly 300 characters', () => {
    expect(mainReportErrors({ title: 'a'.repeat(TITLE_MAX_LENGTH) })).toEqual({});
  });

  it('reports a description and a PoC past 50,000 characters', () => {
    const tooLong = 'a'.repeat(BODY_MAX_LENGTH + 1);

    expect(mainReportErrors({ description: tooLong })['description']).toBe(
      'Keep the description within 50,000 characters.',
    );
    expect(mainReportErrors({ reproductionSteps: tooLong })['reproductionSteps']).toBe(
      'Keep the reproduction steps within 50,000 characters.',
    );
  });

  it('keeps description and reproduction steps as two separate fields', () => {
    // Flow doc §3: they are two columns of the report contract, so one may fail without the other.
    const errors = mainReportErrors({
      description: '',
      reproductionSteps: 'Send tx A, then tx B.',
    });

    expect(errors['description']).toBe('Describe the vulnerability and root cause.');
    expect(errors['reproductionSteps']).toBeUndefined();
  });
});

/*
 * AC 4 / flow doc §8 SR-03: "Required/optional state lấy từ program PoC policy; không hardcode cùng
 * một rule cho mọi program." The same empty draft has to pass for one program and fail for another.
 */
describe('SR-03 proof of concept policy', () => {
  it('requires reproduction steps only when the program does', () => {
    expect(mainReportErrors({ reproductionSteps: '' }, { proofRequired: true })).toEqual({
      reproductionSteps: 'This program requires proof of concept or clear reproduction steps.',
    });
    expect(mainReportErrors({ reproductionSteps: '' }, { proofRequired: false })).toEqual({});
  });

  it('does not accept whitespace as a proof of concept', () => {
    expect(
      mainReportErrors({ reproductionSteps: '   \n ' }, { proofRequired: true })[
        'reproductionSteps'
      ],
    ).toBe('This program requires proof of concept or clear reproduction steps.');
  });

  it('never lets a Gist URL stand in for a required proof of concept', () => {
    const errors = mainReportErrors(
      { reproductionSteps: '', secretGistUrl: 'https://gist.github.com/researcher/abc123' },
      { proofRequired: true },
    );

    expect(errors['reproductionSteps']).toBe(
      'This program requires proof of concept or clear reproduction steps.',
    );
  });

  it('passes once the required steps are written', () => {
    expect(
      mainReportErrors({ reproductionSteps: '1. Deposit\n2. Re-enter' }, { proofRequired: true }),
    ).toEqual({});
  });
});

describe('SR-03 secret Gist URL', () => {
  it('is optional', () => {
    expect(mainReportErrors({ secretGistUrl: '' })).toEqual({});
    expect(mainReportErrors({ secretGistUrl: '   ' })).toEqual({});
  });

  it('accepts an HTTPS URL', () => {
    expect(
      mainReportErrors({ secretGistUrl: 'https://gist.github.com/researcher/abc123' }),
    ).toEqual({});
  });

  it('refuses plain HTTP and anything that is not a URL', () => {
    for (const value of ['http://gist.github.com/researcher/abc123', 'gist.github.com', 'nope']) {
      expect(mainReportErrors({ secretGistUrl: value })['secretGistUrl']).toBe(
        'Enter a valid HTTPS Gist URL.',
      );
    }
  });
});

describe('SR-03V attachment rules', () => {
  it('accepts every type the upload contract allows', () => {
    for (const mimeType of SAFE_UPLOAD_MIME_TYPES) {
      expect(validateAttachment(pickedFile({ type: mimeType }))).toBeNull();
    }
  });

  it('refuses a type outside the contract, whatever the picker allowed through', () => {
    expect(validateAttachment(pickedFile({ name: 'poc.zip', type: 'application/zip' }))).toBe(
      'Choose a supported TXT, MD, JSON, PDF or image file.',
    );
  });

  it('refuses a file over 10 MB', () => {
    expect(validateAttachment(pickedFile({ size: MAX_UPLOAD_SIZE_BYTES + 1 }))).toBe(
      'Choose a file smaller than 10 MB.',
    );
    expect(validateAttachment(pickedFile({ size: MAX_UPLOAD_SIZE_BYTES }))).toBeNull();
  });

  it('refuses a filename carrying folders or control characters', () => {
    for (const name of ['proofs/poc.txt', 'proofs\\poc.txt', 'poc\u0001.txt', '']) {
      expect(validateAttachment(pickedFile({ name }))).toBe(
        'Rename the file without folders or control characters.',
      );
    }
  });

  it('blocks the step through the attachment field, not a separate surface', () => {
    const errors = mainReportErrors({}, { attachmentError: 'Choose a file smaller than 10 MB.' });

    expect(errors['attachment']).toBe('Choose a file smaller than 10 MB.');
  });

  it('advertises exactly the types the contract accepts', () => {
    expect(ATTACHMENT_TYPE_SUMMARY).toBe('TXT, MD, JSON, PDF, PNG, JPEG or WebP');
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual([...SAFE_UPLOAD_MIME_TYPES]);
    expect(describeUploadType('image/webp')).toBe('WebP');
    expect(describeUploadType('application/x-unknown')).toBe('application/x-unknown');
  });
});

describe('SR-03 character counters', () => {
  it('starts at the flow doc values, including the thousands separator', () => {
    expect(characterCounter('', TITLE_MAX_LENGTH)).toBe('0 / 300');
    expect(characterCounter('', BODY_MAX_LENGTH)).toBe('0 / 50,000');
  });

  it('counts the same value the validator judges, so it never contradicts the message', () => {
    const overLong = 'a'.repeat(TITLE_MAX_LENGTH + 1);

    expect(characterCounter(overLong, TITLE_MAX_LENGTH)).toBe('301 / 300');
    expect(mainReportErrors({ title: overLong })['title']).toBe(
      'Keep the title within 300 characters.',
    );
    expect(characterCounter('  ab  ', TITLE_MAX_LENGTH)).toBe('2 / 300');
  });

  it('never replaces a validation message', () => {
    // Both are rendered: the counter is a separate node in `Field`, not the message slot.
    expect(mainReportErrors({ title: '' })['title']).toBe('Enter a concise report title.');
    expect(characterCounter('', TITLE_MAX_LENGTH)).toBe('0 / 300');
  });
});

describe('SR-03V focus order', () => {
  it('jumps to the first invalid control in on-screen order', () => {
    const everything = mainReportErrors(
      { title: '', description: '', reproductionSteps: '', secretGistUrl: 'nope' },
      { attachmentError: 'Choose a file smaller than 10 MB.', proofRequired: true },
    );

    expect(firstInvalidField(everything)).toBe('title');
    expect(firstInvalidField(mainReportErrors({ description: '' }))).toBe('description');
    expect(
      firstInvalidField(mainReportErrors({ reproductionSteps: '' }, { proofRequired: true })),
    ).toBe('reproductionSteps');
    expect(firstInvalidField(mainReportErrors({ secretGistUrl: 'nope' }))).toBe('secretGistUrl');
    expect(
      firstInvalidField(
        mainReportErrors({}, { attachmentError: 'Choose a file smaller than 10 MB.' }),
      ),
    ).toBe('attachment');
  });

  it('orders the step-3 keys exactly as the step renders them', () => {
    const stepThree = FIELD_FOCUS_ORDER.filter((field) =>
      ['title', 'description', 'reproductionSteps', 'secretGistUrl', 'attachment'].includes(field),
    );

    expect(stepThree).toEqual([
      'title',
      'description',
      'reproductionSteps',
      'secretGistUrl',
      'attachment',
    ]);
  });
});

describe('SR-03 copy', () => {
  it('uses the flow doc heading and step summary', () => {
    expect(STEP_HEADINGS[2]).toBe('Write the vulnerability report');
    expect(STEP_ERROR_SUMMARIES[2]).toBe('Review the highlighted fields before continuing.');
  });

  it('keeps the structured PoC placeholder verbatim, line breaks included', () => {
    expect(POC_PLACEHOLDER).toBe(
      '1. Set up the affected environment…\n2. Send the following transaction/request…\n3. Observe…\nExpected result…\nActual result…',
    );
  });

  it('states the privacy notice and the security note verbatim', () => {
    expect(REPORT_PRIVACY_NOTICE).toBe(
      'Your report stays private to authorized reviewers. Do not include seed phrases, private keys or unrelated personal data.',
    );
    expect(ATTACHMENT_SECURITY_NOTE).toBe(
      'Files are uploaded to private storage using a short-lived link after the report is created.',
    );
  });
});

/*
 * A validation error is a message about the draft, never an edit to it: the researcher must be able
 * to leave a failed step and come back to everything they typed (AC 14 / flow doc §8 SR-03V).
 */
describe('validation never touches the draft', () => {
  it('leaves earlier steps and the report content exactly as they were', () => {
    const draft = draftWith({
      ...filledReport,
      affectedScopeId: marketingSite.id,
      programImpactIds: [takeover.id],
      customImpacts: ['Researcher proposed impact'],
      proposedSeverity: 'high',
      severityMismatchAcknowledged: true,
      title: '',
      secretGistUrl: 'nope',
    });
    const snapshot = structuredClone(draft);

    validateMainReportStep({ attachmentError: null, draft, proofRequired: true });
    validateAssetsStep({
      allowCustomImpact: true,
      draft,
      impacts: [takeover, xss],
      scopes: [marketingSite],
    });
    validateSeverityStep(draft, 'critical');

    expect(draft).toEqual(snapshot);
  });
});
