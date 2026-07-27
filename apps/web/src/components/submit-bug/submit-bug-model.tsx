/*
 * Shared model for the researcher Submit Bug composer.
 *
 * The structure follows docs/flow/submit-bug-researcher-flow-for-figma.md, which supersedes the
 * Figma composer frames: the four steps are Assets & Impact → Severity → Main Report → Review and
 * there is no free-text `impact` field anywhere. Impact selection is relational
 * (`programImpactIds` + `customImpacts`) and proposed severity is an independent field.
 *
 * Everything here is pure so the step components stay presentational and the orchestrator owns
 * state. No report content ever leaves the browser from this module — the only persistence is the
 * program-scoped localStorage draft the flow doc mandates.
 */

import {
  SEVERITIES,
  highestSeverity,
  httpsUrlSchema,
  MAX_UPLOAD_SIZE_BYTES,
  SAFE_UPLOAD_MIME_TYPES,
  type AssetType,
  type Program,
  type Severity,
} from '@bug-bounty-escrow/shared';
import { SEVERITY_LABELS } from '@bug-bounty-escrow/ui';
import { ClipboardCheck, Crosshair, FileText, Gauge } from 'lucide-react';
import { z } from 'zod';

import type { StepperStep } from '@bug-bounty-escrow/ui';

/* ── Steps ──────────────────────────────────────────────────────────────────────────────── */

/**
 * Flow doc §5 "Stepper states": Lucide glyphs, never numerals. The Figma stepper still draws
 * `shield-check` and `circle-alert` on the first two nodes; the flow doc's `crosshair` and `gauge`
 * win because those nodes were not updated when the step model changed.
 */
export const SUBMIT_BUG_STEPS: readonly StepperStep[] = Object.freeze([
  { id: 'assets', icon: Crosshair, label: 'Assets & Impact' },
  { id: 'severity', icon: Gauge, label: 'Severity' },
  { id: 'report', icon: FileText, label: 'Main Report' },
  { id: 'review', icon: ClipboardCheck, label: 'Review' },
]);

export const STEP_COUNT = SUBMIT_BUG_STEPS.length;

export type StepIndex = 0 | 1 | 2 | 3;

export const STEP_HEADINGS: Readonly<Record<StepIndex, string>> = Object.freeze({
  0: 'Choose the affected asset and impact',
  1: 'Choose your proposed severity',
  2: 'Write the vulnerability report',
  3: 'Review your private report',
});

export const STEP_SUBTITLES: Readonly<Record<StepIndex, string>> = Object.freeze({
  0: 'Select the in-scope asset where you found the vulnerability, then choose every program impact that applies.',
  1: 'Use the highest severity that matches the impacts you selected. This is your assessment; the reviewer makes the final decision.',
  2: 'Provide enough detail for the program to reproduce and assess the vulnerability.',
  3: 'Confirm the private report and submission policy before sending.',
});

/* ── Draft ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The pre-submit draft. There is no server draft in this flow: `POST /api/programs/:id/reports`
 * creates the report directly as `submitted`, so this object only ever lives in this browser.
 */
export interface ReportDraft {
  readonly affectedScopeId: string;
  readonly programImpactIds: readonly string[];
  readonly customImpacts: readonly string[];
  readonly proposedSeverity: Severity | '';
  readonly severityMismatchAcknowledged: boolean;
  readonly title: string;
  readonly description: string;
  readonly reproductionSteps: string;
  readonly secretGistUrl: string;
}

/** The free-text draft fields, i.e. everything Step 3 edits through a plain string control. */
export type TextDraftField = 'description' | 'reproductionSteps' | 'secretGistUrl' | 'title';

export const EMPTY_DRAFT: ReportDraft = Object.freeze({
  affectedScopeId: '',
  programImpactIds: Object.freeze([]),
  customImpacts: Object.freeze([]),
  proposedSeverity: '',
  severityMismatchAcknowledged: false,
  title: '',
  description: '',
  reproductionSteps: '',
  secretGistUrl: '',
});

const draftSchema = z
  .object({
    affectedScopeId: z.string(),
    programImpactIds: z.array(z.string()),
    customImpacts: z.array(z.string()),
    proposedSeverity: z.union([z.enum(SEVERITIES), z.literal('')]),
    severityMismatchAcknowledged: z.boolean(),
    title: z.string(),
    description: z.string(),
    reproductionSteps: z.string(),
    secretGistUrl: z.string(),
  })
  .strict();

