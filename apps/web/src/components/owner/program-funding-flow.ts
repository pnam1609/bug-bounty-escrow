export const FUNDING_NETWORK_IDS = Object.freeze([
  'Arc_Testnet',
  'Ethereum_Sepolia',
  'Arbitrum_Sepolia',
  'Base_Sepolia',
] as const);

export type FundingNetworkId = (typeof FUNDING_NETWORK_IDS)[number];
export type FundingRouteMode = 'send' | 'bridge' | 'unified_balance';

export interface FundingNetwork {
  readonly id: FundingNetworkId;
  readonly label: string;
  readonly chainId: number;
  readonly gasToken: 'USDC' | 'testnet ETH';
}

export const FUNDING_NETWORKS: Readonly<Record<FundingNetworkId, FundingNetwork>> = Object.freeze({
  Arc_Testnet: {
    id: 'Arc_Testnet',
    label: 'Arc Testnet',
    chainId: 5_042_002,
    gasToken: 'USDC',
  },
  Ethereum_Sepolia: {
    id: 'Ethereum_Sepolia',
    label: 'Ethereum Sepolia',
    chainId: 11_155_111,
    gasToken: 'testnet ETH',
  },
  Arbitrum_Sepolia: {
    id: 'Arbitrum_Sepolia',
    label: 'Arbitrum Sepolia',
    chainId: 421_614,
    gasToken: 'testnet ETH',
  },
  Base_Sepolia: {
    id: 'Base_Sepolia',
    label: 'Base Sepolia',
    chainId: 84_532,
    gasToken: 'testnet ETH',
  },
});

export interface FundingSource {
  readonly rowId: string;
  readonly network: FundingNetworkId;
  readonly amount: string;
}

/**
 * Source rows remain spend allocations and must continue to sum to gross. A durable Gateway
 * deposit may be smaller (existing confirmed balance) or larger (that domain's explicit
 * provider/gas headroom), so wallet execution must use the exact server-returned deposit amount
 * without rewriting the spend allocation.
 */
export function fundingSourceForLockedDeposit(
  allocation: FundingSource,
  deposit: Pick<VerifiedFundingIntent['sourceDeposits'][number], 'network' | 'amount'>,
): FundingSource {
  if (
    allocation.network !== deposit.network ||
    (parseUsdcBaseUnits(deposit.amount) ?? 0n) <= 0n
  ) {
    throw new FundingIntentUnavailableError(
      'The server-verified source deposit does not match this allocation.',
    );
  }
  return { ...allocation, amount: deposit.amount };
}

export interface ValidatedFundingSelection {
  readonly grossAmount: string;
  readonly grossBaseUnits: bigint;
  readonly routeMode: FundingRouteMode;
  readonly sources: readonly FundingSource[];
}

export interface FundingSelectionValidation {
  readonly errors: Readonly<Record<string, string>>;
  readonly selection?: ValidatedFundingSelection;
}

export function parseUsdcBaseUnits(value: string): bigint | undefined {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (match === null) return undefined;

  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(6, '0');
  return BigInt(whole) * 1_000_000n + BigInt(fraction);
}

