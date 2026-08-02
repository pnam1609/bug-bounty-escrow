'use client';

import {
  createDeploymentFeeQuoteRequestSchema,
  createFundingIntentRequestSchema,
  attachSourceDepositRequestSchema,
  attachFundingDestinationRequestSchema,
  attachFundingRecoveryTelemetryRequestSchema,
  createSourceDepositRequestSchema,
  deployEscrowWithCircleRequestSchema,
  deploymentFeeQuoteResponseSchema,
  escrowDeploymentResponseSchema,
  fundingConfirmationArtifactResponseSchema,
  fundingDestinationAttemptRequestSchema,
  fundingIntentResponseSchema,
  gatewayFundingReadinessResponseSchema,
  observeFundingOperationRequestSchema,
  observeDeploymentFeePaymentRequestSchema,
  observeSourceDepositRequestSchema,
  refreshFundingQuoteRequestSchema,
  releaseRejectedSendAttemptRequestSchema,
  walletBoundaryClaimRequestSchema,
  bridgeDeliveryRetryClaimRequestSchema,
  programResponseSchema,
  withdrawalIntentResponseSchema,
  type FundingIntent as ApiFundingIntent,
  type FundingConfirmationArtifact,
  type GatewayFundingReadiness,
  type Program,
  type DeploymentFeeQuote,
  type EscrowDeployment,
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
  Separator,
  StatusBadge,
  Stepper,
} from '@bug-bounty-escrow/ui';
import { ArcTestnet } from '@circle-fin/app-kit/chains';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  stringToHex,
  type EIP1193Provider,
} from 'viem';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  bridgeRecoveryTelemetry,
  canRetryBridgeResult,
  CircleBridgeIncompleteError,
  CircleUnifiedBalanceManualRecoveryError,
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
  fundingReadinessFingerprint,
  isExplicitWalletRejection,
  isFundingReadinessCurrent,
  clearPendingFundingResult,
  clearPendingBridgeRecovery,
  clearPendingSourceDepositHash,
  persistPendingFundingResult,
  persistPendingBridgeRecovery,
  persistPendingSourceDepositHash,
  readPendingFundingResult,
  readPendingBridgeRecovery,
  readPendingSourceDepositHash,
  sourceDepositContinuationAction,
  shouldRenderFundingPending,
  shouldRemainInCp11AfterUnifiedIntentLock,
  parseUsdcBaseUnits,
  validateFundingSelection,
  type FundingDestinationResult,
  type FundingNetworkId,
  type FundingOperationPhase,
  type FundingRecoveryAttempt,
  type FundingSource,
  type FundingReadinessSnapshot,
  type PendingBridgeRecovery,
  type ValidatedFundingSelection,
  type VerifiedFundingIntent,
} from './program-funding-flow';
import { isWithdrawalPanelAvailable } from './program-withdrawal-availability';
import {
  FundingAllocations,
  FundingConfirmationEvidence,
  FundingPending,
  type SourceDepositStatus,
} from './program-funding-views';
import { CREATE_PROGRAM_STEPS } from './program-wizard';
import { formatUsdc, shortenAddress } from './program-draft';
import { buildProgramReadiness, type ProgramReadinessItem } from './program-readiness-model';
import { FormCard, StepLayout, SummaryRow, WizardShell } from './wizard-parts';
import { apiRequest, ApiClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const BOUNTY_ESCROW_ADMIN_PAY_FEE_ABI = [
  {
    type: 'function',
    name: 'payProgramFee',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'programKey', type: 'bytes32' }],
    outputs: [],
  },
] as const;

function canonicalProgramKey(programId: string): `0x${string}` {
  const uuidBytes = `0x${programId.replaceAll('-', '')}` as `0x${string}`;
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes16' }],
      [keccak256(stringToHex('bountyescrow.xyz/BountyEscrow/v1')), 5_042_002n, uuidBytes],
    ),
  );
}

