'use client';

import {
  createProgramRequestSchema,
  logoUploadRequestSchema,
  programResponseSchema,
  signedLogoUploadResponseSchema,
  updateProgramRequestSchema,
  type AuthorableAssetType,
  type Program,
} from '@bug-bounty-escrow/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogWarning,
  Button,
  Callout,
  StatusBadge,
  Stepper,
  type StepperStep,
} from '@bug-bounty-escrow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Coins,
  Crosshair,
  FileText,
  LoaderCircle,
  ScrollText,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FocusEvent } from 'react';

import { WorkspaceHeading } from './owner-workspace';
import {
  buildCreatePayload,
  buildUpdatePayload,
  fieldId,
  firstErrorAssetType,
  saveErrorHint,
  seedImpacts,
  seedRewardTiers,
  validateImpacts,
  validateOverview,
  validateRewards,
  validateRules,
  validateScope,
  type FieldErrors,
  type ProgramDraft,
} from './program-draft';
import { StepImpacts } from './step-impacts';
import { StepOverview } from './step-overview';
import { StepReview } from './step-review';
import { StepRewards } from './step-rewards';
import { StepRules } from './step-rules';
import { StepScope } from './step-scope';
import { FormCard, StepLayout, WizardShell } from './wizard-parts';
import { apiRequest, ApiClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/**
 * The seven-step journey from the flow document. Nodes carry a semantic Lucide glyph and never a
 * numeral; `Fund rewards` lives on the edit route because deploy and fund both need a program id.
 */
export const CREATE_PROGRAM_STEPS: readonly StepperStep[] = [
  { id: 'overview', icon: FileText, label: 'Overview' },
  { id: 'scope', icon: Crosshair, label: 'Scope' },
  { id: 'impacts', icon: ShieldAlert, label: 'Impacts' },
  { id: 'rewards', icon: Coins, label: 'Rewards' },
  { id: 'rules', icon: ScrollText, label: 'Rules' },
  { id: 'review', icon: ClipboardCheck, label: 'Review' },
  { id: 'fund', icon: Wallet, label: 'Fund rewards' },
];

const STEP_HEADINGS: readonly { eyebrow?: string; title: string; subtitle: string }[] = [
  {
    eyebrow: 'NEW BOUNTY PROGRAM',
    title: 'Create a program',
    subtitle:
      'Start with the public identity and timeline for your bounty. Your program remains a private draft until it is funded and published.',
  },
  {
    title: 'Define program scope',
    subtitle: 'Tell researchers exactly which assets are eligible and which assets are excluded.',
  },
  {
    title: 'Define impacts in scope',
    subtitle:
      'Choose the security outcomes researchers can report for each asset type. These options appear directly in Submit Bug.',
  },
  {
    title: 'Set reward tiers',
    subtitle:
      'Define USDC rewards for each asset type and severity. Funding happens after the draft is created.',
  },
  {
    title: 'Set program rules',
    subtitle:
      'Explain what a valid submission must include and which testing activities are prohibited.',
  },
  {
    title: 'Review your program',
    subtitle: 'Check the complete payload before creating the draft.',
  },
];

const VALIDATORS: readonly ((draft: ProgramDraft) => FieldErrors)[] = [
  validateOverview,
  validateScope,
  validateImpacts,
  validateRewards,
  validateRules,
];

/** Storage object keys accept letters, numbers, dots, dashes and underscores only. */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 255);
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `logo-${cleaned}`;
}

/**
 * Uploads the logo and points the saved program at it. Returns the patched program so the caller
 * keeps a fresh `expectedUpdatedAt` — the upload consumes the one it was handed.
 */
