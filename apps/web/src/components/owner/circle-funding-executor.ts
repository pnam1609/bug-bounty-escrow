import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import {
  AppKit,
  isRetryableError,
  type BridgeResult,
} from '@circle-fin/app-kit';
import {
  ArbitrumSepolia,
  ArcTestnet,
  BaseSepolia,
  EthereumSepolia,
} from '@circle-fin/app-kit/chains';
import { encodeFunctionData, type EIP1193Provider } from 'viem';

import {
  FUNDING_NETWORK_IDS,
  FUNDING_NETWORKS,
  assertSelectedUnifiedBalanceReadiness,
  formatUsdcBaseUnits,
  parseUsdcBaseUnits,
  type FundingDestinationResult,
  type FundingExecutionAdapter,
  type FundingExecutionRequest,
  type FundingFeeQuote,
  type FundingNetworkId,
  type FundingOperationPhase,
  type FundingSource,
  type UnifiedBalanceReadinessSnapshot,
} from './program-funding-flow';

const SUPPORTED_CHAINS = [
  EthereumSepolia,
  ArbitrumSepolia,
  BaseSepolia,
  ArcTestnet,
] as const;

const CHAIN_BY_ID = {
  Arc_Testnet: ArcTestnet,
  Ethereum_Sepolia: EthereumSepolia,
  Arbitrum_Sepolia: ArbitrumSepolia,
  Base_Sepolia: BaseSepolia,
} as const;
const ESCROW_OWNER_ABI = [
  {
    type: 'function',
    name: 'close',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawRemaining',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'expectedAmount', type: 'uint256' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
] as const;
const ERC20_READ_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'uint8' }],
  },
] as const;

export interface DiscoveredEvmWallet {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly provider: EIP1193Provider;
}

interface Eip6963ProviderDetail {
  readonly info: {
    readonly icon: string;
    readonly name: string;
    readonly rdns: string;
    readonly uuid: string;
  };
  readonly provider: EIP1193Provider;
}

export type UnifiedBalanceSnapshot = UnifiedBalanceReadinessSnapshot;

export interface UnifiedBalanceDepositResult {
  readonly network: FundingNetworkId;
  readonly transactionHash: string;
}

export interface BridgeRecoveryTelemetry {
  readonly providerState: 'pending' | 'success' | 'error';
  readonly retryable: boolean;
  readonly submissionUncertain: false;
  readonly sourceTransactionHashes: readonly string[];
  readonly steps: readonly {
    readonly name: string;
    readonly state: 'pending' | 'success' | 'error';
    readonly transactionHash?: string;
    readonly errorCode?: string;
  }[];
}

/**
 * EIP-6963 discovery is event based. The short collection window runs only after the owner clicks
 * Connect/Change wallet; it never causes an account permission prompt during page hydration.
 */
export async function discoverEvmWallets(): Promise<readonly DiscoveredEvmWallet[]> {
  if (typeof window === 'undefined') return [];

  const discovered = new Map<string, DiscoveredEvmWallet>();
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.provider === undefined || detail.info === undefined) return;
    discovered.set(detail.info.uuid, {
      id: detail.info.uuid,
      name: detail.info.name,
      icon: detail.info.icon,
      provider: detail.provider,
    });
  };

  window.addEventListener('eip6963:announceProvider', listener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => window.setTimeout(resolve, 120));
  window.removeEventListener('eip6963:announceProvider', listener);

  const legacy = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (legacy !== undefined && discovered.size === 0) {
    discovered.set('legacy-injected', {
      id: 'legacy-injected',
      name: 'Browser wallet',
      provider: legacy,
    });
  }
  return [...discovered.values()];
}

export interface CircleWalletSession {
  readonly address: string;
  readonly wallet: DiscoveredEvmWallet;
  readonly executor: CircleAppKitFundingExecutor;
}

async function createCircleViemAdapter(provider: EIP1193Provider) {
  return createViemAdapterFromProvider({
    provider,
    capabilities: {
      addressContext: 'user-controlled',
      supportedChains: SUPPORTED_CHAINS,
    },
  });
}