async function waitForWalletReceipt(
  provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> },
  transactionHash: string,
  transactionLabel: string,
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [transactionHash],
    });
    if (receipt !== null && typeof receipt === 'object') {
      if ((receipt as { status?: unknown }).status === '0x0') {
        throw new Error(`The ${transactionLabel} transaction was reverted by the wallet.`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for the ${transactionLabel} transaction.`);
}

type DeploymentFeeStage = 'idle' | 'network' | 'approval' | 'charge' | 'verification';

function providerErrorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? code : undefined;
}

function providerErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  if (typeof error === 'string' && error.trim().length > 0) return error.trim();
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim().length > 0 ? message.trim() : undefined;
}

function isUnknownChainError(error: unknown): boolean {
  const code = providerErrorCode(error);
  const message = providerErrorMessage(error) ?? '';
  return (
    code === 4902 ||
    code === '4902' ||
    /(?:unknown|unrecognized|unsupported|not configured|not found).*chain|chain.*(?:unknown|unrecognized|unsupported|not configured|not found)/iu.test(
      message,
    )
  );
}

function isWalletRejection(error: unknown): boolean {
  const code = providerErrorCode(error);
  const message = providerErrorMessage(error) ?? '';
  return (
    code === 4001 ||
    code === '4001' ||
    /user rejected|user denied|rejected the request|request rejected|denied/iu.test(message)
  );
}

function isInsufficientWalletFunds(error: unknown): boolean {
  const message = providerErrorMessage(error) ?? '';
  return /insufficient funds|insufficient balance|not enough funds|balance.*(?:low|insufficient)|gas.*(?:fund|balance)/iu.test(
    message,
  );
}

function deploymentFeeWalletError(error: unknown, stage: DeploymentFeeStage): string {
  if (stage === 'network') {
    if (isWalletRejection(error)) {
      return 'Arc Testnet was not added or selected. Approve the network request in your wallet to continue.';
    }
    return 'The wallet could not add or select Arc Testnet. Check the wallet request and try again.';
  }
  if (stage === 'verification') {
    return error instanceof Error ? error.message : 'The deployment fee could not be verified.';
  }
  if (isWalletRejection(error)) {
    return 'The wallet rejected the deployment fee request. No fee was charged.';
  }
  if (isInsufficientWalletFunds(error)) {
    return 'Deployment fee charge failed: the wallet reports insufficient USDC or Arc Testnet gas.';
  }
  const message = providerErrorMessage(error);
  return message === undefined
    ? 'Deployment fee charge failed in the wallet. Return to the wallet and try again.'
    : `Deployment fee charge failed in the wallet: ${message}`;
}

async function ensureArcTestnetWallet(
  provider: EIP1193Provider,
  onNetworkPrompt: (message: string) => void,
): Promise<void> {
  const targetChainId = `0x${ArcTestnet.chainId.toString(16)}`;
  const currentChainId = await provider.request({ method: 'eth_chainId' });
  if (
    typeof currentChainId === 'string' &&
    Number.parseInt(currentChainId, 16) === ArcTestnet.chainId
  ) {
    return;
  }

  onNetworkPrompt('Your wallet must switch to Arc Testnet before charging the deployment fee.');
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChainId }],
    });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    onNetworkPrompt(
      'Arc Testnet is not added to your wallet. Approve the wallet request to add Arc Testnet, then charging will continue.',
    );
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: targetChainId,
          chainName: ArcTestnet.name,
          nativeCurrency: ArcTestnet.nativeCurrency,
          rpcUrls: [...ArcTestnet.rpcEndpoints],
          blockExplorerUrls: [ArcTestnet.explorerUrl.replace(/\/tx\/\{hash\}$/u, '')],
        },
      ],
    });
  }

  const selectedChainId = await provider.request({ method: 'eth_chainId' });
  if (
    typeof selectedChainId !== 'string' ||
    Number.parseInt(selectedChainId, 16) !== ArcTestnet.chainId
  ) {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChainId }],
    });
  }
}

function deploymentFeeStatusLabel(status: DeploymentFeeQuote['status']): string {
  if (status === 'quoted') return 'Awaiting payment';
  if (status === 'paid') return 'Paid';
  if (status === 'waived') return 'Waived';
  return 'Expired';
}

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
  const mapRecovery = (
    candidate: NonNullable<ApiFundingIntent['recovery']>,
  ): FundingRecoveryAttempt => ({
    operationRecordId: candidate.operationRecordId,
    status: candidate.status,
    operationType: candidate.operationType,
    ...(candidate.attemptNo === undefined ? {} : { attemptNo: candidate.attemptNo }),
    ...(candidate.replacesOperationId === undefined
      ? {}
      : { replacesOperationId: candidate.replacesOperationId }),
    ...(candidate.operationId === undefined ? {} : { operationId: candidate.operationId }),
    ...(candidate.transactionHash === undefined
      ? {}
      : { transactionHash: candidate.transactionHash }),
    ...(candidate.transferId === undefined ? {} : { transferId: candidate.transferId }),
    ...(candidate.failureCode === undefined ? {} : { failureCode: candidate.failureCode }),
    ...(candidate.providerState === undefined ? {} : { providerState: candidate.providerState }),
    retryable: candidate.retryable,
    submissionUncertain: candidate.submissionUncertain,
    sourceTransactionHashes: candidate.sourceTransactionHashes,
    ...(candidate.unboundTransactionHashes === undefined
      ? {}
      : { unboundTransactionHashes: candidate.unboundTransactionHashes }),
    steps: candidate.steps.map((step) => ({
      name: step.name,
      state: step.state,
      ...(step.network === undefined ? {} : { network: step.network }),
      ...(step.transactionHash === undefined ? {} : { transactionHash: step.transactionHash }),
      ...(step.errorCode === undefined ? {} : { errorCode: step.errorCode }),
    })),
    ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt }),
    ...(candidate.updatedAt === undefined ? {} : { updatedAt: candidate.updatedAt }),
    ...(candidate.recoveryCheckedAt === undefined
      ? {}
      : { recoveryCheckedAt: candidate.recoveryCheckedAt }),
    ...(candidate.recoveryTransactionHash === undefined
      ? {}
      : { recoveryTransactionHash: candidate.recoveryTransactionHash }),
    ...(candidate.recoveryState === undefined ? {} : { recoveryState: candidate.recoveryState }),
    ...(candidate.recoveryBlockNumber === undefined
      ? {}
      : { recoveryBlockNumber: candidate.recoveryBlockNumber }),
    ...(candidate.recoveryBlockHash === undefined
      ? {}
      : { recoveryBlockHash: candidate.recoveryBlockHash }),
    ...(candidate.recoveryChecks === undefined
      ? {}
      : {
          recoveryChecks: candidate.recoveryChecks.map((check) => ({
            transactionHash: check.transactionHash,
            evidenceRole: check.evidenceRole,
            network: check.network,
            state: check.state,
            ...(check.blockNumber === undefined ? {} : { blockNumber: check.blockNumber }),
            ...(check.blockHash === undefined ? {} : { blockHash: check.blockHash }),
            checkedAt: check.checkedAt,
          })),
        }),
  });
  const recovery = intent.recovery === undefined ? undefined : mapRecovery(intent.recovery);
  return {
    id: intent.id,
    walletAddress: intent.walletAddress,
    routeMode: intent.routeMode,
    fundingPhase: intent.fundingPhase,
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
      ...(deposit.recoveryCheckedAt === undefined
        ? {}
        : { recoveryCheckedAt: deposit.recoveryCheckedAt }),
      ...(deposit.recoveryTransactionHash === undefined
        ? {}
        : { recoveryTransactionHash: deposit.recoveryTransactionHash }),
      ...(deposit.recoveryState === undefined ? {} : { recoveryState: deposit.recoveryState }),
      ...(deposit.recoveryBlockNumber === undefined
        ? {}
        : { recoveryBlockNumber: deposit.recoveryBlockNumber }),
      ...(deposit.recoveryBlockHash === undefined
        ? {}
        : { recoveryBlockHash: deposit.recoveryBlockHash }),
      ...(deposit.recoveryChecks === undefined
        ? {}
        : {
            recoveryChecks: deposit.recoveryChecks.map((check) => ({
              transactionHash: check.transactionHash,
              evidenceRole: check.evidenceRole,
              network: check.network,
              state: check.state,
              ...(check.blockNumber === undefined ? {} : { blockNumber: check.blockNumber }),
              ...(check.blockHash === undefined ? {} : { blockHash: check.blockHash }),
              checkedAt: check.checkedAt,
            })),
          }),
      canAttach: deposit.canAttach,
      canRetry: deposit.canRetry,
    })),
    ...(intent.sourceDepositsTotal === undefined
      ? {}
      : { sourceDepositsTotal: intent.sourceDepositsTotal }),
    ...(intent.sourceDepositsTruncated === undefined
      ? {}
      : { sourceDepositsTruncated: intent.sourceDepositsTruncated }),
    destinationChain: intent.destinationChain,
    recipientAddress: intent.recipientAddress,
    recipientVerified: true,
    ...(intent.destinationTransactionHash === undefined
      ? {}
      : { destinationTransactionHash: intent.destinationTransactionHash }),
    ...(intent.transferId === undefined ? {} : { transferId: intent.transferId }),
    ...(recovery === undefined ? {} : { recovery }),
    ...(intent.recoveryAttempts === undefined
      ? {}
      : { recoveryAttempts: intent.recoveryAttempts.map(mapRecovery) }),
    ...(intent.recoveryAttemptsTotal === undefined
      ? {}
      : { recoveryAttemptsTotal: intent.recoveryAttemptsTotal }),
    ...(intent.recoveryAttemptsTruncated === undefined
      ? {}
      : { recoveryAttemptsTruncated: intent.recoveryAttemptsTruncated }),
    expiresAt: intent.expiresAt,
  };
}

function fundingQuoteFromIntent(intent: VerifiedFundingIntent) {
  if (intent.quoteQuotedAt === undefined || intent.quoteExpiresAt === undefined) {
    throw new Error('The locked funding quote is missing. Return to CP-11 and check readiness.');
  }
  const estimatedFeeReserveBaseUnits = parseUsdcBaseUnits(intent.estimatedFeeReserve);
  if (estimatedFeeReserveBaseUnits === undefined) {
    throw new Error('The locked funding fee evidence is invalid.');
  }
  return {
    estimatedFeeReserve: intent.estimatedFeeReserve,
    estimatedFeeReserveBaseUnits,
    estimatedFeeReserveByNetwork: Object.fromEntries(
      intent.feeAllocations.map((allocation) => [allocation.network, allocation.amount]),
    ),
    feeAllocations: intent.feeAllocations,
    quotedAt: intent.quoteQuotedAt,
    expiresAt: intent.quoteExpiresAt,
  };
}

export function depositStatusesFromIntent(
  intent: ApiFundingIntent,
  intentSources: readonly FundingSource[],
  readiness?: GatewayFundingReadiness,
): Readonly<Record<string, SourceDepositStatus>> {
  return Object.fromEntries(
    intentSources.map((source) => {
      const deposit = intent.sourceDeposits
        .filter((candidate) => candidate.network === source.network)
        .sort((left, right) => right.attemptNo - left.attemptNo)[0];
      const deficit = readiness?.sources.find(
        (candidate) => candidate.network === source.network,
      )?.deficit;
      const status =
        deposit?.status === 'confirmed' && (parseUsdcBaseUnits(deficit ?? '0') ?? 0n) > 0n
          ? 'top_up_required'
          : sourceDepositStatusFromApi(deposit);
      return [source.rowId, status];
    }),
  );
}

function topUpAmountsFromReadiness(
  intentSources: readonly FundingSource[],
  readiness?: GatewayFundingReadiness,
): Readonly<Record<string, string>> {
  const amounts: Record<string, string> = {};
  for (const source of intentSources) {
    const deficit = readiness?.sources.find(
      (candidate) => candidate.network === source.network,
    )?.deficit;
    if (deficit !== undefined && (parseUsdcBaseUnits(deficit) ?? 0n) > 0n) {
      amounts[source.rowId] = deficit;
    }
  }
  return amounts;
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

class DeploymentSupportRequiredError extends Error {
  constructor() {
    super(
      'Circle reported a definitive deployment failure. The immutable attempt is preserved; contact support because this screen will not create a blind replacement deployment.',
    );
    this.name = 'DeploymentSupportRequiredError';
  }
}

function ReadinessRow({ item }: { readonly item: ProgramReadinessItem }) {
  const deploying = item.status.toLowerCase() === 'deploying';
  const Icon = deploying ? LoaderCircle : item.complete ? CheckCircle2 : Circle;

  return (
    <li
      className="flex items-start gap-md rounded-md border border-border bg-surface-raised p-lg"
      data-readiness-item={item.id}
    >
      <Icon
        aria-hidden="true"
        className={`size-5 shrink-0 ${
          deploying ? 'animate-spin text-escrow' : item.complete ? 'text-escrow' : 'text-text-disabled'
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-xs sm:flex-row sm:items-start sm:justify-between sm:gap-lg">
        <span className="flex min-w-0 flex-col">
          <span className="text-label-lg text-text">{item.title}</span>
          <span className="text-label-md text-text-muted">{item.detail}</span>
        </span>
        <span
          className={`shrink-0 text-label-sm font-semibold uppercase ${
            deploying ? 'text-escrow' : item.complete ? 'text-escrow' : 'text-medium'
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
  const [deploymentFeeQuote, setDeploymentFeeQuote] = useState<DeploymentFeeQuote>();
  const [deploymentFeePaymentHash, setDeploymentFeePaymentHash] = useState<string>();
  const [deploymentFeeLoading, setDeploymentFeeLoading] = useState(false);
  const [deploymentFeeError, setDeploymentFeeError] = useState<string>();
  const [deploymentFeeNotice, setDeploymentFeeNotice] = useState<string>();
  const [deploymentFeeStage, setDeploymentFeeStage] = useState<DeploymentFeeStage>('idle');
  const deploymentFeeStageRef = useRef<DeploymentFeeStage>('idle');
  const [deploymentStatus, setDeploymentStatus] = useState<EscrowDeployment['status']>();
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
  const [fundingRecoveryHash, setFundingRecoveryHash] = useState('');
  const [fundingReadiness, setFundingReadiness] = useState<FundingReadinessSnapshot>();
  const [fundingPendingDismissed, setFundingPendingDismissed] = useState(false);
  const [bridgeRecoveryResult, setBridgeRecoveryResult] =
    useState<CircleBridgeIncompleteError['result']>();
  const bridgeRecoveryObservationPending = useRef(false);
  const [verifiedFundingIntent, setVerifiedFundingIntent] = useState<VerifiedFundingIntent>();
  const fundingIdempotencyKey = useRef<string | undefined>(undefined);
  const fundingDestinationAttemptKey = useRef<string | undefined>(undefined);
  const destinationWalletClaimTokens = useRef<Record<string, string>>({});
  const bridgeDeliveryRetryClaimTokens = useRef<Record<string, string>>({});
  const sourceWalletClaimTokens = useRef<Record<string, string>>({});
  const volatileSourceDepositHashes = useRef<Record<string, string>>({});
  const [depositStatuses, setDepositStatuses] = useState<
    Readonly<Record<string, SourceDepositStatus>>
  >({});
  const [depositTopUpAmounts, setDepositTopUpAmounts] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [depositRecoveryHashes, setDepositRecoveryHashes] = useState<
    Readonly<Record<string, string>>
  >({});
  const [confirmedUnifiedBalance, setConfirmedUnifiedBalance] = useState<string>();
  const [pendingUnifiedBalance, setPendingUnifiedBalance] = useState<string>();
  const [fundingConfirmation, setFundingConfirmation] = useState<FundingConfirmationArtifact>();
  const [fundingConfirmationError, setFundingConfirmationError] = useState<string>();
  const [withdrawalIntent, setWithdrawalIntent] = useState<WithdrawalIntent>();
  const [formError, setFormError] = useState<Record<string, string>>({});

  const chainLabel = 'Arc Testnet';
  const deployed = program.contractAddress !== undefined;

  useEffect(() => {
    if (session?.access_token === undefined || deployed) return;
    let cancelled = false;
    setDeploymentFeeLoading(true);
    void apiRequest(
      `/api/programs/${program.id}/escrow-deployment-fees/current`,
      deploymentFeeQuoteResponseSchema,
      { token: session.access_token },
    )
      .then((response) => {
        if (!cancelled) {
          setDeploymentFeeQuote(response.data);
          setDeploymentFeeError(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof ApiClientError && error.status === 404)) {
          setDeploymentFeeError(
            error instanceof Error ? error.message : 'Deployment fee status could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDeploymentFeeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deployed, program.id, session?.access_token]);

  // CP-10 is durable: if Circle accepted the operation but Arc verification is still pending,
  // keep the page in DEPLOYING and resume from the server record after reloads.
  useEffect(() => {
    if (session?.access_token === undefined || deployed) return;
    let cancelled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try {
        const response = await apiRequest(
          `/api/programs/${program.id}/escrow-deployments/current`,
          escrowDeploymentResponseSchema,
          { token: session.access_token },
        );
        if (cancelled) return;
        const current = response.data;
        if (['accepted', 'pending', 'verifying'].includes(current.status)) {
          setDeploymentStatus(current.status);
          timer = globalThis.setTimeout(() => void poll(), 2_000);
          return;
        }
        if (current.status === 'confirmed') {
          const saved = await apiRequest(
            `/api/owner/programs/${program.id}`,
            programResponseSchema,
            { token: session.access_token },
          );
          if (!cancelled) {
            setDeploymentStatus(current.status);
            await cacheProgram(saved.data);
            setView(Number(saved.data.totalPool) > 0 ? 'readiness' : 'fund');
            setDeployOpen(false);
          }
          return;
        }
        if (!cancelled) setDeploymentStatus(current.status);
      } catch (error: unknown) {
        // A missing deployment is the normal pre-deploy state. Other errors are retried while
        // the local status remains unchanged so a transient API failure cannot create a second
        // Circle operation.
        if (!cancelled && !(error instanceof ApiClientError && error.status === 404)) {
          timer = globalThis.setTimeout(() => void poll(), 2_000);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [deployed, deploymentStatus, program.id, session?.access_token]);

  useEffect(() => {
    if (fundingReadiness === undefined) return;
    const remaining = Date.parse(fundingReadiness.quote.expiresAt) - Date.now();
    if (remaining <= 0) {
      setFundingReadiness(undefined);
      return;
    }
    const timeout = globalThis.setTimeout(
      () => setFundingReadiness(undefined),
      Math.min(remaining, 2_147_483_647),
    );
    return () => globalThis.clearTimeout(timeout);
  }, [fundingReadiness]);
  const funded = Number(program.totalPool) > 0;
  const withdrawalAvailable = isWithdrawalPanelAvailable(program.status, withdrawalIntent);
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
      .then(async (response) => {
        if (cancelled) return;
        const intent = response.data;
        const intentSources = fundingSourcesFromApi(intent);
        const validation = validateFundingSelection(intent.grossAmount, intentSources);
        if (validation.selection === undefined) return;
        let readiness: GatewayFundingReadiness | undefined;
        if (intent.routeMode === 'unified_balance') {
          try {
            readiness = (
              await apiRequest(
                `/api/programs/${program.id}/funding-intents/${intent.id}/gateway-readiness`,
                gatewayFundingReadinessResponseSchema,
                { token: session.access_token },
              )
            ).data;
          } catch {
            // Intent hydration remains authoritative even when provider readiness is temporarily
            // unavailable. A later Check readiness will derive the exact deficit again.
          }
        }
        if (cancelled) return;
        setVerifiedFundingIntent(verifiedIntentFromApi(intent));
        setGrossAmount(intent.grossAmount);
        setSources(intentSources);
        setDepositStatuses(depositStatusesFromIntent(intent, intentSources, readiness));
        setDepositTopUpAmounts(topUpAmountsFromReadiness(intentSources, readiness));
        setFundingSelection(
          intent.fundingPhase === 'ready_for_destination' ? validation.selection : undefined,
        );
        setFundingPendingDismissed(false);
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
    setFundingConfirmation((current) => (current?.programId === program.id ? current : undefined));
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
        // Withdrawal execution is platform-admin managed; an unavailable optional projection
        // must not turn the owner readiness page into an error state.
        void error;
      });
    return () => {
      cancelled = true;
    };
  }, [deployed, program.id, session?.access_token]);

  function cacheProgram(saved: Program) {
    client.setQueryData(queryKeys.ownerProgram(session?.user.id ?? 'no-session', saved.id), {
      success: true,
      data: saved,
    });
    return client.invalidateQueries({ queryKey: ['programs'] });
  }

  const deploymentFeeQuoteMutation = useMutation({
    mutationFn: async (): Promise<DeploymentFeeQuote> => {
      const body = createDeploymentFeeQuoteRequestSchema.parse({
        idempotencyKey: globalThis.crypto.randomUUID(),
      });
      const response = await apiRequest(
        `/api/programs/${program.id}/escrow-deployment-fees/quote`,
        deploymentFeeQuoteResponseSchema,
        { method: 'POST', token: session?.access_token, body },
      );
      return response.data;
    },
    onSuccess: (quote) => {
      setDeploymentFeeQuote(quote);
      setDeploymentFeePaymentHash(undefined);
      setDeploymentFeeError(undefined);
    },
    onError: (error: unknown) => {
      setDeploymentFeeError(error instanceof Error ? error.message : 'Fee quote unavailable.');
    },
  });

  const deploymentFeePaymentMutation = useMutation({
    mutationFn: async (): Promise<DeploymentFeeQuote> => {
      if (walletSession === undefined) {
        throw new Error('Connect the owner wallet before paying the deployment fee.');
      }
      const quote = deploymentFeeQuote;
      if (quote === undefined) throw new Error('Request a deployment fee quote first.');
      if (deploymentFeePaymentHash !== undefined) {
        deploymentFeeStageRef.current = 'verification';
        setDeploymentFeeStage('verification');
        const paymentBody = observeDeploymentFeePaymentRequestSchema.parse({
          quoteId: quote.id,
          payerAddress: walletSession.address,
          transactionHash: deploymentFeePaymentHash,
        });
        const response = await apiRequest(
          `/api/programs/${program.id}/escrow-deployment-fees/payment`,
          deploymentFeeQuoteResponseSchema,
          { method: 'POST', token: session?.access_token, body: paymentBody },
        );
        return response.data;
      }

      const amount = parseUsdcBaseUnits(quote.amount);
      if (amount === undefined || amount <= 0n)
        throw new Error('The server returned an invalid deployment fee.');
      if (quote.chainId !== ArcTestnet.chainId) {
        throw new Error('The server returned an unsupported deployment-fee network.');
      }
      deploymentFeeStageRef.current = 'network';
      setDeploymentFeeStage('network');
      await ensureArcTestnetWallet(walletSession.wallet.provider, (message) => {
        setDeploymentFeeNotice(message);
      });
      setDeploymentFeeNotice(undefined);

      deploymentFeeStageRef.current = 'approval';
      setDeploymentFeeStage('approval');
      const approvalHash = await walletSession.wallet.provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: walletSession.address as `0x${string}`,
            to: quote.tokenAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: ERC20_APPROVE_ABI,
              functionName: 'approve',
              args: [quote.recipientAddress as `0x${string}`, amount],
            }),
            value: '0x0',
          },
        ],
      });
      if (typeof approvalHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(approvalHash)) {
        throw new Error('The wallet did not return a valid deployment-fee approval hash.');
      }
      await waitForWalletReceipt(
        walletSession.wallet.provider as unknown as {
          request(args: { method: string; params?: unknown[] }): Promise<unknown>;
        },
        approvalHash,
        'deployment-fee approval',
      );

      deploymentFeeStageRef.current = 'charge';
      setDeploymentFeeStage('charge');
      const transactionHash = await walletSession.wallet.provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: walletSession.address as `0x${string}`,
            to: quote.recipientAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: BOUNTY_ESCROW_ADMIN_PAY_FEE_ABI,
              functionName: 'payProgramFee',
              args: [canonicalProgramKey(program.id)],
            }),
            value: '0x0',
          },
        ],
      });
      if (typeof transactionHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
        throw new Error('The wallet did not return a valid deployment fee transaction hash.');
      }
      await waitForWalletReceipt(
        walletSession.wallet.provider as unknown as {
          request(args: { method: string; params?: unknown[] }): Promise<unknown>;
        },
        transactionHash,
        'deployment-fee charge',
      );
      setDeploymentFeePaymentHash(transactionHash);

      deploymentFeeStageRef.current = 'verification';
      setDeploymentFeeStage('verification');
      const paymentBody = observeDeploymentFeePaymentRequestSchema.parse({
        quoteId: quote.id,
        payerAddress: walletSession.address,
        transactionHash,
      });
      const response = await apiRequest(
        `/api/programs/${program.id}/escrow-deployment-fees/payment`,
        deploymentFeeQuoteResponseSchema,
        {
          method: 'POST',
          token: session?.access_token,
          body: paymentBody,
        },
      );
      return response.data;
    },
    onMutate: () => {
      setDeploymentFeeError(undefined);
      setDeploymentFeeNotice(undefined);
      deploymentFeeStageRef.current = 'network';
      setDeploymentFeeStage('network');
    },
    onSuccess: (quote) => {
      setDeploymentFeeQuote(quote);
      setDeploymentFeePaymentHash(undefined);
      setDeploymentFeeError(undefined);
      setDeploymentFeeNotice(undefined);
      deploymentFeeStageRef.current = 'idle';
      setDeploymentFeeStage('idle');
    },
    onError: (error: unknown) => {
      setDeploymentFeeError(deploymentFeeWalletError(error, deploymentFeeStageRef.current));
      setDeploymentFeeNotice(undefined);
      deploymentFeeStageRef.current = 'idle';
      setDeploymentFeeStage('idle');
    },
  });

  const deployMutation = useMutation({
    mutationFn: async (): Promise<EscrowDeployment> => {
      if (program.deadline === undefined) {
        throw new Error('Set a program deadline before deploying the escrow.');
      }
      if (
        deploymentFeeQuote === undefined ||
        !['paid', 'waived'].includes(deploymentFeeQuote.status)
      ) {
        throw new Error('Pay the deployment fee before deploying the escrow.');
      }
      const body = deployEscrowWithCircleRequestSchema.parse({});
      const deployment = await apiRequest(
        `/api/programs/${program.id}/escrow-deployments`,
        escrowDeploymentResponseSchema,
        { method: 'POST', token: session?.access_token, body },
      );
      setDeploymentStatus(deployment.data.status);
      if (deployment.data.status === 'failed' || deployment.data.status === 'reverted') {
        throw new DeploymentSupportRequiredError();
      }
      return deployment.data;
    },
    onSuccess: async (deployment) => {
      if (deployment.status !== 'confirmed') {
        // The polling effect above owns the transition to confirmed. Keep CP-10 visible and
        // disable duplicate clicks while Circle/Arc finalization is in progress.
        setDeployOpen(true);
        return;
      }
      const response = await apiRequest(
        `/api/owner/programs/${program.id}`,
        programResponseSchema,
        { token: session?.access_token },
      );
      setDeployOpen(false);
      await cacheProgram(response.data);
      // CP-10 → CP-11 happens automatically once the contract is ready.
      setView(Number(response.data.totalPool) > 0 ? 'readiness' : 'fund');
    },
  });

  const lifecyclePending =
    deployMutation.isPending ||
    ['accepted', 'pending', 'verifying'].includes(deploymentStatus ?? '') ||
    deploymentFeeQuoteMutation.isPending ||
    deploymentFeePaymentMutation.isPending ||
    fundingWorking;

  const deploymentFeeReady =
    deploymentFeeQuote?.status === 'paid' || deploymentFeeQuote?.status === 'waived';

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

  const readiness = buildProgramReadiness(program).map((item) =>
    item.id === 'escrow-contract' &&
    ['accepted', 'pending', 'verifying'].includes(deploymentStatus ?? '')
      ? {
          ...item,
          detail: 'The platform admin wallet is deploying and verifying the Arc escrow contract',
          status: 'Deploying',
        }
      : item,
  );
  const collateralReady = readiness.find((item) => item.id === 'funding')?.complete === true;
  const publishingReady = readiness.find((item) => item.id === 'publishing')?.status === 'Ready';
  const currentFundingValidation = validateFundingSelection(grossAmount, sources);
  const canSubmitFundingPlan =
    currentFundingValidation.selection !== undefined &&
    walletSession !== undefined &&
    walletMatchesVerifiedIntent &&
    program.contractAddress !== undefined &&
    fundingReadiness !== undefined &&
    walletSession !== undefined &&
    currentFundingValidation.selection !== undefined &&
    isFundingReadinessCurrent(fundingReadiness, {
      walletAddress: walletSession.address,
      escrowAddress: program.contractAddress,
      selection: currentFundingValidation.selection,
      quote: fundingReadiness.quote,
    }) &&
    !fundingWorking;
  const depositRequiredAmounts = sources.reduce<Record<string, string>>((amounts, source) => {
    const topUpAmount = depositTopUpAmounts[source.rowId];
    if (depositStatuses[source.rowId] === 'top_up_required' && topUpAmount !== undefined) {
      amounts[source.rowId] = topUpAmount;
      return amounts;
    }
    const latest = verifiedFundingIntent?.sourceDeposits
      .filter((deposit) => deposit.network === source.network)
      .sort((left, right) => right.attemptNo - left.attemptNo)[0];
    if (latest !== undefined) amounts[source.rowId] = latest.amount;
    return amounts;
  }, {});

  async function connectFundingWallet() {
    setWalletPending(true);
    setWalletError(undefined);
    try {
      const connected = await connectCircleWallet();
      if (
        walletSession !== undefined &&
        walletSession.address.toLowerCase() !== connected.address.toLowerCase()
      ) {
        setDeploymentFeePaymentHash(undefined);
        setFundingSelection(undefined);
        setFundingResult(undefined);
        setFundingPhase('ready_to_sign');
        setDepositStatuses({});
        setConfirmedUnifiedBalance(undefined);
        setPendingUnifiedBalance(undefined);
      }
      setFundingReadiness(undefined);
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
      setWalletError(
        error instanceof Error ? error.message : 'The wallet connection was declined.',
      );
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
    setFundingReadiness(undefined);
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
    setFundingReadiness(undefined);
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
    setFundingReadiness(undefined);
    setFormError({});
    setFundingError(undefined);
  }

  function removeFundingSource(rowId: string) {
    if (verifiedFundingIntent !== undefined) {
      setFundingError('This funding plan is locked. Resume or finish the active intent.');
      return;
    }
    setSources((current) => current.filter((source) => source.rowId !== rowId));
    setFundingReadiness(undefined);
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
        deposit?.status === 'confirmed' && depositStatuses[source.rowId] === 'top_up_required';
      if (deposit?.status === 'confirmed' && !topUpRequired) {
        setDepositStatuses((current) => ({ ...current, [source.rowId]: 'confirmed' }));
        return;
      }
      if (topUpRequired) deposit = undefined;
      if (deposit !== undefined) {
        depositId = deposit.id;
        const localHash =
          volatileSourceDepositHashes.current[deposit.id] ??
          readPendingSourceDepositHash(
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
        if (
          depositAction === 'recovery_required' &&
          sourceWalletClaimTokens.current[deposit.id] !== undefined
        ) {
          // The same mounted client saw an ambiguous arm response before the wallet callback ran.
          // Reusing that exact token is idempotent; a reload has no such proof and stays fail-closed.
          depositAction = 'execute_claimed';
        }
        if (depositAction === 'observe_local_hash' && localHash !== undefined) {
          const localClaimToken = sourceWalletClaimTokens.current[deposit.id];
          const observed = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits/${deposit.id}/${localClaimToken === undefined ? 'attach' : 'observations'}`,
            fundingIntentResponseSchema,
            {
              method: 'POST',
              token: session?.access_token,
              body:
                localClaimToken === undefined
                  ? attachSourceDepositRequestSchema.parse({ transactionHash: localHash })
                  : observeSourceDepositRequestSchema.parse({
                      claimToken: localClaimToken,
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
          delete volatileSourceDepositHashes.current[deposit.id];
          delete sourceWalletClaimTokens.current[deposit.id];
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
            deposit = activeIntent.sourceDeposits.find((candidate) => candidate.id === depositId);
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
                candidate.network === source.network && candidate.status === 'awaiting_signature',
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
        const sourceWalletClaimToken =
          sourceWalletClaimTokens.current[claimedDepositId] ??
          (sourceWalletClaimTokens.current[claimedDepositId] = globalThis.crypto.randomUUID());
        // For a restored awaiting_signature operation storage and all wallet readiness checks
        // still occur before the durable wallet boundary. A rejected chain switch therefore
        // remains safely retryable instead of being mislabeled as an uncertain transaction.
        assertFundingRecoveryStorage(window.localStorage);
        const result = await executePreparedFundingSubmission(
          () => walletSession.executor.prepareUnifiedBalanceDepositSource(exactDepositSource),
          async () => {
            const locked = await apiRequest(
              `/api/programs/${program.id}/funding-intents/${claimedIntentId}/source-deposits/${claimedDepositId}/arm`,
              fundingIntentResponseSchema,
              {
                method: 'POST',
                token: session?.access_token,
                body: walletBoundaryClaimRequestSchema.parse({
                  claimToken: sourceWalletClaimToken,
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
        volatileSourceDepositHashes.current[depositId] = returnedHash;
        setDepositRecoveryHashes((current) => ({ ...current, [source.rowId]: returnedHash! }));
        try {
          persistPendingSourceDepositHash(
            window.localStorage,
            program.id,
            activeIntent.id,
            depositId,
            returnedHash,
          );
        } catch {
          // Keep going with the volatile provider result so the server records the exact hash.
        }
        const observed = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${activeIntent.id}/source-deposits/${depositId}/observations`,
          fundingIntentResponseSchema,
          {
            method: 'POST',
            token: session?.access_token,
            body: observeSourceDepositRequestSchema.parse({
              claimToken: sourceWalletClaimToken,
              outcome: 'submitted',
              transactionHash: returnedHash,
            }),
          },
        );
        activeIntent = verifiedIntentFromApi(observed.data);
        clearPendingSourceDepositHash(window.localStorage, program.id, activeIntent.id, depositId);
        delete volatileSourceDepositHashes.current[depositId];
        delete sourceWalletClaimTokens.current[depositId];
        setDepositRecoveryHashes((current) => ({ ...current, [source.rowId]: '' }));
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
              ? 'The deposit hash is preserved in this mounted session. Use Check deposit to persist and reconcile that same transaction.'
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
    quote?: FundingReadinessSnapshot['quote'],
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
    if (quote === undefined) {
      throw new Error('Check readiness before creating a funding intent.');
    }
    fundingIdempotencyKey.current ??= globalThis.crypto.randomUUID();
    const body = createFundingIntentRequestSchema.parse({
      idempotencyKey: fundingIdempotencyKey.current,
      walletAddress: walletSession.address,
      grossAmount: selection.grossAmount,
      estimatedFeeReserve: quote.estimatedFeeReserve,
      feeAllocations: quote.feeAllocations,
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
    suppliedQuote?: FundingReadinessSnapshot['quote'],
  ): Promise<{
    intent: VerifiedFundingIntent;
    quote: Awaited<ReturnType<CircleWalletSession['executor']['estimateFunding']>>;
  }> {
    if (walletSession === undefined || program.contractAddress === undefined) {
      throw new Error('Connect the locked wallet and verify the Arc escrow before quoting.');
    }
    const quote =
      suppliedQuote ??
      (await walletSession.executor.estimateFunding(selection, program.contractAddress));
    const response = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/quote`,
      fundingIntentResponseSchema,
      {
        method: 'POST',
        token: session?.access_token,
        body: refreshFundingQuoteRequestSchema.parse({
          estimatedFeeReserve: quote.estimatedFeeReserve,
          feeAllocations: quote.feeAllocations,
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

  async function checkFundingReadiness() {
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
      walletSession === undefined ||
      program.contractAddress === undefined
    ) {
      setFundingReadiness(undefined);
      return;
    }
    const selectedFunding = validation.selection;
    setFundingWorking(true);
    setFundingError(undefined);
    try {
      const quote = await walletSession.executor.estimateFunding(
        selectedFunding,
        program.contractAddress,
      );
      if (Date.parse(quote.expiresAt) <= Date.now()) {
        throw new Error('Circle returned an expired funding quote.');
      }
      let checkedQuote = quote;
      if (verifiedFundingIntent !== undefined) {
        const refreshed = await refreshServerFundingQuote(
          verifiedFundingIntent,
          selectedFunding,
          quote,
        );
        checkedQuote = refreshed.quote;
        if (selectedFunding.routeMode === 'unified_balance') {
          const balance = await walletSession.executor.getUnifiedBalance();
          const serverReadiness = await getGatewayReadiness(refreshed.intent.id);
          setDepositTopUpAmounts(
            topUpAmountsFromReadiness(selectedFunding.sources, serverReadiness),
          );
          setDepositStatuses((current) => {
            const next = { ...current };
            for (const source of selectedFunding.sources) {
              const serverSource = serverReadiness.sources.find(
                (candidate) => candidate.network === source.network,
              );
              const latestDeposit = refreshed.intent.sourceDeposits
                .filter((candidate) => candidate.network === source.network)
                .sort((left, right) => right.attemptNo - left.attemptNo)[0];
              if (
                latestDeposit?.status === 'confirmed' &&
                (parseUsdcBaseUnits(serverSource?.deficit ?? '0') ?? 0n) > 0n
              ) {
                next[source.rowId] = 'top_up_required';
              } else if (latestDeposit?.status === 'confirmed') {
                next[source.rowId] = 'confirmed';
              }
            }
            return next;
          });
          if (!serverReadiness.ready) {
            throw new Error(
              'Selected Gateway domains do not yet cover their locked allocations and source fee headroom.',
            );
          }
          assertSelectedUnifiedBalanceReadiness(selectedFunding, balance, checkedQuote);
          setConfirmedUnifiedBalance(balance.confirmedAmount);
          setPendingUnifiedBalance(balance.pendingAmount);
        }
      }
      setFundingReadiness({
        checkedAt: new Date().toISOString(),
        quote: checkedQuote,
        fingerprint: fundingReadinessFingerprint({
          walletAddress: walletSession.address,
          escrowAddress: program.contractAddress,
          selection: selectedFunding,
          quote: checkedQuote,
        }),
      });
      setFormError({});
    } catch (error) {
      setFundingReadiness(undefined);
      setFundingError(
        error instanceof Error ? error.message : 'Funding readiness could not be verified.',
      );
    } finally {
      setFundingWorking(false);
    }
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
    const readinessCurrent =
      fundingReadiness !== undefined &&
      walletSession !== undefined &&
      program.contractAddress !== undefined &&
      validation.selection !== undefined &&
      isFundingReadinessCurrent(fundingReadiness, {
        walletAddress: walletSession.address,
        escrowAddress: program.contractAddress,
        selection: validation.selection,
        quote: fundingReadiness.quote,
      });
    if (!readinessCurrent) {
      nextErrors['readiness'] = 'Check readiness again before submitting.';
    }
    if (
      Object.keys(nextErrors).length > 0 ||
      validation.selection === undefined ||
      walletSession === undefined
    ) {
      return;
    }
    const selection = validation.selection;
    const hadVerifiedIntentBeforeSubmit = verifiedFundingIntent !== undefined;
    const readinessQuote = fundingReadiness!.quote;

    setFundingWorking(true);
    try {
      const intent = await ensureServerFundingIntent(selection, readinessQuote);
      setFundingReadiness(undefined);
      if (selection.routeMode === 'unified_balance') {
        if (
          shouldRemainInCp11AfterUnifiedIntentLock(
            selection.routeMode,
            hadVerifiedIntentBeforeSubmit,
            intent.fundingPhase,
          )
        ) {
          setFundingSelection(undefined);
          setFundingPendingDismissed(false);
          setFundingError(undefined);
          return;
        }
        // The explicit Check readiness action already bound a fresh quote plus client/server
        // per-domain balances to this exact fingerprint. Submit must not repeat wallet/network
        // prompts or introduce a second mutable readiness result.
        assertFreshFundingQuoteMatchesIntent(intent, readinessQuote);
        const prepared = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${intent.id}/prepare-destination`,
          fundingIntentResponseSchema,
          { method: 'POST', token: session?.access_token },
        );
        const preparedIntent = verifiedIntentFromApi(prepared.data);
        setVerifiedFundingIntent(preparedIntent);
      }
      setFundingPendingDismissed(false);
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
    operationRecordId: string,
    claimToken: string,
  ): Promise<VerifiedFundingIntent> {
    const body = observeFundingOperationRequestSchema.parse({
      operationRecordId,
      claimToken,
      outcome: 'submitted',
      ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
      destinationTransactionHash: result.destinationTransactionHash,
      ...(result.transferId === undefined ? {} : { transferId: result.transferId }),
      sourceTransactionHashes: result.sourceTransactionHashes,
      ...(result.sourceTransactions === undefined
        ? {}
        : {
            steps: result.sourceTransactions.map((source) => ({
              name: 'source_transaction',
              state: 'success' as const,
              network: source.network,
              transactionHash: source.transactionHash,
            })),
          }),
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

  async function observeBridgeRecoveryTelemetry(
    intent: VerifiedFundingIntent,
    telemetry: PendingBridgeRecovery,
    operationRecordId: string,
    claimToken: string,
  ): Promise<VerifiedFundingIntent> {
    const body = observeFundingOperationRequestSchema.parse({
      ...telemetry,
      operationRecordId,
      claimToken,
      outcome: 'provider_progress' as const,
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

  async function attachRecoveryOnlyTelemetry(
    intent: VerifiedFundingIntent,
    operationRecordId: string,
    input: {
      providerState: 'pending' | 'success' | 'error';
      retryable: boolean;
      sourceTransactionHashes?: readonly string[];
      unboundTransactionHashes?: readonly string[];
      steps?: readonly {
        name: string;
        state: 'pending' | 'success' | 'error';
        network?: FundingNetworkId;
        transactionHash?: string;
        errorCode?: string;
      }[];
    },
  ): Promise<VerifiedFundingIntent> {
    const attached = await apiRequest(
      `/api/programs/${program.id}/funding-intents/${intent.id}/destination-attempts/recovery-telemetry`,
      fundingIntentResponseSchema,
      {
        method: 'POST',
        token: session?.access_token,
        body: attachFundingRecoveryTelemetryRequestSchema.parse({
          operationRecordId,
          providerState: input.providerState,
          retryable: input.retryable,
          sourceTransactionHashes: input.sourceTransactionHashes ?? [],
          unboundTransactionHashes: input.unboundTransactionHashes ?? [],
          steps: input.steps ?? [],
        }),
      },
    );
    const verified = verifiedIntentFromApi(attached.data);
    setVerifiedFundingIntent(verified);
    return verified;
  }

  async function observeUncertainSubmission(
    intent: VerifiedFundingIntent,
    operationRecordId: string,
    claimToken: string,
  ): Promise<VerifiedFundingIntent> {
    const body = observeFundingOperationRequestSchema.parse({
      operationRecordId,
      claimToken,
      outcome: 'submission_uncertain',
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
      setFundingPendingDismissed(false);
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
    if (verifiedFundingIntent.walletAddress.toLowerCase() !== walletSession.address.toLowerCase()) {
      setFundingError(
        `This intent is locked to ${shortenAddress(verifiedFundingIntent.walletAddress)}. Connect that wallet to continue.`,
      );
      return;
    }

    setFundingWorking(true);
    setFundingError(undefined);
    let latestPhase: FundingOperationPhase = fundingPhase;
    let submissionLocked = false;
    let deliveryRetryLocked = false;
    let claimedOperationRecordId: string | undefined =
      verifiedFundingIntent.recovery?.status === 'awaiting_signature' ||
      (verifiedFundingIntent.recovery?.operationRecordId !== undefined &&
        destinationWalletClaimTokens.current[verifiedFundingIntent.recovery.operationRecordId] !==
          undefined)
        ? verifiedFundingIntent.recovery.operationRecordId
        : undefined;
    let destinationWalletClaimToken: string | undefined =
      claimedOperationRecordId === undefined
        ? undefined
        : destinationWalletClaimTokens.current[claimedOperationRecordId];
    let safeLinkedSendRetry = false;
    let activeIntent = verifiedFundingIntent;
    try {
      const manualDestinationHash = fundingRecoveryHash.trim();
      if (
        (activeIntent.recovery?.status === 'submission_uncertain' ||
          (activeIntent.routeMode === 'bridge' && activeIntent.recovery?.status === 'pending')) &&
        manualDestinationHash !== ''
      ) {
        const attached = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-attempts/attach`,
          fundingIntentResponseSchema,
          {
            method: 'POST',
            token: session?.access_token,
            body: attachFundingDestinationRequestSchema.parse({
              operationRecordId: activeIntent.recovery.operationRecordId,
              transactionHash: manualDestinationHash,
            }),
          },
        );
        activeIntent = verifiedIntentFromApi(attached.data);
        setVerifiedFundingIntent(activeIntent);
        setFundingRecoveryHash('');
        setFundingPhase('destination_submitted');
        await reconcileFundingIntent(activeIntent);
        return;
      }
      const pendingBridgeTelemetry =
        bridgeRecoveryObservationPending.current && bridgeRecoveryResult !== undefined
          ? bridgeRecoveryTelemetry(bridgeRecoveryResult)
          : readPendingBridgeRecovery(window.localStorage, program.id, activeIntent.id);
      if (pendingBridgeTelemetry !== undefined) {
        const operationRecordId = activeIntent.recovery?.operationRecordId;
        if (operationRecordId === undefined) {
          throw new Error('The durable Bridge operation is missing for recovery observation.');
        }
        activeIntent =
          destinationWalletClaimToken === undefined
            ? await attachRecoveryOnlyTelemetry(activeIntent, operationRecordId, {
                providerState: pendingBridgeTelemetry.providerState,
                retryable: pendingBridgeTelemetry.retryable,
                sourceTransactionHashes: pendingBridgeTelemetry.sourceTransactionHashes,
                steps: pendingBridgeTelemetry.steps,
              })
            : await observeBridgeRecoveryTelemetry(
                activeIntent,
                pendingBridgeTelemetry,
                operationRecordId,
                destinationWalletClaimToken,
              );
        setVerifiedFundingIntent(activeIntent);
        bridgeRecoveryObservationPending.current = false;
        try {
          clearPendingBridgeRecovery(window.localStorage, program.id, activeIntent.id);
        } catch {
          // The server already owns the bounded evidence. A stale local outbox is idempotent.
        }
        setFundingPhase('source_submitted');
        setFundingError(
          bridgeRecoveryResult === undefined
            ? 'The original Bridge approve/burn evidence was restored and persisted. Raw provider retry state is unavailable after reload, so no replacement Bridge will be submitted.'
            : 'The original Bridge evidence is now persisted. Continue again to retry only Circle’s documented failed delivery step.',
        );
        return;
      }
      const pendingDestinationResult =
        fundingResult ?? readPendingFundingResult(window.localStorage, program.id, activeIntent.id);

      const continuation = fundingContinuationAction(
        fundingPhase,
        bridgeRecoveryResult !== undefined && canRetryBridgeResult(bridgeRecoveryResult),
        pendingDestinationResult !== undefined,
      );
      const heldDestinationClaimToken =
        activeIntent.recovery?.operationRecordId === undefined
          ? undefined
          : destinationWalletClaimTokens.current[activeIntent.recovery.operationRecordId];
      const safeAmbiguousArmRetry =
        continuation === 'recovery_required' && heldDestinationClaimToken !== undefined;
      if (continuation !== 'execute' && !safeAmbiguousArmRetry) {
        if (continuation === 'observe_destination' && pendingDestinationResult !== undefined) {
          setFundingResult(pendingDestinationResult);
          const operationRecordId =
            activeIntent.recovery?.operationRecordId ??
            (() => {
              throw new Error('The durable destination operation is missing.');
            })();
          if (destinationWalletClaimToken === undefined) {
            const attached = await apiRequest(
              `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-attempts/attach`,
              fundingIntentResponseSchema,
              {
                method: 'POST',
                token: session?.access_token,
                body: attachFundingDestinationRequestSchema.parse({
                  operationRecordId,
                  transactionHash: pendingDestinationResult.destinationTransactionHash,
                }),
              },
            );
            activeIntent = verifiedIntentFromApi(attached.data);
            if (
              pendingDestinationResult.sourceTransactionHashes.length > 0 ||
              (pendingDestinationResult.unboundTransactionHashes?.length ?? 0) > 0
            ) {
              activeIntent = await attachRecoveryOnlyTelemetry(activeIntent, operationRecordId, {
                providerState: 'success',
                retryable: false,
                sourceTransactionHashes: pendingDestinationResult.sourceTransactionHashes,
                ...(pendingDestinationResult.sourceTransactions === undefined
                  ? {}
                  : {
                      steps: pendingDestinationResult.sourceTransactions.map((source) => ({
                        name: 'source_transaction',
                        state: 'success' as const,
                        network: source.network,
                        transactionHash: source.transactionHash,
                      })),
                    }),
                ...(pendingDestinationResult.unboundTransactionHashes === undefined
                  ? {}
                  : {
                      unboundTransactionHashes: pendingDestinationResult.unboundTransactionHashes,
                    }),
              });
            }
          } else {
            activeIntent = await observeDestinationResult(
              activeIntent,
              pendingDestinationResult,
              'success',
              operationRecordId,
              destinationWalletClaimToken,
            );
          }
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
            setFundingError(fundingSourceSubmittedRecoveryMessage(fundingSelection.routeMode));
            return;
          }
        }
        if (continuation === 'retry_bridge' && bridgeRecoveryResult !== undefined) {
          const operationRecordId =
            activeIntent.recovery?.operationRecordId ??
            (() => {
              throw new Error('The durable destination operation is missing.');
            })();
          const retryClaimToken =
            bridgeDeliveryRetryClaimTokens.current[operationRecordId] ??
            (bridgeDeliveryRetryClaimTokens.current[operationRecordId] =
              globalThis.crypto.randomUUID());
          const retryInput = bridgeRecoveryResult;
          let retryArmed = false;
          const recovered = await walletSession.executor.retryBridge(retryInput, async (phase) => {
            if (!retryArmed) {
              if (phase !== 'delivery_pending') {
                throw new Error('The Bridge delivery retry reached an invalid submission phase.');
              }
              // Circle's executor verifies the live account before invoking this callback and
              // verifies it again immediately before the SDK call. Persist the one-shot retry
              // boundary between those checks so a wallet changed before retry consumes nothing.
              const armedRetry = await apiRequest(
                `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-attempts/delivery-retry/arm`,
                fundingIntentResponseSchema,
                {
                  method: 'POST',
                  token: session?.access_token,
                  body: bridgeDeliveryRetryClaimRequestSchema.parse({
                    operationRecordId,
                    claimToken: retryClaimToken,
                  }),
                },
              );
              activeIntent = verifiedIntentFromApi(armedRetry.data);
              setVerifiedFundingIntent(activeIntent);
              submissionLocked = true;
              deliveryRetryLocked = true;
              retryArmed = true;
              // Once the retry boundary is durable, never retain a callable BridgeResult that
              // could issue a second delivery retry after an accepted-but-lost provider response.
              setBridgeRecoveryResult(undefined);
            }
            latestPhase = phase;
            setFundingPhase(phase);
          });
          setFundingResult(recovered);
          try {
            persistPendingFundingResult(
              window.localStorage,
              program.id,
              activeIntent.id,
              recovered,
            );
          } catch {
            // Volatile result remains visible and is attached to the server immediately below.
          }
          activeIntent = await observeDestinationResult(
            activeIntent,
            recovered,
            latestPhase === 'delivery_pending' ? 'pending' : 'success',
            operationRecordId,
            destinationWalletClaimToken ??
              (() => {
                throw new Error('The Bridge wallet claim is unavailable for delivery recovery.');
              })(),
          );
          clearPendingFundingResult(window.localStorage, program.id, activeIntent.id);
          delete bridgeDeliveryRetryClaimTokens.current[operationRecordId];
        }
        await reconcileFundingIntent(activeIntent);
        return;
      }

      if (
        fundingSelection.routeMode === 'send' &&
        activeIntent.recovery?.status === 'failed' &&
        activeIntent.recovery.failureCode === 'server.funding_destination_reverted'
      ) {
        const replacement = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-replacement`,
          fundingIntentResponseSchema,
          { method: 'POST', token: session?.access_token },
        );
        activeIntent = verifiedIntentFromApi(replacement.data);
        claimedOperationRecordId = activeIntent.recovery?.operationRecordId;
        setVerifiedFundingIntent(activeIntent);
      }

      const lockedQuote = fundingQuoteFromIntent(activeIntent);
      assertFreshFundingQuoteMatchesIntent(activeIntent, lockedQuote);
      if (fundingSelection.routeMode === 'unified_balance') {
        const balance = await walletSession.executor.getUnifiedBalance();
        setConfirmedUnifiedBalance(balance.confirmedAmount);
        setPendingUnifiedBalance(balance.pendingAmount);
        const serverReadiness = await getGatewayReadiness(activeIntent.id);
        if (!serverReadiness.ready) {
          const reopened = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}/reopen-source-collection`,
            fundingIntentResponseSchema,
            { method: 'POST', token: session?.access_token },
          );
          activeIntent = verifiedIntentFromApi(reopened.data);
          setVerifiedFundingIntent(activeIntent);
          setDepositStatuses(
            depositStatusesFromIntent(reopened.data, fundingSelection.sources, serverReadiness),
          );
          setDepositTopUpAmounts(
            topUpAmountsFromReadiness(fundingSelection.sources, serverReadiness),
          );
          setFundingSelection(undefined);
          setFundingReadiness(undefined);
          setFundingPendingDismissed(false);
          setFundingPhase('ready_to_sign');
          setFundingError(
            'Gateway balance changed after handoff. Source collection was safely reopened for the exact server-derived top-up; no destination signature was requested.',
          );
          return;
        }
        assertSelectedUnifiedBalanceReadiness(fundingSelection, balance, lockedQuote);
      }
      assertFundingRecoveryStorage(window.localStorage);
      const result = await executeVerifiedFundingIntent(
        activeIntent,
        fundingSelection,
        walletSession.address,
        walletSession.executor,
        async (phase) => {
          if (phase === 'awaiting_signature' && !submissionLocked) {
            if (claimedOperationRecordId === undefined) {
              fundingDestinationAttemptKey.current ??= globalThis.crypto.randomUUID();
              const claimed = await apiRequest(
                `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-attempts`,
                fundingIntentResponseSchema,
                {
                  method: 'POST',
                  token: session?.access_token,
                  body: fundingDestinationAttemptRequestSchema.parse({
                    idempotencyKey: fundingDestinationAttemptKey.current,
                  }),
                },
              );
              activeIntent = verifiedIntentFromApi(claimed.data);
              claimedOperationRecordId = activeIntent.recovery?.operationRecordId;
              if (claimedOperationRecordId === undefined) {
                throw new Error('The server did not return the claimed destination operation.');
              }
              setVerifiedFundingIntent(activeIntent);
            }
            // Arm the durable no-replay boundary in the same claimed row immediately before the
            // App Kit call. A process crash after broadcast but before the SDK returns must hydrate
            // into recovery, never another wallet invocation.
            destinationWalletClaimToken ??= globalThis.crypto.randomUUID();
            destinationWalletClaimToken =
              destinationWalletClaimTokens.current[claimedOperationRecordId] ??
              (destinationWalletClaimTokens.current[claimedOperationRecordId] =
                destinationWalletClaimToken);
            const armed = await apiRequest(
              `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-attempts/arm`,
              fundingIntentResponseSchema,
              {
                method: 'POST',
                token: session?.access_token,
                body: walletBoundaryClaimRequestSchema.parse({
                  claimToken: destinationWalletClaimToken,
                }),
              },
            );
            activeIntent = verifiedIntentFromApi(armed.data);
            setVerifiedFundingIntent(activeIntent);
            submissionLocked = true;
          }
          latestPhase = phase;
          setFundingPhase(phase);
        },
        lockedQuote,
      );
      try {
        persistPendingFundingResult(window.localStorage, program.id, activeIntent.id, result);
      } catch {
        // The returned hash is authoritative volatile evidence. Server observation must still run;
        // local recovery storage is only a fallback for a crash between these two statements.
      }
      setFundingResult(result);
      activeIntent = await observeDestinationResult(
        activeIntent,
        result,
        latestPhase === 'delivery_pending' ? 'pending' : 'success',
        claimedOperationRecordId ??
          (() => {
            throw new Error('The durable destination operation is missing.');
          })(),
        destinationWalletClaimToken ??
          (() => {
            throw new Error('The destination wallet claim is unavailable for auto-observation.');
          })(),
      );
      clearPendingFundingResult(window.localStorage, program.id, activeIntent.id);
      await reconcileFundingIntent(activeIntent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The funding operation failed.';
      if (error instanceof CircleUnifiedBalanceManualRecoveryError) {
        const recoveryResult: FundingDestinationResult = {
          ...error.result,
          unboundTransactionHashes: error.unboundTransactionHashes.slice(0, 32),
        };
        setFundingResult(recoveryResult);
        try {
          persistPendingFundingResult(
            window.localStorage,
            program.id,
            activeIntent.id,
            recoveryResult,
          );
        } catch {
          // Server observation remains authoritative; storage is only crash-recovery evidence.
        }
        try {
          if (claimedOperationRecordId === undefined) throw error;
          activeIntent = await observeDestinationResult(
            activeIntent,
            recoveryResult,
            'pending',
            claimedOperationRecordId,
            destinationWalletClaimToken ??
              (() => {
                throw new Error(
                  'The destination wallet claim is unavailable for auto-observation.',
                );
              })(),
          );
          activeIntent = await attachRecoveryOnlyTelemetry(activeIntent, claimedOperationRecordId, {
            providerState: 'success',
            retryable: false,
            ...(recoveryResult.unboundTransactionHashes === undefined
              ? {}
              : { unboundTransactionHashes: recoveryResult.unboundTransactionHashes }),
          });
          clearPendingFundingResult(window.localStorage, program.id, activeIntent.id);
        } catch {
          // Preserve the local result and the durable claimed operation. Hydration will retry
          // observation without ever deriving source networks or replaying the spend.
        }
        setFundingPhase('destination_submitted');
        setFundingError(
          `${message} Keep this page open until the server persists the original destination hash ${error.result.destinationTransactionHash}; never sign a replacement spend.`,
        );
        return;
      }
      if (error instanceof CircleBridgeIncompleteError) {
        if (!deliveryRetryLocked) setBridgeRecoveryResult(error.result);
        const telemetry = bridgeRecoveryTelemetry(error.result);
        bridgeRecoveryObservationPending.current = true;
        try {
          persistPendingBridgeRecovery(window.localStorage, program.id, activeIntent.id, telemetry);
        } catch {
          // Keep the bounded telemetry in this mounted session and show the source hashes below.
        }
        try {
          if (claimedOperationRecordId === undefined) throw error;
          await observeBridgeRecoveryTelemetry(
            activeIntent,
            telemetry,
            claimedOperationRecordId,
            destinationWalletClaimToken ??
              (() => {
                throw new Error('The Bridge wallet claim is unavailable for recovery observation.');
              })(),
          );
          bridgeRecoveryObservationPending.current = false;
          try {
            clearPendingBridgeRecovery(window.localStorage, program.id, activeIntent.id);
          } catch {
            // Server persistence succeeded; stale local outbox replay is idempotent.
          }
          setFundingPhase('source_submitted');
        } catch {
          setFundingPhase('source_submitted');
        }
        setFundingError(
          `${deliveryRetryLocked ? `${message} The bounded delivery retry result is incomplete, so automatic retry is now locked for manual recovery.` : canRetryBridgeResult(error.result) ? `${message} Continue delivery retries only Circle's failed step; the original burn will not be repeated.` : `${message} Circle did not mark the failed step retryable, so no replacement bridge will be submitted.`}${
            telemetry.sourceTransactionHashes.length === 0
              ? ''
              : ` Keep this page open until the server persists these original source hashes: ${telemetry.sourceTransactionHashes.join(', ')}.`
          }`,
        );
        return;
      }
      if (
        submissionLocked &&
        fundingSelection.routeMode === 'send' &&
        claimedOperationRecordId !== undefined &&
        isExplicitWalletRejection(error)
      ) {
        try {
          const released = await apiRequest(
            `/api/programs/${program.id}/funding-intents/${activeIntent.id}/destination-attempts/rejected`,
            fundingIntentResponseSchema,
            {
              method: 'POST',
              token: session?.access_token,
              body: releaseRejectedSendAttemptRequestSchema.parse({
                operationRecordId: claimedOperationRecordId,
                claimToken: destinationWalletClaimToken,
              }),
            },
          );
          const releasedIntent = verifiedIntentFromApi(released.data);
          setVerifiedFundingIntent(releasedIntent);
          setFundingPhase('awaiting_signature');
          setFundingError(
            'The Send signature was rejected before broadcast. Resume to retry the same locked signature step.',
          );
          return;
        } catch {
          try {
            const restored = await apiRequest(
              `/api/programs/${program.id}/funding-intents/${activeIntent.id}`,
              fundingIntentResponseSchema,
              { token: session?.access_token },
            );
            const releasedAttempt = restored.data.recoveryAttempts?.find(
              (attempt) => attempt.operationRecordId === claimedOperationRecordId,
            );
            if (
              restored.data.status === 'awaiting_signature' &&
              releasedAttempt?.status === 'awaiting_signature' &&
              releasedAttempt.transactionHash === undefined &&
              releasedAttempt.sourceTransactionHashes.length === 0
            ) {
              setVerifiedFundingIntent(verifiedIntentFromApi(restored.data));
              setFundingPhase('awaiting_signature');
              setFundingError(
                'The Send signature was rejected before broadcast. Resume to retry the same locked signature step.',
              );
              return;
            }
          } catch {
            // A second lost response remains fail-closed; the claim-bound observation RPC rejects
            // a row whose rejection release already cleared its wallet claim.
          }
        }
      }
      if (submissionLocked) {
        if (claimedOperationRecordId !== undefined) {
          try {
            const uncertainIntent = await observeUncertainSubmission(
              verifiedFundingIntent,
              claimedOperationRecordId,
              destinationWalletClaimToken ??
                (() => {
                  throw new Error('The destination wallet claim is unavailable.');
                })(),
            );
            setVerifiedFundingIntent(uncertainIntent);
          } catch {
            // The claimed operation remains durable; a reload will recover it without replay.
          }
        }
        setFundingPhase(fundingSubmissionFailurePhase(true));
        setFundingError(
          `${message} The wallet submission result is uncertain and has been durably locked for recovery. Reloading will not submit another transaction.`,
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
            fundingSelection.routeMode === 'send' && restored.data.status === 'ready_to_sign';
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

  async function leaveFundingConfirmation() {
    const cancellationHasNoIrreversibleEvidence =
      verifiedFundingIntent !== undefined &&
      verifiedFundingIntent.sourceDeposits.every(
        (deposit) =>
          deposit.transactionHash === undefined &&
          (deposit.status === 'awaiting_signature' || deposit.status === 'failed'),
      ) &&
      (verifiedFundingIntent.recovery === undefined ||
        (verifiedFundingIntent.recovery.status === 'awaiting_signature' &&
          !verifiedFundingIntent.recovery.submissionUncertain &&
          verifiedFundingIntent.recovery.sourceTransactionHashes.length === 0 &&
          verifiedFundingIntent.recovery.steps.every(
            (step) => step.transactionHash === undefined,
          )));
    if (
      verifiedFundingIntent !== undefined &&
      fundingSelection !== undefined &&
      cancellationHasNoIrreversibleEvidence &&
      (fundingPhase === 'ready_to_sign' || fundingPhase === 'awaiting_signature')
    ) {
      setFundingWorking(true);
      setFundingError(undefined);
      try {
        await apiRequest(
          `/api/programs/${program.id}/funding-intents/${verifiedFundingIntent.id}/cancel`,
          fundingIntentResponseSchema,
          { method: 'POST', token: session?.access_token },
        );
        setVerifiedFundingIntent(undefined);
        fundingIdempotencyKey.current = undefined;
        fundingDestinationAttemptKey.current = undefined;
        setFundingSelection(undefined);
        setFundingPendingDismissed(true);
        setFundingPhase('ready_to_sign');
        return;
      } catch (error) {
        setFundingError(
          error instanceof Error
            ? error.message
            : 'The funding intent could not be cancelled safely.',
        );
        return;
      } finally {
        setFundingWorking(false);
      }
    }
    if (
      verifiedFundingIntent?.routeMode === 'unified_balance' &&
      verifiedFundingIntent.fundingPhase === 'ready_for_destination'
    ) {
      // A UB intent that already owns deposit evidence cannot be discarded. Back returns to the
      // same locked source collection so a fresh quote/deficit can be checked without rewriting
      // confirmed attempts. The evidence-free branch above is the only path allowed to cancel.
      setFundingWorking(true);
      setFundingError(undefined);
      try {
        const reopened = await apiRequest(
          `/api/programs/${program.id}/funding-intents/${verifiedFundingIntent.id}/reopen-source-collection`,
          fundingIntentResponseSchema,
          { method: 'POST', token: session?.access_token },
        );
        const reopenedIntent = verifiedIntentFromApi(reopened.data);
        setVerifiedFundingIntent(reopenedIntent);
        setDepositStatuses(
          depositStatusesFromIntent(reopened.data, fundingSourcesFromApi(reopened.data)),
        );
        setFundingSelection(undefined);
        setFundingReadiness(undefined);
        setFundingPendingDismissed(true);
        setFundingPhase('ready_to_sign');
        return;
      } catch (error) {
        setFundingError(
          error instanceof Error
            ? error.message
            : 'Source collection could not be reopened safely.',
        );
        return;
      } finally {
        setFundingWorking(false);
      }
    }
    setFundingSelection(undefined);
    setFundingPendingDismissed(true);
    setFundingError(undefined);
    setFundingPhase('ready_to_sign');
  }

  /* CP-10 — Deploying escrow. Navigation and actions stay locked while Circle/Arc is pending. */
  if (
    deployMutation.isPending ||
    ['accepted', 'pending', 'verifying'].includes(deploymentStatus ?? '')
  ) {
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
    verifiedFundingIntent !== undefined &&
    fundingSelection !== undefined &&
    shouldRenderFundingPending(
      verifiedFundingIntent,
      fundingSelection,
      fundingPhase,
      fundingPendingDismissed,
    )
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
            onBack={() => void leaveFundingConfirmation()}
            onConnectWallet={() => void connectFundingWallet()}
            onContinue={() => void continueFundingOperation()}
            onRecoveryHashChange={setFundingRecoveryHash}
            phase={fundingPhase}
            result={fundingResult}
            recoveryHash={fundingRecoveryHash}
            selection={fundingSelection}
            intent={verifiedFundingIntent}
            verifiedRecipient={verifiedFundingIntent?.recipientAddress}
            walletAddress={walletSession?.address}
            walletMatchesIntent={walletMatchesVerifiedIntent}
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
          formError['readiness'] === undefined &&
          fundingError === undefined ? null : (
            <Callout title="Funding plan is not ready" variant="danger">
              {formError['wallet'] ??
                formError['escrow'] ??
                formError['unifiedBalance'] ??
                formError['readiness'] ??
                fundingError}
            </Callout>
          )}
          <FundingAllocations
            confirmedUnifiedBalance={confirmedUnifiedBalance}
            depositRequiredAmounts={depositRequiredAmounts}
            depositRecoveryHashes={depositRecoveryHashes}
            depositStatuses={depositStatuses}
            estimatedFeeReserve={verifiedFundingIntent?.estimatedFeeReserve}
            canSubmit={canSubmitFundingPlan}
            readinessChecked={fundingReadiness !== undefined}
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
            onCheckReadiness={() => void checkFundingReadiness()}
            pendingUnifiedBalance={pendingUnifiedBalance}
            program={program}
            sources={sources}
            transactionsEnabled={verifiedFundingIntent !== undefined && walletMatchesVerifiedIntent}
            working={fundingWorking}
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

        <Callout role="status" title="Canonical funding confirmed" variant="escrow">
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
              description="After the refund unlock, the platform admin closes the Arc escrow and withdraws only the unreserved USDC to the immutable recipient."
              title="Remaining escrow funds"
            >
              <div className="flex flex-col">
                <SummaryRow
                  label="Platform admin wallet"
                  value={
                    withdrawalIntent === undefined
                      ? 'Managed by the platform'
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
              <Callout variant="warning">
                Closing and withdrawing are privileged platform-admin operations. The backend
                submits and verifies both Arc transactions; this page never asks the program
                owner to connect or sign a contract-owner wallet.
              </Callout>
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
          <GuidancePanel eyebrow="Private draft" title="Not visible to researchers">
            <p className="text-label-sm uppercase text-text-muted">Escrow pool</p>
            <p className="text-h2 text-text">{formatUsdc(program.totalPool)}</p>
            <div className="flex flex-col">
              <SummaryRow label="Remaining" value={formatUsdc(program.remainingPool)} />
              {escrowSummary(program, chainLabel)}
            </div>
            <p className="text-label-sm uppercase text-text-muted">Next action</p>
            <p className="text-body-sm text-primary">
              {deployed
                ? 'Fund the reward pool'
                : deploymentFeeReady
                  ? 'Deploy escrow contract'
                  : 'Pay deployment fee'}
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

          {!deployed && !deploymentFeeReady ? (
            <Callout className="mt-lg" title="Deployment fee required" variant="warning">
              Request the server quote and pay the exact USDC amount to the verified platform
              recipient before escrow deployment can begin.
            </Callout>
          ) : null}

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
              <Button className="w-full sm:w-auto" onClick={() => setDeployOpen(true)} size="lg">
                {deploymentFeeReady ? 'Deploy escrow' : 'Pay deployment fee'}
              </Button>
            )}
            {deployed ? (
              <Button className="w-full sm:w-auto" onClick={() => setView('fund')} size="lg">
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
              Pay the server-quoted deployment fee from your connected wallet. The backend then
              deploys the versioned escrow artifact on Arc Testnet using the configured deployment
              wallet and platform-admin controls.
            </DialogDescription>
          </DialogHeader>

          {deploymentFeeError === undefined ? null : (
            <Callout title="Deployment fee needs attention" variant="danger">
              {deploymentFeeError}
            </Callout>
          )}
          {deploymentFeeNotice === undefined ? null : (
            <Callout title="Wallet action required" variant="warning">
              {deploymentFeeNotice}
            </Callout>
          )}

          <div className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-lg">
            <span className="text-label-md text-text-muted">Deployment fee</span>
            {deploymentFeeLoading || deploymentFeeQuoteMutation.isPending ? (
              <span className="text-body-sm text-text-muted">Loading a server quote…</span>
            ) : deploymentFeeQuote === undefined || deploymentFeeQuote.status === 'expired' ? (
              <>
                <span className="text-body-sm text-text-muted">
                  A verified quote is required before deployment.
                </span>
                <Button
                  className="w-fit"
                  loading={deploymentFeeQuoteMutation.isPending}
                  onClick={() => deploymentFeeQuoteMutation.mutate()}
                  size="md"
                  variant="secondary"
                >
                  Get fee quote
                </Button>
              </>
            ) : (
              <>
                <SummaryRow label="Amount" value={`${deploymentFeeQuote.amount} USDC`} />
                <SummaryRow label="Network" value={`Chain ${deploymentFeeQuote.chainId}`} />
                <SummaryRow
                  label="Recipient"
                  value={shortenAddress(deploymentFeeQuote.recipientAddress)}
                />
                <SummaryRow
                  label="Status"
                  value={
                    deploymentFeePaymentMutation.isPending
                      ? deploymentFeeStage === 'network'
                        ? 'Waiting for wallet network approval'
                        : deploymentFeeStage === 'approval'
                          ? 'Waiting for USDC approval'
                          : deploymentFeeStage === 'charge'
                            ? 'Waiting for fee charge'
                            : 'Payment verifying'
                      : deploymentFeeStatusLabel(deploymentFeeQuote.status)
                  }
                />
                {deploymentFeeReady ? null : walletSession === undefined ? (
                  <Button
                    className="w-fit"
                    loading={walletPending}
                    onClick={() => void connectFundingWallet()}
                    size="md"
                    variant="secondary"
                  >
                    Connect wallet to pay
                  </Button>
                ) : (
                  <Button
                    className="w-fit"
                    loading={deploymentFeePaymentMutation.isPending}
                    onClick={() => deploymentFeePaymentMutation.mutate()}
                    size="md"
                  >
                    Pay deployment fee
                  </Button>
                )}
              </>
            )}
          </div>

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
              disabled={
                !deploymentFeeReady ||
                deployMutation.isPending ||
                ['accepted', 'pending', 'verifying'].includes(deploymentStatus ?? '') ||
                deploymentFeePaymentMutation.isPending ||
                deployMutation.error instanceof DeploymentSupportRequiredError
              }
              onClick={() => {
                const next: Record<string, string> = {};
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
                  : deploymentFeeReady
                    ? 'Deploy escrow'
                    : 'Pay deployment fee first'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WizardShell>
  );
}