export function formatUsdcBaseUnits(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

export function deriveFundingRoute(
  sources: readonly Pick<FundingSource, 'network'>[],
): FundingRouteMode | undefined {
  if (sources.length === 0) return undefined;
  if (sources.length >= 2) return 'unified_balance';
  return sources[0]?.network === 'Arc_Testnet' ? 'send' : 'bridge';
}

export function fundingRouteLabel(routeMode: FundingRouteMode): string {
  if (routeMode === 'send') return 'Send on Arc';
  if (routeMode === 'bridge') return 'Bridge to Arc';
  return 'Unified Balance';
}

export function validateFundingSelection(
  grossAmount: string,
  sources: readonly FundingSource[],
): FundingSelectionValidation {
  const errors: Record<string, string> = {};
  const grossBaseUnits = parseUsdcBaseUnits(grossAmount);

  if (grossBaseUnits === undefined || grossBaseUnits <= 0n) {
    errors['grossAmount'] = 'Enter a positive USDC amount with at most 6 decimal places.';
  }
  if (sources.length === 0) {
    errors['sources'] = 'Add at least one funding source.';
  }
  if (sources.length > FUNDING_NETWORK_IDS.length) {
    errors['sources'] = 'At most four testnet sources are supported.';
  }

  const networks = new Set<FundingNetworkId>();
  let allocationBaseUnits = 0n;

  for (const source of sources) {
    const networkKey = `sources.${source.rowId}.network`;
    const amountKey = `sources.${source.rowId}.amount`;

    if (!FUNDING_NETWORK_IDS.includes(source.network)) {
      errors[networkKey] = 'Choose a supported testnet network.';
    } else if (networks.has(source.network)) {
      errors[networkKey] = 'Each network can only be selected once.';
    } else {
      networks.add(source.network);
    }

    const sourceBaseUnits = parseUsdcBaseUnits(source.amount);
    if (sourceBaseUnits === undefined || sourceBaseUnits <= 0n) {
      errors[amountKey] = 'Enter a positive USDC amount with at most 6 decimal places.';
    } else {
      allocationBaseUnits += sourceBaseUnits;
    }
  }

  if (
    grossBaseUnits !== undefined &&
    grossBaseUnits > 0n &&
    allocationBaseUnits !== grossBaseUnits
  ) {
    errors['sources.total'] = 'Source allocations must equal the gross funding amount.';
  }

  const routeMode = deriveFundingRoute(sources);
  if (Object.keys(errors).length > 0 || grossBaseUnits === undefined || routeMode === undefined) {
    return { errors };
  }

  return {
    errors,
    selection: {
      grossAmount: formatUsdcBaseUnits(grossBaseUnits),
      grossBaseUnits,
      routeMode,
      sources: sources.map((source) => ({ ...source })),
    },
  };
}

export interface BrowserWalletProvider {
  request(input: { readonly method: string; readonly params?: readonly unknown[] }): Promise<unknown>;
}

export function browserWalletProvider(): BrowserWalletProvider | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { ethereum?: BrowserWalletProvider }).ethereum;
}

/**
 * Must only be called from an explicit click/tap handler. It intentionally does not run during
 * hydration, so the browser never opens a wallet prompt without a user gesture.
 */
export async function connectBrowserWallet(
  provider: BrowserWalletProvider | undefined = browserWalletProvider(),
): Promise<string> {
  if (provider === undefined) {
    throw new Error('No EVM browser wallet was detected.');
  }

  const result = await provider.request({ method: 'eth_requestAccounts' });
  if (
    !Array.isArray(result) ||
    typeof result[0] !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(result[0])
  ) {
    throw new Error('The wallet did not return a valid EVM account.');
  }
  return result[0];
}

export type FundingOperationPhase =
  | 'ready_to_sign'
  | 'awaiting_signature'
  | 'source_submitted'
  | 'destination_submitted'
  | 'delivery_pending'
  | 'verifying_destination'
  | 'syncing_pool'
  | 'sync_failed'
  | 'complete';

export interface FundingExecutionRequest extends ValidatedFundingSelection {
  readonly fundingIntentId: string;
  readonly estimatedFeeReserveBaseUnits: bigint;
  readonly estimatedFeeReserveByNetwork: Readonly<Partial<Record<FundingNetworkId, string>>>;
  readonly walletAddress: string;
  readonly destinationChain: 'Arc_Testnet';
  readonly recipientAddress: string;
  readonly recipientVerified: true;
}

export interface FundingDestinationResult {
  readonly routeMode: FundingRouteMode;
  readonly destinationTransactionHash: string;
  readonly operationId?: string;
  readonly transferId?: string;
  readonly sourceTransactionHashes: readonly string[];
}

export interface FundingExecutionAdapter {
  readonly available: boolean;
  execute(
    request: FundingExecutionRequest,
    onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  ): Promise<FundingDestinationResult>;
}

/**
 * Keeps readiness and network-selection failures outside the durable no-replay boundary. Once
 * lockSubmissionBoundary resolves, every provider outcome is treated as potentially submitted.
 */
export async function executePreparedFundingSubmission<T>(
  prepare: () => Promise<void>,
  lockSubmissionBoundary: () => Promise<void>,
  submit: () => Promise<T>,
): Promise<T> {
  await prepare();
  await lockSubmissionBoundary();
  return submit();
}

export interface FundingFeeQuote {
  /** USDC deducted from the amount delivered to the Arc escrow. */
  readonly estimatedFeeReserve: string;
  readonly estimatedFeeReserveBaseUnits: bigint;
  readonly estimatedFeeReserveByNetwork: Readonly<Partial<Record<FundingNetworkId, string>>>;
  /** Short-lived client quote timestamp; the server persists the value on intent creation. */
  readonly quotedAt: string;
  readonly expiresAt: string;
}

export interface UnifiedBalanceReadinessSnapshot {
  readonly confirmedAmount: string;
  readonly pendingAmount: string;
  readonly confirmedByNetwork: Readonly<Partial<Record<FundingNetworkId, string>>>;
  readonly pendingByNetwork: Readonly<Partial<Record<FundingNetworkId, string>>>;
}