export async function connectCircleWallet(
  selectedWallet?: DiscoveredEvmWallet,
): Promise<CircleWalletSession> {
  const wallet = selectedWallet ?? (await discoverEvmWallets())[0];
  if (wallet === undefined) throw new Error('No EVM browser wallet was detected.');

  const accounts = await wallet.provider.request({
    method: 'eth_requestAccounts',
    params: undefined,
  });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])
  ) {
    throw new Error('The wallet did not return a valid EVM account.');
  }

  const adapter = await createCircleViemAdapter(wallet.provider);

  return {
    address: accounts[0],
    wallet,
    executor: new CircleAppKitFundingExecutor(adapter, wallet.provider, accounts[0]),
  };
}

type CircleViemAdapter = Awaited<ReturnType<typeof createCircleViemAdapter>>;

export class CircleAppKitFundingExecutor implements FundingExecutionAdapter {
  readonly available = true;
  readonly #kit = new AppKit();

  constructor(
    readonly adapter: CircleViemAdapter,
    private readonly provider: EIP1193Provider,
    private readonly connectedAddress: string,
  ) {}

  async closeEscrow(
    provider: EIP1193Provider,
    ownerAddress: string,
    escrowAddress: string,
  ): Promise<string> {
    return this.#executeEscrowOwnerCall(provider, ownerAddress, escrowAddress, 'close');
  }

