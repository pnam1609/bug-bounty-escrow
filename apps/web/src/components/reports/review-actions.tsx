'use client';

import {
  approveRewardRequestSchema,
  confirmPaymentRequestSchema,
  markDuplicateRequestSchema,
  rejectReportRequestSchema,
  reportResponseSchema,
  requestInformationRequestSchema,
  startPaymentRequestSchema,
  validateReportRequestSchema,
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import {
  describeReportError,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  type ReportStatus,
} from './report-format';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

import {
  ACTIONS_BY_STATUS,
  ACTION_RESULT_STATUS,
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

function ApproveRewardAction({ busy, submit }: ActionProps) {
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
      mode === 'decided'
        ? { amount: amount.trim() }
        : { calculationBasisAmount: basis.trim() },
    );

    if (!parsed.success) {
      setFieldError(
        mode === 'decided'
          ? 'Enter the reward as a plain USDC figure, for example 2500 or 2500.50.'
          : 'Enter the verified funds at risk as a plain USDC figure above zero.',
      );
      return;
    }

    const result = await submit('approve-reward', parsed.data);
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
        <legend className="mb-sm text-label-md text-text">
          How is this tier calculated?
        </legend>
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
            tier maximum, and every input is snapshotted with the decision. No reward amount is
            sent from this screen — the figure shown after approval is the authoritative one.
          </Callout>
        </>
      )}
    </ActionDialog>
  );
}

/* ── Pay ──────────────────────────────────────────────────────────────────────────────────── */

function PayAction({ busy, submit }: ActionProps) {
  const [hash, setHash] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [hashError, setHashError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const form = useActionForm(() => {
    setHash('');
    setTokenAddress('');
    setHashError(null);
    setTokenError(null);
  });

  async function confirm() {
    setHashError(null);
    setTokenError(null);

    const parsed = startPaymentRequestSchema.safeParse({
      transactionHash: hash.trim(),
      tokenAddress: tokenAddress.trim(),
    });

    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      if (paths.has('transactionHash')) {
        setHashError('Enter the 0x-prefixed 64-character transaction hash.');
      }
      if (paths.has('tokenAddress')) {
        setTokenError('Enter the 0x-prefixed 40-character token contract address.');
      }
      return;
    }

    const result = await submit('pay', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Record payment"
      description="Records the payout transaction and moves the report to Payment pending."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Record the payout transaction"
      trigger={<Button>Record payment</Button>}
      warning="Record a hash only after the transfer has actually been broadcast. The report cannot go back to Reward approved."
    >
      <Field error={hashError ?? undefined} label="Transaction hash" required>
        <Input
          autoComplete="off"
          onChange={(event) => setHash(event.target.value)}
          placeholder="0x…"
          size="lg"
          value={hash}
        />
      </Field>
      <Field
        error={tokenError ?? undefined}
        helperText="The USDC contract the transfer used."
        label="Token address"
        required
      >
        <Input
          autoComplete="off"
          onChange={(event) => setTokenAddress(event.target.value)}
          placeholder="0x…"
          size="lg"
          value={tokenAddress}
        />
      </Field>
    </ActionDialog>
  );
}

/* ── Confirm payment ──────────────────────────────────────────────────────────────────────── */

function ConfirmPaymentAction({ busy, submit }: ActionProps) {
  const [blockNumber, setBlockNumber] = useState('');
  const [blockHash, setBlockHash] = useState('');
  const [confirmations, setConfirmations] = useState('1');
  const [numberError, setNumberError] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const form = useActionForm(() => {
    setBlockNumber('');
    setBlockHash('');
    setConfirmations('1');
    setNumberError(null);
    setHashError(null);
  });

  async function confirm() {
    setNumberError(null);
    setHashError(null);

    const parsed = confirmPaymentRequestSchema.safeParse({
      blockNumber: Number(blockNumber),
      blockHash: blockHash.trim(),
      confirmations: Number(confirmations),
    });

    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      if (paths.has('blockNumber') || paths.has('confirmations')) {
        setNumberError('Enter the block number and a confirmation count of at least 1.');
      }
      if (paths.has('blockHash')) {
        setHashError('Enter the 0x-prefixed 64-character block hash.');
      }
      return;
    }

    const result = await submit('confirm-payment', parsed.data);
    if (result.ok) form.close();
    else form.setError(result.message);
  }

  return (
    <ActionDialog
      busy={busy}
      confirmLabel="Confirm payment"
      description="Settles the payout: the reserved amount moves to paid and the report closes as Paid."
      error={form.error}
      onConfirm={() => void confirm()}
      onOpenChange={form.change}
      open={form.open}
      title="Confirm the payment settled"
      trigger={<Button>Confirm payment</Button>}
      warning="Confirming closes the report. Only do this once the transaction has the confirmations your policy requires."
    >
      <Field error={numberError ?? undefined} label="Block number" required>
        <Input
          inputMode="numeric"
          onChange={(event) => setBlockNumber(event.target.value)}
          placeholder="21345678"
          size="lg"
          value={blockNumber}
        />
      </Field>
      <Field error={hashError ?? undefined} label="Block hash" required>
        <Input
          autoComplete="off"
          onChange={(event) => setBlockHash(event.target.value)}
          placeholder="0x…"
          size="lg"
          value={blockHash}
        />
      </Field>
      <Field label="Confirmations" required>
        <Input
          inputMode="numeric"
          onChange={(event) => setConfirmations(event.target.value)}
          size="lg"
          value={confirmations}
        />
      </Field>
    </ActionDialog>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────────────────────── */

export interface ReviewActionsProps {
  readonly principalId: string;
  readonly report: ReportDetail;
  readonly token: string | undefined;
}

export function ReviewActions({ principalId, report, token }: ReviewActionsProps) {
  const client = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: ActionId; body: unknown }) =>
      apiRequest(
        `/api/reports/${encodeURIComponent(report.id)}/${action}`,
        reportResponseSchema,
        { method: 'POST', token, body },
      ),
    onSuccess: async (response) => {
      // The transition endpoints return the updated report, so the detail cache is written
      // directly and only the lists need a refetch.
      client.setQueryData(queryKeys.report(principalId, report.id), response);
      await client.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) });
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

  const available = ACTIONS_BY_STATUS[report.status];
  const busy = mutation.isPending;
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
          {available.includes('approve-reward') ? <ApproveRewardAction {...props} /> : null}
          {available.includes('pay') ? <PayAction {...props} /> : null}
          {available.includes('confirm-payment') ? <ConfirmPaymentAction {...props} /> : null}
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