export function assertSelectedUnifiedBalanceReadiness(
  selection: Pick<ValidatedFundingSelection, 'sources'>,
  balance: UnifiedBalanceReadinessSnapshot,
  quote: Pick<FundingFeeQuote, 'estimatedFeeReserveByNetwork'>,
): void {
  const deficient = selectedUnifiedBalanceDeficientNetworks(selection, balance, quote);
  const network = deficient[0];
  if (network !== undefined) {
    throw new FundingIntentUnavailableError(
      `${FUNDING_NETWORKS[network].label} confirmed Unified Balance does not cover its locked allocation and source fees.`,
    );
  }
}

export function selectedUnifiedBalanceDeficientNetworks(
  selection: Pick<ValidatedFundingSelection, 'sources'>,
  balance: UnifiedBalanceReadinessSnapshot,
  quote: Pick<FundingFeeQuote, 'estimatedFeeReserveByNetwork'>,
): readonly FundingNetworkId[] {
  const deficient: FundingNetworkId[] = [];
  for (const source of selection.sources) {
    const confirmed =
      parseUsdcBaseUnits(balance.confirmedByNetwork[source.network] ?? '0') ?? 0n;
    const allocation = parseUsdcBaseUnits(source.amount) ?? 0n;
    const fee =
      parseUsdcBaseUnits(quote.estimatedFeeReserveByNetwork[source.network] ?? '0') ?? 0n;
    if (confirmed < allocation + fee) {
      deficient.push(source.network);
    }
  }
  return deficient;
}

export function assertFreshFundingQuoteMatchesIntent(
  intent: Pick<VerifiedFundingIntent, 'estimatedFeeReserve' | 'feeAllocations'>,
  quote: FundingFeeQuote,
  now = Date.now(),
): void {
  if (Date.parse(quote.expiresAt) <= now) {
    throw new FundingIntentUnavailableError(
      'The Circle funding quote expired. Refresh the plan before signing.',
    );
  }
  if (
    parseUsdcBaseUnits(intent.estimatedFeeReserve) !==
    quote.estimatedFeeReserveBaseUnits
  ) {
    throw new FundingIntentUnavailableError(
      'Circle fees changed after this funding intent was locked. Replace the intent with a refreshed quote before signing.',
    );
  }
  for (const allocation of intent.feeAllocations) {
    if (
      parseUsdcBaseUnits(allocation.amount) !==
      parseUsdcBaseUnits(quote.estimatedFeeReserveByNetwork[allocation.network] ?? '0')
    ) {
      throw new FundingIntentUnavailableError(
        'Circle per-network fees changed after this funding intent was locked. Refresh before signing.',
      );
    }
  }
}

export interface VerifiedFundingIntent {
  readonly id: string;
  readonly walletAddress: string;
  readonly routeMode: FundingRouteMode;
  readonly grossAmount: string;
  readonly estimatedFeeReserve: string;
  readonly feeAllocations: readonly {
    readonly network: FundingNetworkId;
    readonly amount: string;
  }[];
  readonly quoteQuotedAt?: string;
  readonly quoteExpiresAt?: string;
  readonly sources: readonly FundingSource[];
  readonly sourceDeposits: readonly {
    readonly id: string;
    readonly attemptNo: number;
    readonly replacesDepositId?: string;
    readonly network: FundingNetworkId;
    readonly amount: string;
    readonly status:
      | 'awaiting_signature'
      | 'submission_uncertain'
      | 'submitted'
      | 'onchain_verified'
      | 'gateway_finalized'
      | 'confirmed'
      | 'failed';
    readonly transactionHash?: string;
    readonly failureCode?: string;
    readonly canAttach: boolean;
    readonly canRetry: boolean;
  }[];
  readonly destinationChain: 'Arc_Testnet';
  readonly recipientAddress: string;
  readonly recipientVerified: true;
  readonly recovery?: {
    readonly providerState?: 'pending' | 'success' | 'error';
    readonly retryable: boolean;
    readonly submissionUncertain: boolean;
    readonly sourceTransactionHashes: readonly string[];
    readonly steps: readonly {
      readonly name: string;
      readonly state: 'pending' | 'success' | 'error';
      readonly transactionHash?: string;
      readonly errorCode?: string;
    }[];
  };
}

export type SourceDepositContinuationAction =
  | 'create'
  | 'execute_claimed'
  | 'replace'
  | 'observe_local_hash'
  | 'attach_manual_hash'
  | 'reconcile'
  | 'complete'
  | 'recovery_required';

