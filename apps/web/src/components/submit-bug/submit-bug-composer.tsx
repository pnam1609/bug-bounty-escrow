'use client';

/*
 * Researcher Submit Bug composer — orchestrates SR-00 through SR-11.
 *
 * Structure comes from docs/flow/submit-bug-researcher-flow-for-figma.md, which supersedes the
 * Figma composer frames: four steps (Assets & Impact → Severity → Main Report → Review), no
 * free-text impact, severity proposed independently of the selected impacts.
 *
 * Two rules shape the whole state machine:
 *  1. No API write happens before Review. The pre-submit draft is browser-only, under
 *     `offchain-report-draft:<programId>`, because the API has no draft report state — the create
 *     call produces a `submitted` report straight away.
 *  2. The attachment is a second, separate transaction. Once the report exists, an upload failure
 *     is a partial success: the composer moves to the recovery state bound to that report id and
 *     can never re-send the report payload.
 */

import {
  attachmentUploadRequestSchema,
  createReportRequestSchema,
  programResponseSchema,
  reportResponseSchema,
  signedUploadResponseSchema,
  type CreateReportRequest,
  type Program,
  type ReportResponse,
  type Severity,
} from '@bug-bounty-escrow/shared';
import { Button, Callout } from '@bug-bounty-escrow/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { z } from 'zod';

import { AttachmentRecovery } from './attachment-recovery';
import {
  ComposerActions,
  ComposerColumns,
  ComposerFrame,
  ComposerHeading,
  ComposerStepper,
  type ComposerBreadcrumb,
} from './composer-frame';
import { ContextRail } from './context-rail';
import { ChangeAssetTypeDialog, DiscardDraftDialog } from './discard-draft-dialog';
import { ProgramClosed } from './program-closed';
import {
  discardLocalReportDraft,
  retainFailedCreatePayload,
  retryAttachmentOnly,
  SUBMIT_ERROR_ALERT,
  SUBMIT_ERROR_SUPPORT,
} from './recovery-actions';
import { SessionExpired } from './session-expired';
import { StepAssetsImpact } from './step-assets-impact';
import { StepMainReport } from './step-main-report';
import { StepReview } from './step-review';
import { StepSeverity } from './step-severity';
import { finishSubmittedReport } from './submission-finish';
import { SubmissionProgress, type ProgressState } from './submission-progress';
import {
  ASSET_TYPE_LABELS,
  clearDraft,
  commitDraftChange,
  eligibleImpacts,
  eligibleScopes,
  EMPTY_DRAFT,
  findScope,
  firstInvalidField,
  formatBytes,
  impactSuggestedSeverity,
  isDraftDirty,
  isDraftFieldKey,
  planAssetChange,
  readDraft,
  restoredDraft,
  retainedImpactIds,
  staleImpactIds,
  STEP_ERROR_SUMMARIES,
  STEP_SUBTITLES,
  toggleImpactId,
  touchedErrors,
  validateAssetsStep,
  validateAttachment,
  validateMainReportStep,
  validateSeverityStep,
  writeDraft,
  type FieldErrors,
  type ReportDraft,
  type StepIndex,
  type TextDraftField,
} from './submit-bug-model';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const completeUploadResponseSchema = z
  .object({ success: z.literal(true), data: z.object({ attachmentId: z.string() }).strict() })
  .strict();

type Phase =
  | { readonly kind: 'composing' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'uploading'; readonly reportId: string }
  | { readonly kind: 'opening'; readonly reportId: string }
  | { readonly kind: 'attachment-recovery'; readonly reportId: string }
  | { readonly kind: 'program-closed' }
  | { readonly kind: 'session-expired' };

const STEP_ORDER: readonly StepIndex[] = [0, 1, 2, 3];