export function draftStorageKey(programId: string): string {
  return `offchain-report-draft:${programId}`;
}

export function readDraft(programId: string): ReportDraft | null {
  try {
    const stored = window.localStorage.getItem(draftStorageKey(programId));
    if (stored === null) return null;

    const parsed = draftSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    // A corrupt or unreadable draft must never block the composer.
    return null;
  }
}

export function writeDraft(programId: string, draft: ReportDraft): void {
  try {
    window.localStorage.setItem(draftStorageKey(programId), JSON.stringify(draft));
  } catch {
    // Private-mode or quota failures degrade to "no autosave", never to a thrown render.
  }
}

export function clearDraft(programId: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(programId));
  } catch {
    /* nothing to clean up */
  }
}

export function isDraftDirty(draft: ReportDraft, hasFile: boolean): boolean {
  return (
    hasFile ||
    draft.affectedScopeId !== '' ||
    draft.programImpactIds.length > 0 ||
    draft.customImpacts.length > 0 ||
    draft.proposedSeverity !== '' ||
    draft.title.trim() !== '' ||
    draft.description.trim() !== '' ||
    draft.reproductionSteps.trim() !== '' ||
    draft.secretGistUrl.trim() !== ''
  );
}

/* ── Program projections ────────────────────────────────────────────────────────────────── */

export type ProgramScope = Program['scopes'][number];
export type ProgramImpact = Program['impacts'][number];

export const ASSET_TYPE_LABELS: Readonly<Record<AssetType, string>> = Object.freeze({
  smart_contract: 'Smart contract',
  website: 'Website',
  api: 'API',
  mobile: 'Mobile',
});

/** Only `isInScope` and non-archived assets may be reported against (flow doc §2). */
export function eligibleScopes(program: Program): readonly ProgramScope[] {
  return program.scopes.filter((scope) => scope.isInScope && !scope.archived);
}

/**
 * The catalog is filtered three ways at once — enabled, this program, and matching the affected
 * scope's asset type. The server rejects anything else, so the form must not offer it either.
 */
export function eligibleImpacts(
  program: Program,
  assetType: AssetType | undefined,
): readonly ProgramImpact[] {
  if (assetType === undefined) return [];

  return [...program.impacts]
    .filter((impact) => impact.enabled && impact.assetType === assetType)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function findScope(
  scopes: readonly ProgramScope[],
  scopeId: string,
): ProgramScope | undefined {
  return scopes.find((scope) => scope.id === scopeId);
}

/* ── Impact selection ───────────────────────────────────────────────────────────────────── */

/**
 * The selected catalog impacts that still resolve to an offered impact. Anything else is an id the
 * form no longer renders, and SR-01 is explicit that hidden stale impact ids must never survive in
 * the payload — the server would reject them with `impact_not_eligible` anyway.
 */
export function retainedImpactIds(
  selectedIds: readonly string[],
  available: readonly ProgramImpact[],
): readonly string[] {
  return selectedIds.filter((id) => available.some((impact) => impact.id === id));
}

/** The mirror of `retainedImpactIds`: selected ids that no longer resolve to an offered impact. */
export function staleImpactIds(
  selectedIds: readonly string[],
  available: readonly ProgramImpact[],
): readonly string[] {
  return selectedIds.filter((id) => !available.some((impact) => impact.id === id));
}

/** Adds or removes one catalog impact. Re-checking an id can never duplicate it in the payload. */
export function toggleImpactId(
  selectedIds: readonly string[],
  impactId: string,
  checked: boolean,
): readonly string[] {
  if (!checked) return selectedIds.filter((id) => id !== impactId);

  return selectedIds.includes(impactId) ? selectedIds : [...selectedIds, impactId];
}

export interface AssetChangeInput {
  /** The scope the draft points at today, or `undefined` before the first pick. */
  readonly current: ProgramScope | undefined;
  readonly next: ProgramScope | undefined;
  /** The impacts the *next* scope offers, i.e. `eligibleImpacts(program, next?.assetType)`. */
  readonly nextImpacts: readonly ProgramImpact[];
  readonly selectedIds: readonly string[];
}

export interface AssetChangePlan {
  /** Exactly what `programImpactIds` becomes once the change is applied. */
  readonly impactIds: readonly string[];
  /** True when the researcher has to confirm losing impacts to a different asset type. */
  readonly needsConfirmation: boolean;
}

/**
 * Reconciles the impact selection with a newly chosen asset (flow doc §8, SR-01 "Asset-change
 * rule").
 *
 * An impact row belongs to exactly one asset type, so moving to the same type keeps every
 * selection that is still in the catalog, and moving to a different type invalidates all of them.
 * Losing a selection to a type change is confirmed rather than silent; ids the form already
 * stopped offering are dropped outright, because keeping them would put a hidden stale id in the
 * payload.
 */
export function planAssetChange(input: AssetChangeInput): AssetChangePlan {
  const { current, next, nextImpacts, selectedIds } = input;
  const impactIds = retainedImpactIds(selectedIds, nextImpacts);

  return {
    impactIds,
    needsConfirmation:
      current !== undefined &&
      next?.assetType !== current.assetType &&
      impactIds.length < selectedIds.length,
  };
}

function shortenAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** "Smart contract · 0xA41e…90C2" — the asset subtitle drawn in SR-01. */
export function describeScope(scope: ProgramScope): string {
  const parts = [ASSET_TYPE_LABELS[scope.assetType]];
  if (scope.contractAddress !== undefined) parts.push(shortenAddress(scope.contractAddress));
  if (scope.assetUrl !== undefined) parts.push(scope.assetUrl);
  return parts.join(' · ');
}

/* ── Severity ───────────────────────────────────────────────────────────────────────────── */

export const SEVERITY_GUIDANCE: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'Direct loss, permanent freeze or complete protocol compromise',
  high: 'Major asset or security impact with a realistic exploitation path',
  medium: 'Limited impact, a constrained exploit or a significant malfunction',
  low: 'Minor security impact, or an issue that is hard to exploit',
  informational: 'Best practice or an observation with no direct security impact',
});

