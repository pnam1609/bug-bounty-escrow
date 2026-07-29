'use client';

import {
  createFundingIntentRequestSchema,
  attachSourceDepositRequestSchema,
  createSourceDepositRequestSchema,
  createWithdrawalIntentRequestSchema,
  deployEscrowWithCircleRequestSchema,
  escrowDeploymentResponseSchema,
  fundingConfirmationArtifactResponseSchema,
  fundingIntentResponseSchema,
  gatewayFundingReadinessResponseSchema,
  observeFundingOperationRequestSchema,
  observeSourceDepositRequestSchema,
  refreshFundingQuoteRequestSchema,
  observeWithdrawalRequestSchema,
  programResponseSchema,
  withdrawalIntentResponseSchema,
  type FundingIntent as ApiFundingIntent,
  type FundingConfirmationArtifact,
  type Program,
  type WithdrawalIntent,
} from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Separator,
  StatusBadge,
  Stepper,
} from '@bug-bounty-escrow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  bridgeRecoveryTelemetry,
  canRetryBridgeResult,
  CircleBridgeIncompleteError,
  connectCircleWallet,
  type CircleWalletSession,
} from './circle-funding-executor';
import { GuidancePanel, WorkspaceHeading } from './owner-workspace';
import {
  FUNDING_NETWORK_IDS,
  assertSelectedUnifiedBalanceReadiness,
  assertFundingRecoveryStorage,
  assertFreshFundingQuoteMatchesIntent,
  executeVerifiedFundingIntent,
  executePreparedFundingSubmission,
  fundingSourceForLockedDeposit,
  fundingRouteLabel,
  fundingSourceSubmittedRecoveryMessage,
  fundingContinuationAction,
  fundingSubmissionFailurePhase,
  clearPendingFundingResult,
  clearPendingSourceDepositHash,
  persistPendingFundingResult,
  persistPendingSourceDepositHash,
  readPendingFundingResult,
  readPendingSourceDepositHash,
  sourceDepositContinuationAction,
  selectedUnifiedBalanceDeficientNetworks,
  parseUsdcBaseUnits,
  validateFundingSelection,
  type FundingDestinationResult,
  type FundingOperationPhase,
  type FundingSource,
  type ValidatedFundingSelection,
  type VerifiedFundingIntent,
} from './program-funding-flow';
import {
  FundingAllocations,
  FundingConfirmationEvidence,
  FundingPending,
  type SourceDepositStatus,
} from './program-funding-views';
import {
  assertWithdrawalRecoveryStorage,
  clearPendingWithdrawalHash,
  persistPendingWithdrawalHash,
  readPendingWithdrawalHash,
  withdrawalContinuationAction,
} from './program-withdrawal-flow';
import { CREATE_PROGRAM_STEPS } from './program-wizard';
import { formatUsdc, shortenAddress } from './program-draft';
import {
  buildProgramReadiness,
  type ProgramReadinessItem,
} from './program-readiness-model';
import { FormCard, StepLayout, SummaryRow, WizardShell } from './wizard-parts';
import { apiRequest, ApiClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

function fundingPhaseFromApi(status: ApiFundingIntent['status']): FundingOperationPhase {
  if (status === 'failed' || status === 'cancelled') return 'sync_failed';
  return status;
}

function fundingSourcesFromApi(intent: ApiFundingIntent): FundingSource[] {
  return intent.sources.map((source, index) => ({
    rowId: `intent-source-${index + 1}`,
    network: source.network,
    amount: source.amount,
  }));
}

function verifiedIntentFromApi(intent: ApiFundingIntent): VerifiedFundingIntent {
  const recovery =
    intent.recovery === undefined
      ? undefined
      : {
          ...(intent.recovery.providerState === undefined
            ? {}
            : { providerState: intent.recovery.providerState }),
          retryable: intent.recovery.retryable,
          submissionUncertain: intent.recovery.submissionUncertain,
          sourceTransactionHashes: intent.recovery.sourceTransactionHashes,
          steps: intent.recovery.steps.map((step) => ({
            name: step.name,
            state: step.state,
            ...(step.transactionHash === undefined
              ? {}
              : { transactionHash: step.transactionHash }),
            ...(step.errorCode === undefined ? {} : { errorCode: step.errorCode }),
          })),
        };
  return {
    id: intent.id,
    walletAddress: intent.walletAddress,
    routeMode: intent.routeMode,
    grossAmount: intent.grossAmount,
    estimatedFeeReserve: intent.estimatedFeeReserve,
    feeAllocations: intent.feeAllocations.map((allocation) => ({ ...allocation })),
    ...('quoteQuotedAt' in intent && typeof intent.quoteQuotedAt === 'string'
      ? { quoteQuotedAt: intent.quoteQuotedAt }
      : {}),
    ...('quoteExpiresAt' in intent && typeof intent.quoteExpiresAt === 'string'
      ? { quoteExpiresAt: intent.quoteExpiresAt }
      : {}),
    sources: fundingSourcesFromApi(intent),
    sourceDeposits: intent.sourceDeposits.map((deposit) => ({
      id: deposit.id,
      attemptNo: deposit.attemptNo,
      ...(deposit.replacesDepositId === undefined
        ? {}
        : { replacesDepositId: deposit.replacesDepositId }),
      network: deposit.network,
      amount: deposit.amount,
      status: deposit.status,
      ...(deposit.transactionHash === undefined
        ? {}
        : { transactionHash: deposit.transactionHash }),
      ...(deposit.failureCode === undefined ? {} : { failureCode: deposit.failureCode }),
      canAttach: deposit.canAttach,
      canRetry: deposit.canRetry,
    })),
    destinationChain: intent.destinationChain,
    recipientAddress: intent.recipientAddress,
    recipientVerified: true,
    ...(recovery === undefined ? {} : { recovery }),
  };
}

function depositStatusesFromIntent(
  intent: ApiFundingIntent,
  intentSources: readonly FundingSource[],
): Readonly<Record<string, SourceDepositStatus>> {
  return Object.fromEntries(
    intentSources.map((source) => {
      const deposit = intent.sourceDeposits
        .filter((candidate) => candidate.network === source.network)
        .sort((left, right) => right.attemptNo - left.attemptNo)[0];
      return [source.rowId, sourceDepositStatusFromApi(deposit)];
    }),
  );
}

function sourceDepositStatusFromApi(
  deposit: ApiFundingIntent['sourceDeposits'][number] | undefined,
): SourceDepositStatus {
  if (deposit?.status === 'confirmed') return 'confirmed';
  if (
    deposit?.status === 'submitted' ||
    deposit?.status === 'onchain_verified' ||
    deposit?.status === 'gateway_finalized'
  ) {
    return 'pending';
  }
  if (deposit?.status === 'failed') return deposit.canRetry ? 'replaceable' : 'failed';
  if (deposit?.status === 'submission_uncertain') return 'recovery_required';
  return 'not_started';
}

function withdrawalActionLabel(intent: WithdrawalIntent | undefined): string {
  if (intent === undefined) return 'Check remaining funds';
  if (intent.status === 'ready_to_close') return 'Sign close transaction';
  if (intent.status === 'close_submission_uncertain') return 'Attach close transaction';
  if (intent.status === 'close_submitted') return 'Verify program close';
  if (intent.status === 'ready_to_withdraw') return 'Sign withdrawal';
  if (intent.status === 'withdraw_submission_uncertain') return 'Attach withdrawal transaction';
  if (intent.status === 'withdraw_submitted' || intent.status === 'verifying') {
    return 'Verify withdrawal';
  }
  if (intent.status === 'complete') return 'Check for late funds';
  if (intent.status === 'failed') return 'Start a new withdrawal';
  return 'Withdrawal needs support';
}

class DeploymentSupportRequiredError extends Error {
  constructor() {
    super(
      'Circle reported a definitive deployment failure. The immutable attempt is preserved; contact support because this screen will not create a blind replacement deployment.',
    );
    this.name = 'DeploymentSupportRequiredError';
  }
}

function ReadinessRow({ item }: { readonly item: ProgramReadinessItem }) {
  const Icon = item.complete ? CheckCircle2 : Circle;

  return (
    <li
      className="flex items-start gap-md rounded-md border border-border bg-surface-raised p-lg"
      data-readiness-item={item.id}
    >
      <Icon
        aria-hidden="true"
        className={`size-5 shrink-0 ${item.complete ? 'text-escrow' : 'text-text-disabled'}`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-xs sm:flex-row sm:items-start sm:justify-between sm:gap-lg">
        <span className="flex min-w-0 flex-col">
          <span className="text-label-lg text-text">{item.title}</span>
          <span className="text-label-md text-text-muted">{item.detail}</span>
        </span>
        <span
          className={`shrink-0 text-label-sm font-semibold uppercase ${
            item.complete ? 'text-escrow' : 'text-medium'
          }`}
        >
          {item.status}
        </span>
      </span>
    </li>
  );
}

function escrowSummary(program: Program, chainLabel: string): ReactNode {
  return (
    <>
      <SummaryRow label="Network" value={chainLabel} />
      <SummaryRow label="Token" value="USDC" />
      <SummaryRow
        label="Escrow contract"
        value={
          program.contractAddress === undefined
            ? 'Not deployed'
            : shortenAddress(program.contractAddress)
        }
      />
    </>
  );
}

export interface ProgramLifecycleProps {
  readonly program: Program;
  /** Rendered once after `POST /api/programs` lands on this route. */
  readonly showCreatedBanner: boolean;
  readonly logoFailed: boolean;
  readonly onBlockingPendingChange: (pending: boolean) => void;
  readonly onEditProgram: () => void;
}

export function ProgramLifecycle({
  logoFailed,
  onBlockingPendingChange,
  onEditProgram,
  program,
  showCreatedBanner,
}: ProgramLifecycleProps) {
  const { session } = useAuth();
  const client = useQueryClient();
  const router = useRouter();

  const [view, setView] = useState<'readiness' | 'fund'>('readiness');
  const [deployOpen, setDeployOpen] = useState(false);
  const [grossAmount, setGrossAmount] = useState('');
  const [sources, setSources] = useState<readonly FundingSource[]>([
    { rowId: 'source-1', network: 'Arc_Testnet', amount: '' },
  ]);
  const sourceSequence = useRef(1);
  const [walletSession, setWalletSession] = useState<CircleWalletSession>();
  const [walletPending, setWalletPending] = useState(false);
  const [walletError, setWalletError] = useState<string>();
  const [fundingSelection, setFundingSelection] = useState<ValidatedFundingSelection>();
  const [fundingPhase, setFundingPhase] = useState<FundingOperationPhase>('ready_to_sign');
  const [fundingWorking, setFundingWorking] = useState(false);
  const [fundingError, setFundingError] = useState<string>();
  const [fundingResult, setFundingResult] = useState<FundingDestinationResult>();
  const [bridgeRecoveryResult, setBridgeRecoveryResult] =
    useState<CircleBridgeIncompleteError['result']>();
  const [verifiedFundingIntent, setVerifiedFundingIntent] =
    useState<VerifiedFundingIntent>();
  const fundingIdempotencyKey = useRef<string | undefined>(undefined);
  const withdrawalIdempotencyKey = useRef<string | undefined>(undefined);
  const [depositStatuses, setDepositStatuses] = useState<
    Readonly<Record<string, SourceDepositStatus>>
  >({});
  const [depositRecoveryHashes, setDepositRecoveryHashes] = useState<
    Readonly<Record<string, string>>
  >({});
  const [confirmedUnifiedBalance, setConfirmedUnifiedBalance] = useState<string>();
  const [pendingUnifiedBalance, setPendingUnifiedBalance] = useState<string>();
  const [fundingConfirmation, setFundingConfirmation] =
    useState<FundingConfirmationArtifact>();
  const [fundingConfirmationError, setFundingConfirmationError] = useState<string>();
  const [withdrawalIntent, setWithdrawalIntent] = useState<WithdrawalIntent>();
  const [withdrawalWorking, setWithdrawalWorking] = useState(false);
  const [withdrawalError, setWithdrawalError] = useState<string>();
  const [withdrawalRecoveryHash, setWithdrawalRecoveryHash] = useState('');
  const [formError, setFormError] = useState<Record<string, string>>({});

  const chainLabel = 'Arc Testnet';
  const deployed = program.contractAddress !== undefined;
  const funded = Number(program.totalPool) > 0;
  const withdrawalAvailable =
    program.status === 'expired' ||
    program.status === 'closed' ||
    (program.deadline !== undefined && Date.parse(program.deadline) <= Date.now()) ||
    withdrawalIntent !== undefined;
  const walletMatchesVerifiedIntent =
    walletSession === undefined ||
    verifiedFundingIntent === undefined ||
    walletSession.address.toLowerCase() === verifiedFundingIntent.walletAddress.toLowerCase();

  useEffect(() => {
    if (session?.access_token === undefined || !deployed) return;
    let cancelled = false;
    void apiRequest(
      `/api/programs/${program.id}/funding-intents/active`,
      fundingIntentResponseSchema,
      { token: session.access_token },
    )
      .then((response) => {
        if (cancelled) return;
        const intent = response.data;
        const intentSources = fundingSourcesFromApi(intent);
        const validation = validateFundingSelection(intent.grossAmount, intentSources);
        if (validation.selection === undefined) return;
        setVerifiedFundingIntent(verifiedIntentFromApi(intent));
        setGrossAmount(intent.grossAmount);
        setSources(intentSources);
        setDepositStatuses(depositStatusesFromIntent(intent, intentSources));
        if (intent.routeMode !== 'unified_balance' || intent.status !== 'ready_to_sign') {
          setFundingSelection(validation.selection);
        }
        setFundingPhase(fundingPhaseFromApi(intent.status));
        setView('fund');
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiClientError && error.status === 404)) {
          setFundingError(
            error instanceof Error ? error.message : 'Funding intent could not be restored.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deployed, program.id, session?.access_token]);

  useEffect(() => {
    if (session?.access_token === undefined || !funded) return;
    let cancelled = false;
    setFundingConfirmation((current) =>
      current?.programId === program.id ? current : undefined,
    );
    setFundingConfirmationError(undefined);
    void apiRequest(
      `/api/programs/${program.id}/funding-confirmations/latest`,
      fundingConfirmationArtifactResponseSchema,
      { token: session.access_token },
    )
      .then((response) => {
        if (!cancelled) setFundingConfirmation(response.data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFundingConfirmation(undefined);
        setFundingConfirmationError(
          error instanceof Error
            ? error.message
            : 'Canonical funding confirmation could not be loaded.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [funded, program.id, session?.access_token]);

  useEffect(() => {
    if (session?.access_token === undefined || !deployed) return;
    let cancelled = false;
    void apiRequest(
      `/api/programs/${program.id}/withdrawal-intents/active`,
      withdrawalIntentResponseSchema,
      { token: session.access_token },
    )
      .then((response) => {
        if (!cancelled) setWithdrawalIntent(response.data);
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof ApiClientError && error.status === 404)) {
          setWithdrawalError(
            error instanceof Error ? error.message : 'Withdrawal state could not be restored.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deployed, program.id, session?.access_token]);

  function cacheProgram(saved: Program) {
    client.setQueryData(
      queryKeys.ownerProgram(session?.user.id ?? 'no-session', saved.id),
      { success: true, data: saved },
    );
    return client.invalidateQueries({ queryKey: ['programs'] });
  }

  const deployMutation = useMutation({
    mutationFn: async (): Promise<Program> => {
      if (walletSession === undefined) {
        throw new Error('Connect the owner wallet before deploying the escrow.');
      }
      if (program.deadline === undefined) {
        throw new Error('Set a program deadline before deploying the escrow.');
      }
      const body = deployEscrowWithCircleRequestSchema.parse({
        ownerWallet: walletSession.address,
        withdrawRecipient: walletSession.address,
        refundUnlockAt: program.deadline,
        artifactVersion: '1.1.0',
      });
      const deployment = await apiRequest(
        `/api/programs/${program.id}/escrow-deployments`,
        escrowDeploymentResponseSchema,
        { method: 'POST', token: session?.access_token, body },
      );
      if (deployment.data.status === 'failed' || deployment.data.status === 'reverted') {
        throw new DeploymentSupportRequiredError();
      }
      if (deployment.data.status !== 'confirmed') {
        throw new Error(
          'Circle accepted the deployment, but Arc verification is not complete. Resume the same deployment instead of creating another one.',
        );
      }
      const response = await apiRequest(
        `/api/owner/programs/${program.id}`,
        programResponseSchema,
        { token: session?.access_token },
      );
      return response.data;
    },
    onSuccess: async (saved) => {
      setDeployOpen(false);
      await cacheProgram(saved);
      // CP-10 → CP-11 happens automatically once the contract is ready.
      setView(Number(saved.totalPool) > 0 ? 'readiness' : 'fund');
    },
  });

  const lifecyclePending = deployMutation.isPending || fundingWorking || withdrawalWorking;

  useEffect(() => {
    onBlockingPendingChange(lifecyclePending);
  }, [lifecyclePending, onBlockingPendingChange]);

  useEffect(
    () => () => {
      onBlockingPendingChange(false);
    },
    [onBlockingPendingChange],
  );

  const publishMutation = useMutation({
    mutationFn: async (): Promise<Program> => {
      const response = await apiRequest(
        `/api/programs/${program.id}/publish`,
        programResponseSchema,
        { method: 'POST', token: session?.access_token },
      );
      return response.data;
    },
    onSuccess: async (saved) => {
      await cacheProgram(saved);
      router.push('/owner/programs');
    },
  });

  const readiness = buildProgramReadiness(program);
  const collateralReady =
    readiness.find((item) => item.id === 'funding')?.complete === true;
  const publishingReady =
    readiness.find((item) => item.id === 'publishing')?.status === 'Ready';
  const depositRequiredAmounts = Object.fromEntries(
    sources.flatMap((source) => {
      const latest = verifiedFundingIntent?.sourceDeposits
        .filter((deposit) => deposit.network === source.network)
        .sort((left, right) => right.attemptNo - left.attemptNo)[0];
      return latest === undefined ? [] : [[source.rowId, latest.amount]];
    }),
  );

  async function connectFundingWallet() {
    setWalletPending(true);
    setWalletError(undefined);
    try {
      const connected = await connectCircleWallet();
      if (
        walletSession !== undefined &&
        walletSession.address.toLowerCase() !== connected.address.toLowerCase()
      ) {
        setFundingSelection(undefined);
        setFundingResult(undefined);
        setFundingPhase('ready_to_sign');
        setDepositStatuses({});
        setConfirmedUnifiedBalance(undefined);
        setPendingUnifiedBalance(undefined);
      }
      setWalletSession(connected);
      if (
        verifiedFundingIntent !== undefined &&
        verifiedFundingIntent.walletAddress.toLowerCase() !== connected.address.toLowerCase()
      ) {
        setWalletError(
          `This intent is locked to ${shortenAddress(verifiedFundingIntent.walletAddress)}. Connect that wallet to continue.`,
        );
        setFormError({
          wallet: 'The connected wallet does not match the active funding intent.',
        });
      } else {
        setFormError({});
      }
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'The wallet connection was declined.');
    } finally {
      setWalletPending(false);
    }
  }

  function updateGrossAmount(nextAmount: string) {
    if (verifiedFundingIntent !== undefined) {
      setFundingError('This funding plan is locked. Resume or finish the active intent.');
      return;
    }
    setGrossAmount(nextAmount);
    setFormError({});
    setFundingError(undefined);
    setSources((current) => {
      if (current.length !== 1) return current;
      const source = current[0];
      if (source === undefined || (source.amount !== '' && source.amount !== grossAmount)) {
        return current;
      }
      return [{ ...source, amount: nextAmount }];
    });
  }

  function updateFundingSource(rowId: string, patch: Partial<FundingSource>) {
    if (verifiedFundingIntent !== undefined) {
      setFundingError('This funding plan is locked. Resume or finish the active intent.');
      return;
    }
    setSources((current) =>
      current.map((source) => (source.rowId === rowId ? { ...source, ...patch } : source)),
    );
    setDepositStatuses((current) => ({ ...current, [rowId]: 'not_started' }));
    setFormError({});
    setFundingError(undefined);
  }

  function addFundingSource() {
    if (verifiedFundingIntent !== undefined) {
      setFundingError('This funding plan is locked. Resume or finish the active intent.');
      return;
    }
    const selected = new Set(sources.map((source) => source.network));
    const nextNetwork = FUNDING_NETWORK_IDS.find((network) => !selected.has(network));
    if (nextNetwork === undefined) return;
    sourceSequence.current += 1;
    setSources((current) => [
      ...current,
      { rowId: `source-${sourceSequence.current}`, network: nextNetwork, amount: '' },
    ]);
    setFormError({});
    setFundingError(undefined);
  }

  function removeFundingSource(rowId: string) {
    if (verifiedFundingIntent !== undefined) {
      setFundingError('This funding plan is locked. Resume or finish the active intent.');
      return;
    }
    setSources((current) => current.filter((source) => source.rowId !== rowId));
    setDepositStatuses((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    setFormError({});
    setFundingError(undefined);
  }

  async function refreshUnifiedBalance() {
    if (walletSession === undefined || fundingWorking) return;
    setFundingWorking(true);
    setFundingError(undefined);
    try {
      const balance = await walletSession.executor.getUnifiedBalance();
      setConfirmedUnifiedBalance(balance.confirmedAmount);
      setPendingUnifiedBalance(balance.pendingAmount);
    } catch (error) {
      setFundingError(
        error instanceof Error ? error.message : 'Unified Balance could not be refreshed.',
      );
    } finally {
      setFundingWorking(false);
    }
  }

  async function depositUnifiedBalanceSource(source: FundingSource) {
    if (walletSession === undefined || fundingWorking) return;
    const amount = parseUsdcBaseUnits(source.amount);
    if (amount === undefined || amount <= 0n) {
      setFormError({
        [`sources.${source.rowId}.amount`]:
          'Enter a positive USDC amount with at most 6 decimal places.',
      });
      return;
    }

    setFundingWorking(true);
    setFundingError(undefined);
    let activeIntent: VerifiedFundingIntent | undefined;
    let depositId: string | undefined;
    let returnedHash: string | undefined;
    let executeClaimedDeposit: boolean;
    let claimedDepositSource: FundingSource | undefined;
    let submissionBoundaryLocked = false;
    try {
      const validation = validateFundingSelection(grossAmount, sources);
      if (validation.selection === undefined) {
        setFormError({ ...validation.errors });
        return;
      }
      activeIntent = await ensureServerFundingIntent(validation.selection);
      if (activeIntent.walletAddress.toLowerCase() !== walletSession.address.toLowerCase()) {
        throw new Error(
          `This funding intent is locked to ${shortenAddress(activeIntent.walletAddress)}. Connect that wallet before depositing.`,
        );
      }
      if (activeIntent.routeMode !== 'unified_balance') {
        throw new Error('Source deposits are available only for a Unified Balance intent.');
      }

      let deposit = activeIntent.sourceDeposits
        .filter((candidate) => candidate.network === source.network)
        .sort((left, right) => right.attemptNo - left.attemptNo)[0];
      const topUpRequired =
        deposit?.status === 'confirmed' &&
        depositStatuses[source.rowId] === 'top_up_required';
      if (deposit?.status === 'confirmed' && !topUpRequired) {
        setDepositStatuses((current) => ({ ...current, [source.rowId]: 'confirmed' }));
        return;
      }
      if (topUpRequired) deposit = undefined;
      if (deposit !== undefined) {
        depositId = deposit.id;
        const localHash = readPendingSourceDepositHash(
          window.localStorage,
          program.id,
          activeIntent.id,
          deposit.id,
        );
        let depositAction = sourceDepositContinuationAction(
          deposit,
          localHash,
          depositRecoveryHashes[source.rowId],
        );
        if (depositAction === 'observe_local_hash' && localHash !== undefined) {
          const observed = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits/${deposit.id}/observations`,
            fundingIntentResponseSchema,
            {
              method: 'POST',
              token: session?.access_token,
              body: observeSourceDepositRequestSchema.parse({
                outcome: 'submitted',
                transactionHash: localHash,
              }),
            },
          );
          activeIntent = verifiedIntentFromApi(observed.data);
          clearPendingSourceDepositHash(
            window.localStorage,
            program.id,
            activeIntent.id,
            deposit.id,
          );
          deposit = activeIntent.sourceDeposits.find((candidate) => candidate.id === depositId);
          depositAction = sourceDepositContinuationAction(
            deposit,
            undefined,
            depositRecoveryHashes[source.rowId],
          );
        }
        if (depositAction === 'attach_manual_hash') {
          const recoveryHash = depositRecoveryHashes[source.rowId]?.trim();
          if (recoveryHash !== undefined && recoveryHash !== '') {
            const attached = await apiRequest(
              `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits/${depositId}/attach`,
              fundingIntentResponseSchema,
              {
                method: 'POST',
                token: session?.access_token,
                body: attachSourceDepositRequestSchema.parse({
                  transactionHash: recoveryHash,
                }),
              },
            );
            activeIntent = verifiedIntentFromApi(attached.data);
            deposit = activeIntent.sourceDeposits.find(
              (candidate) => candidate.id === depositId,
            );
            setDepositRecoveryHashes((current) => ({
              ...current,
              [source.rowId]: '',
            }));
            depositAction = sourceDepositContinuationAction(deposit, undefined, undefined);
          }
        }
        if (depositAction === 'replace') {
          assertFundingRecoveryStorage(window.localStorage);
          const replacement = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits`,
            fundingIntentResponseSchema,
            {
              method: 'POST',
              token: session?.access_token,
              body: createSourceDepositRequestSchema.parse({ network: source.network }),
            },
          );
          activeIntent = verifiedIntentFromApi(replacement.data);
          deposit = activeIntent.sourceDeposits
            .filter(
              (candidate) =>
                candidate.network === source.network &&
                candidate.status === 'awaiting_signature',
            )
            .sort((left, right) => right.attemptNo - left.attemptNo)[0];
          if (deposit === undefined) {
            throw new Error('The replacement source deposit lock was not returned.');
          }
          depositId = deposit.id;
          depositAction = 'execute_claimed';
        }
        if (depositAction === 'recovery_required') {
          setDepositStatuses((current) => ({
            ...current,
            [source.rowId]: 'recovery_required',
          }));
          throw new Error(
            'This source deposit is durably locked but has no transaction hash. Attach the original hash or contact support; no replacement deposit was submitted.',
          );
        }
        executeClaimedDeposit = depositAction === 'execute_claimed';
        if (executeClaimedDeposit && deposit !== undefined) {
          claimedDepositSource = fundingSourceForLockedDeposit(source, deposit);
        }
      } else {
        // The server derives the exact missing amount from the locked allocation, fresh fee
        // reserve and already-confirmed Gateway balance. It must exist before wallet readiness can
        // check the amount without trusting client arithmetic.
        assertFundingRecoveryStorage(window.localStorage);
        const created = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits`,
          fundingIntentResponseSchema,
          {
            method: 'POST',
            token: session?.access_token,
            body: createSourceDepositRequestSchema.parse({ network: source.network }),
          },
        );
        activeIntent = verifiedIntentFromApi(created.data);
        deposit = activeIntent.sourceDeposits
          .filter((candidate) => candidate.network === source.network)
          .sort((left, right) => right.attemptNo - left.attemptNo)[0];
        if (deposit === undefined) throw new Error('The source deposit lock was not returned.');
        depositId = deposit.id;
        executeClaimedDeposit = true;
        claimedDepositSource = fundingSourceForLockedDeposit(source, deposit);
      }

      if (executeClaimedDeposit) {
        if (depositId === undefined) throw new Error('The source deposit lock is unavailable.');
        if (claimedDepositSource === undefined) {
          throw new Error('The server-verified source deposit amount is unavailable.');
        }
        const claimedIntentId = activeIntent.id;
        const claimedDepositId = depositId;
        const exactDepositSource = claimedDepositSource;
        // For a restored awaiting_signature operation storage and all wallet readiness checks
        // still occur before the durable wallet boundary. A rejected chain switch therefore
        // remains safely retryable instead of being mislabeled as an uncertain transaction.
        assertFundingRecoveryStorage(window.localStorage);
        const result = await executePreparedFundingSubmission(
          () => walletSession.executor.prepareUnifiedBalanceDepositSource(exactDepositSource),
          async () => {
            const locked = await apiRequest(
              `/api/programs/${program.id}/funding-intents/${claimedIntentId}/source-deposits/${claimedDepositId}/observations`,
              fundingIntentResponseSchema,
              {
                method: 'POST',
                token: session?.access_token,
                body: observeSourceDepositRequestSchema.parse({
                  outcome: 'submission_uncertain',
                }),
              },
            );
            activeIntent = verifiedIntentFromApi(locked.data);
            submissionBoundaryLocked = true;
            setDepositStatuses((current) => ({ ...current, [source.rowId]: 'submitting' }));
          },
          () => walletSession.executor.depositUnifiedBalanceSource(exactDepositSource),
        );
        returnedHash = result.transactionHash;
        persistPendingSourceDepositHash(
          window.localStorage,
          program.id,
          activeIntent.id,
          depositId,
          returnedHash,
        );
        const observed = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits/${depositId}/observations`,
          fundingIntentResponseSchema,
          {
            method: 'POST',
            token: session?.access_token,
            body: observeSourceDepositRequestSchema.parse({
              outcome: 'submitted',
              transactionHash: returnedHash,
            }),
          },
        );
        activeIntent = verifiedIntentFromApi(observed.data);
        clearPendingSourceDepositHash(
          window.localStorage,
          program.id,
          activeIntent.id,
          depositId,
        );
      }

      const reconciled = await apiRequest(
        `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits/${depositId}/reconcile`,
        fundingIntentResponseSchema,
        { method: 'POST', token: session?.access_token },
      );
      activeIntent = verifiedIntentFromApi(reconciled.data);
      setVerifiedFundingIntent(activeIntent);
      const reconciledDeposit = activeIntent.sourceDeposits.find(
        (candidate) => candidate.id === depositId,
      );
      setDepositStatuses((current) => ({
        ...current,
        [source.rowId]: reconciledDeposit?.status === 'confirmed' ? 'confirmed' : 'pending',
      }));
      const balance = await walletSession.executor.getUnifiedBalance();
      setConfirmedUnifiedBalance(balance.confirmedAmount);
      setPendingUnifiedBalance(balance.pendingAmount);
    } catch (error) {
      if (
        submissionBoundaryLocked &&
        activeIntent !== undefined &&
        depositId !== undefined &&
        returnedHash === undefined
      ) {
        // `submission_uncertain` was persisted before invoking the composite App Kit call. A
        // rejection-shaped error may follow an approval/deposit transaction, so never downgrade
        // this boundary or infer that signing is safe to replay.
      }
      let restoredStatus: SourceDepositStatus | undefined;
      if (activeIntent !== undefined && depositId !== undefined) {
        try {
          const restored = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}`,
            fundingIntentResponseSchema,
            { token: session?.access_token },
          );
          activeIntent = verifiedIntentFromApi(restored.data);
          setVerifiedFundingIntent(activeIntent);
          restoredStatus = sourceDepositStatusFromApi(
            restored.data.sourceDeposits.find((candidate) => candidate.id === depositId),
          );
        } catch {
          // Preserve the local no-replay boundary when durable state cannot be reloaded.
        }
      }
      setDepositStatuses((current) => ({
        ...current,
        [source.rowId]:
          restoredStatus ??
          (returnedHash !== undefined
            ? 'pending'
            : submissionBoundaryLocked
              ? 'recovery_required'
              : 'not_started'),
      }));
      setFundingError(
        restoredStatus === 'replaceable'
          ? 'Arc verified that the original source deposit reverted. A linked replacement attempt is now safe.'
          : restoredStatus === 'recovery_required'
            ? `${error instanceof Error ? error.message : 'The Unified Balance deposit result is unavailable.'} Attach the original transaction hash; no automatic replacement deposit will be submitted.`
          : returnedHash !== undefined
          ? 'The deposit hash is preserved locally. Use Check deposit to persist and reconcile that same transaction.'
          : submissionBoundaryLocked
          ? `${error instanceof Error ? error.message : 'The Unified Balance deposit result is unavailable.'} No automatic replacement deposit will be submitted.`
          : error instanceof Error
            ? error.message
            : 'The source is not ready for a Unified Balance deposit.',
      );
    } finally {
      setFundingWorking(false);
    }
  }

  async function ensureServerFundingIntent(
    selection: ValidatedFundingSelection,
  ): Promise<VerifiedFundingIntent> {
    if (verifiedFundingIntent !== undefined) {
      if (
        walletSession === undefined ||
        verifiedFundingIntent.walletAddress.toLowerCase() !== walletSession.address.toLowerCase()
      ) {
        throw new Error(
          `This funding intent is locked to ${shortenAddress(verifiedFundingIntent.walletAddress)}. Connect that wallet to continue.`,
        );
      }
      return verifiedFundingIntent;
    }
    if (walletSession === undefined) {
      throw new Error('Connect the owner wallet first.');
    }
    if (program.contractAddress === undefined) {
      throw new Error('Deploy and verify the Arc escrow before estimating funding.');
    }
    const quote = await walletSession.executor.estimateFunding(
      selection,
      program.contractAddress,
    );
    fundingIdempotencyKey.current ??= globalThis.crypto.randomUUID();
    const body = createFundingIntentRequestSchema.parse({
      idempotencyKey: fundingIdempotencyKey.current,
      walletAddress: walletSession.address,
      grossAmount: selection.grossAmount,
      estimatedFeeReserve: quote.estimatedFeeReserve,
      feeAllocations: selection.sources.map((source) => ({
        network: source.network,
        amount: quote.estimatedFeeReserveByNetwork[source.network] ?? '0',
      })),
      quoteQuotedAt: quote.quotedAt,
      quoteExpiresAt: quote.expiresAt,
      sources: selection.sources.map(({ network, amount }) => ({ network, amount })),
    });
    const response = await apiRequest(
      `/api/programs/${program.id}/funding-intents`,
      fundingIntentResponseSchema,
      { method: 'POST', token: session?.access_token, body },
    );
    const intent = verifiedIntentFromApi(response.data);
    setVerifiedFundingIntent(intent);
    setFundingPhase(fundingPhaseFromApi(response.data.status));
    return intent;
  }

  async function refreshServerFundingQuote(
    intent: VerifiedFundingIntent,
    selection: ValidatedFundingSelection,
  ): Promise<{
    intent: VerifiedFundingIntent;
    quote: Awaited<ReturnType<CircleWalletSession['executor']['estimateFunding']>>;
  }> {
    if (walletSession === undefined || program.contractAddress === undefined) {
      throw new Error('Connect the locked wallet and verify the Arc escrow before quoting.');
    }
    const quote = await walletSession.executor.estimateFunding(
      selection,
      program.contractAddress,
    );
    const response = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/quote`,
      fundingIntentResponseSchema,
      {
        method: 'POST',
        token: session?.access_token,
        body: refreshFundingQuoteRequestSchema.parse({
          estimatedFeeReserve: quote.estimatedFeeReserve,
          feeAllocations: selection.sources.map((source) => ({
            network: source.network,
            amount: quote.estimatedFeeReserveByNetwork[source.network] ?? '0',
          })),
          quotedAt: quote.quotedAt,
          expiresAt: quote.expiresAt,
        }),
      },
    );
    const refreshedIntent = verifiedIntentFromApi(response.data);
    assertFreshFundingQuoteMatchesIntent(refreshedIntent, quote);
    setVerifiedFundingIntent(refreshedIntent);
    return { intent: refreshedIntent, quote };
  }

  async function getGatewayReadiness(intentId: string) {
    return (
      await apiRequest(
        `/api/programs/${program.id}/funding-intents/${intentId}/gateway-readiness`,
        gatewayFundingReadinessResponseSchema,
        { token: session?.access_token },
      )
    ).data;
  }

  async function submitFundingPlan() {
    const validation = validateFundingSelection(grossAmount, sources);
    const nextErrors = { ...validation.errors };
    if (walletSession === undefined) nextErrors['wallet'] = 'Connect the owner wallet first.';
    if (!walletMatchesVerifiedIntent) {
      nextErrors['wallet'] = 'The connected wallet does not match the active funding intent.';
    }
    if (program.contractAddress === undefined) {
      nextErrors['escrow'] = 'Deploy and verify the program escrow before funding.';
    }

    setFormError(nextErrors);
    if (
      Object.keys(nextErrors).length > 0 ||
      validation.selection === undefined ||
      walletSession === undefined
    ) {
      return;
    }
    const selection = validation.selection;

    setFundingWorking(true);
    try {
      const intent = await ensureServerFundingIntent(selection);
      if (selection.routeMode === 'unified_balance') {
        const refreshed = await refreshServerFundingQuote(
          intent,
          selection,
        );
        const balance = await walletSession.executor.getUnifiedBalance();
        setConfirmedUnifiedBalance(balance.confirmedAmount);
        setPendingUnifiedBalance(balance.pendingAmount);
        const serverReadiness = await getGatewayReadiness(refreshed.intent.id);
        if (!serverReadiness.ready) {
          const deficient = new Set(
            serverReadiness.sources
              .filter((source) => parseUsdcBaseUnits(source.deficit) !== 0n)
              .map((source) => source.network),
          );
          setDepositStatuses((current) => ({
            ...current,
            ...Object.fromEntries(
              selection.sources
                .filter((source) => deficient.has(source.network))
                .map((source) => [source.rowId, 'top_up_required' as const]),
            ),
          }));
          setFormError({
            unifiedBalance:
              'Selected Gateway domains do not yet cover their locked allocations and source fee headroom.',
          });
          setFundingError(undefined);
          return;
        }
        try {
          assertSelectedUnifiedBalanceReadiness(
            selection,
            balance,
            refreshed.quote,
          );
        } catch (error) {
          const deficient = new Set(
            selectedUnifiedBalanceDeficientNetworks(
              selection,
              balance,
              refreshed.quote,
            ),
          );
          setDepositStatuses((current) => ({
            ...current,
            ...Object.fromEntries(
              selection.sources
                .filter((source) => deficient.has(source.network))
                .map((source) => [source.rowId, 'top_up_required' as const]),
            ),
          }));
          setFormError({
            unifiedBalance:
              error instanceof Error
                ? error.message
                : 'A selected source does not have enough confirmed Unified Balance.',
          });
          setFundingError(undefined);
          return;
        }
      }
      setFundingSelection(selection);
      setFundingResult(undefined);
      setBridgeRecoveryResult(undefined);
      setFundingError(undefined);
      setFundingPhase('ready_to_sign');
    } catch (error) {
      setFundingError(
        error instanceof Error ? error.message : 'The funding intent could not be created.',
      );
    } finally {
      setFundingWorking(false);
    }
  }

  async function observeDestinationResult(
    intent: VerifiedFundingIntent,
    result: FundingDestinationResult,
    providerState: 'pending' | 'success',
  ): Promise<VerifiedFundingIntent> {
    const body = observeFundingOperationRequestSchema.parse({
      ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
      destinationTransactionHash: result.destinationTransactionHash,
      ...(result.transferId === undefined ? {} : { transferId: result.transferId }),
      sourceTransactionHashes: result.sourceTransactionHashes,
      providerState,
    });
    const observed = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/operations`,
      fundingIntentResponseSchema,
      { method: 'POST', token: session?.access_token, body },
    );
    const verified = verifiedIntentFromApi(observed.data);
    setVerifiedFundingIntent(verified);
    return verified;
  }

  async function observeIncompleteBridge(
    intent: VerifiedFundingIntent,
    error: CircleBridgeIncompleteError,
  ): Promise<VerifiedFundingIntent> {
    const telemetry = bridgeRecoveryTelemetry(error.result);
    const body = observeFundingOperationRequestSchema.parse(telemetry);
    const observed = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/operations`,
      fundingIntentResponseSchema,
      { method: 'POST', token: session?.access_token, body },
    );
    const verified = verifiedIntentFromApi(observed.data);
    setVerifiedFundingIntent(verified);
    return verified;
  }

  async function observeUncertainSubmission(
    intent: VerifiedFundingIntent,
  ): Promise<VerifiedFundingIntent> {
    const body = observeFundingOperationRequestSchema.parse({
      operationId: `uncertain-after-sign:${intent.id}`,
      providerState: 'pending',
      retryable: false,
      submissionUncertain: true,
      steps: [
        {
          name: 'wallet_submission',
          state: 'pending',
          errorCode: 'result_unavailable',
        },
      ],
    });
    const observed = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/operations`,
      fundingIntentResponseSchema,
      { method: 'POST', token: session?.access_token, body },
    );
    const verified = verifiedIntentFromApi(observed.data);
    setVerifiedFundingIntent(verified);
    return verified;
  }

  async function reconcileFundingIntent(intent: VerifiedFundingIntent) {
    setFundingPhase('verifying_destination');
    const reconciled = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/reconcile`,
      fundingIntentResponseSchema,
      { method: 'POST', token: session?.access_token },
    );
    const verified = verifiedIntentFromApi(reconciled.data);
    setFundingPhase(fundingPhaseFromApi(reconciled.data.status));
    if (reconciled.data.status === 'complete') {
      if (reconciled.data.confirmationArtifact !== undefined) {
        setFundingConfirmation(reconciled.data.confirmationArtifact);
      }
      setVerifiedFundingIntent(undefined);
      fundingIdempotencyKey.current = undefined;
      setFundingSelection(undefined);
      setView('readiness');
    } else {
      setVerifiedFundingIntent(verified);
    }
    await client.invalidateQueries({
      queryKey: queryKeys.ownerProgram(session?.user.id ?? 'no-session', program.id),
    });
    await client.invalidateQueries({ queryKey: ['programs'] });
  }

  async function continueFundingOperation() {
    if (
      walletSession === undefined ||
      fundingSelection === undefined ||
      verifiedFundingIntent === undefined ||
      fundingWorking
    ) {
      return;
    }
    if (
      verifiedFundingIntent.walletAddress.toLowerCase() !== walletSession.address.toLowerCase()
    ) {
      setFundingError(
        `This intent is locked to ${shortenAddress(verifiedFundingIntent.walletAddress)}. Connect that wallet to continue.`,
      );
      return;
    }

    setFundingWorking(true);
    setFundingError(undefined);
    let latestPhase: FundingOperationPhase = fundingPhase;
    let submissionLocked = false;
    let safeLinkedSendRetry = false;
    try {
      let activeIntent = verifiedFundingIntent;
      const pendingDestinationResult = readPendingFundingResult(
        window.localStorage,
        program.id,
        activeIntent.id,
      );

      const continuation = fundingContinuationAction(
        fundingPhase,
        bridgeRecoveryResult !== undefined && canRetryBridgeResult(bridgeRecoveryResult),
        pendingDestinationResult !== undefined,
      );
      if (continuation !== 'execute') {
        if (continuation === 'observe_destination' && pendingDestinationResult !== undefined) {
          setFundingResult(pendingDestinationResult);
          activeIntent = await observeDestinationResult(
            activeIntent,
            pendingDestinationResult,
            'success',
          );
          clearPendingFundingResult(window.localStorage, program.id, activeIntent.id);
          await reconcileFundingIntent(activeIntent);
          return;
        }
        if (continuation === 'recovery_required') {
          const restored = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}`,
            fundingIntentResponseSchema,
            { token: session?.access_token },
          );
          activeIntent = verifiedIntentFromApi(restored.data);
          setVerifiedFundingIntent(activeIntent);
          setFundingPhase(fundingPhaseFromApi(restored.data.status));
          if (restored.data.status === 'source_submitted') {
            setFundingError(
              fundingSourceSubmittedRecoveryMessage(fundingSelection.routeMode),
            );
            return;
          }
        }
        if (continuation === 'retry_bridge' && bridgeRecoveryResult !== undefined) {
          const recovered = await walletSession.executor.retryBridge(
            bridgeRecoveryResult,
            (phase) => {
              latestPhase = phase;
              setFundingPhase(phase);
            },
          );
          setFundingResult(recovered);
          setBridgeRecoveryResult(undefined);
          activeIntent = await observeDestinationResult(
            activeIntent,
            recovered,
            latestPhase === 'delivery_pending' ? 'pending' : 'success',
          );
        }
        await reconcileFundingIntent(activeIntent);
        return;
      }

      const refreshed = await refreshServerFundingQuote(activeIntent, fundingSelection);
      activeIntent = refreshed.intent;
      if (fundingSelection.routeMode === 'unified_balance') {
        const balance = await walletSession.executor.getUnifiedBalance();
        setConfirmedUnifiedBalance(balance.confirmedAmount);
        setPendingUnifiedBalance(balance.pendingAmount);
        const serverReadiness = await getGatewayReadiness(activeIntent.id);
        if (!serverReadiness.ready) {
          throw new Error(
            'Selected Gateway domains no longer cover their locked allocations and source fee headroom. No signature was requested.',
          );
        }
        assertSelectedUnifiedBalanceReadiness(
          fundingSelection,
          balance,
          refreshed.quote,
        );
      }
      assertFundingRecoveryStorage(window.localStorage);
      const result = await executeVerifiedFundingIntent(
        activeIntent,
        fundingSelection,
        walletSession.address,
        walletSession.executor,
        async (phase) => {
          if (phase === 'awaiting_signature' && !submissionLocked) {
            activeIntent = await observeUncertainSubmission(activeIntent);
            submissionLocked = true;
          }
          latestPhase = phase;
          setFundingPhase(phase);
        },
        refreshed.quote,
      );
      persistPendingFundingResult(window.localStorage, program.id, activeIntent.id, result);
      setFundingResult(result);
      activeIntent = await observeDestinationResult(
        activeIntent,
        result,
        latestPhase === 'delivery_pending' ? 'pending' : 'success',
      );
      clearPendingFundingResult(window.localStorage, program.id, activeIntent.id);
      await reconcileFundingIntent(activeIntent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The funding operation failed.';
      if (error instanceof CircleBridgeIncompleteError) {
        setBridgeRecoveryResult(error.result);
        try {
          await observeIncompleteBridge(verifiedFundingIntent, error);
          setFundingPhase('source_submitted');
        } catch {
          setFundingPhase('source_submitted');
        }
        setFundingError(
          canRetryBridgeResult(error.result)
            ? `${message} Continue delivery retries only Circle's failed step; the original burn will not be repeated.`
            : `${message} Circle did not mark the failed step retryable, so no replacement bridge will be submitted.`,
        );
        return;
      }
      const rejectedBeforeSubmission = /reject|denied|cancel/i.test(message);
      if (submissionLocked) {
        setFundingPhase(fundingSubmissionFailurePhase(true));
        setFundingError(
          rejectedBeforeSubmission
            ? `${message} The signing boundary was durably locked before the wallet prompt. No retry will run automatically; support can release or recover this intent after confirming no transaction was submitted.`
            : `${message} The wallet submission result is uncertain and has been durably locked for recovery. Reloading will not submit another transaction.`,
        );
        return;
      }
      if (latestPhase !== 'ready_to_sign' && latestPhase !== 'awaiting_signature') {
        try {
          const restored = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${verifiedFundingIntent.id}`,
            fundingIntentResponseSchema,
            { token: session?.access_token },
          );
          const restoredIntent = verifiedIntentFromApi(restored.data);
          setVerifiedFundingIntent(restoredIntent);
          setFundingPhase(fundingPhaseFromApi(restored.data.status));
          safeLinkedSendRetry =
            fundingSelection.routeMode === 'send' &&
            restored.data.status === 'ready_to_sign';
        } catch {
          setFundingPhase('sync_failed');
        }
      } else {
        setFundingPhase(fundingSubmissionFailurePhase(false));
      }
      setFundingError(
        safeLinkedSendRetry
          ? `${message} Arc verified that the original Send reverted. Continue creates a linked retry after refreshing the quote; it does not reuse the reverted transaction.`
          : latestPhase === 'ready_to_sign' || latestPhase === 'awaiting_signature'
          ? `${message} No destination transaction was submitted.`
          : `${message} Operation state is uncertain after ${latestPhase}; do not submit a new transfer.`,
      );
    } finally {
      setFundingWorking(false);
    }
  }

  async function createWithdrawalIntent(): Promise<WithdrawalIntent | undefined> {
    if (walletSession === undefined) {
      setWithdrawalError('Connect the contract owner wallet first.');
      return undefined;
    }
    withdrawalIdempotencyKey.current ??= globalThis.crypto.randomUUID();
    const body = createWithdrawalIntentRequestSchema.parse({
      idempotencyKey: withdrawalIdempotencyKey.current,
      walletAddress: walletSession.address,
    });
    const response = await apiRequest(
      `/api/programs/${program.id}/withdrawal-intents`,
      withdrawalIntentResponseSchema,
      { method: 'POST', token: session?.access_token, body },
    );
    setWithdrawalIntent(response.data);
    return response.data;
  }

  async function observeWithdrawal(
    intent: WithdrawalIntent,
    operation: 'close' | 'withdraw',
    transactionHash?: string,
  ): Promise<WithdrawalIntent> {
    const body = observeWithdrawalRequestSchema.parse({
      operation,
      outcome: transactionHash === undefined ? 'submission_uncertain' : 'submitted',
      ...(transactionHash === undefined ? {} : { transactionHash }),
    });
    const response = await apiRequest(
      `/api/programs/${program.id}/withdrawal-intents/${intent.id}/operations`,
      withdrawalIntentResponseSchema,
      { method: 'POST', token: session?.access_token, body },
    );
    setWithdrawalIntent(response.data);
    return response.data;
  }

  async function reconcileWithdrawal(intent: WithdrawalIntent): Promise<WithdrawalIntent> {
    const response = await apiRequest(
      `/api/programs/${program.id}/withdrawal-intents/${intent.id}/reconcile`,
      withdrawalIntentResponseSchema,
      { method: 'POST', token: session?.access_token },
    );
    setWithdrawalIntent(response.data);
    await client.invalidateQueries({
      queryKey: queryKeys.ownerProgram(session?.user.id ?? 'no-session', program.id),
    });
    await client.invalidateQueries({ queryKey: ['programs'] });
    return response.data;
  }

  async function continueWithdrawal() {
    if (withdrawalWorking) return;
    setWithdrawalWorking(true);
    setWithdrawalError(undefined);
    let recoveryIntentId = withdrawalIntent?.id;
    try {
      let intent = withdrawalIntent;
      if (intent?.status === 'complete' || intent?.status === 'failed') {
        withdrawalIdempotencyKey.current = undefined;
        setWithdrawalIntent(undefined);
        intent = undefined;
      }
      intent ??= await createWithdrawalIntent();
      if (intent === undefined) return;
      recoveryIntentId = intent.id;
      if (walletSession === undefined) {
        setWithdrawalError('Connect the contract owner wallet first.');
        return;
      }
      if (intent.walletAddress.toLowerCase() !== walletSession.address.toLowerCase()) {
        setWithdrawalError(
          `This withdrawal is locked to ${shortenAddress(intent.walletAddress)}. Connect that owner wallet.`,
        );
        return;
      }
      const storage = window.localStorage;
      let pendingCloseHash = readPendingWithdrawalHash(
        storage,
        program.id,
        intent.id,
        'close',
      );
      let pendingWithdrawHash = readPendingWithdrawalHash(
        storage,
        program.id,
        intent.id,
        'withdraw',
      );
      let action = withdrawalContinuationAction(intent, pendingCloseHash, pendingWithdrawHash);

      if (action === 'attach_close' || action === 'attach_withdraw') {
        const transactionHash = withdrawalRecoveryHash.trim();
        if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
          setWithdrawalError(
            'Enter the original transaction hash. This flow will not submit a replacement transaction.',
          );
          return;
        }
        const operation = action === 'attach_close' ? 'close' : 'withdraw';
        intent = await observeWithdrawal(intent, operation, transactionHash);
        setWithdrawalRecoveryHash('');
        await reconcileWithdrawal(intent);
        return;
      }

      if (action === 'sign_close') {
        assertWithdrawalRecoveryStorage(storage);
        await walletSession.executor.prepareEscrowOwnerCall(
          walletSession.wallet.provider,
          walletSession.address,
          intent.escrowAddress,
          'close',
        );
        intent = await observeWithdrawal(intent, 'close');
        pendingCloseHash = await walletSession.executor.closeEscrow(
          walletSession.wallet.provider,
          walletSession.address,
          intent.escrowAddress,
        );
        persistPendingWithdrawalHash(storage, program.id, intent.id, 'close', pendingCloseHash);
        action = 'observe_close';
      }
      if (action === 'observe_close' && pendingCloseHash !== undefined) {
        intent = await observeWithdrawal(intent, 'close', pendingCloseHash);
        clearPendingWithdrawalHash(storage, program.id, intent.id, 'close');
        action = 'verify_close';
      }
      if (action === 'verify_close') {
        await reconcileWithdrawal(intent);
        return;
      }
      if (action === 'sign_withdraw') {
        const expectedWithdrawalAmount = parseUsdcBaseUnits(intent.amount);
        if (expectedWithdrawalAmount === undefined || expectedWithdrawalAmount <= 0n) {
          throw new Error('The server-verified withdrawal amount is invalid.');
        }
        assertWithdrawalRecoveryStorage(storage);
        await walletSession.executor.prepareEscrowOwnerCall(
          walletSession.wallet.provider,
          walletSession.address,
          intent.escrowAddress,
          'withdrawRemaining',
          expectedWithdrawalAmount,
        );
        intent = await observeWithdrawal(intent, 'withdraw');
        pendingWithdrawHash = await walletSession.executor.withdrawRemaining(
          walletSession.wallet.provider,
          walletSession.address,
          intent.escrowAddress,
          expectedWithdrawalAmount,
        );
        persistPendingWithdrawalHash(
          storage,
          program.id,
          intent.id,
          'withdraw',
          pendingWithdrawHash,
        );
        action = 'observe_withdraw';
      }
      if (action === 'observe_withdraw' && pendingWithdrawHash !== undefined) {
        intent = await observeWithdrawal(intent, 'withdraw', pendingWithdrawHash);
        clearPendingWithdrawalHash(storage, program.id, intent.id, 'withdraw');
        action = 'verify_withdraw';
      }
      if (action === 'verify_withdraw') {
        await reconcileWithdrawal(intent);
      }
    } catch (error) {
      if (recoveryIntentId !== undefined) {
        try {
          const restored = await apiRequest(
            `/api/programs/${program.id}/withdrawal-intents/${recoveryIntentId}`,
            withdrawalIntentResponseSchema,
            { token: session?.access_token },
          );
          setWithdrawalIntent(restored.data);
        } catch {
          // Keep the local no-replay state when the durable intent cannot be restored.
        }
      }
      setWithdrawalError(
        error instanceof Error ? error.message : 'The remaining-funds withdrawal needs attention.',
      );
    } finally {
      setWithdrawalWorking(false);
    }
  }

  /* CP-10 — Deploying escrow. Navigation and actions stay locked while the mutation is pending. */
  if (deployMutation.isPending) {
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Deploying a dedicated escrow contract before funding the reward pool."
          title="Preparing program escrow…"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout
          aside={
            <GuidancePanel eyebrow="Next step" title="Fund reward pool">
              <p>
                Once the contract is ready, transfer USDC into escrow. Funding does not publish the
                program.
              </p>
              <p className="text-label-sm uppercase text-text-muted">Current pool</p>
              <p className="text-h2 text-text">{formatUsdc(program.totalPool)}</p>
            </GuidancePanel>
          }
        >
          <div aria-busy="true" aria-live="polite" role="status">
            <FormCard title="Creating a secure reward vault">
              <div className="flex flex-wrap items-start justify-between gap-lg">
                <div className="flex min-w-0 flex-col gap-md">
                  <span className="w-fit rounded-full bg-primary px-md py-xs text-label-sm font-semibold uppercase text-primary-contrast">
                    Deploying contract
                  </span>
                  <p className="text-body-sm text-text-muted">
                    This usually takes less than a minute. Keep this window open while the contract
                    is confirmed.
                  </p>
                </div>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-2xl shrink-0 text-primary motion-safe:animate-spin"
                />
              </div>
              <Separator />
              <div className="flex flex-col">
                <SummaryRow label="Program" value={program.name} />
                <SummaryRow label="Network" value={chainLabel} />
                <SummaryRow label="Reward token" value="USDC" />
              </div>
              <p className="text-body-sm text-low">
                Do not close this window until the escrow address is available.
              </p>
            </FormCard>
          </div>
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-12 — Funding pending remains inside the existing owner edit route. */
  if (
    fundingSelection !== undefined &&
    fundingPhase !== 'complete' &&
    walletSession !== undefined &&
    walletMatchesVerifiedIntent
  ) {
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Sign the locked route, then verify the Arc destination before reconciling the pool."
          title="Funding pending"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout
          aside={
            <GuidancePanel
              eyebrow="Locked route"
              title={fundingRouteLabel(fundingSelection.routeMode)}
            >
              <div className="flex flex-col">
                <SummaryRow label="Gross amount" value={formatUsdc(fundingSelection.grossAmount)} />
                <SummaryRow label="Destination" value={chainLabel} />
                <SummaryRow label="Token" value="USDC" />
              </div>
              <p>
                Once a destination operation is submitted, resume that operation. Never start a
                replacement transfer blindly.
              </p>
            </GuidancePanel>
          }
        >
          <FundingPending
            error={fundingError}
            estimatedFeeReserve={verifiedFundingIntent?.estimatedFeeReserve ?? '0'}
            onBack={() => {
              setFundingSelection(undefined);
              setFundingError(undefined);
              setFundingPhase('ready_to_sign');
            }}
            onContinue={() => void continueFundingOperation()}
            phase={fundingPhase}
            result={fundingResult}
            selection={fundingSelection}
            verifiedRecipient={verifiedFundingIntent?.recipientAddress}
            walletAddress={walletSession.address}
            working={fundingWorking}
            executionAvailable={verifiedFundingIntent !== undefined}
          />
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-11 — Fund rewards. */
  if (view === 'fund') {
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Select testnet sources and let Circle App Kit derive the path to the Arc escrow."
          title="Fund rewards"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout
          aside={
            <GuidancePanel eyebrow="Escrow summary" title={formatUsdc(program.totalPool)}>
              <p>Current reward pool</p>
              <div className="flex flex-col">{escrowSummary(program, chainLabel)}</div>
              <Callout variant="warning">
                Funding does not publish the program. Pool credit waits for verified Arc USDC and
                database reconciliation.
              </Callout>
            </GuidancePanel>
          }
        >
          {formError['wallet'] === undefined &&
          formError['escrow'] === undefined &&
          formError['unifiedBalance'] === undefined &&
          fundingError === undefined ? null : (
            <Callout title="Funding plan is not ready" variant="danger">
              {formError['wallet'] ??
                formError['escrow'] ??
                formError['unifiedBalance'] ??
                fundingError}
            </Callout>
          )}
          <FundingAllocations
            confirmedUnifiedBalance={confirmedUnifiedBalance}
            depositRequiredAmounts={depositRequiredAmounts}
            depositRecoveryHashes={depositRecoveryHashes}
            depositStatuses={depositStatuses}
            estimatedFeeReserve={verifiedFundingIntent?.estimatedFeeReserve}
            errors={formError}
            grossAmount={grossAmount}
            onAddSource={addFundingSource}
            onConnectWallet={() => void connectFundingWallet()}
            onDepositSource={(source) => void depositUnifiedBalanceSource(source)}
            onDepositRecoveryHashChange={(rowId, value) =>
              setDepositRecoveryHashes((current) => ({ ...current, [rowId]: value }))
            }
            onGrossAmountChange={updateGrossAmount}
            onLater={() => setView('readiness')}
            onRefreshUnifiedBalance={() => void refreshUnifiedBalance()}
            onRemoveSource={removeFundingSource}
            onSourceChange={updateFundingSource}
            onSubmit={() => void submitFundingPlan()}
            pendingUnifiedBalance={pendingUnifiedBalance}
            program={program}
            sources={sources}
            transactionsEnabled={
              verifiedFundingIntent !== undefined && walletMatchesVerifiedIntent
            }
            walletAddress={walletSession?.address}
            walletError={walletError}
            walletName={walletSession?.wallet.name}
            walletPending={walletPending}
          />
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-13 — Funding succeeded, but publishing remains a separate owner action. */
  if (funded) {
    if (fundingConfirmation === undefined) {
      return (
        <WizardShell>
          <WorkspaceHeading
            breadcrumb={`Programs / ${program.name} / Funding`}
            subtitle="Loading the immutable Arc receipt, contract artifact and reconciled accounting snapshot."
            title="Verifying funding confirmation"
          />
          <Stepper
            aria-label="Create program progress"
            currentStep={6}
            steps={CREATE_PROGRAM_STEPS}
          />
          <FormCard
            description="Publishing remains locked until the canonical completed-intent confirmation can be rendered."
            title="Canonical evidence"
          >
            {fundingConfirmationError === undefined ? (
              <div aria-live="polite" className="flex items-center gap-md" role="status">
                <LoaderCircle
                  aria-hidden="true"
                  className="size-5 text-primary motion-safe:animate-spin"
                />
                <span className="text-body-sm text-text-muted">
                  Loading the latest completed funding confirmation…
                </span>
              </div>
            ) : (
              <Callout title="Funding confirmation is unavailable" variant="danger">
                {fundingConfirmationError} No local wallet result or mutable program total is used
                as a replacement for canonical evidence.
              </Callout>
            )}
          </FormCard>
        </WizardShell>
      );
    }
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle={
            collateralReady
              ? 'Escrow is ready. Review readiness before publishing the program.'
              : 'The escrow has funds, but available collateral is below the maximum bounty.'
          }
          title={collateralReady ? 'Reward pool funded' : 'Reward pool needs collateral'}
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />

        <Callout
          role="status"
          title="Canonical funding confirmed"
          variant="escrow"
        >
          {`${formatUsdc(fundingConfirmation.netReceivedAmount)} was verified on Arc. The immutable reconciliation captured ${formatUsdc(fundingConfirmation.accounting.totalPool)} total pool and ${formatUsdc(fundingConfirmation.accounting.availablePool)} available.`}
        </Callout>

        <StepLayout
          aside={
            <GuidancePanel
              eyebrow="Reward pool"
              title={formatUsdc(fundingConfirmation.accounting.totalPool)}
            >
              <p className="text-label-md text-escrow">USDC funded</p>
              <div className="flex flex-col">
                <SummaryRow
                  label="Snapshot available"
                  value={formatUsdc(fundingConfirmation.accounting.availablePool)}
                />
                <SummaryRow
                  label="Status"
                  value={collateralReady ? 'Ready' : 'Below maximum bounty'}
                />
                <SummaryRow
                  label="Available at reconciliation"
                  value={formatUsdc(fundingConfirmation.accounting.availablePool)}
                />
              </div>
            </GuidancePanel>
          }
        >
          {publishMutation.isError ? (
            <Callout title="The program could not be published" variant="danger">
              Funding is still secure. Publishing remains a separate action and can be retried.
            </Callout>
          ) : null}

          <FundingConfirmationEvidence artifact={fundingConfirmation} />

          <FormCard
            description="The escrow is funded and ready. Researchers still cannot see this program until you publish it."
            title="Program readiness"
          >
            <ul aria-label="Program readiness checklist" className="flex flex-col gap-sm">
              {readiness.map((item) => (
                <ReadinessRow item={item} key={item.id} />
              ))}
            </ul>

            <div className="mt-2xl grid grid-cols-1 gap-md pt-md sm:flex sm:flex-wrap sm:items-center sm:justify-end">
              <Button asChild className="w-full sm:w-auto" size="lg" variant="secondary">
                <Link href="/owner/programs">Back to program</Link>
              </Button>
              {collateralReady ? null : (
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setView('fund')}
                  size="lg"
                  variant="secondary"
                >
                  Add collateral
                </Button>
              )}
              <Button
                className="w-full sm:w-auto"
                disabled={!publishingReady}
                loading={publishMutation.isPending}
                onClick={() => publishMutation.mutate()}
                size="lg"
              >
                {publishingReady ? 'Publish program' : 'Complete readiness to publish'}
              </Button>
            </div>
          </FormCard>

          {withdrawalAvailable ? (
            <FormCard
              description="After the refund unlock, the contract owner closes the Arc escrow and withdraws only the unreserved USDC to the immutable recipient."
              title="Remaining escrow funds"
            >
              {withdrawalError === undefined ? null : (
                <Callout title="Withdrawal needs attention" variant="danger">
                  {withdrawalError}
                </Callout>
              )}
              <div className="flex flex-col">
                <SummaryRow
                  label="Contract owner"
                  value={
                    withdrawalIntent === undefined
                      ? walletSession === undefined
                        ? 'Connect wallet to verify'
                        : shortenAddress(walletSession.address)
                      : shortenAddress(withdrawalIntent.walletAddress)
                  }
                />
                <SummaryRow
                  label="Withdrawal recipient"
                  value={
                    withdrawalIntent === undefined
                      ? 'Verified by the server'
                      : shortenAddress(withdrawalIntent.recipientAddress)
                  }
                />
                <SummaryRow
                  label="Amount"
                  value={
                    withdrawalIntent === undefined
                      ? 'Verified from Arc and the pool ledger'
                      : formatUsdc(withdrawalIntent.amount)
                  }
                />
                <SummaryRow
                  label="State"
                  value={withdrawalIntent?.status.replaceAll('_', ' ') ?? 'Not started'}
                />
              </div>
              {withdrawalIntent?.status !== 'close_submission_uncertain' &&
              withdrawalIntent?.status !== 'withdraw_submission_uncertain' ? null : (
                <Field
                  htmlFor="withdrawal-recovery-hash"
                  label="Original Arc transaction hash"
                >
                  <Input
                    id="withdrawal-recovery-hash"
                    onChange={(event) => setWithdrawalRecoveryHash(event.currentTarget.value)}
                    placeholder="0x…"
                    value={withdrawalRecoveryHash}
                  />
                </Field>
              )}
              <Callout variant="warning">
                Close and withdrawal are separate owner-signed Arc transactions. Once a hash is
                observed, Continue verifies that same transaction and never submits it again.
              </Callout>
              <div className="mt-2xl flex flex-wrap items-center justify-end gap-md pt-md">
                <Button
                  loading={walletPending}
                  onClick={() => void connectFundingWallet()}
                  size="lg"
                  variant="secondary"
                >
                  {walletSession === undefined ? 'Connect owner wallet' : 'Change wallet'}
                </Button>
                <Button
                  disabled={
                    walletSession === undefined
                  }
                  loading={withdrawalWorking}
                  onClick={() => void continueWithdrawal()}
                  size="lg"
                >
                  {withdrawalActionLabel(withdrawalIntent)}
                </Button>
              </div>
            </FormCard>
          ) : null}
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-06 — Draft created / edit landing. */
  return (
    <WizardShell>
      {showCreatedBanner ? (
        <Callout role="status" title="Draft created" variant="escrow">
          Your program is saved and remains private.
        </Callout>
      ) : null}

      {logoFailed ? (
        <Callout title="The logo was not attached" variant="warning">
          The draft was saved. Open <strong>Edit program</strong> to upload the logo again.
        </Callout>
      ) : null}

      <WorkspaceHeading
        badge={<StatusBadge kind="program" status={program.status} />}
        breadcrumb={
          <Link className="hover:text-text" href="/owner/programs">
            Programs
          </Link>
        }
        subtitle={`Last saved ${new Date(program.updatedAt).toLocaleString()} · /programs/${program.slug}`}
        title={program.name}
      />

      <StepLayout
        aside={
          <GuidancePanel
            eyebrow="Private draft"
            title="Not visible to researchers"
          >
            <p className="text-label-sm uppercase text-text-muted">Escrow pool</p>
            <p className="text-h2 text-text">{formatUsdc(program.totalPool)}</p>
            <div className="flex flex-col">
              <SummaryRow label="Remaining" value={formatUsdc(program.remainingPool)} />
              {escrowSummary(program, chainLabel)}
            </div>
            <p className="text-label-sm uppercase text-text-muted">Next action</p>
            <p className="text-body-sm text-primary">
              {deployed ? 'Fund the reward pool' : 'Deploy escrow contract'}
            </p>
          </GuidancePanel>
        }
      >
        {deployMutation.isError ? (
          <Callout title="The escrow could not be deployed" variant="danger">
            <p>
              The deployment parameters remain unchanged. Retry resumes the same Circle operation.
            </p>
            <Button className="mt-md" onClick={() => setDeployOpen(true)} variant="secondary">
              Try again
            </Button>
          </Callout>
        ) : null}
        <FormCard
          description="Complete the remaining launch steps before researchers can see this program."
          title="Program readiness"
        >
          <ul aria-label="Program readiness checklist" className="flex flex-col gap-sm">
            {readiness.map((item) => (
              <ReadinessRow item={item} key={item.id} />
            ))}
          </ul>

          <div className="mt-2xl grid grid-cols-1 gap-md pt-md sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            <Button asChild className="w-full sm:w-auto" size="lg" variant="ghost">
              <Link href="/owner/programs">Back to programs</Link>
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={onEditProgram}
              size="lg"
              variant="secondary"
            >
              Edit program
            </Button>
            {deployed ? null : (
              <Button
                className="w-full sm:w-auto"
                onClick={() => setDeployOpen(true)}
                size="lg"
              >
                Deploy escrow
              </Button>
            )}
            {deployed ? (
              <Button
                className="w-full sm:w-auto"
                onClick={() => setView('fund')}
                size="lg"
              >
                Fund rewards
              </Button>
            ) : null}
          </div>
        </FormCard>
      </StepLayout>

      <Dialog onOpenChange={setDeployOpen} open={deployOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Deploy escrow contract</DialogTitle>
            <DialogDescription>
              Circle deploys the versioned escrow artifact on Arc Testnet. The connected owner
              wallet becomes both the contract owner and the verified withdrawal recipient.
            </DialogDescription>
          </DialogHeader>

          {deployMutation.isError ? (
            <Callout title="The escrow could not be recorded" variant="danger">
              {deployMutation.error instanceof ApiClientError &&
              deployMutation.error.code === 'program_escrow_already_deployed'
                ? 'A different escrow is already recorded for this program. The existing escrow was not replaced.'
                : deployMutation.error instanceof Error
                  ? deployMutation.error.message
                  : 'The deployment could not be verified. Retry uses the same immutable parameters.'}
            </Callout>
          ) : null}

          <div className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-lg">
            <span className="text-label-md text-text-muted">Owner wallet</span>
            <span className="text-label-lg text-text">
              {walletSession === undefined
                ? 'Not connected'
                : `${walletSession.wallet.name} · ${shortenAddress(walletSession.address)}`}
            </span>
            {walletError === undefined ? null : (
              <span className="text-body-sm text-danger">{walletError}</span>
            )}
            {formError['wallet'] === undefined ? null : (
              <span className="text-body-sm text-danger">{formError['wallet']}</span>
            )}
            <Button
              className="w-fit"
              loading={walletPending}
              onClick={() => void connectFundingWallet()}
              size="md"
              variant="secondary"
            >
              {walletSession === undefined ? 'Connect owner wallet' : 'Change wallet'}
            </Button>
          </div>

          <div className="flex flex-col">
            <SummaryRow label="Network" value={chainLabel} />
            <SummaryRow label="Reward token" value="USDC" />
            <SummaryRow
              label="Refund unlock"
              value={
                program.deadline === undefined
                  ? 'Set a program deadline first'
                  : new Date(program.deadline).toLocaleString()
              }
            />
          </div>

          <DialogFooter>
            <Button onClick={() => setDeployOpen(false)} size="lg" variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={deployMutation.error instanceof DeploymentSupportRequiredError}
              onClick={() => {
                const next: Record<string, string> = {};
                if (walletSession === undefined) {
                  next['wallet'] = 'Connect the owner wallet before deploying.';
                }
                if (program.deadline === undefined) {
                  next['refundUnlockAt'] = 'Set a program deadline before deploying.';
                } else if (Date.parse(program.deadline) <= Date.now()) {
                  next['refundUnlockAt'] = 'The program deadline must be in the future.';
                }
                setFormError(next);
                if (Object.keys(next).length === 0) deployMutation.mutate();
              }}
              size="lg"
            >
              {deployMutation.error instanceof DeploymentSupportRequiredError
                ? 'Support required'
                : deployMutation.isError
                  ? 'Resume deployment'
                  : 'Deploy escrow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WizardShell>
  );
}