/** Moves keyboard focus to the first control the failed step complained about. */
function focusField(field: string | undefined): void {
  if (field === undefined) return;

  const container = document.getElementById(field);
  if (container === null) return;

  const selector =
    'input:not([type="hidden"]), textarea, select, button, [tabindex]:not([tabindex="-1"])';
  const target = container.matches(selector)
    ? container
    : container.querySelector<HTMLElement>(selector);

  (target ?? container).scrollIntoView({ block: 'center' });
  target?.focus();
}

function ComposerSkeleton() {
  return (
    <div aria-live="polite" className="flex flex-col gap-2xl">
      <p className="text-body-sm text-text-muted">Loading program and eligible scopes…</p>
      <div className="h-28 w-full animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-2xl lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="h-[32rem] animate-pulse rounded-lg border border-border bg-surface motion-reduce:animate-none" />
        <div className="h-80 animate-pulse rounded-lg border border-border bg-surface-raised motion-reduce:animate-none" />
      </div>
    </div>
  );
}

export function SubmitBugComposer({ programId }: { readonly programId: string }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [attemptedSteps, setAttemptedSteps] = useState<readonly StepIndex[]>([]);
  /** Field keys that have already lost focus once — the field-level half of the validation rule. */
  const [touchedFields, setTouchedFields] = useState<readonly string[]>([]);
  /** The picked file, valid or not: a refused file has to stay visible to stay removable. */
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'composing' });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingLeaveHref, setPendingLeaveHref] = useState<string | null>(null);
  const [pendingScopeId, setPendingScopeId] = useState<string | null>(null);

  /** Held across retries so a re-upload reuses the same attachment row instead of creating one. */
  const attachmentIdRef = useRef<string | null>(null);
  const createdReportRef = useRef<ReportResponse | null>(null);
  const failedCreatePayloadRef = useRef<CreateReportRequest | null>(null);

  const programQuery = useQuery({
    queryKey: queryKeys.program(programId),
    queryFn: () => apiRequest(`/api/programs/${programId}`, programResponseSchema),
  });

  useEffect(() => {
    const stored = readDraft(programId);
    // Everything but the mismatch acknowledgement is restored: see `restoredDraft`.
    if (stored !== null) setDraft(restoredDraft(stored));
    setHydrated(true);
  }, [programId]);

  // Autosave is browser-only and only exists while there is something to save, so an untouched
  // composer never leaves a stray key behind.
  useEffect(() => {
    if (!hydrated) return;

    if (isDraftDirty(draft, false)) writeDraft(programId, draft);
    else clearDraft(programId);
  }, [draft, hydrated, programId]);

  const dirty = hydrated && phase.kind === 'composing' && isDraftDirty(draft, file !== null);

  useEffect(() => {
    if (!dirty) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const interceptInternalLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>('a[href]');
      if (anchor === undefined || anchor === null || anchor.target === '_blank') return;

      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin) return;

      event.preventDefault();
      setPendingLeaveHref(`${target.pathname}${target.search}${target.hash}`);
      setDiscardOpen(true);
    };

    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', interceptInternalLink, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', interceptInternalLink, true);
    };
  }, [dirty]);

  const program: Program | undefined = programQuery.data?.data;

  /**
   * The single draft-write funnel. Routing every change through `commitDraftChange` is what keeps
   * `severityMismatchAcknowledged` describing the mismatch the researcher actually read — the
   * checkbox that clears it only exists while that mismatch is on screen.
   */
  const changeDraft = useCallback(
    (update: (current: ReportDraft) => ReportDraft) => {
      setDraft((current) => commitDraftChange(program, current, update(current)));
    },
    [program],
  );

  const updateDraft = useCallback(
    (patch: Partial<ReportDraft>) => {
      changeDraft((current) => ({ ...current, ...patch }));
    },
    [changeDraft],
  );

  /** Explicit per-field writes: a computed key would widen the draft to `Record<string, string>`. */
  const updateText = useCallback(
    (field: TextDraftField, value: string) => {
      changeDraft((current) => {
        switch (field) {
          case 'title':
            return { ...current, title: value };
          case 'description':
            return { ...current, description: value };
          case 'reproductionSteps':
            return { ...current, reproductionSteps: value };
          case 'secretGistUrl':
            return { ...current, secretGistUrl: value };
        }
      });
    },
    [changeDraft],
  );

  const scopes = useMemo(() => (program === undefined ? [] : eligibleScopes(program)), [program]);
  const scope = findScope(scopes, draft.affectedScopeId);
  const impacts = useMemo(
    () => (program === undefined ? [] : eligibleImpacts(program, scope?.assetType)),
    [program, scope?.assetType],
  );
  /**
   * Selected ids the current catalog no longer offers. They can only appear when the owner edits
   * the program while a draft sits in this browser, and they block the step until they are gone.
   */
  const staleImpacts = useMemo(
    () => staleImpactIds(draft.programImpactIds, impacts),
    [draft.programImpactIds, impacts],
  );
  const suggestedSeverity = impactSuggestedSeverity(impacts, draft.programImpactIds);
  const selectedImpactTitles = useMemo(
    () =>
      impacts
        .filter((impact) => draft.programImpactIds.includes(impact.id))
        .map((impact) => impact.title),
    [draft.programImpactIds, impacts],
  );

  const allowCustomImpact = program?.rules.allowCustomImpact ?? false;
  /** SR-03 AC 4: the PoC rule is the published program's, never a constant baked into the form. */
  const proofRequired = program?.rules.pocPolicy === 'required';

  /**
   * SR-03V. Derived rather than stored: a second `attachmentError` state could outlive the file it
   * described, and the researcher would be left with a message no control on screen can clear.
   */
  const attachmentError = useMemo(() => (file === null ? null : validateAttachment(file)), [file]);

  /** The file this submission actually carries. A refused file is held for editing, never sent. */
  const attachedFile = attachmentError === null ? file : null;

  const stepErrors = useMemo<FieldErrors>(() => {
    if (program === undefined) return {};

    switch (step) {
      case 0:
        return validateAssetsStep({ allowCustomImpact, draft, impacts, scopes });
      case 1:
        return validateSeverityStep(draft, suggestedSeverity);
      case 2:
        return validateMainReportStep({ attachmentError, draft, proofRequired });
      case 3:
        return confirmed
          ? {}
          : { confirmed: 'Confirm the statement above before submitting this report.' };
      default:
        return {};
    }
  }, [
    allowCustomImpact,
    attachmentError,
    confirmed,
    draft,
    impacts,
    program,
    proofRequired,
    scopes,
    step,
    suggestedSeverity,
  ]);

  const showErrors = attemptedSteps.includes(step);
  // Flow doc §4.4: a field is judged when it loses focus, the whole step when Continue is pressed.
  // Only the step summary waits for Continue, so blurring one control never lights up the others.
  const errors: FieldErrors = showErrors ? stepErrors : touchedErrors(stepErrors, touchedFields);
  const hasErrors = Object.keys(stepErrors).length > 0;

  const markFieldTouched = useCallback((field: string) => {
    setTouchedFields((current) => (current.includes(field) ? current : [...current, field]));
  }, []);

  /**
   * One bubbling `focusout` covers every control in the step. The nearest ancestor id that names a
   * validated field is the field just left, which also catches composite controls (radio group,
   * checkbox list, attachment block) whose inner ids are generated by Radix or `useId`.
   */
  const handleFieldBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      let node: HTMLElement | null = event.target instanceof HTMLElement ? event.target : null;

      while (node !== null) {
        if (node.id !== '' && isDraftFieldKey(node.id)) {
          markFieldTouched(node.id);
          return;
        }
        node = node.parentElement;
      }
    },
    [markFieldTouched],
  );

  /* ── Step 1 handlers ──────────────────────────────────────────────────────────────────── */

  /**
   * The scope and its reconciled impact ids move together, always as an explicit list: writing
   * `affectedScopeId` without deciding what happens to `programImpactIds` is how a hidden stale id
   * reaches the payload.
   */
  const applyScope = useCallback(
    (scopeId: string, impactIds: readonly string[]) => {
      updateDraft({ affectedScopeId: scopeId, programImpactIds: impactIds });
    },
    [updateDraft],
  );

  /** What picking `scopeId` would do to the impacts already selected. */
  const planScopeChange = useCallback(
    (scopeId: string) => {
      const next = findScope(scopes, scopeId);

      return planAssetChange({
        current: scope,
        next,
        nextImpacts: program === undefined ? [] : eligibleImpacts(program, next?.assetType),
        selectedIds: draft.programImpactIds,
      });
    },
    [draft.programImpactIds, program, scope, scopes],
  );

  const handleSelectScope = useCallback(
    (scopeId: string) => {
      const plan = planScopeChange(scopeId);

      // Losing impacts to a different asset type is confirmed rather than silent; ids that are
      // already un-rendered are dropped without ceremony.
      if (plan.needsConfirmation) {
        setPendingScopeId(scopeId);
        return;
      }

      applyScope(scopeId, plan.impactIds);
    },
    [applyScope, planScopeChange],
  );

  const handleToggleImpact = useCallback(
    (impactId: string, checked: boolean) => {
      changeDraft((current) => ({
        ...current,
        programImpactIds: toggleImpactId(current.programImpactIds, impactId, checked),
      }));
    },
    [changeDraft],
  );

  /**
   * SR-01V escape hatch. Once the owner disables an impact the checkbox disappears, so the only way
   * to act on "One or more impacts no longer apply to this asset" is an explicit drop.
   */
  const handleRemoveStaleImpacts = useCallback(() => {
    changeDraft((current) => ({
      ...current,
      programImpactIds: retainedImpactIds(current.programImpactIds, impacts),
    }));
  }, [changeDraft, impacts]);

  const handleAddCustomImpact = useCallback(() => {
    changeDraft((current) => ({ ...current, customImpacts: [...current.customImpacts, ''] }));
  }, [changeDraft]);

  const handleChangeCustomImpact = useCallback(
    (index: number, value: string) => {
      changeDraft((current) => ({
        ...current,
        customImpacts: current.customImpacts.map((entry, position) =>
          position === index ? value : entry,
        ),
      }));
    },
    [changeDraft],
  );

  const handleRemoveCustomImpact = useCallback(
    (index: number) => {
      changeDraft((current) => ({
        ...current,
        customImpacts: current.customImpacts.filter((_entry, position) => position !== index),
      }));
    },
    [changeDraft],
  );

  /* ── Step 3 handlers ──────────────────────────────────────────────────────────────────── */

  /**
   * A refused file is kept, not dropped: the selected row names it and Remove clears it, so the
   * state that blocks Continue is both visible and reversible.
   *
   * It is also marked touched immediately. Returning from the OS file dialog never blurs the
   * dropzone, so waiting for `focusout` would leave the researcher looking at a file that simply
   * did not attach, with no reason given.
   */
  const handlePickFile = useCallback(
    (picked: File | null) => {
      setFile(picked);
      if (picked !== null && validateAttachment(picked) !== null) markFieldTouched('attachment');
    },
    [markFieldTouched],
  );

  /* ── Navigation ───────────────────────────────────────────────────────────────────────── */

  const markAttempted = useCallback((target: StepIndex) => {
    setAttemptedSteps((current) => (current.includes(target) ? current : [...current, target]));
  }, []);

  const goToStep = useCallback((target: StepIndex) => {
    setStep(target);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }, []);

  const handleContinue = useCallback(() => {
    markAttempted(step);

    if (hasErrors) {
      focusField(firstInvalidField(stepErrors));
      return;
    }

    const next = STEP_ORDER[step + 1];
    if (next !== undefined) goToStep(next);
  }, [goToStep, hasErrors, markAttempted, step, stepErrors]);

  const handleBack = useCallback(() => {
    const previous = STEP_ORDER[step - 1];
    if (previous !== undefined) goToStep(previous);
  }, [goToStep, step]);

  const handleCancel = useCallback(() => {
    if (isDraftDirty(draft, file !== null)) {
      setPendingLeaveHref(`/programs/${encodeURIComponent(programId)}`);
      setDiscardOpen(true);
      return;
    }
    router.push(`/programs/${encodeURIComponent(programId)}`);
  }, [draft, file, programId, router]);

  const handleDiscard = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setFile(null);
    setDiscardOpen(false);
    discardLocalReportDraft({
      navigate: (href) => router.push(href),
      programId,
      ...(pendingLeaveHref === null ? {} : { returnTo: pendingLeaveHref }),
    });
    setPendingLeaveHref(null);
  }, [pendingLeaveHref, programId, router]);

  /* ── Submit ───────────────────────────────────────────────────────────────────────────── */

  const finish = useCallback(
    async (reportId: string) => {
      setPhase({ kind: 'opening', reportId });

      const created = createdReportRef.current;
      if (created === null) return;

      await finishSubmittedReport({
        programId,
        queryClient,
        report: created,
        router,
      });
    },
    [programId, queryClient, router],
  );

  const uploadAttachment = useCallback(
    async (reportId: string, pending: File): Promise<boolean> => {
      try {
        const existingId = attachmentIdRef.current;
        const input = attachmentUploadRequestSchema.parse({
          ...(existingId === null ? {} : { attachmentId: existingId }),
          filename: pending.name,
          mimeType: pending.type,
          sizeBytes: pending.size,
        });

        const signed = await apiRequest(
          `/api/reports/${reportId}/attachments/upload-url`,
          signedUploadResponseSchema,
          { method: 'POST', token: session?.access_token, body: input },
        );
        attachmentIdRef.current = signed.data.attachmentId;

        // Straight to private storage: the signed URL is not an API route, and it is never stored.
        const upload = await fetch(signed.data.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': pending.type },
          body: pending,
        });
        if (!upload.ok) throw new Error('upload_failed');

        // The row stays `pending` until this lands, so a half-finished file never shows up.
        await apiRequest(
          `/api/reports/${reportId}/attachments/${signed.data.attachmentId}/complete`,
          completeUploadResponseSchema,
          { method: 'POST', token: session?.access_token },
        );

        return true;
      } catch {
        return false;
      }
    },
    [session?.access_token],
  );

  const runSubmit = useCallback(async () => {
    if (program === undefined) return;

    let payload = failedCreatePayloadRef.current;
    if (payload === null) {
      // Re-validate every earlier step: the owner may have edited the catalog while the draft sat
      // in this browser, which can invalidate a scope or impact chosen minutes ago.
      const earlier: readonly [StepIndex, FieldErrors][] = [
        [0, validateAssetsStep({ allowCustomImpact, draft, impacts, scopes })],
        [1, validateSeverityStep(draft, suggestedSeverity)],
        [2, validateMainReportStep({ attachmentError, draft, proofRequired })],
      ];
      const invalid = earlier.find(([, stepIssues]) => Object.keys(stepIssues).length > 0);

      if (invalid !== undefined) {
        const [invalidStep, invalidErrors] = invalid;
        markAttempted(invalidStep);
        goToStep(invalidStep);
        focusField(firstInvalidField(invalidErrors));
        return;
      }

      markAttempted(3);
      if (!confirmed) {
        focusField('confirmed');
        return;
      }

      const secretGistUrl = draft.secretGistUrl.trim();
      const reproductionSteps = draft.reproductionSteps.trim();
      const parsed = createReportRequestSchema.safeParse({
        affectedScopeId: draft.affectedScopeId,
        programImpactIds: [...draft.programImpactIds],
        customImpacts: draft.customImpacts.map((entry) => entry.trim()).filter(Boolean),
        title: draft.title.trim(),
        description: draft.description.trim(),
        ...(reproductionSteps === '' ? {} : { reproductionSteps }),
        ...(secretGistUrl === '' ? {} : { secretGistUrl }),
        proposedSeverity: draft.proposedSeverity,
        severityMismatchAcknowledged: draft.severityMismatchAcknowledged,
      });

      if (!parsed.success) {
        setSubmitError('Some fields no longer satisfy the report contract. Review each step again.');
        return;
      }
      payload = retainFailedCreatePayload(failedCreatePayloadRef.current, parsed.data);
      failedCreatePayloadRef.current = payload;
    }

    setSubmitError(null);
    setPhase({ kind: 'submitting' });

    let response: ReportResponse;
    try {
      response = await apiRequest(`/api/programs/${programId}/reports`, reportResponseSchema, {
        method: 'POST',
        token: session?.access_token,
        body: payload,
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setPhase({ kind: 'session-expired' });
        return;
      }
      // A closed program is a terminal state, never a retry loop; the local draft stays put.
      if (error instanceof ApiClientError && error.code === 'program_not_accepting_reports') {
        setPhase({ kind: 'program-closed' });
        return;
      }

      setPhase({ kind: 'composing' });
      setSubmitError(SUBMIT_ERROR_ALERT);
      return;
    }

    createdReportRef.current = response;
    failedCreatePayloadRef.current = null;
    const reportId = response.data.id;

    if (attachedFile === null) {
      await finish(reportId);
      return;
    }

    setPhase({ kind: 'uploading', reportId });
    const uploaded = await uploadAttachment(reportId, attachedFile);

    if (uploaded) {
      await finish(reportId);
      return;
    }

    // Partial success: the report exists. Never resubmit it.
    setPhase({ kind: 'attachment-recovery', reportId });
  }, [
    allowCustomImpact,
    attachedFile,
    attachmentError,
    confirmed,
    draft,
    finish,
    goToStep,
    impacts,
    markAttempted,
    proofRequired,
    program,
    programId,
    scopes,
    session?.access_token,
    suggestedSeverity,
    uploadAttachment,
  ]);

  const [retrying, setRetrying] = useState(false);

  const handleRetryAttachment = useCallback(async () => {
    if (phase.kind !== 'attachment-recovery' || file === null) return;

    setRetrying(true);
    const { reportId } = phase;
    setPhase({ kind: 'uploading', reportId });

    const uploaded = await retryAttachmentOnly({ file, reportId, upload: uploadAttachment });
    setRetrying(false);

    if (uploaded) {
      await finish(reportId);
      return;
    }

    setPhase({ kind: 'attachment-recovery', reportId });
  }, [file, finish, phase, uploadAttachment]);

  /* ── Render ───────────────────────────────────────────────────────────────────────────── */

  const loadingProgram = programQuery.isPending;
  const breadcrumbs = useMemo<readonly ComposerBreadcrumb[]>(
    () => [
      { href: '/programs', label: 'Programs' },
      ...(program === undefined
        ? loadingProgram
          ? [{ label: 'Program', pending: true }]
          : []
        : [{ href: `/programs/${program.id}`, label: program.name }]),
      { label: 'Submit report' },
    ],
    [loadingProgram, program],
  );

  if (programQuery.isPending) {
    return (
      <ComposerFrame breadcrumbs={breadcrumbs}>
        <ComposerSkeleton />
      </ComposerFrame>
    );
  }

  if (programQuery.isError || program === undefined) {
    return (
      <ComposerFrame breadcrumbs={breadcrumbs}>
        <Callout variant="danger" title="The program could not be loaded">
          <div className="flex flex-col gap-lg">
            <p>Your local draft is untouched. Try again, or go back to the program list.</p>
            <div className="flex flex-wrap gap-md">
              <Button onClick={() => void programQuery.refetch()}>Try again</Button>
              <Button onClick={() => router.push('/programs')} variant="secondary">
                Back to programs
              </Button>
            </div>
          </div>
        </Callout>
      </ComposerFrame>
    );
  }

  const draftSummary = [
    `${String(draft.programImpactIds.length + draft.customImpacts.length)} impacts selected`,
    attachedFile === null ? 'no attachment' : `${attachedFile.name} selected`,
    'saved in this browser',
  ].join(' · ');

  if (phase.kind === 'program-closed' || program.status !== 'active') {
    return (
      <ComposerFrame breadcrumbs={breadcrumbs}>
        <ProgramClosed draftSummary={draftSummary} programId={program.id} />
      </ComposerFrame>
    );
  }

  if (phase.kind === 'submitting' || phase.kind === 'uploading' || phase.kind === 'opening') {
    const creating: ProgressState = phase.kind === 'submitting' ? 'active' : 'complete';
    const uploading: ProgressState =
      attachedFile === null
        ? 'skipped'
        : phase.kind === 'uploading'
          ? 'active'
          : phase.kind === 'opening'
            ? 'complete'
            : 'upcoming';
    const opening: ProgressState = phase.kind === 'opening' ? 'active' : 'upcoming';

    return (
      <ComposerFrame breadcrumbs={breadcrumbs}>
        <SubmissionProgress
          attachmentDetail={
            attachedFile === null
              ? 'No attachment selected'
              : `${attachedFile.name} · ${formatBytes(attachedFile.size)}`
          }
          creating={creating}
          opening={opening}
          uploading={uploading}
        />
      </ComposerFrame>
    );
  }

  if (phase.kind === 'attachment-recovery' && file !== null) {
    return (
      <ComposerFrame breadcrumbs={breadcrumbs}>
        <AttachmentRecovery
          file={file}
          onContinueWithout={() => void finish(phase.reportId)}
          onOpenReport={() => void finish(phase.reportId)}
          onRetry={() => void handleRetryAttachment()}
          reportId={phase.reportId}
          retrying={retrying}
        />
      </ComposerFrame>
    );
  }

  if (phase.kind === 'session-expired') {
    return (
      <ComposerFrame breadcrumbs={breadcrumbs}>
        <SessionExpired programId={programId} />
      </ComposerFrame>
    );
  }

  const pendingScope = pendingScopeId === null ? undefined : findScope(scopes, pendingScopeId);

  return (
    <ComposerFrame breadcrumbs={breadcrumbs}>
      <ComposerHeading
        savedLocally={hydrated && isDraftDirty(draft, false)}
        subtitle={`${STEP_SUBTITLES[step]} Your draft autosaves in this browser only — nothing reaches the program until you submit.`}
      />
      <ComposerStepper currentStep={step} />

      <ComposerColumns
        rail={
          <ContextRail
            attachmentName={attachedFile?.name ?? null}
            impactCount={draft.programImpactIds.length + draft.customImpacts.length}
            program={program}
            proposedSeverity={draft.proposedSeverity}
            scope={scope}
            suggestedSeverity={suggestedSeverity}
          />
        }
      >
        <div className="flex flex-col gap-lg">
          {showErrors && hasErrors ? (
            <Callout variant="danger" title="Before you continue">
              {STEP_ERROR_SUMMARIES[step]}
            </Callout>
          ) : null}

          {/* SR-08: the create call failed before a report existed, so the same payload can be
              retried without any risk of a duplicate. */}
          {submitError === null ? null : (
            <Callout variant="danger">
              <div className="flex flex-col gap-xs">
                <p className="font-semibold">{submitError}</p>
                <p>{SUBMIT_ERROR_SUPPORT}</p>
              </div>
            </Callout>
          )}

          {/* `display: contents` keeps every step a direct flex child while one bubbling blur
              listener judges whichever field the researcher just left. */}
          <div className="contents" onBlur={handleFieldBlur}>
            {step === 0 ? (
              <StepAssetsImpact
                allowCustomImpact={allowCustomImpact}
                draft={draft}
                errors={errors}
                impacts={impacts}
                onAddCustomImpact={handleAddCustomImpact}
                onChangeCustomImpact={handleChangeCustomImpact}
                onRemoveCustomImpact={handleRemoveCustomImpact}
                onRemoveStaleImpacts={handleRemoveStaleImpacts}
                onSelectScope={handleSelectScope}
                onToggleImpact={handleToggleImpact}
                programId={program.id}
                scope={scope}
                scopes={scopes}
                staleImpactCount={staleImpacts.length}
              />
            ) : null}

            {step === 1 ? (
              <StepSeverity
                customImpactCount={
                  draft.customImpacts.filter((entry) => entry.trim() !== '').length
                }
                draft={draft}
                errors={errors}
                onAcknowledgeMismatch={(acknowledged) =>
                  updateDraft({ severityMismatchAcknowledged: acknowledged })
                }
                onEditAssets={() => goToStep(0)}
                onSelectSeverity={(severity: Severity) =>
                  updateDraft({ proposedSeverity: severity })
                }
                scope={scope}
                selectedImpactTitles={selectedImpactTitles}
                suggestedSeverity={suggestedSeverity}
              />
            ) : null}

            {step === 2 ? (
              <StepMainReport
                draft={draft}
                errors={errors}
                file={file}
                onChangeField={updateText}
                onClearFile={() => handlePickFile(null)}
                onPickFile={handlePickFile}
                pocPolicyNote={program.rules.pocPolicyNote}
                proofRequired={proofRequired}
              />
            ) : null}

            {step === 3 ? (
              <StepReview
                confirmError={errors['confirmed']}
                confirmed={confirmed}
                draft={draft}
                file={file}
                onConfirm={setConfirmed}
                onEditStep={goToStep}
                programName={program.name}
                scope={scope}
                selectedImpactTitles={selectedImpactTitles}
                suggestedSeverity={suggestedSeverity}
              />
            ) : null}
          </div>

          <ComposerActions
            primary={
              step === 3 ? (
                <Button onClick={() => void runSubmit()} size="lg">
                  {submitError === null ? 'Submit private report' : 'Try again'}
                </Button>
              ) : (
                <Button onClick={handleContinue} size="lg">
                  {step === 0
                    ? 'Continue to severity'
                    : step === 1
                      ? 'Continue to main report'
                      : 'Review report'}
                </Button>
              )
            }
            secondary={
              step === 0 ? (
                <Button onClick={handleCancel} size="lg" variant="secondary">
                  Cancel
                </Button>
              ) : step === 3 && submitError !== null ? (
                <Button
                  onClick={() => {
                    failedCreatePayloadRef.current = null;
                    setSubmitError(null);
                  }}
                  size="lg"
                  variant="ghost"
                >
                  Review report
                </Button>
              ) : (
                <Button onClick={handleBack} size="lg" variant="ghost">
                  Back
                </Button>
              )
            }
          />

          {step === 3 ? (
            <p className="text-label-sm text-text-muted">
              Report content is never written to analytics or application logs, and no wallet is
              needed to submit.
            </p>
          ) : null}
        </div>
      </ComposerColumns>

      <DiscardDraftDialog
        onDiscard={handleDiscard}
        onOpenChange={(open) => {
          setDiscardOpen(open);
          if (!open) setPendingLeaveHref(null);
        }}
        open={discardOpen}
      />
      <ChangeAssetTypeDialog
        nextAssetTypeLabel={
          pendingScope === undefined ? 'These' : ASSET_TYPE_LABELS[pendingScope.assetType]
        }
        onConfirm={() => {
          // The plan is recomputed on confirm so the applied ids match the catalog as it stands
          // now, not as it stood when the dialog opened.
          if (pendingScopeId !== null) {
            applyScope(pendingScopeId, planScopeChange(pendingScopeId).impactIds);
          }
          setPendingScopeId(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingScopeId(null);
        }}
        open={pendingScopeId !== null}
      />
    </ComposerFrame>
  );
}