  async withdrawRemaining(
    provider: EIP1193Provider,
    ownerAddress: string,
    escrowAddress: string,
    expectedAmountBaseUnits: bigint,
  ): Promise<string> {
    return this.#executeEscrowOwnerCall(
      provider,
      ownerAddress,
      escrowAddress,
      'withdrawRemaining',
      expectedAmountBaseUnits,
    );
  }

  async prepareEscrowOwnerCall(
    provider: EIP1193Provider,
    ownerAddress: string,
    escrowAddress: string,
    functionName: 'close' | 'withdrawRemaining',
    expectedAmountBaseUnits?: bigint,
  ): Promise<void> {
    await assertConnectedWalletAccount(provider, ownerAddress);
    if (!/^0x[0-9a-fA-F]{40}$/.test(ownerAddress) || !/^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) {
      throw new Error('The owner or escrow address is invalid.');
    }
    await this.adapter.ensureChain(ArcTestnet);
    const chainId = await provider.request({ method: 'eth_chainId', params: undefined });
    if (typeof chainId !== 'string' || Number.parseInt(chainId, 16) !== 5_042_002) {
      throw new Error('The wallet is not connected to Arc Testnet.');
    }
    const data = encodeEscrowOwnerCall(functionName, expectedAmountBaseUnits);
    await assertProviderTransactionGasReady(provider, {
      from: ownerAddress,
      to: escrowAddress,
      data,
      value: '0x0',
    });
  }

  async #executeEscrowOwnerCall(
    provider: EIP1193Provider,
    ownerAddress: string,
    escrowAddress: string,
    functionName: 'close' | 'withdrawRemaining',
    expectedAmountBaseUnits?: bigint,
  ): Promise<string> {
    // Revalidate again immediately before eth_sendTransaction in case the active account changed
    // after the pre-boundary readiness check.
    await this.prepareEscrowOwnerCall(
      provider,
      ownerAddress,
      escrowAddress,
      functionName,
      expectedAmountBaseUnits,
    );
    const data = encodeEscrowOwnerCall(functionName, expectedAmountBaseUnits);
    const result = await provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: ownerAddress as `0x${string}`,
          to: escrowAddress as `0x${string}`,
          data,
          value: '0x0',
        },
      ],
    });
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
      throw new Error('The wallet did not return a valid Arc transaction hash.');
    }
    return result;
  }

  async depositUnifiedBalanceSource(source: FundingSource): Promise<UnifiedBalanceDepositResult> {
    await assertConnectedWalletAccount(this.provider, this.connectedAddress);
    // CP-11 already selected this chain before its durable boundary. Keep the second call as a
    // defensive no-op in the normal path; if the wallet changed in the tiny race window, the
    // operation remains uncertain and must not be blindly replayed.
    await this.adapter.ensureChain(CHAIN_BY_ID[source.network]);
    const result = await this.#kit.unifiedBalance.deposit({
      from: { adapter: this.adapter, chain: source.network },
      amount: source.amount,
      token: 'USDC',
    });

    return {
      network: source.network,
      transactionHash: result.txHash,
    };
  }

  async prepareUnifiedBalanceDepositSource(source: FundingSource): Promise<void> {
    // Everything that can fail without submitting a transaction belongs before CP-11 persists
    // submission_uncertain. In particular, a rejected network switch must leave the durable
    // source operation at awaiting_signature so it remains safely retryable.
    await assertConnectedWalletAccount(this.provider, this.connectedAddress);
    await this.assertFundingSourceBalances([source]);
    await this.adapter.ensureChain(CHAIN_BY_ID[source.network]);
    await this.#assertDepositNativeGasReady(source);
  }

  async getUnifiedBalance(): Promise<UnifiedBalanceSnapshot> {
    const result = await this.#kit.unifiedBalance.getBalances({
      sources: { adapter: this.adapter },
      networkType: 'testnet',
      includePending: true,
      token: 'USDC',
    });
    const confirmedByNetwork: Partial<Record<FundingNetworkId, bigint>> = {};
    const pendingByNetwork: Partial<Record<FundingNetworkId, bigint>> = {};
    for (const account of result.breakdown) {
      if (account.depositor.toLowerCase() !== this.connectedAddress.toLowerCase()) continue;
      for (const chain of account.breakdown) {
        if (!FUNDING_NETWORK_IDS.includes(chain.chain as FundingNetworkId)) continue;
        const network = chain.chain as FundingNetworkId;
        confirmedByNetwork[network] =
          (confirmedByNetwork[network] ?? 0n) +
          (parseUsdcBaseUnits(chain.confirmedBalance) ?? 0n);
        pendingByNetwork[network] =
          (pendingByNetwork[network] ?? 0n) +
          (parseUsdcBaseUnits(chain.pendingBalance ?? '0') ?? 0n);
      }
    }
    return {
      confirmedAmount: formatUsdcBaseUnits(sumNetworkAmounts(confirmedByNetwork)),
      pendingAmount: formatUsdcBaseUnits(sumNetworkAmounts(pendingByNetwork)),
      confirmedByNetwork: formatNetworkAmounts(confirmedByNetwork),
      pendingByNetwork: formatNetworkAmounts(pendingByNetwork),
    };
  }

  async estimateFunding(
    selection: Pick<FundingExecutionRequest, 'routeMode' | 'sources' | 'grossAmount'>,
    recipientAddress: string,
  ): Promise<FundingFeeQuote> {
    await assertConnectedWalletAccount(this.provider, this.connectedAddress);
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
      throw new Error('A verified Arc escrow recipient is required to estimate funding.');
    }
    // Unified Balance may already contain enough confirmed USDC. Source-wallet balance is checked
    // only when the owner explicitly deposits that source, never as a prerequisite to spending an
    // already-confirmed Gateway balance.
    if (requiresSourceWalletBalanceCheck(selection.routeMode)) {
      await this.assertFundingSourceBalances(selection.sources);
    }

    let reserveBaseUnits = 0n;
    let reserveByNetwork: Readonly<Partial<Record<FundingNetworkId, string>>> =
      Object.fromEntries(selection.sources.map((source) => [source.network, '0']));
    if (selection.routeMode === 'send') {
      await this.adapter.ensureChain(ArcTestnet);
      const estimate = await this.#kit.estimateSend({
        from: { adapter: this.adapter, chain: 'Arc_Testnet' },
        to: recipientAddress,
        amount: selection.grossAmount,
        token: 'USDC',
      });
      await this.#assertNativeGasReady(
        'Arc_Testnet',
        estimate.fee,
        parseUsdcBaseUnits(selection.grossAmount),
      );
    } else if (selection.routeMode === 'bridge') {
      const source = selection.sources[0];
      if (source === undefined || source.network === 'Arc_Testnet') {
        throw new Error('Bridge estimation requires one non-Arc source.');
      }
      const estimate = await this.#kit.estimateBridge({
        from: { adapter: this.adapter, chain: source.network },
        to: {
          adapter: this.adapter,
          chain: 'Arc_Testnet',
          recipientAddress,
        },
        amount: selection.grossAmount,
        token: 'USDC',
      });
      for (const gasFee of estimate.gasFees) {
        if (gasFee.error !== undefined || gasFee.fees === null) {
          throw new Error(`Circle could not estimate ${gasFee.name} gas. Try again before signing.`);
        }
      }
      const sourceGas = estimate.gasFees.find(
        (entry) => entry.blockchain === CHAIN_BY_ID[source.network].chain,
      );
      if (sourceGas === undefined || sourceGas.fees === null) {
        throw new Error('Circle did not return the source-chain gas estimate.');
      }
      await this.#assertNativeGasReady(source.network, sourceGas.fees.fee);
      reserveBaseUnits = sumUsdcFees(
        estimate.fees.map((fee) => ({ token: fee.token, amount: fee.amount, error: fee.error })),
      );
      reserveByNetwork = {
        [source.network]: formatUsdcBaseUnits(reserveBaseUnits),
      };
    } else {
      const estimate = await this.#kit.unifiedBalance.estimateSpend({
        amount: selection.grossAmount,
        token: 'USDC',
        from: {
          adapter: this.adapter,
          allocations: selection.sources.map((source) => ({
            amount: source.amount,
            chain: source.network,
          })),
        },
        to: {
          adapter: this.adapter,
          chain: 'Arc_Testnet',
          recipientAddress,
        },
      });
      reserveBaseUnits = unifiedBalanceSourceDebitFeeTotal(estimate.fees);
      reserveByNetwork = unifiedBalanceFeeReserveByNetwork(
        estimate.fees,
        selection.sources.map((source) => source.network),
      );
    }

    const quotedAt = new Date();
    return {
      estimatedFeeReserve: formatUsdcBaseUnits(reserveBaseUnits),
      estimatedFeeReserveBaseUnits: reserveBaseUnits,
      estimatedFeeReserveByNetwork: reserveByNetwork,
      quotedAt: quotedAt.toISOString(),
      expiresAt: new Date(quotedAt.getTime() + 2 * 60_000).toISOString(),
    };
  }

  async assertFundingSourceBalances(
    sources: readonly Pick<FundingSource, 'network' | 'amount'>[],
  ): Promise<void> {
    await assertConnectedWalletAccount(this.provider, this.connectedAddress);
    await Promise.all(
      sources.map(async (source) => {
        const chain = CHAIN_BY_ID[source.network];
        const address = await this.adapter.getAddress(chain);
        if (address.toLowerCase() !== this.connectedAddress.toLowerCase()) {
          throw new Error(
            `${FUNDING_NETWORKS[source.network].label} resolved a different wallet account. Reconnect before signing.`,
          );
        }
        const tokenAddress = chain.usdcAddress;
        const [balance, decimals] = await Promise.all([
          this.adapter.readContract<bigint>(
            {
              address: tokenAddress,
              abi: ERC20_READ_ABI,
              functionName: 'balanceOf',
              args: [address],
            },
            chain,
          ),
          this.adapter.readContract<number>(
            {
              address: tokenAddress,
              abi: ERC20_READ_ABI,
              functionName: 'decimals',
              args: [],
            },
            chain,
          ),
        ]);
        if (typeof balance !== 'bigint' || decimals !== 6) {
          throw new Error(
            `Canonical USDC balance evidence is invalid on ${FUNDING_NETWORKS[source.network].label}.`,
          );
        }
        const required = parseUsdcBaseUnits(source.amount);
        if (required === undefined || balance < required) {
          throw new Error(
            `${FUNDING_NETWORKS[source.network].label} does not have enough canonical USDC for its ${source.amount} USDC allocation.`,
          );
        }
      }),
    );
  }

  async #assertNativeGasReady(
    network: FundingNetworkId,
    requiredBaseUnits: string,
    arcUsdcDebitBaseUnits?: bigint,
  ): Promise<void> {
    if (!/^\d+$/.test(requiredBaseUnits)) {
      throw new Error(`Circle returned an invalid gas estimate for ${FUNDING_NETWORKS[network].label}.`);
    }
    const chain = CHAIN_BY_ID[network];
    const address = await this.adapter.getAddress(chain);
    const balance = await this.adapter.readNativeBalance(address, chain);
    const required =
      network === 'Arc_Testnet' && arcUsdcDebitBaseUnits !== undefined
        ? arcCombinedNativeDebitBaseUnits(
            arcUsdcDebitBaseUnits,
            BigInt(requiredBaseUnits),
          )
        : BigInt(requiredBaseUnits);
    if (balance < required) {
      throw new Error(
        network === 'Arc_Testnet' && arcUsdcDebitBaseUnits !== undefined
          ? 'Arc Testnet needs enough shared USDC balance for the transfer amount and native gas before signing.'
          : `${FUNDING_NETWORKS[network].label} needs more ${FUNDING_NETWORKS[network].gasToken} for gas before signing.`,
      );
    }
  }

  async #assertDepositNativeGasReady(
    source: Pick<FundingSource, 'network' | 'amount'>,
  ): Promise<void> {
    const network = source.network;
    const chain = CHAIN_BY_ID[network];
    const address = await this.adapter.getAddress(chain);
    const [gasLimitValue, gasPriceValue] = await Promise.all([
      this.provider.request({
        method: 'eth_estimateGas',
        params: [{ from: address, to: address, value: '0x0' }],
      } as never),
      this.provider.request({ method: 'eth_gasPrice', params: undefined }),
    ]);
    const baselineGas = parseRpcQuantity(gasLimitValue, 'source-chain gas estimate');
    const gasPrice = parseRpcQuantity(gasPriceValue, 'source-chain gas price');
    // Deposit may include approval/permit plus Gateway deposit. App Kit 1.10 does not expose
    // estimateDeposit, so use a deliberately conservative multiplier over a live chain estimate
    // and keep this check before the durable submission boundary.
    const conservativeRequired = baselineGas * gasPrice * 20n;
    await this.#assertNativeGasReady(
      network,
      conservativeRequired.toString(),
      network === 'Arc_Testnet' ? parseUsdcBaseUnits(source.amount) : undefined,
    );
  }

  async execute(
    request: FundingExecutionRequest,
    onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  ): Promise<FundingDestinationResult> {
    await assertConnectedWalletAccount(this.provider, this.connectedAddress);
    if (request.routeMode === 'send') return this.#send(request, onPhase);
    if (request.routeMode === 'bridge') return this.#bridge(request, onPhase);
    return this.#spendUnifiedBalance(request, onPhase);
  }

  async retryBridge(
    result: BridgeResult,
    onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  ): Promise<FundingDestinationResult> {
    if (!canRetryBridgeResult(result)) {
      throw new Error(
        'Circle did not classify the incomplete bridge as retryable. The original transfer was preserved.',
      );
    }

    await onPhase('delivery_pending');
    const retried = await this.#kit.retryBridge(result, {
      from: this.adapter,
      to: this.adapter,
    });
    await onPhase(retried.state === 'pending' ? 'delivery_pending' : 'destination_submitted');
    return bridgeDestinationResult(retried);
  }

  async #send(
    request: FundingExecutionRequest,
    onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  ): Promise<FundingDestinationResult> {
    await this.adapter.ensureChain(ArcTestnet);
    // A rejected network switch is not an uncertain transaction submission. Persist the
    // no-replay boundary only after the wallet is already on the required chain.
    await onPhase('awaiting_signature');
    const result = await this.#kit.send({
      from: { adapter: this.adapter, chain: 'Arc_Testnet' },
      to: request.recipientAddress,
      amount: request.grossAmount,
      token: 'USDC',
    });
    if (result.txHash === undefined) {
      throw new Error('Circle Send completed without a destination transaction hash.');
    }
    await onPhase('destination_submitted');
    return {
      routeMode: 'send',
      destinationTransactionHash: result.txHash,
      sourceTransactionHashes: [result.txHash],
    };
  }

  async #bridge(
    request: FundingExecutionRequest,
    onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  ): Promise<FundingDestinationResult> {
    const source = request.sources[0];
    if (source === undefined || source.network === 'Arc_Testnet') {
      throw new Error('Bridge requires exactly one non-Arc source.');
    }

    await this.adapter.ensureChain(CHAIN_BY_ID[source.network]);
    // Keep chain selection outside the durable transaction-submission boundary. The composite
    // Bridge call below may submit approve/burn operations, so errors after this point stay locked.
    await onPhase('awaiting_signature');
    const result = await this.#kit.bridge({
      from: { adapter: this.adapter, chain: source.network },
      to: {
        adapter: this.adapter,
        chain: 'Arc_Testnet',
        recipientAddress: request.recipientAddress,
      },
      amount: request.grossAmount,
      token: 'USDC',
    });
    await onPhase(result.state === 'pending' ? 'delivery_pending' : 'destination_submitted');
    return bridgeDestinationResult(result);
  }

  async #spendUnifiedBalance(
    request: FundingExecutionRequest,
    onPhase: (phase: FundingOperationPhase) => void | Promise<void>,
  ): Promise<FundingDestinationResult> {
    const balance = await this.getUnifiedBalance();
    assertSelectedUnifiedBalanceReadiness(
      request,
      balance,
      { estimatedFeeReserveByNetwork: request.estimatedFeeReserveByNetwork },
    );

    await onPhase('awaiting_signature');
    const result = await this.#kit.unifiedBalance.spend({
      amount: request.grossAmount,
      token: 'USDC',
      from: {
        adapter: this.adapter,
        allocations: request.sources.map((source) => ({
          amount: source.amount,
          chain: source.network,
        })),
      },
      to: {
        adapter: this.adapter,
        chain: 'Arc_Testnet',
        recipientAddress: request.recipientAddress,
      },
    });
    await onPhase('destination_submitted');
    return {
      routeMode: 'unified_balance',
      destinationTransactionHash: result.txHash,
      ...(result.transferId === undefined ? {} : { transferId: result.transferId }),
      sourceTransactionHashes: result.steps?.flatMap((step) => step.txHash ?? []) ?? [],
    };
  }
}