export function sourceDepositContinuationAction(
  deposit: VerifiedFundingIntent['sourceDeposits'][number] | undefined,
  localTransactionHash: string | undefined,
  manualTransactionHash: string | undefined,
): SourceDepositContinuationAction {
  if (deposit === undefined) return 'create';
  if (deposit.status === 'confirmed') return 'complete';
  if (deposit.status === 'failed') {
    return deposit.canRetry ? 'replace' : 'recovery_required';
  }
  if (deposit.transactionHash !== undefined) return 'reconcile';
  if (localTransactionHash !== undefined) return 'observe_local_hash';
  if (manualTransactionHash !== undefined && manualTransactionHash.trim() !== '') {
    return 'attach_manual_hash';
  }
  if (deposit.status === 'awaiting_signature') return 'execute_claimed';
  return 'recovery_required';
}

export class FundingIntentUnavailableError extends Error {
  constructor(message = 'A server-verified funding intent is required before signing.') {
    super(message);
    this.name = 'FundingIntentUnavailableError';
  }
}

function sameFundingSources(
  left: readonly FundingSource[],
  right: readonly FundingSource[],
): boolean {
  return (
    left.length === right.length &&
    left.every((source, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        source.network === candidate.network &&
        parseUsdcBaseUnits(source.amount) === parseUsdcBaseUnits(candidate.amount)
      );
    })
  );
}

/**
 * The only frontend entry point allowed to start a destination transfer. A program contract
 * address from the legacy deploy response is not enough: the recipient must come back locked and
 * verified in the server funding intent.
 */
export async function executeVerifiedFundingIntent(
  intent: VerifiedFundingIntent | undefined,
  selection: ValidatedFundingSelection,
  connectedWallet: string,
  executor: FundingExecutionAdapter,
  onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  freshQuote?: FundingFeeQuote,
): Promise<FundingDestinationResult> {
  if (intent === undefined) throw new FundingIntentUnavailableError();
  if (
    intent.recipientVerified !== true ||
    intent.destinationChain !== 'Arc_Testnet' ||
    intent.walletAddress.toLowerCase() !== connectedWallet.toLowerCase() ||
    intent.routeMode !== selection.routeMode ||
    parseUsdcBaseUnits(intent.grossAmount) !== selection.grossBaseUnits ||
    !sameFundingSources(intent.sources, selection.sources)
  ) {
    throw new FundingIntentUnavailableError(
      'The connected wallet or funding plan no longer matches the server-verified intent.',
    );
  }
  if (
    selection.routeMode === 'unified_balance' &&
    freshQuote === undefined
  ) {
    throw new FundingIntentUnavailableError(
      'A fresh per-network Unified Balance fee quote is required before signing.',
    );
  }

  return executor.execute(
    {
      ...selection,
      fundingIntentId: intent.id,
      estimatedFeeReserveBaseUnits:
        parseUsdcBaseUnits(intent.estimatedFeeReserve) ?? 0n,
      estimatedFeeReserveByNetwork:
        freshQuote?.estimatedFeeReserveByNetwork ?? {},
      walletAddress: connectedWallet,
      destinationChain: intent.destinationChain,
      recipientAddress: intent.recipientAddress,
      recipientVerified: true,
    },
    onPhase,
  );
}

export class FundingIntegrationUnavailableError extends Error {
  constructor() {
    super(
      'Circle App Kit execution is not configured. No transaction was submitted. Add the funding-intent and verification API before enabling signing.',
    );
    this.name = 'FundingIntegrationUnavailableError';
  }
}

/**
 * CP-12's frontend boundary is deliberately non-operational until the server-owned CP-13 funding
 * intent, durable operation state and destination verification endpoints exist. Returning a fake
 * transaction here would let the UI claim escrow guarantees that the backend cannot prove.
 */
export const unavailableFundingExecutionAdapter: FundingExecutionAdapter = {
  available: false,
  async execute() {
    throw new FundingIntegrationUnavailableError();
  },
};

export function fundingRecoveryAction(phase: FundingOperationPhase): string | undefined {
  if (phase === 'ready_to_sign' || phase === 'awaiting_signature') return 'Resume signatures';
  if (phase === 'source_submitted') return 'Check delivery recovery';
  if (phase === 'destination_submitted' || phase === 'delivery_pending') return 'Continue delivery';
  if (phase === 'verifying_destination') return 'Continue verification';
  if (phase === 'sync_failed') return 'Retry sync';
  return undefined;
}

