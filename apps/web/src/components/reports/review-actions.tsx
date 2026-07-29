'use client';

import {
  approveRewardRequestSchema,
  createRewardSettlementIntentRequestSchema,
  markDuplicateRequestSchema,
  rejectReportRequestSchema,
  reportResponseSchema,
  rewardSettlementIntentResponseSchema,
  requestInformationRequestSchema,
  validateReportRequestSchema,
  type ApproveRewardRequest,
  type ReportDetail,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

import {
  describeReportError,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  type ReportStatus,
} from './report-format';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { connectCircleWallet } from '@/components/owner/circle-funding-executor';

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
  duplicate: 'This report is closed as a duplicate. That decision is final.',
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
            disabled={busy}
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

function MarkDuplicateAction({ busy, submit }: ActionProps) {
  const [originalId, setOriginalId] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useActionForm(() => {
    setOriginalId('');
    setReason('');
    setFieldError(null);
  });

  async function confirm() {
    setFieldError(null);
    const trimmedReason = reason.trim();
    const parsed = markDuplicateRequestSchema.safeParse({
      originalReportId: originalId.trim(),
      ...(trimmedReason === '' ? {} : { reason: trimmedReason }),
    });

    if (!parsed.success) {
      setFieldError('Enter the id of the earlier report this one duplicates.');
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
      warning="A duplicate is closed for good and earns no reward. Check the original first."
    >
      <Field
        error={fieldError ?? undefined}
        helperText="The full id of the original report, copied from its detail screen."
        label="Original report id"
        required
      >
        <Input
          autoComplete="off"
          onChange={(event) => setOriginalId(event.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          size="lg"
          value={originalId}
        />
      </Field>
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

/* ── Approve reward ───────────────────────────────────────────────────────────────────────── */

type RewardMode = 'decided' | 'percentage';

function ApproveRewardAction({
  busy,
  settleReward,
}: {
  readonly busy: boolean;
  readonly settleReward: (input: ApproveRewardRequest) => Promise<SubmitResult>;
}) {
  const [mode, setMode] = useState<RewardMode>('decided');
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useActionForm(() => {
    setMode('decided');
    setAmount('');
    setBasis('');
    setFieldError(null);
  });

  async function confirm() {
    setFieldError(null);

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
    >
      <fieldset className="flex flex-col gap-md">
        <legend className="mb-sm text-label-md text-text">How is this tier calculated?</legend>
        <RadioGroup
          onValueChange={(value) => {
            setMode(value as RewardMode);
            setFieldError(null);
          }}
          value={mode}
        >
          <RadioGroupCard
            description="You decide the payout. The server bounds-checks it against the tier for this severity and asset type."
            title="Range or flat tier"
            value="decided"
          />
          <RadioGroupCard
            description="You supply the verified funds at risk. The server derives the reward from the tier's basis points and applies the cap."
            title="Percentage tier"
            value="percentage"
          />
        </RadioGroup>
      </fieldset>

      {mode === 'decided' ? (
        <Field
          error={fieldError ?? undefined}
          helperText="Plain USDC figure. The server rejects anything outside the tier's bounds."
          label="Reward amount (USDC)"
          required
        >
          <Input
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="2500"
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

/* ── Panel ────────────────────────────────────────────────────────────────────────────────── */

export interface ReviewActionsProps {
  readonly principalId: string;
  readonly report: ReportDetail;
  readonly token: string | undefined;
  readonly viewerRole?: 'owner' | 'researcher' | 'reviewer';
}

export function ReviewActions({ principalId, report, token, viewerRole }: ReviewActionsProps) {
  const client = useQueryClient();
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
      connect: connectCircleWallet,
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
      const session = await connectCircleWallet();
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

  return (
    <Card className="h-fit gap-xl" padding="lg">
      <CardHeader>
        <CardTitle>Review decision</CardTitle>
        <CardDescription>
          Only the transitions this report&rsquo;s current status allows are shown. Every decision
          is recorded against your account.
        </CardDescription>
      </CardHeader>

      {available.length === 0 ? (
        <p className="text-body-sm text-text-muted">
          {WAITING_COPY[report.status] ?? 'There is nothing to decide at this stage.'}
        </p>
      ) : (
        <div className="flex flex-col items-stretch gap-md">
          {available.includes('validate') ? (
            <ValidateAction {...props} proposed={report.proposedSeverity} />
          ) : null}
          {viewerRole === 'owner' &&
          available.includes('approve-reward') &&
          settlementMode === 'approve' ? (
            <ApproveRewardAction busy={busy} settleReward={settleReward} />
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
          {available.includes('mark-duplicate') ? <MarkDuplicateAction {...props} /> : null}
        </div>
      )}

      <p aria-live="polite" className="text-label-sm text-text-muted">
        {busy ? 'Applying the decision…' : ''}
      </p>
    </Card>
  );
}
