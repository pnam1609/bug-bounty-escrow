'use client';

import {
  approveRewardRequestSchema,
  createRewardSettlementIntentRequestSchema,
  markDuplicateRequestSchema,
  reopenDuplicateRequestSchema,
  rejectReportRequestSchema,
  reportResponseSchema,
  rewardSettlementIntentResponseSchema,
  requestInformationRequestSchema,
  parseUsdcBaseUnits,
  sendBackForReviewRequestSchema,
  validateReportRequestSchema,
  type ApproveRewardRequest,
  type AiDuplicateCandidate,
  type ReportDetail,
  type RewardSettlementIntent,
  type Severity,
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
  AlertDialogTrigger,
  AlertDialogWarning,
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  RadioGroup,
  RadioGroupCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@bug-bounty-escrow/ui';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import type { EIP1193Provider } from 'viem';

import {
  describeReportError,
  formatTimestamp,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  shortReportId,
  type ReportStatus,
} from './report-format';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import {
  connectCircleWalletFromProvider,
  type CircleWalletSession,
} from '@/components/owner/circle-funding-executor';
import { eligibleDuplicateCandidates } from './report-ai-review-card';

function formatDuplicateCandidateTime(value: string | undefined): string {
  return value === undefined ? 'timestamp unavailable' : formatTimestamp(value);
}

import {
  executeReservedRewardApproval,
  resumeRewardApproval,
  type RewardApprovalOrchestratorDependencies,
} from './reward-approval-orchestrator';
import {
  ACTIONS_BY_STATUS,
  ACTION_RESULT_STATUS,
  readRewardApprovalHash,
  readRewardApprovalUncertain,
  rewardSettlementUiMode,
  type ActionId,
} from './review-transitions';

export { ACTIONS_BY_STATUS, ACTION_RESULT_STATUS };
export type { ActionId };

type RainbowRewardConnector = {
  readonly id: string;
  readonly name: string;
  readonly getProvider: () => Promise<unknown>;
};

/**
 * Resolve the owner approval wallet through RainbowKit's Wagmi connector. The legacy funding
 * helper discovers injected providers and calls `eth_requestAccounts`, which could silently pick
 * an installed OKX provider when the owner expected RainbowKit's selected account. Reward approval
 * must use the same account/provider RainbowKit displays; Circle App Kit only receives the bridged
 * EIP-1193 provider after that selection has already happened.
 */
export async function connectRewardWalletViaRainbowKit(input: {
  readonly address: string | undefined;
  readonly connector: RainbowRewardConnector | undefined;
  readonly isConnected: boolean;
  readonly openConnectModal: (() => void) | undefined;
}): Promise<CircleWalletSession> {
  if (!input.isConnected || input.address === undefined || input.connector === undefined) {
    input.openConnectModal?.();
    throw new Error('reward_wallet_connection_required');
  }

  const provider = await input.connector.getProvider();
  return connectCircleWalletFromProvider(provider as EIP1193Provider, input.address, {
    id: input.connector.id,
    name: input.connector.name,
  });
}

/*
 * No Figma source — the reviewer's decision panel.
 *
 * Rules this file exists to enforce:
 *   - Every transition is confirmed in an `AlertDialog`, never `window.confirm`: the consequence
 *     has to be readable, focus has to be trapped, and Escape has to be a real cancel.
 *   - Only the transitions the report's current status actually allows are offered. The map below
 *     mirrors `REPORT_STATUS_TRANSITIONS` in `@bug-bounty-escrow/domain`, which the web app does
 *     not depend on directly.
 *   - Reward approval is calculation-aware. A range or flat tier takes the amount the reviewer
 *     decided; a percentage tier takes the verified basis and the server derives and caps the
 *     payout, ignoring any amount a client sends. Those are two different questions, so they are
 *     two different forms behind an explicit choice — never one ambiguous amount box.
 *   - Failures are read from `error.code`. A raw server string is never rendered.
 */

const WAITING_COPY: Readonly<Partial<Record<ReportStatus, string>>> = Object.freeze({
  needs_information:
    'Waiting on the researcher. They must answer and resend the report before it can be decided.',
  rejected: 'This report is closed. Rejection is final.',
  duplicate:
    'This report is closed as a duplicate. The program owner may reopen it only while the program remains unfunded.',
  paid: 'Settled. The escrow released the reward and there is nothing left to decide.',
  draft: 'This report has not been submitted yet.',
});

export type SubmitResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/* ── Dialog shell ─────────────────────────────────────────────────────────────────────────── */

interface ActionDialogProps {
  readonly busy: boolean;
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  readonly description: string;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly title: string;
  readonly tone?: 'destructive' | 'primary';
  readonly trigger: ReactNode;
  readonly confirmDisabled?: boolean;
  /** Copy for the red consequence panel. Present only when the transition cannot be undone. */
  readonly warning?: string;
}

const SPINNER_COLORS = {
  primary: '[color:var(--color-primary-contrast)]',
  destructive: '[color:var(--color-background)]',
} as const;

function ActionDialog({
  busy,
  children,
  confirmLabel,
  description,
  error,
  onConfirm,
  onOpenChange,
  open,
  title,
  tone = 'primary',
  trigger,
  confirmDisabled = false,
  warning,
}: ActionDialogProps) {
  return (
    <AlertDialog
      onOpenChange={(next) => {
        // Escape and outside interaction are ignored while a transition is in flight: the request
        // is already on its way and the reader must see how it resolved.
        if (!busy) onOpenChange(next);
      }}
      open={open}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {warning === undefined ? null : (
          <AlertDialogWarning>
            <p className="text-label-lg font-semibold text-error">This cannot be undone</p>
            <p className="text-body-sm text-text-muted">{warning}</p>
          </AlertDialogWarning>
        )}

        {children === undefined ? null : <div className="flex flex-col gap-xl">{children}</div>}

        {error === null ? null : (
          <p className="flex items-start gap-xs text-body-sm text-error" role="alert">
            <CircleAlert aria-hidden="true" className="mt-xs size-4 shrink-0" />
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {/* `preventDefault` keeps the dialog open so a rejected transition can explain itself;
              it closes from `onConfirm` only once the server has accepted. The label stays in
              place under the spinner so the button never changes width mid-request. */}
          <AlertDialogAction
            aria-busy={busy || undefined}
            className={busy ? 'relative [color:transparent]' : 'relative'}
            disabled={busy || confirmDisabled}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            variant={tone}
          >
            {confirmLabel}
            {busy ? (
              <span
                className={`pointer-events-none absolute inset-0 flex items-center justify-center ${SPINNER_COLORS[tone]}`}
              >
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                <span className="sr-only">Applying the decision</span>
              </span>
            ) : null}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ActionProps {
  readonly busy: boolean;
  readonly submit: (action: ActionId, body: unknown) => Promise<SubmitResult>;
}

/** Shared open/error plumbing: close and reset on success, keep the dialog open on failure. */
function useActionForm(reset: () => void) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setError(null);
      reset();
    }
  }

  return { error, setError, open, change, close: () => change(false) };
}

/* ── Request information ──────────────────────────────────────────────────────────────────── */

function RequestInformationAction({ busy, submit }: ActionProps) {
  const [reason, setReason] = useState('');
  const form = useActionForm(() => setReason(''));

  async function confirm() {
    const parsed = requestInformationRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      form.setError('Say what is missing so the researcher knows what to send.');
      return;
    }

    const result = await submit('request-information', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Request information"
      description="The report moves to Needs information and the researcher is asked to answer before review continues."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Ask the researcher for more"
      trigger={<Button variant="secondary">Request information</Button>}
    >
      <Field
        counter={`${String(reason.length)} / 2,000`}
        helperText="The researcher sees this text in the report."
        label="What is missing?"
        required
      >
        <Textarea
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. The reproduction steps stop before the exploit lands. Include the failing transaction."
          rows={4}
          value={reason}
        />
      </Field>
    </ActionDialog>
  );
}

/* ── Validate ─────────────────────────────────────────────────────────────────────────────── */

function ValidateAction({ busy, proposed, submit }: ActionProps & { readonly proposed: Severity }) {
  const [severity, setSeverity] = useState<Severity>(proposed);
  const form = useActionForm(() => setSeverity(proposed));
  const selectId = useId();

  async function confirm() {
    const parsed = validateReportRequestSchema.safeParse({ finalSeverity: severity });
    if (!parsed.success) {
      form.setError('Choose the final severity for this report.');
      return;
    }

    const result = await submit('validate', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Validate report"
      description="Accepts the finding and records the final severity. Reward approval comes next."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Validate this report"
      trigger={<Button>Validate</Button>}
      warning="Validation is a one-way transition. The severity you choose here drives which reward tier applies."
    >
      {/* The id is set on the trigger rather than left to `Field`: a Radix Select root is not a
          DOM node, so an injected id would never reach a labellable element. */}
      <Field
        helperText={`The researcher proposed ${SEVERITY_LABELS[proposed]}. Your choice is the one that counts.`}
        htmlFor={selectId}
        label="Final severity"
        required
      >
        <Select onValueChange={(value) => setSeverity(value as Severity)} value={severity}>
          <SelectTrigger id={selectId} size="lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITY_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {SEVERITY_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </ActionDialog>
  );
}

/* ── Send validated report back for review ───────────────────────────────────────────────── */

function SendBackForReviewAction({ busy, submit }: ActionProps) {
  const [reason, setReason] = useState('');
  const form = useActionForm(() => setReason(''));

  async function confirm() {
    const parsed = sendBackForReviewRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      form.setError('Explain why this validated report needs another review pass.');
      return;
    }

    const result = await submit('send-back-for-review', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Send back for review"
      description="Returns this validated report to Submitted so the owner can review the evidence again before reward settlement."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Send report back for review"
      trigger={<Button variant="secondary">Send back for review</Button>}
      warning="This action is available only before reward approval or settlement evidence exists. It does not start another AI run or payout."
    >
      <Field
        counter={`${String(reason.length)} / 2,000`}
        helperText="The reason is recorded in the private review timeline."
        label="Reason"
        required
      >
        <Textarea
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Recheck the final severity against the latest evidence before approving the reward."
          rows={4}
          value={reason}
        />
      </Field>
    </ActionDialog>
  );
}

/* ── Reject ───────────────────────────────────────────────────────────────────────────────── */

function RejectAction({ busy, submit }: ActionProps) {
  const [reason, setReason] = useState('');
  const form = useActionForm(() => setReason(''));

  async function confirm() {
    const parsed = rejectReportRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      form.setError('Give the researcher a reason for the rejection.');
      return;
    }

    const result = await submit('reject', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Reject report"
      description="Closes the report. The researcher sees your reason."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Reject this report"
      tone="destructive"
      trigger={<Button variant="secondary">Reject</Button>}
      warning="A rejected report is closed for good. It cannot be reopened, validated or rewarded."
    >
      <Field
        counter={`${String(reason.length)} / 2,000`}
        helperText="Explain the decision — out of scope, not reproducible, already known."
        label="Reason for rejection"
        required
      >
        <Textarea
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. The affected endpoint is listed as out of scope for this program."
          rows={4}
          value={reason}
        />
      </Field>
    </ActionDialog>
  );
}

/* ── Mark duplicate ───────────────────────────────────────────────────────────────────────── */

interface MarkDuplicateActionProps extends ActionProps {
  readonly currentProgramId: string;
  readonly currentReportId: string;
  readonly currentSubmittedAt: string | undefined;
  readonly currentSubmissionSequence: number | undefined;
  readonly duplicateCandidates: readonly AiDuplicateCandidate[];
  readonly initialOriginalReportId?: string;
  readonly onInitialOriginalReportIdConsumed?: () => void;
  readonly token: string | undefined;
}

/** Client-side guard for the destructive dialog; the API remains the authority on submit. */
export function duplicateTargetIsSafe(
  currentReportId: string,
  currentProgramId: string,
  target: Pick<ReportDetail, 'id' | 'programId'> | undefined,
): boolean {
  return (
    target !== undefined && target.id !== currentReportId && target.programId === currentProgramId
  );
}

function MarkDuplicateAction({
  busy,
  currentProgramId,
  currentReportId,
  currentSubmittedAt,
  currentSubmissionSequence,
  duplicateCandidates,
  initialOriginalReportId,
  onInitialOriginalReportIdConsumed,
  submit,
  token,
}: MarkDuplicateActionProps) {
  const [originalId, setOriginalId] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useActionForm(() => {
    setOriginalId('');
    setReason('');
    setFieldError(null);
  });
  const eligibleCandidates = eligibleDuplicateCandidates(
    {
      status: 'ready',
      submissionSequence: currentSubmissionSequence,
      duplicateCandidates,
    },
    currentSubmittedAt,
  );
  useEffect(() => {
    if (initialOriginalReportId === undefined) return;
    const isEligible = eligibleCandidates.some(
      (candidate) => candidate.candidateReportId === initialOriginalReportId,
    );
    setOriginalId(isEligible ? initialOriginalReportId : '');
    setReason('');
    setFieldError(null);
    if (isEligible) form.change(true);
    onInitialOriginalReportIdConsumed?.();
    // `form.change` is intentionally used only for this one-shot candidate prefill. The parent
    // clears the consumed id immediately, so including the per-render form object would reopen
    // the dialog on every render.
  }, [initialOriginalReportId, onInitialOriginalReportIdConsumed]);
  const candidateId = originalId.trim();
  const candidateShapeValid = markDuplicateRequestSchema.safeParse({
    originalReportId: candidateId,
  }).success;
  const targetQuery = useQuery({
    queryKey: ['review-duplicate-target', currentReportId, candidateId],
    queryFn: () =>
      apiRequest(`/api/reports/${encodeURIComponent(candidateId)}`, reportResponseSchema, {
        token,
      }),
    enabled:
      form.open && candidateShapeValid && candidateId !== currentReportId && candidateId.length > 0,
    retry: false,
    staleTime: 30_000,
  });
  const target = targetQuery.data?.data;
  const targetIsSameProgram = duplicateTargetIsSafe(currentReportId, currentProgramId, target);
  const targetReady = targetIsSameProgram;

  async function confirm() {
    setFieldError(null);
    const trimmedReason = reason.trim();
    const parsed = markDuplicateRequestSchema.safeParse({
      originalReportId: originalId.trim(),
      ...(trimmedReason === '' ? {} : { reason: trimmedReason }),
    });

    if (!parsed.success) {
      setFieldError('Select an earlier authorized report this one duplicates.');
      return;
    }

    if (!targetReady) {
      setFieldError(
        targetQuery.isError || (target !== undefined && !targetIsSameProgram)
          ? 'That original report is not available in this program.'
          : 'Check the original report preview before confirming.',
      );
      return;
    }

    const result = await submit('mark-duplicate', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Mark duplicate"
      description="Closes this report against an earlier one in the same program."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Mark as a duplicate"
      tone="destructive"
      trigger={<Button variant="secondary">Mark duplicate</Button>}
      confirmDisabled={!targetReady}
      warning="A duplicate is closed for good and earns no reward. Check the original first."
    >
      <Field
        error={fieldError ?? undefined}
        helperText="Only earlier, server-authorized AI candidates above the action threshold are available."
        label="Original report"
        required
      >
        <Select
          onValueChange={(value) => {
            setOriginalId(value);
            setFieldError(null);
          }}
          value={originalId}
        >
          <SelectTrigger
            aria-invalid={fieldError !== null || undefined}
            id="duplicate-target"
            size="lg"
          >
            <SelectValue
              placeholder={
                eligibleCandidates.length === 0
                  ? 'No eligible earlier report'
                  : 'Select an earlier report'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {eligibleCandidates.map((candidate) => (
              <SelectItem key={candidate.candidateReportId} value={candidate.candidateReportId}>
                {`${candidate.title ?? 'Untitled report'} · ${shortReportId(candidate.candidateReportId)} · ${formatDuplicateCandidateTime(candidate.submittedAt)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {candidateId === '' || !candidateShapeValid ? null : targetQuery.isPending ? (
        <p aria-live="polite" className="text-body-sm text-text-muted">
          Checking that report is readable and belongs to this program…
        </p>
      ) : targetReady && target !== undefined ? (
        <div className="flex flex-col gap-xs rounded-md border border-border bg-surface-raised p-md">
          <p className="text-label-md text-text">Original report preview</p>
          <p className="text-body-sm text-text">{target.title}</p>
          <p className="text-label-sm text-text-muted">
            <code aria-label={`Full original report ID ${target.id}`}>
              {shortReportId(target.id)}…
            </code>{' '}
            · {target.status.replaceAll('_', ' ')} · same program confirmed
          </p>
        </div>
      ) : (
        <p className="text-body-sm text-error" role="alert">
          That original report is not available in this program.
        </p>
      )}
      <Field counter={`${String(reason.length)} / 2,000`} label="Note (optional)">
        <Textarea
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Anything that helps the researcher see the overlap."
          rows={3}
          value={reason}
        />
      </Field>
    </ActionDialog>
  );
}

function ReopenDuplicateAction({ busy, submit }: ActionProps) {
  const [reason, setReason] = useState('');
  const form = useActionForm(() => setReason(''));

  async function confirm() {
    const parsed = reopenDuplicateRequestSchema.safeParse(
      reason.trim() === '' ? {} : { reason: reason.trim() },
    );
    if (!parsed.success) {
      form.setError('Use a shorter explanation, or leave the reason empty.');
      return;
    }

    const result = await submit('reopen-duplicate', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Reopen report"
      description="Returns this duplicate report to submitted so the program owner can review it again."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Reopen duplicate report"
      trigger={<Button variant="secondary">Reopen duplicate</Button>}
      warning="This is available only to the program owner while the program is active, unfunded, and has no settlement or disclosure activity."
    >
      <Field counter={`${String(reason.length)} / 2,000`} label="Reason (optional)">
        <Textarea
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain why this duplicate decision should be reviewed again."
          rows={3}
          value={reason}
        />
      </Field>
    </ActionDialog>
  );
}

/* ── Approve reward ───────────────────────────────────────────────────────────────────────── */

type RewardMode = 'decided' | 'percentage';

type ReviewRewardTier = NonNullable<ReportDetail['rewardTiers']>[number];

export function matchingRewardTiers(report: ReportDetail): readonly ReviewRewardTier[] {
  if (report.finalSeverity === undefined || report.rewardTiers === undefined) return [];
  return report.rewardTiers.filter(
    (tier) =>
      tier.assetType === report.affectedScope.assetType && tier.severity === report.finalSeverity,
  );
}

export function configuredRewardTiers(report: ReportDetail): readonly ReviewRewardTier[] {
  if (report.rewardTiers === undefined) return [];
  return report.rewardTiers.filter((tier) => tier.assetType === report.affectedScope.assetType);
}

export function tierDetails(tier: ReviewRewardTier): string {
  if (tier.calculationType === 'flat') return `Flat · ${tier.flatAmount ?? '—'} USDC`;
  if (tier.calculationType === 'range') {
    return `Range · ${tier.minReward ?? '—'}–${tier.maxReward ?? '—'} USDC`;
  }
  return `Percentage · ${tier.percentageBps === undefined ? '—' : `${tier.percentageBps / 100}%`} · cap ${tier.maxRewardCap ?? '—'} USDC`;
}

export function amountWithinTier(amount: string, tier: ReviewRewardTier): boolean {
  const value = parseUsdcBaseUnits(amount);
  if (value === undefined) return false;
  if (tier.calculationType === 'flat') {
    const flat = tier.flatAmount === undefined ? undefined : parseUsdcBaseUnits(tier.flatAmount);
    return flat !== undefined && value === flat;
  }
  if (tier.calculationType !== 'range') return true;
  const minimum = tier.minReward === undefined ? undefined : parseUsdcBaseUnits(tier.minReward);
  const maximum = tier.maxReward === undefined ? undefined : parseUsdcBaseUnits(tier.maxReward);
  return minimum !== undefined && maximum !== undefined && value >= minimum && value <= maximum;
}

function ApproveRewardAction({
  busy,
  report,
  settleReward,
}: {
  readonly busy: boolean;
  readonly report: ReportDetail;
  readonly settleReward: (input: ApproveRewardRequest) => Promise<SubmitResult>;
}) {
  const tiers = matchingRewardTiers(report);
  const configuredTiers = configuredRewardTiers(report);
  const [selectedTierIndex, setSelectedTierIndex] = useState(0);
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const selectedTier = tiers[selectedTierIndex];
  const mode: RewardMode =
    selectedTier?.calculationType === 'percentage' ? 'percentage' : 'decided';
  const form = useActionForm(() => {
    setSelectedTierIndex(0);
    setAmount('');
    setBasis('');
    setFieldError(null);
  });

  useEffect(() => {
    if (
      !form.open ||
      selectedTier?.calculationType !== 'flat' ||
      selectedTier.flatAmount === undefined
    ) {
      return;
    }
    setAmount(selectedTier.flatAmount);
  }, [form.open, selectedTier?.calculationType, selectedTier?.flatAmount]);

  const rangeOutOfBounds =
    selectedTier?.calculationType === 'range' && amount.trim() !== ''
      ? !amountWithinTier(amount.trim(), selectedTier)
      : false;
  const flatAmountInvalid =
    selectedTier?.calculationType === 'flat' &&
    (amount.trim() === '' || !amountWithinTier(amount.trim(), selectedTier));

  async function confirm() {
    setFieldError(null);

    if (selectedTier === undefined) {
      setFieldError('No reward tier matches this report’s final severity and affected asset.');
      return;
    }
    if (rangeOutOfBounds || flatAmountInvalid) {
      setFieldError(
        selectedTier.calculationType === 'range'
          ? 'Reward amount is outside the configured range'
          : 'The flat reward amount must match the configured tier exactly.',
      );
      return;
    }

    // Only the field the chosen tier type actually uses is sent. A percentage tier never carries
    // an amount, so the payload cannot even suggest the client decided the payout.
    const parsed = approveRewardRequestSchema.safeParse(
      mode === 'decided' ? { amount: amount.trim() } : { calculationBasisAmount: basis.trim() },
    );

    if (!parsed.success) {
      setFieldError(
        mode === 'decided'
          ? 'Enter the reward as a plain USDC figure, for example 2500 or 2500.50.'
          : 'Enter the verified funds at risk as a plain USDC figure above zero.',
      );
      return;
    }

    const result = await settleReward(parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Approve reward"
      description="Reserves the reward against the program's available pool. It does not send a payment."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Approve the reward"
      trigger={<Button>Approve reward</Button>}
      warning="Approval reserves USDC from the pool and cannot be reversed from this screen."
      confirmDisabled={
        selectedTier === undefined ||
        rangeOutOfBounds ||
        flatAmountInvalid ||
        (mode === 'decided' && amount.trim() === '')
      }
    >
      <Callout title={`Final severity: ${report.finalSeverity ?? 'Unavailable'}`} variant="info">
        <p>
          All active tiers for {report.affectedScope.name} ({report.affectedScope.assetType}) are
          shown below. Only tiers matching the validated final severity can be selected; the
          proposed severity is not used for pricing.
        </p>
      </Callout>

      {configuredTiers.length === 0 ? null : (
        <div className="flex flex-col gap-xs" data-testid="configured-reward-tiers">
          <p className="text-label-md text-text">Configured tiers for this asset</p>
          {configuredTiers.map((tier, index) => {
            const applicable = tiers.includes(tier);
            return (
              <div
                className={`flex items-center justify-between gap-md rounded-md border p-sm ${applicable ? 'border-primary bg-surface-raised' : 'border-border bg-surface'}`}
                key={`${tier.assetType}-${tier.severity}-${tier.calculationType}-${index}`}
              >
                <span className="text-body-sm text-text">{`${tier.severity} · ${tierDetails(tier)}`}</span>
                <span className="text-label-sm text-text-muted">
                  {applicable ? 'Available for final severity' : 'Not applicable'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {tiers.length > 1 ? (
        <fieldset className="flex flex-col gap-md">
          <legend className="mb-sm text-label-md text-text">Choose a configured reward tier</legend>
          <RadioGroup
            onValueChange={(value) => {
              setSelectedTierIndex(Number(value));
              setAmount('');
              setBasis('');
              setFieldError(null);
            }}
            value={String(selectedTierIndex)}
          >
            {tiers.map((tier, index) => (
              <RadioGroupCard
                key={`${tier.assetType}-${tier.severity}-${tier.calculationType}-${index}`}
                description={tier.calculationNote ?? tierDetails(tier)}
                title={tierDetails(tier)}
                value={String(index)}
              />
            ))}
          </RadioGroup>
        </fieldset>
      ) : selectedTier === undefined ? (
        <p className="text-body-sm text-error" role="alert">
          No active reward tier matches this report&rsquo;s final severity and affected asset.
        </p>
      ) : (
        <Callout title="Configured reward tier" variant="info">
          <p>{tierDetails(selectedTier)}</p>
          {selectedTier.calculationNote === undefined ? null : (
            <p>{selectedTier.calculationNote}</p>
          )}
        </Callout>
      )}

      {selectedTier?.calculationType !== 'percentage' ? (
        <Field
          error={
            fieldError ??
            (rangeOutOfBounds ? 'Reward amount is outside the configured range' : undefined)
          }
          helperText={
            selectedTier?.calculationType === 'flat'
              ? 'The configured flat amount is prefilled and cannot be changed.'
              : 'Inclusive configured range. The server validates the amount again.'
          }
          label="Reward amount (USDC)"
          required
        >
          <Input
            aria-readonly={selectedTier?.calculationType === 'flat' || undefined}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder={selectedTier?.calculationType === 'range' ? '2500' : undefined}
            readOnly={selectedTier?.calculationType === 'flat'}
            size="lg"
            value={amount}
          />
        </Field>
      ) : (
        <>
          <Field
            error={fieldError ?? undefined}
            helperText="The funds you verified were actually at risk — the basis the percentage applies to."
            label="Verified funds at risk (USDC)"
            required
          >
            <Input
              inputMode="decimal"
              onChange={(event) => setBasis(event.target.value)}
              placeholder="1200000"
              size="lg"
              value={basis}
            />
          </Field>
          <Callout title="The server decides the amount" variant="info">
            The reward is derived from this basis and the tier&rsquo;s basis points, capped at the
            tier maximum, and every input is snapshotted with the decision. No reward amount is sent
            from this screen — the figure shown after approval is the authoritative one.
          </Callout>
        </>
      )}
    </ActionDialog>
  );
}

function ResumeRewardSettlementAction({
  busy,
  resume,
}: {
  readonly busy: boolean;
  readonly resume: (recoveryHash?: string) => Promise<SubmitResult>;
}) {
  const [recoveryHash, setRecoveryHash] = useState('');
  const [hashError, setHashError] = useState<string | null>(null);
  const form = useActionForm(() => undefined);
  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Resume verification"
      description="Checks the known Arc evidence and resumes the permissionless Circle payout relay. The owner does not sign a second payout transaction."
      error={form.error}
      onConfirm={() => {
        const candidate = recoveryHash.trim();
        if (candidate !== '' && !/^0x[0-9a-fA-F]{64}$/.test(candidate)) {
          setHashError('Enter a valid Arc transaction hash, or leave this empty.');
          return;
        }
        setHashError(null);
        void resume(candidate === '' ? undefined : candidate).then((result) => {
          if (result.ok) form.close();
          else form.setError(result.message);
        });
      }}
      onOpenChange={form.change}
      open={form.open}
      title="Resume reward settlement"
      trigger={<Button>Resume settlement</Button>}
    >
      <Field
        error={hashError ?? undefined}
        helperText="Optional. Use the hash returned by the owner wallet if the page reloaded before it reached the server."
        label="Approval recovery hash"
      >
        <Input
          autoComplete="off"
          onChange={(event) => setRecoveryHash(event.target.value)}
          placeholder="0x…"
          size="lg"
          value={recoveryHash}
        />
      </Field>
    </ActionDialog>
  );
}

function ContinueRewardApprovalAction({
  amount,
  busy,
  cancel,
  continueApproval,
}: {
  readonly amount: string;
  readonly busy: boolean;
  readonly cancel: () => Promise<SubmitResult>;
  readonly continueApproval: () => Promise<SubmitResult>;
}) {
  const continuation = useActionForm(() => undefined);
  const cancellation = useActionForm(() => undefined);

  return (
    <>
      <ActionDialog
        busy={busy}
        confirmLabel="Continue approval"
        description={`The server already reserved ${amount} USDC. Continue with that immutable amount; this does not create another reservation.`}
        error={continuation.error}
        onConfirm={() => {
          void continueApproval().then((result) => {
            if (result.ok) continuation.close();
            else continuation.setError(result.message);
          });
        }}
        onOpenChange={continuation.change}
        open={continuation.open}
        title="Continue the reserved reward"
        trigger={<Button>Continue approval</Button>}
      >
        <Callout title="One owner signature" variant="info">
          The wallet will sign the locked approveReward call once. If a previous prompt may have
          submitted, this action is hidden and only recovery is offered.
        </Callout>
      </ActionDialog>

      <ActionDialog
        busy={busy}
        confirmLabel="Release reservation"
        description={`Cancels the unsigned ${amount} USDC reward reservation after the server scans Arc for an approval.`}
        error={cancellation.error}
        onConfirm={() => {
          void cancel().then((result) => {
            if (result.ok) cancellation.close();
            else cancellation.setError(result.message);
          });
        }}
        onOpenChange={cancellation.change}
        open={cancellation.open}
        title="Cancel unsigned reward"
        tone="destructive"
        trigger={<Button variant="secondary">Cancel reservation</Button>}
        warning="Cancellation is allowed only before any known or uncertain approval submission. Arc is checked before the reservation is released."
      />
    </>
  );
}

function SettlementPreflight({ intent }: { readonly intent: RewardSettlementIntent }) {
  const maskedRecipient = `${intent.recipientAddress.slice(0, 6)}…${intent.recipientAddress.slice(-4)}`;
  const calculation =
    intent.calculationType === 'percentage'
      ? `Percentage · ${intent.percentageBps === undefined ? 'server-derived' : `${intent.percentageBps} bps`}`
      : readableCalculation(intent.calculationType);

  return (
    <Callout title="Reward settlement preflight" variant="info">
      <div className="flex flex-col gap-md">
        <p>
          Server-derived values are locked to this durable intent. Review them before the owner
          wallet signs; a payout is permissionless after approval.
        </p>
        <dl className="grid gap-sm text-body-sm sm:grid-cols-2">
          <div>
            <dt className="text-label-sm text-text-muted">Reward</dt>
            <dd className="text-text">{intent.amount} USDC</dd>
          </div>
          <div>
            <dt className="text-label-sm text-text-muted">Calculation</dt>
            <dd className="text-text">{calculation}</dd>
          </div>
          {intent.calculationBasisAmount === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Verified basis</dt>
              <dd className="text-text">{intent.calculationBasisAmount} USDC</dd>
            </div>
          )}
          {intent.maxRewardCap === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Cap</dt>
              <dd className="text-text">{intent.maxRewardCap} USDC</dd>
            </div>
          )}
          <div>
            <dt className="text-label-sm text-text-muted">Researcher wallet</dt>
            <dd className="font-mono text-text">{maskedRecipient}</dd>
          </div>
          <div>
            <dt className="text-label-sm text-text-muted">Escrow</dt>
            <dd className="font-mono text-text">{intent.escrowAddress}</dd>
          </div>
        </dl>
      </div>
    </Callout>
  );
}

function readableCalculation(value: RewardSettlementIntent['calculationType']): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* ── Panel ────────────────────────────────────────────────────────────────────────────────── */

export interface ReviewActionsProps {
  readonly principalId: string;
  readonly report: ReportDetail;
  readonly token: string | undefined;
  readonly viewerRole?: 'owner' | 'researcher' | 'reviewer';
  readonly initialDuplicateCandidateId?: string;
  readonly onDuplicateCandidateConsumed?: () => void;
}

export function ReviewActions({
  initialDuplicateCandidateId,
  onDuplicateCandidateConsumed,
  principalId,
  report,
  token,
  viewerRole,
}: ReviewActionsProps) {
  const client = useQueryClient();
  const { address: rainbowAddress, connector: rainbowConnector, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const rewardIntentQueryKey = ['reward-settlement', principalId, report.id] as const;
  const settlement = useQuery({
    queryKey: rewardIntentQueryKey,
    queryFn: () =>
      apiRequest(
        `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents/current`,
        rewardSettlementIntentResponseSchema,
        { method: 'GET', token },
      ),
    enabled:
      viewerRole === 'owner' &&
      ['validated', 'reward_approved', 'payment_pending'].includes(report.status),
    retry: false,
  });
  const [localRecoveryIntentId, setLocalRecoveryIntentId] = useState<string | undefined>();
  const [volatileRecovery, setVolatileRecovery] = useState<
    { intentId: string; transactionHash: string } | undefined
  >();

  async function connectRewardWallet(): Promise<CircleWalletSession> {
    return connectRewardWalletViaRainbowKit({
      address: rainbowAddress,
      connector: rainbowConnector,
      isConnected,
      openConnectModal,
    });
  }

  useEffect(() => {
    const intentId = settlement.data?.data.id;
    if (intentId === undefined) {
      setLocalRecoveryIntentId(undefined);
      return;
    }
    setLocalRecoveryIntentId(
      readRewardApprovalHash(window.localStorage, intentId) !== undefined ||
        readRewardApprovalUncertain(window.localStorage, intentId)
        ? intentId
        : undefined,
    );
  }, [settlement.data?.data.id]);

  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: ActionId; body: unknown }) =>
      apiRequest(`/api/reports/${encodeURIComponent(report.id)}/${action}`, reportResponseSchema, {
        method: 'POST',
        token,
        body,
      }),
    onSuccess: async (response) => {
      // The transition endpoints return the updated report, so the detail cache is written
      // directly and only the lists need a refetch.
      client.setQueryData(queryKeys.report(principalId, report.id), response);
      await client.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) });
    },
  });

  function rewardDependencies(): RewardApprovalOrchestratorDependencies {
    return {
      recoveryStore: window.localStorage,
      connect: connectRewardWallet,
      current: async () =>
        (
          await apiRequest(
            `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents/current`,
            rewardSettlementIntentResponseSchema,
            { method: 'GET', token },
          )
        ).data,
      cancel: async (intentId) =>
        apiRequest(
          `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents/${encodeURIComponent(intentId)}/cancel`,
          rewardSettlementIntentResponseSchema,
          { method: 'POST', token },
        ),
      observe: async (intentId, input) =>
        (
          await apiRequest(
            `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents/${encodeURIComponent(intentId)}/approval-observations`,
            rewardSettlementIntentResponseSchema,
            { method: 'POST', token, body: input },
          )
        ).data,
      reconcile: async (intentId) =>
        (
          await apiRequest(
            `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents/${encodeURIComponent(intentId)}/reconcile`,
            rewardSettlementIntentResponseSchema,
            { method: 'POST', token },
          )
        ).data,
      setRecoveryIntent: setLocalRecoveryIntentId,
      setVolatileRecovery,
    };
  }

  const rewardMutation = useMutation({
    mutationFn: async (
      command:
        { kind: 'create'; input: ApproveRewardRequest } | { kind: 'continue'; intentId: string },
    ) => {
      const session = await connectRewardWallet();
      let intentId: string;
      if (command.kind === 'create') {
        const request = createRewardSettlementIntentRequestSchema.parse({
          idempotencyKey: crypto.randomUUID(),
          ownerWallet: session.address,
          ...command.input,
        });
        const created = await apiRequest(
          `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents`,
          rewardSettlementIntentResponseSchema,
          { method: 'POST', token, body: request },
        );
        intentId = created.data.id;
      } else {
        intentId = command.intentId;
      }
      return executeReservedRewardApproval(intentId, rewardDependencies(), session);
    },
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.report(principalId, report.id) }),
        client.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) }),
        client.invalidateQueries({ queryKey: rewardIntentQueryKey }),
      ]);
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async (recoveryHash?: string) =>
      resumeRewardApproval(rewardDependencies(), {
        ...(recoveryHash === undefined ? {} : { recoveryHash }),
        ...(volatileRecovery === undefined ? {} : { volatileRecovery }),
      }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.report(principalId, report.id) }),
        client.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) }),
        client.invalidateQueries({ queryKey: rewardIntentQueryKey }),
      ]);
    },
  });

  const cancelRewardMutation = useMutation({
    mutationFn: async (intentId: string) =>
      apiRequest(
        `/api/reports/${encodeURIComponent(report.id)}/reward-settlement-intents/${encodeURIComponent(intentId)}/cancel`,
        rewardSettlementIntentResponseSchema,
        { method: 'POST', token },
      ),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: rewardIntentQueryKey });
    },
  });

  async function submit(action: ActionId, body: unknown): Promise<SubmitResult> {
    try {
      await mutation.mutateAsync({ action, body });
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        message: describeReportError(
          cause,
          'That decision was not applied. Refresh the report and try again.',
        ),
      };
    }
  }

  async function settleReward(input: ApproveRewardRequest): Promise<SubmitResult> {
    try {
      await rewardMutation.mutateAsync({ kind: 'create', input });
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        message: describeReportError(
          cause,
          'Reward approval was not completed. Use Resume settlement if the wallet may have submitted a transaction.',
        ),
      };
    }
  }

  async function continueReward(intentId: string): Promise<SubmitResult> {
    try {
      await rewardMutation.mutateAsync({ kind: 'continue', intentId });
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        message: describeReportError(
          cause,
          'The reserved approval was not completed. No second signature is offered if its outcome is uncertain.',
        ),
      };
    }
  }

  async function cancelReward(intentId: string): Promise<SubmitResult> {
    try {
      await cancelRewardMutation.mutateAsync(intentId);
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        message: describeReportError(
          cause,
          'The reservation was not released. Arc evidence may still need verification.',
        ),
      };
    }
  }

  async function resumeReward(recoveryHash?: string): Promise<SubmitResult> {
    try {
      await resumeMutation.mutateAsync(recoveryHash);
      return { ok: true };
    } catch (cause) {
      return {
        ok: false,
        message: describeReportError(
          cause,
          'Settlement is still pending or could not be verified. No new owner signature was requested.',
        ),
      };
    }
  }

  const available = ACTIONS_BY_STATUS[report.status];
  const canRenderReopen = viewerRole === 'owner' && report.capabilities.canReopenDuplicate;
  const canRenderSendBack = viewerRole === 'owner' && report.capabilities.canSendBackForReview;
  const hasVisibleAction = available.some(
    (action) =>
      (action !== 'reopen-duplicate' || canRenderReopen) &&
      (action !== 'send-back-for-review' || canRenderSendBack),
  );
  const settlementAbsent =
    settlement.error instanceof ApiClientError &&
    settlement.error.status === 404 &&
    settlement.error.code === 'reward_settlement_not_found';
  const intentState = settlement.isPending
    ? 'loading'
    : settlement.data !== undefined
      ? 'loaded'
      : settlementAbsent
        ? 'absent'
        : 'error';
  const settlementMode = rewardSettlementUiMode({
    reportStatus: report.status,
    intentState,
    localRecoveryKnown:
      settlement.data !== undefined && settlement.data.data.id === localRecoveryIntentId,
    ...(settlement.data === undefined ? {} : { intent: settlement.data.data }),
  });
  const busy =
    mutation.isPending ||
    rewardMutation.isPending ||
    resumeMutation.isPending ||
    cancelRewardMutation.isPending;
  const props: ActionProps = { busy, submit };
  const reviewerWaitingForOwner = viewerRole === 'reviewer' && report.status === 'validated';

  return (
    <Card className="h-fit gap-xl" padding="lg">
      <CardHeader>
        <CardTitle>Review decision</CardTitle>
        <CardDescription>
          Only the transitions this report&rsquo;s current status allows are shown. Every decision
          is recorded against your account.
        </CardDescription>
      </CardHeader>

      {viewerRole === 'owner' && settlement.data !== undefined ? (
        <SettlementPreflight intent={settlement.data.data} />
      ) : null}

      {reviewerWaitingForOwner ? (
        <p className="text-body-sm text-text-muted" role="status">
          Waiting for the program owner to approve the reward.
        </p>
      ) : !hasVisibleAction ? (
        <p className="text-body-sm text-text-muted">
          {WAITING_COPY[report.status] ?? 'There is nothing to decide at this stage.'}
        </p>
      ) : (
        <div className="flex flex-col items-stretch gap-md">
          {available.includes('validate') ? (
            <ValidateAction {...props} proposed={report.proposedSeverity} />
          ) : null}
          {available.includes('send-back-for-review') && canRenderSendBack ? (
            <SendBackForReviewAction {...props} />
          ) : null}
          {viewerRole === 'owner' &&
          available.includes('approve-reward') &&
          settlementMode === 'approve' ? (
            <ApproveRewardAction busy={busy} report={report} settleReward={settleReward} />
          ) : null}
          {viewerRole === 'owner' &&
          settlementMode === 'continue' &&
          settlement.data !== undefined ? (
            <ContinueRewardApprovalAction
              amount={settlement.data.data.amount}
              busy={busy}
              cancel={() => cancelReward(settlement.data.data.id)}
              continueApproval={() => continueReward(settlement.data.data.id)}
            />
          ) : null}
          {viewerRole === 'owner' && settlementMode === 'resume' ? (
            <ResumeRewardSettlementAction busy={busy} resume={resumeReward} />
          ) : null}
          {viewerRole === 'owner' && settlementMode === 'loading' ? (
            <p className="text-body-sm text-text-muted">Checking durable settlement state…</p>
          ) : null}
          {viewerRole === 'owner' && settlementMode === 'error' ? (
            <Callout title="Settlement state could not be verified" variant="danger">
              <div className="flex flex-col items-start gap-md">
                <p>
                  Approval is disabled because the server could not prove whether a durable intent
                  already exists. Retrying this read never asks the wallet to sign.
                </p>
                <Button
                  disabled={settlement.isFetching}
                  onClick={() => void settlement.refetch()}
                  variant="secondary"
                >
                  Retry status check
                </Button>
              </div>
            </Callout>
          ) : null}
          {available.includes('request-information') ? (
            <RequestInformationAction {...props} />
          ) : null}
          {available.includes('reject') ? <RejectAction {...props} /> : null}
          {available.includes('mark-duplicate') ? (
            <MarkDuplicateAction
              {...props}
              currentProgramId={report.programId}
              currentReportId={report.id}
              currentSubmittedAt={report.submittedAt ?? report.createdAt}
              currentSubmissionSequence={report.aiReview?.submissionSequence}
              duplicateCandidates={report.aiReview?.duplicateCandidates ?? []}
              {...(initialDuplicateCandidateId === undefined
                ? {}
                : { initialOriginalReportId: initialDuplicateCandidateId })}
              {...(onDuplicateCandidateConsumed === undefined
                ? {}
                : { onInitialOriginalReportIdConsumed: onDuplicateCandidateConsumed })}
              token={token}
            />
          ) : null}
          {available.includes('reopen-duplicate') && canRenderReopen ? (
            <ReopenDuplicateAction {...props} />
          ) : null}
        </div>
      )}

      <p aria-live="polite" className="text-label-sm text-text-muted">
        {busy ? 'Applying the decision…' : ''}
      </p>
    </Card>
  );
}