export const SEVERITY_DISCLAIMER =
  'This is your assessment. The reviewer makes the final severity decision.';

/**
 * The severity the selected catalog impacts imply. Custom impacts are researcher-proposed, so they
 * deliberately contribute nothing here — a custom-only selection has no suggestion and therefore
 * can never raise a false mismatch (flow doc §8, SR-02).
 */
export function impactSuggestedSeverity(
  impacts: readonly ProgramImpact[],
  selectedIds: readonly string[],
): Severity | undefined {
  return highestSeverity(
    impacts.filter((impact) => selectedIds.includes(impact.id)).map((impact) => impact.severity),
  );
}

export function hasSeverityMismatch(
  proposed: Severity | '',
  suggested: Severity | undefined,
): boolean {
  return proposed !== '' && suggested !== undefined && proposed !== suggested;
}

/**
 * The whole-draft form of `impactSuggestedSeverity`, resolved against the published program.
 *
 * The step renders the suggestion from the memoised catalog it already has; this variant answers
 * the same question for a draft that has not been applied yet, which is what lets a change be
 * judged before it lands (see `commitDraftChange`).
 */
export function draftSuggestedSeverity(
  program: Program | undefined,
  draft: ReportDraft,
): Severity | undefined {
  if (program === undefined) return undefined;

  const scope = findScope(eligibleScopes(program), draft.affectedScopeId);

  return impactSuggestedSeverity(
    eligibleImpacts(program, scope?.assetType),
    draft.programImpactIds,
  );
}

/**
 * The mismatch warning, naming both values (flow doc §3 "Severity guidance"). It is built here so
 * the sentence the researcher acknowledges cannot drift from the pair the code compared.
 */
export function severityMismatchMessage(proposed: Severity, suggested: Severity): string {
  return `Your selected impacts suggest ${SEVERITY_LABELS[suggested]}, but your proposed severity is ${SEVERITY_LABELS[proposed]}. Review your selection or confirm that you want to continue.`;
}

export interface MismatchAcknowledgementInput {
  /** The acknowledgement the write is asking for. */
  readonly acknowledged: boolean;
  readonly nextProposed: Severity | '';
  readonly nextSuggested: Severity | undefined;
  readonly previousProposed: Severity | '';
  readonly previousSuggested: Severity | undefined;
}