async function attachLogo(
  programId: string,
  file: File,
  expectedUpdatedAt: string,
  token: string | undefined,
): Promise<Program> {
  const signed = await apiRequest(
    `/api/programs/${programId}/logo/upload-url`,
    signedLogoUploadResponseSchema,
    {
      method: 'POST',
      token,
      body: logoUploadRequestSchema.parse({
        filename: safeFilename(file.name),
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    },
  );

  // The storage upload is a signed PUT straight at the bucket, so it bypasses `apiRequest`.
  const upload = await fetch(signed.data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });

  if (!upload.ok) throw new Error('Logo upload rejected');

  const patched = await apiRequest(`/api/programs/${programId}`, programResponseSchema, {
    method: 'PATCH',
    token,
    body: updateProgramRequestSchema.parse({
      logoStoragePath: signed.data.storagePath,
      expectedUpdatedAt,
    }),
  });

  return patched.data;
}

/**
 * Result of one save attempt.
 *
 * `logoFailed` exists because the logo travels in two further calls that only run *after*
 * `POST /api/programs` has already created the draft. Letting them reject the mutation showed CP-07
 * — "The program could not be saved" — for a program that demonstrably was, and `Try again` then
 * posted a second program under the same slug, which dead-ends on the unique-slug conflict with no
 * way back. The created draft wins instead and CP-06 raises the logo warning it already carries.
 */
interface SaveOutcome {
  readonly program: Program;
  readonly logoFailed: boolean;
}

export interface ProgramWizardProps {
  /** Present when the wizard is reopened against a saved draft; switches the submit to PATCH. */
  readonly program?: Program;
  readonly initialDraft: ProgramDraft;
  /** Edit mode only: leaves the wizard without saving. */
  readonly onClose?: () => void;
}

export function ProgramWizard({ initialDraft, onClose, program }: ProgramWizardProps) {
  const { session } = useAuth();
  const client = useQueryClient();
  const router = useRouter();

  const [draft, setDraft] = useState<ProgramDraft>(initialDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  /** Errors of a just-failed step submit; a fresh object each time so the focus effect refires. */
  const [focusRequest, setFocusRequest] = useState<FieldErrors | null>(null);
  /** DOM id of the control that last lost focus — §4.3 field-level validation on blur. */
  const [blurredControl, setBlurredControl] = useState<string | null>(null);
  /**
   * Active asset-type tab for the two tabbed steps (Impacts, Rewards). It lives here rather than
   * inside each step because only a failed submit may move it, and the shell is what knows a submit
   * failed. `null` leaves each step on its own first tab.
   */
  const [tab, setTab] = useState<AuthorableAssetType | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const isEdit = program !== undefined;

  const update = useCallback((patch: Partial<ProgramDraft>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  // A hard navigation cannot show the styled dialog, so the browser prompt covers that path.
  useEffect(() => {
    if (!dirty) return undefined;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // "Focus chuyển tới field invalid đầu tiên sau khi submit bước." Keyed on the submit's own
  // error object — not the live `errors` map — so a later blur-time revalidation never yanks
  // focus back to the top of the form. `reportStepFailure` has already moved the tab, so by the
  // time this runs the panel holding the first failure is mounted.
  useEffect(() => {
    if (focusRequest === null) return;

    const keys = Object.keys(focusRequest);
    if (keys.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      // The first key can be a step-level summary key with no control of its own (`rewardTiers`
      // when every row was deleted), so fall through to the first key that rendered a target.
      for (const key of keys) {
        const target = document.getElementById(fieldId(key));
        if (target === null) continue;

        target.focus();
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest]);

  // §4.3 — validate the single field the owner just left; the step submit stays the full check.
  // Runs as an effect so state committed by the control's own blur handlers (e.g. the tag chip
  // commit) is already visible when the field is judged.
  useEffect(() => {
    if (blurredControl === null) return;
    setBlurredControl(null);

    const validate = VALIDATORS[step];
    if (validate === undefined) return;

    const stepErrors = validate(draft);
    setErrors((current) => {
      let changed = false;
      const next: Record<string, string> = { ...current };

      // Sync every error key owned by the blurred control: exact id match, or the control sits
      // inside the keyed row (`cp-resources-resource-1-title` → key `resources.resource-1`).
      for (const key of new Set([...Object.keys(current), ...Object.keys(stepErrors)])) {
        const control = fieldId(key);
        if (blurredControl !== control && !blurredControl.startsWith(`${control}-`)) continue;

        const message = stepErrors[key];
        if (message === undefined) {
          if (key in next) {
            delete next[key];
            changed = true;
          }
        } else if (next[key] !== message) {
          next[key] = message;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [blurredControl, draft, step]);

  const mutation = useMutation({
    // Every field is re-read from `draft` here rather than captured when the button is pressed, so
    // the CP-07 `Try again` re-sends the same payload while the owner changed nothing, and sends
    // the corrected one once they went back through `Review program`.
    mutationFn: async (): Promise<SaveOutcome> => {
      let saved: Program;

      if (program === undefined) {
        const body = createProgramRequestSchema.parse(buildCreatePayload(draft));
        const created = await apiRequest('/api/programs', programResponseSchema, {
          method: 'POST',
          token: session?.access_token,
          body,
        });

        saved = created.data;
      } else {
        const body = updateProgramRequestSchema.parse(buildUpdatePayload(draft, program.updatedAt));
        const updated = await apiRequest(`/api/programs/${program.id}`, programResponseSchema, {
          method: 'PATCH',
          token: session?.access_token,
          body,
        });

        saved = updated.data;
      }

      if (draft.logoFile === null) return { program: saved, logoFailed: false };

      try {
        const withLogo = await attachLogo(
          saved.id,
          draft.logoFile,
          saved.updatedAt,
          session?.access_token,
        );

        return { program: withLogo, logoFailed: false };
      } catch {
        return { program: saved, logoFailed: true };
      }
    },
    onSuccess: async ({ logoFailed, program: saved }) => {
      setDirty(false);
      client.setQueryData(queryKeys.program(saved.id), { success: true, data: saved });
      await client.invalidateQueries({ queryKey: ['programs'] });

      // Rebuilt from this attempt every time, so a `logo=failed` warning left in the URL by an
      // earlier save cannot outlive the upload that fixed it.
      const params = new URLSearchParams();
      if (!isEdit) params.set('created', '1');
      if (logoFailed) params.set('logo', 'failed');
      const query = params.toString();

      // No optimistic redirect: this only runs once the server has returned a valid program.
      router.replace(`/owner/programs/${saved.id}/edit${query === '' ? '' : `?${query}`}`);
      if (isEdit) onClose?.();
    },
  });

  function goToStep(next: number) {
    setErrors({});
    setStep(next);
  }

  /** Records which control lost focus; the blur-validation effect above does the judging. */
  function queueBlurValidation(event: FocusEvent<HTMLDivElement>) {
    const control = event.target instanceof HTMLElement ? event.target.id : '';
    if (control !== '') setBlurredControl(control);
  }

  /**
   * The one place a failed step submit is reported. On a tabbed step (Impacts, Rewards) Radix
   * unmounts the inactive `TabsContent`, so the tab has to move to the first failing panel before
   * the focus effect can reach the control inside it. Only an explicit submit calls this — blur
   * revalidation never does, so revalidating a field never yanks the owner off the tab they are on.
   */
  function reportStepFailure(stepErrors: FieldErrors) {
    setErrors(stepErrors);

    const failingTab = firstErrorAssetType(draft, stepErrors);
    if (failingTab !== null) setTab(failingTab);

    setFocusRequest(stepErrors);
  }

  function submitStep() {
    const validate = VALIDATORS[step];
    const stepErrors = validate === undefined ? {} : validate(draft);

    if (Object.keys(stepErrors).length > 0) {
      reportStepFailure(stepErrors);
      return;
    }

    setErrors({});

    if (step === 1) {
      // Scope decides which asset types need an impact catalog and a reward tier.
      setDraft((current) => {
        const withImpacts = { ...current, impacts: seedImpacts(current) };
        return { ...withImpacts, rewardTiers: seedRewardTiers(withImpacts) };
      });
    }

    setStep(step + 1);
  }

  function submitProgram() {
    for (let index = 0; index < VALIDATORS.length; index += 1) {
      const validate = VALIDATORS[index];
      const stepErrors = validate === undefined ? {} : validate(draft);

      if (Object.keys(stepErrors).length > 0) {
        setStep(index);
        reportStepFailure(stepErrors);
        return;
      }
    }

    mutation.mutate();
  }

  function leaveFlow() {
    if (dirty) {
      setDiscarding(true);
      return;
    }
    if (isEdit) {
      onClose?.();
      return;
    }
    router.push('/owner/programs');
  }

  const heading = STEP_HEADINGS[Math.min(step, STEP_HEADINGS.length - 1)];

  /* CP-05 — Saving. Back, Cancel and the primary action are all locked while the draft saves. */
  if (mutation.isPending) {
    return (
      <WizardShell>
        <WorkspaceHeading
          badge={<StatusBadge kind="program" status="draft" />}
          breadcrumb="Programs / Create program"
          subtitle="We’re validating and saving the program identity, resources, scope, impacts, rewards and rules."
          title={isEdit ? 'Saving your changes…' : 'Creating your draft…'}
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={5}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout>
          <FormCard title="Server confirmation required">
            <p aria-live="polite" className="flex items-center gap-md text-body-sm text-text-muted">
              <LoaderCircle
                aria-hidden="true"
                className="size-5 text-primary motion-safe:animate-spin"
              />
              No optimistic redirect. The edit workspace opens only after the server confirms the
              draft.
            </p>
            <div className="flex justify-end pt-md">
              <Button disabled loading loadingLabel="Creating draft" size="lg">
                {isEdit ? 'Saving changes…' : 'Creating draft…'}
              </Button>
            </div>
          </FormCard>
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-07 — Save error. Every field the owner entered is still in state for a same-payload retry. */
  if (mutation.isError) {
    // CP-02 answers a rejected payload with a machine-readable code. The flow document's sentence
    // is mandatory and stays untouched; this only names the rule that fired beside it.
    const hint =
      mutation.error instanceof ApiClientError ? saveErrorHint(mutation.error.code) : null;

    return (
      <WizardShell>
        <WorkspaceHeading
          badge={<StatusBadge kind="program" status="draft" />}
          breadcrumb="Programs / Create program"
          subtitle="Your complete program data is still here."
          title={isEdit ? 'We couldn’t save your changes' : 'We couldn’t create the draft'}
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={5}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout>
          <FormCard title="Retry with the same payload">
            {/* Title and body concatenate to the CP-07 sentence exactly, full stop included. */}
            <Callout title="The program could not be saved." variant="danger">
              Check every field or refresh if another editor changed it.
            </Callout>
            {hint === null ? null : (
              <p className="text-body-sm text-text">
                <span className="font-semibold">What the server rejected: </span>
                {hint}
              </p>
            )}
            <p className="text-body-sm text-text-muted">
              Your draft data is still here. Retrying sends the same program details, resources,
              scope, impacts, reward tiers and rules.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-md pt-md">
              <Button
                onClick={() => {
                  mutation.reset();
                  setStep(5);
                }}
                size="lg"
                variant="ghost"
              >
                Review program
              </Button>
              <Button onClick={() => mutation.mutate()} size="lg">
                Try again
              </Button>
            </div>
          </FormCard>
        </StepLayout>
      </WizardShell>
    );
  }

  return (
    <WizardShell>
      <WorkspaceHeading
        badge={<StatusBadge kind="program" status="draft" />}
        breadcrumb={
          <>
            <button
              className="inline-flex min-h-11 items-center rounded-sm text-label-md text-text-muted hover:text-text"
              onClick={leaveFlow}
              type="button"
            >
              Programs
            </button>
            <span aria-hidden="true"> / </span>
            <span aria-current="page">Create program</span>
          </>
        }
        eyebrow={heading?.eyebrow}
        subtitle={heading?.subtitle ?? ''}
        title={heading?.title ?? 'Create a program'}
      />

      <Stepper
        aria-label="Create program progress"
        currentStep={step}
        steps={CREATE_PROGRAM_STEPS}
      />

      {/* `display: contents` keeps the steps as direct flex children while one bubbling blur
          listener covers every field of the active step (§4.3). */}
      <div className="contents" onBlur={queueBlurValidation}>
        {step === 0 ? (
          <StepOverview
            draft={draft}
            errors={errors}
            onCancel={leaveFlow}
            onContinue={submitStep}
            update={update}
          />
        ) : null}
        {step === 1 ? (
          <StepScope
            draft={draft}
            errors={errors}
            onBack={() => goToStep(0)}
            onContinue={submitStep}
            update={update}
          />
        ) : null}
        {step === 2 ? (
          <StepImpacts
            activeTab={tab}
            draft={draft}
            errors={errors}
            onBack={() => goToStep(1)}
            onContinue={submitStep}
            onTabChange={setTab}
            update={update}
          />
        ) : null}
        {step === 3 ? (
          <StepRewards
            activeTab={tab}
            draft={draft}
            errors={errors}
            onBack={() => goToStep(2)}
            onContinue={submitStep}
            onTabChange={setTab}
            update={update}
          />
        ) : null}
        {step === 4 ? (
          <StepRules
            draft={draft}
            errors={errors}
            onBack={() => goToStep(3)}
            onContinue={submitStep}
            update={update}
          />
        ) : null}
        {step === 5 ? (
          <StepReview
            draft={draft}
            onBack={() => goToStep(4)}
            onEdit={goToStep}
            onSubmit={submitProgram}
            submitLabel={isEdit ? 'Save changes' : 'Create draft'}
          />
        ) : null}
      </div>

      {/* CP-08 — Discard changes. */}
      <AlertDialog onOpenChange={setDiscarding} open={discarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this program draft?</AlertDialogTitle>
            <AlertDialogDescription>
              The program has not been created. Your unsaved details, scope, impacts, rewards and
              rules will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogWarning>
            <p className="text-label-lg font-semibold text-error">This action cannot be undone</p>
            <p className="text-label-md text-text-muted">Nothing has been saved to the server.</p>
          </AlertDialogWarning>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDirty(false);
                if (isEdit) {
                  setDraft(initialDraft);
                  onClose?.();
                  return;
                }
                router.push('/owner/programs');
              }}
              variant="destructive"
            >
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WizardShell>
  );
}