export function arcCombinedNativeDebitBaseUnits(
  canonicalUsdcBaseUnits: bigint,
  nativeGasBaseUnits: bigint,
): bigint {
  return canonicalUsdcBaseUnits * 1_000_000_000_000n + nativeGasBaseUnits;
}

function encodeEscrowOwnerCall(
  functionName: 'close' | 'withdrawRemaining',
  expectedAmountBaseUnits?: bigint,
): `0x${string}` {
  return functionName === 'withdrawRemaining'
    ? encodeFunctionData({
        abi: ESCROW_OWNER_ABI,
        functionName,
        args: [requireExpectedWithdrawalAmount(expectedAmountBaseUnits)],
      })
    : encodeFunctionData({ abi: ESCROW_OWNER_ABI, functionName });
}

function requireExpectedWithdrawalAmount(value: bigint | undefined): bigint {
  if (value === undefined || value <= 0n) {
    throw new Error('A positive server-verified withdrawal amount is required.');
  }
  return value;
}

async function assertProviderTransactionGasReady(
  provider: EIP1193Provider,
  transaction: Readonly<{
    from: string;
    to: string;
    data: `0x${string}`;
    value: '0x0';
  }>,
): Promise<void> {
  const [gasLimitValue, gasPriceValue, balanceValue] = await Promise.all([
    provider.request({ method: 'eth_estimateGas', params: [transaction] } as never),
    provider.request({ method: 'eth_gasPrice', params: undefined }),
    provider.request({
      method: 'eth_getBalance',
      params: [transaction.from, 'latest'],
    } as never),
  ]);
  const gasLimit = parseRpcQuantity(gasLimitValue, 'gas estimate');
  const gasPrice = parseRpcQuantity(gasPriceValue, 'gas price');
  const balance = parseRpcQuantity(balanceValue, 'Arc gas balance');
  if (balance < gasLimit * gasPrice) {
    throw new Error(
      'The owner wallet does not have enough Arc native USDC for this transaction gas.',
    );
  }
}

function parseRpcQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`The wallet returned an invalid ${label}.`);
  }
  return BigInt(value);
}

export function sumUsdcFees(
  fees: readonly { readonly token: string; readonly amount: string | null; readonly error?: unknown }[],
): bigint {
  return fees.reduce((total, fee) => {
    if (fee.error !== undefined || fee.amount === null) {
      throw new Error('Circle could not provide a complete USDC fee estimate. Try again.');
    }
    if (fee.token.toUpperCase() !== 'USDC') {
      if (fee.amount === '0') return total;
      throw new Error(`Unsupported fee token ${fee.token}; funding is blocked before signing.`);
    }
    const parsed = parseUsdcBaseUnits(fee.amount);
    if (parsed === undefined) {
      throw new Error('Circle returned an invalid USDC fee estimate.');
    }
    return total + parsed;
  }, 0n);
}

export function unifiedBalanceFeeReserveByNetwork(
  fees: readonly {
    readonly type: 'provider' | 'gasFee' | 'kit' | 'forwarder';
    readonly token: string;
    readonly amount: string | null;
    readonly error?: unknown;
    readonly allocations?: readonly {
      readonly chain: string;
      readonly amount: string;
    }[];
  }[],
  selectedNetworks: readonly FundingNetworkId[],
): Readonly<Partial<Record<FundingNetworkId, string>>> {
  const totals: Partial<Record<FundingNetworkId, bigint>> = Object.fromEntries(
    selectedNetworks.map((network) => [network, 0n]),
  );
  for (const fee of fees) {
    if (fee.error !== undefined || fee.amount === null) {
      throw new Error('Circle could not provide a complete USDC fee estimate. Try again.');
    }
    if (fee.token.toUpperCase() !== 'USDC') {
      if (fee.amount === '0') continue;
      throw new Error(`Unsupported fee token ${fee.token}; funding is blocked before signing.`);
    }
    if ((fee.type === 'kit' || fee.type === 'forwarder') && fee.amount !== '0') {
      throw new Error(
        `Circle ${fee.type} fees are disabled for this funding flow.`,
      );
    }
    if (fee.type === 'kit' || fee.type === 'forwarder') continue;
    if (fee.allocations !== undefined && fee.allocations.length > 0) {
      for (const allocation of fee.allocations) {
        if (!FUNDING_NETWORK_IDS.includes(allocation.chain as FundingNetworkId)) {
          throw new Error(`Circle returned a fee for unsupported chain ${allocation.chain}.`);
        }
        const network = allocation.chain as FundingNetworkId;
        const amount = parseUsdcBaseUnits(allocation.amount);
        if (amount === undefined) throw new Error('Circle returned an invalid allocated fee.');
        totals[network] = (totals[network] ?? 0n) + amount;
      }
      continue;
    }
    const amount = parseUsdcBaseUnits(fee.amount);
    if (amount === undefined) throw new Error('Circle returned an invalid USDC fee estimate.');
    if (amount > 0n) {
      throw new Error(
        `Circle ${fee.type} fee is missing its required per-chain allocation.`,
      );
    }
  }
  return formatNetworkAmounts(totals);
}