/**
 * Whether an acknowledgement survives a draft change.
 *
 * `severityMismatchAcknowledged` is an audit signal, not a preference: it records that the
 * researcher read one specific sentence — "your impacts suggest X, but you propose Y" — and chose
 * to continue anyway. So it may only outlive a change that leaves that exact pair standing. A
 * `true` that survived into a *different* mismatch would silently pass a warning nobody ever saw,
 * and a `true` that survived into *no* mismatch would ship a false signal to the server, where
 * SR-04 folds it into the report content hash.
 *
 * Adding a second impact below the current highest keeps the sentence true, so the acknowledgement
 * stands; anything that moves either value drops it and the checkbox is asked again.
 */
export function retainMismatchAcknowledgement(input: MismatchAcknowledgementInput): boolean {
  const { acknowledged, nextProposed, nextSuggested, previousProposed, previousSuggested } = input;

  if (!acknowledged) return false;
  if (!hasSeverityMismatch(nextProposed, nextSuggested)) return false;

  return nextProposed === previousProposed && nextSuggested === previousSuggested;
}

/**
 * Applies a draft change and reconciles the mismatch acknowledgement with it.
 *
 * Every draft write goes through this, because the checkbox is the only affordance that can clear
 * the acknowledgement and it is rendered *only* while a mismatch is on screen — leaving a stale
 * `true` behind would be state the researcher can no longer reach.
 */
export function commitDraftChange(
  program: Program | undefined,
  current: ReportDraft,
  next: ReportDraft,
): ReportDraft {
  const acknowledged = retainMismatchAcknowledgement({
    acknowledged: next.severityMismatchAcknowledged,
    nextProposed: next.proposedSeverity,
    nextSuggested: draftSuggestedSeverity(program, next),
    previousProposed: current.proposedSeverity,
    previousSuggested: draftSuggestedSeverity(program, current),
  });

  return acknowledged === next.severityMismatchAcknowledged
    ? next
    : { ...next, severityMismatchAcknowledged: acknowledged };
}

/**
 * The stored draft as a fresh session must start from it.
 *
 * Report content is restored untouched; the acknowledgement deliberately is not. It describes a
 * warning that was read in an earlier session, against a catalog the owner may have edited since,
 * and the composer restarts at step 1 anyway — so the researcher walks past the warning again and
 * confirms the mismatch that is actually on screen.
 */
export function restoredDraft(stored: ReportDraft): ReportDraft {
  return stored.severityMismatchAcknowledged
    ? { ...stored, severityMismatchAcknowledged: false }
    : stored;
}

/* ── Attachment ─────────────────────────────────────────────────────────────────────────── */

export const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_SIZE_BYTES / 1024 / 1024);

export const ATTACHMENT_ACCEPT = SAFE_UPLOAD_MIME_TYPES.join(',');

/**
 * Human labels for the contract's safe MIME list. `accept` and the validator both work in MIME
 * types; the researcher reads extensions, and the selected-file row has to name the type it
 * accepted (flow doc §8, SR-03 field 5).
 */
const UPLOAD_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'application/json': 'JSON',
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
});

/** Falls back to the raw MIME type: an unlabelled type is still worth showing, never hiding. */
export function describeUploadType(mimeType: string): string {
  return UPLOAD_TYPE_LABELS[mimeType] ?? mimeType;
}

const UPLOAD_TYPE_SUMMARY_PARTS = SAFE_UPLOAD_MIME_TYPES.map(describeUploadType);

/**
 * "TXT, MD, JSON, PDF, PNG, JPEG or WebP" — derived from `SAFE_UPLOAD_MIME_TYPES` so the list the
 * dropzone advertises cannot drift from the list the server accepts.
 */