export function fundingSourceSubmittedRecoveryMessage(routeMode: FundingRouteMode): string {
  if (routeMode === 'send') {
    return 'The Arc Send result is unavailable. Attach the original transaction hash or use support recovery; this screen will never submit another Send while the attempt is uncertain.';
  }
  if (routeMode === 'bridge') {
    return 'The source burn is preserved, but Circle App Kit requires the original in-memory BridgeResult for a documented retry. Continue in the original session or recover the CCTP mint manually; this screen will never submit another burn.';
  }
  return 'The Unified Balance source operation is preserved, but Circle App Kit does not expose a documented retrySpend recovery from bounded persisted steps. Recover the original message/mint manually; this screen will never submit another spend.';
}

export function canStartDestinationOperation(phase: FundingOperationPhase): boolean {
  return phase === 'ready_to_sign' || phase === 'awaiting_signature';
}

export type FundingContinuationAction =
  | 'execute'
  | 'observe_destination'
  | 'retry_bridge'
  | 'recovery_required'
  | 'reconcile';

export function fundingContinuationAction(
  phase: FundingOperationPhase,
  hasInMemoryBridgeResult: boolean,
  hasPendingDestinationResult = false,
): FundingContinuationAction {
  if (hasPendingDestinationResult) return 'observe_destination';
  if (canStartDestinationOperation(phase)) return 'execute';
  if (phase === 'source_submitted') {
    return hasInMemoryBridgeResult ? 'retry_bridge' : 'recovery_required';
  }
  return 'reconcile';
}

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function assertFundingRecoveryStorage(storage: Storage): void {
  const probe = 'bounty-escrow:funding:probe';
  storage.setItem(probe, '1');
  storage.removeItem(probe);
}

function pendingFundingResultKey(programId: string, intentId: string) {
  return `bounty-escrow:funding:${programId}:${intentId}:destination`;
}

export function persistPendingFundingResult(
  storage: Storage,
  programId: string,
  intentId: string,
  result: FundingDestinationResult,
): void {
  storage.setItem(pendingFundingResultKey(programId, intentId), JSON.stringify(result));
}

export function readPendingFundingResult(
  storage: Storage,
  programId: string,
  intentId: string,
): FundingDestinationResult | undefined {
  const raw = storage.getItem(pendingFundingResultKey(programId, intentId));
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<FundingDestinationResult>;
    if (
      !['send', 'bridge', 'unified_balance'].includes(value.routeMode ?? '') ||
      typeof value.destinationTransactionHash !== 'string' ||
      !TRANSACTION_HASH_PATTERN.test(value.destinationTransactionHash) ||
      !Array.isArray(value.sourceTransactionHashes) ||
      !value.sourceTransactionHashes.every(
        (hash) => typeof hash === 'string' && TRANSACTION_HASH_PATTERN.test(hash),
      )
    ) {
      return undefined;
    }
    return {
      routeMode: value.routeMode!,
      destinationTransactionHash: value.destinationTransactionHash,
      sourceTransactionHashes: value.sourceTransactionHashes as string[],
      ...(typeof value.operationId === 'string' ? { operationId: value.operationId } : {}),
      ...(typeof value.transferId === 'string' ? { transferId: value.transferId } : {}),
    };
  } catch {
    return undefined;
  }
}

export function clearPendingFundingResult(
  storage: Storage,
  programId: string,
  intentId: string,
): void {
  storage.removeItem(pendingFundingResultKey(programId, intentId));
}

function pendingSourceDepositKey(programId: string, intentId: string, depositId: string) {
  return `bounty-escrow:funding:${programId}:${intentId}:deposit:${depositId}`;
}

export function persistPendingSourceDepositHash(
  storage: Storage,
  programId: string,
  intentId: string,
  depositId: string,
  transactionHash: string,
): void {
  if (!TRANSACTION_HASH_PATTERN.test(transactionHash)) {
    throw new Error('Invalid Unified Balance deposit transaction hash.');
  }
  storage.setItem(
    pendingSourceDepositKey(programId, intentId, depositId),
    transactionHash.toLowerCase(),
  );
}

export function readPendingSourceDepositHash(
  storage: Storage,
  programId: string,
  intentId: string,
  depositId: string,
): string | undefined {
  const value = storage.getItem(pendingSourceDepositKey(programId, intentId, depositId));
  return value !== null && TRANSACTION_HASH_PATTERN.test(value) ? value : undefined;
}

export function clearPendingSourceDepositHash(
  storage: Storage,
  programId: string,
  intentId: string,
  depositId: string,
): void {
  storage.removeItem(pendingSourceDepositKey(programId, intentId, depositId));
}

export function fundingSubmissionFailurePhase(
  submissionLocked: boolean,
): 'source_submitted' | 'awaiting_signature' | 'delivery_pending' {
  if (submissionLocked) return 'source_submitted';
  return 'awaiting_signature';
}