export function unifiedBalanceSourceDebitFeeTotal(
  fees: readonly {
    readonly type: 'provider' | 'gasFee' | 'kit' | 'forwarder';
    readonly token: string;
    readonly amount: string | null;
    readonly error?: unknown;
  }[],
): bigint {
  for (const fee of fees) {
    if ((fee.type === 'kit' || fee.type === 'forwarder') && fee.amount !== '0') {
      throw new Error(`Circle ${fee.type} fees are disabled for this funding flow.`);
    }
  }
  return sumUsdcFees(
    fees.filter((fee) => fee.type === 'provider' || fee.type === 'gasFee'),
  );
}

function formatNetworkAmounts(
  amounts: Readonly<Partial<Record<FundingNetworkId, bigint>>>,
): Readonly<Partial<Record<FundingNetworkId, string>>> {
  return Object.fromEntries(
    FUNDING_NETWORK_IDS.flatMap((network) => {
      const amount = amounts[network];
      return amount === undefined ? [] : [[network, formatUsdcBaseUnits(amount)]];
    }),
  );
}

function sumNetworkAmounts(
  amounts: Readonly<Partial<Record<FundingNetworkId, bigint>>>,
): bigint {
  return FUNDING_NETWORK_IDS.reduce(
    (total, network) => total + (amounts[network] ?? 0n),
    0n,
  );
}