export const ATTACHMENT_TYPE_SUMMARY = `${UPLOAD_TYPE_SUMMARY_PARTS.slice(0, -1).join(', ')} or ${UPLOAD_TYPE_SUMMARY_PARTS.slice(-1).join('')}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isSafeFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= 255 &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    [...filename].every((character) => character.charCodeAt(0) >= 32)
  );
}

function isSafeMimeType(mimeType: string): boolean {
  return (SAFE_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * SR-03V attachment rules. Returns the message to show, or `null` when the file is acceptable.
 *
 * All three rules stay here rather than on the control: `accept` only filters the OS dialog — it is
 * bypassed by "All files" and by drag and drop — and there is no attribute that caps a file size at
 * all. So every message below is reachable, which is the point of stating them.
 */
export function validateAttachment(file: File): string | null {
  if (!isSafeMimeType(file.type)) {
    return 'Choose a supported TXT, MD, JSON, PDF or image file.';
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `Choose a file smaller than ${String(MAX_UPLOAD_MB)} MB.`;
  }
  if (!isSafeFilename(file.name)) {
    return 'Rename the file without folders or control characters.';
  }
  return null;
}

/* ── Main report copy ───────────────────────────────────────────────────────────────────── */

export const TITLE_MAX_LENGTH = 300;
export const BODY_MAX_LENGTH = 50_000;

/**
 * "0 / 300" and "0 / 50,000" (flow doc §8, SR-03).
 *
 * It counts the trimmed value because that is what the validator judges and what the payload
 * carries, so the counter can never sit at 300 while "Keep the title within 300 characters." is
 * being shown — or the other way round.
 */
export function characterCounter(value: string, max: number): string {
  return `${String(value.trim().length)} / ${max.toLocaleString('en-US')}`;
}

/** SR-03 PoC placeholder, verbatim including its line breaks. */
export const POC_PLACEHOLDER = `1. Set up the affected environment…
2. Send the following transaction/request…
3. Observe…
Expected result…
Actual result…`;

/** SR-03 info callout, verbatim. */
export const REPORT_PRIVACY_NOTICE =
  'Your report stays private to authorized reviewers. Do not include seed phrases, private keys or unrelated personal data.';

/** SR-03V security note, verbatim. It describes SR-04's two-transaction upload, not a promise. */
export const ATTACHMENT_SECURITY_NOTE =
  'Files are uploaded to private storage using a short-lived link after the report is created.';

/* ── Validation ─────────────────────────────────────────────────────────────────────────── */

/**
 * Flat, string-keyed errors. Bracket access returns `string | undefined`, which is exactly what
 * `Field`, `CheckboxField` and `RadioGroupItemField` accept for their `error` prop, so a field is
 * either linked to a live message or has none at all.
 */
export type FieldErrors = Readonly<Record<string, string>>;

export function customImpactErrorKey(index: number): string {
  return `customImpacts.${String(index)}`;
}

/*
 * Two SR-01V messages describe a draft the program has outgrown rather than a field the researcher
 * filled in wrong. The step renders them where the researcher can act on them — next to the control
 * that clears the offending state — so the copy lives here once instead of in both places.
 */
export const STALE_IMPACTS_MESSAGE =
  'One or more impacts no longer apply to this asset. Review your selections.';

export const CUSTOM_IMPACTS_DISABLED_MESSAGE =
  'This program no longer accepts custom impacts. Remove the custom impact to continue.';

export interface AssetsStepInput {
  readonly allowCustomImpact: boolean;
  readonly draft: ReportDraft;
  readonly scopes: readonly ProgramScope[];
  readonly impacts: readonly ProgramImpact[];
}

export function validateAssetsStep(input: AssetsStepInput): FieldErrors {
  const errors: Record<string, string> = {};
  const { allowCustomImpact, draft, impacts, scopes } = input;

  if (draft.affectedScopeId === '') {
    errors['affectedScopeId'] = 'Choose the in-scope asset you tested.';
  } else if (findScope(scopes, draft.affectedScopeId) === undefined) {
    errors['affectedScopeId'] =
      'This asset is no longer eligible. Refresh the program scope and choose another asset.';
  }

  const trimmedCustom = draft.customImpacts.map((entry) => entry.trim());

  if (draft.programImpactIds.length === 0 && trimmedCustom.filter(Boolean).length === 0) {
    errors['programImpactIds'] = 'Select at least one impact.';
  } else if (staleImpactIds(draft.programImpactIds, impacts).length > 0) {
    // Reached when the owner edits the catalog under a draft that was already selected: the ids
    // are no longer rendered, so the step blocks until the researcher clears them.
    errors['programImpactIds'] = STALE_IMPACTS_MESSAGE;
  }

  if (!allowCustomImpact && draft.customImpacts.length > 0) {
    errors['customImpacts'] = CUSTOM_IMPACTS_DISABLED_MESSAGE;
  }

  draft.customImpacts.forEach((entry, index) => {
    if (entry.trim() === '') {
      errors[customImpactErrorKey(index)] = 'Describe the custom impact or remove this field.';
    } else if (entry.trim().length > 300) {
      errors[customImpactErrorKey(index)] = 'Keep the custom impact within 300 characters.';
    }
  });

  return errors;
}

export function validateSeverityStep(
  draft: ReportDraft,
  suggested: Severity | undefined,
): FieldErrors {
  const errors: Record<string, string> = {};

  if (draft.proposedSeverity === '') {
    errors['proposedSeverity'] = 'Select your proposed severity.';
    return errors;
  }

  if (
    hasSeverityMismatch(draft.proposedSeverity, suggested) &&
    !draft.severityMismatchAcknowledged
  ) {
    errors['severityMismatchAcknowledged'] =
      'Confirm the severity mismatch or update your selection.';
  }

  return errors;
}

export interface MainReportStepInput {
  readonly attachmentError: string | null;
  readonly draft: ReportDraft;
  readonly proofRequired: boolean;
}

export function validateMainReportStep(input: MainReportStepInput): FieldErrors {
  const errors: Record<string, string> = {};
  const { attachmentError, draft, proofRequired } = input;
  const title = draft.title.trim();
  const description = draft.description.trim();
  const reproductionSteps = draft.reproductionSteps.trim();
  const secretGistUrl = draft.secretGistUrl.trim();

  // Every length rule is judged here and never as a `maxLength` on the control: a hard cap would
  // silently truncate the paste *and* make "Keep the title within 300 characters." unreachable.
  if (title === '') {
    errors['title'] = 'Enter a concise report title.';
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors['title'] = 'Keep the title within 300 characters.';
  }

  if (description === '') {
    errors['description'] = 'Describe the vulnerability and root cause.';
  } else if (description.length > BODY_MAX_LENGTH) {
    errors['description'] = 'Keep the description within 50,000 characters.';
  }

  // The PoC rule comes from the published program, never from a hardcoded default.
  if (proofRequired && reproductionSteps === '') {
    errors['reproductionSteps'] =
      'This program requires proof of concept or clear reproduction steps.';
  } else if (reproductionSteps.length > BODY_MAX_LENGTH) {
    errors['reproductionSteps'] = 'Keep the reproduction steps within 50,000 characters.';
  }

  if (secretGistUrl !== '' && !httpsUrlSchema.safeParse(secretGistUrl).success) {
    errors['secretGistUrl'] = 'Enter a valid HTTPS Gist URL.';
  }

  if (attachmentError !== null) {
    errors['attachment'] = attachmentError;
  }

  return errors;
}

export const STEP_ERROR_SUMMARIES: Readonly<Record<StepIndex, string>> = Object.freeze({
  0: 'Choose an in-scope asset and at least one applicable impact before continuing.',
  1: 'Review your severity assessment before continuing.',
  2: 'Review the highlighted fields before continuing.',
  3: 'Confirm the disclosure statement before submitting.',
});

/** Focus order used to jump to the first invalid control after a failed Continue. */
export const FIELD_FOCUS_ORDER: readonly string[] = Object.freeze([
  'affectedScopeId',
  'programImpactIds',
  'customImpacts',
  'proposedSeverity',
  'severityMismatchAcknowledged',
  'title',
  'description',
  'reproductionSteps',
  'secretGistUrl',
  'attachment',
  'confirmed',
]);

export function firstInvalidField(errors: FieldErrors): string | undefined {
  return FIELD_FOCUS_ORDER.find((field) => errors[field] !== undefined) ?? Object.keys(errors)[0];
}

const CUSTOM_IMPACT_KEY_PATTERN = /^customImpacts\.\d+$/;

/**
 * True when a DOM id names a validated field. The composer turns one bubbled `focusout` into the
 * field-level check the flow doc asks for (§4.4), so the id list must not be duplicated there.
 */
export function isDraftFieldKey(id: string): boolean {
  return FIELD_FOCUS_ORDER.includes(id) || CUSTOM_IMPACT_KEY_PATTERN.test(id);
}

/**
 * The subset of a step's errors whose field has already lost focus. Before the first Continue only
 * these are shown: a field is judged when the researcher leaves it, the step when they submit it.
 */
export function touchedErrors(errors: FieldErrors, touched: readonly string[]): FieldErrors {
  const visible: Record<string, string> = {};

  for (const field of touched) {
    const message = errors[field];
    if (message !== undefined) visible[field] = message;
  }

  return visible;
}