export function requiresSourceWalletBalanceCheck(
  routeMode: FundingExecutionRequest['routeMode'],
): boolean {
  return routeMode !== 'unified_balance';
}

export async function assertConnectedWalletAccount(
  provider: EIP1193Provider,
  expectedAddress: string,
): Promise<void> {
  const accounts = await provider.request({ method: 'eth_accounts', params: undefined });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    accounts[0].toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    throw new Error('The active wallet account changed. Reconnect the wallet before continuing.');
  }
}

function bridgeDestinationResult(result: BridgeResult): FundingDestinationResult {
  const mint = [...result.steps]
    .reverse()
    .find(
      (step) =>
        step.name.toLowerCase() === 'mint' &&
        step.state !== 'error' &&
        step.txHash !== undefined,
    );
  if (result.state === 'error' || mint?.txHash === undefined) {
    // The caller must persist the full BridgeResult and use kit.retryBridge only for a documented
    // retryable soft error. Re-running execute() after burn could create a duplicate transfer.
    throw new CircleBridgeIncompleteError(result);
  }

  return {
    routeMode: 'bridge',
    destinationTransactionHash: mint.txHash,
    sourceTransactionHashes: result.steps.flatMap((step) => step.txHash ?? []),
  };
}

export function canRetryBridgeResult(result: BridgeResult): boolean {
  return (
    result.state === 'error' &&
    result.steps.some((step) => step.error !== undefined && isRetryableError(step.error))
  );
}

export function bridgeRecoveryTelemetry(result: BridgeResult): BridgeRecoveryTelemetry {
  const sourceTransactionHashes = [
    ...new Set(
      result.steps.flatMap((step) =>
        step.txHash !== undefined && /^0x[0-9a-fA-F]{64}$/.test(step.txHash)
          ? [step.txHash]
          : [],
      ),
    ),
  ];
  return {
    providerState: result.state,
    retryable: canRetryBridgeResult(result),
    submissionUncertain: false,
    sourceTransactionHashes,
    steps: result.steps.slice(0, 32).map((step) => ({
      name: step.name.slice(0, 64) || 'bridge_step',
      state: step.state === 'noop' ? 'success' : step.state,
      ...(step.txHash !== undefined && /^0x[0-9a-fA-F]{64}$/.test(step.txHash)
        ? { transactionHash: step.txHash }
        : {}),
      ...(step.errorCategory === undefined
        ? {}
        : { errorCode: step.errorCategory.slice(0, 128) }),
    })),
  };
}

export class CircleBridgeIncompleteError extends Error {
  constructor(readonly result: BridgeResult) {
    super(
      `Circle Bridge is ${result.state}. Preserve this result and continue delivery; do not start a new bridge.`,
    );
    this.name = 'CircleBridgeIncompleteError';
  }
}

export function describeFundingNetwork(network: FundingNetworkId): string {
  return `${FUNDING_NETWORKS[network].label} (${FUNDING_NETWORKS[network].chainId})`;
}
