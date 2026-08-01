import { createHash } from 'node:crypto';

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
  ERC20_ABI,
  BOUNTY_ESCROW_ADMIN_ABI,
  ESCROW_ABI,
  FUNDING_NETWORK_CONFIG,
  GATEWAY_ABI,
  GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
  type FundingNetworkId,
} from '@bug-bounty-escrow/blockchain';
import {
  parseUsdcBaseUnits,
  type ApiEnvironment,
  type FundingRouteMode,
} from '@bug-bounty-escrow/shared';
import { createPublicClient, decodeEventLog, defineChain, http, type Hex } from 'viem';

import {
  EscrowProviderError,
  type ArcEscrowGateway,
  type EscrowWithdrawalState,
  type EscrowArtifact,
  type VerifiedClose,
  type VerifiedFundingDestination,
  type VerifiedSync,
  type VerifiedWithdrawal,
  type VerifiedLateFundingEvent,
  type VerifiedRewardApproval,
  type VerifiedRewardPayout,
  type VerifiedSourceDeposit,
} from './escrow-gateways.js';

const ARC_CHAIN_ID = ARC_TESTNET_CHAIN_ID;
const LEGACY_ESCROW_INITIALIZED_ABI = [{
  type: 'event', name: 'EscrowInitialized', anonymous: false,
  inputs: [
    { name: 'programKey', type: 'bytes32', indexed: true },
    { name: 'platformAdmin', type: 'address', indexed: true },
    { name: 'token', type: 'address', indexed: true },
    { name: 'refundUnlockAt', type: 'uint256', indexed: false },
    { name: 'withdrawRecipient', type: 'address', indexed: false },
  ],
}] as const;
const CANONICAL_USDC = ARC_TESTNET_USDC_ADDRESS;
const GATEWAY_WALLET = GATEWAY_WALLET_EVM_TESTNET_ADDRESS;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface RpcLog {
  address: `0x${string}`;
  data: Hex;
  topics: readonly [Hex, ...Hex[]];
  logIndex: number | null;
}

interface RpcReceipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  blockHash: `0x${string}`;
  contractAddress: `0x${string}` | null;
  logs: readonly RpcLog[];
}

interface ArcRpcClient {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<{ hash: Hex | null }>;
  getBytecode(input: { address: `0x${string}` }): Promise<Hex | undefined>;
  readContract(input: Readonly<Record<string, unknown>>): Promise<unknown>;
  getTransactionReceipt(input: { hash: `0x${string}` }): Promise<RpcReceipt>;
  getLogs(input: Readonly<Record<string, unknown>>): Promise<readonly RpcLog[]>;
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isTransactionReceiptMissing(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    if (
      current.name === 'TransactionReceiptNotFoundError' ||
      /transaction receipt.*(?:not found|could not be found)/i.test(current.message)
    ) {
      return true;
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

function normalizeRuntimeBytecode(artifact: EscrowArtifact, deployedBytecode: Hex): Buffer {
  const normalized = Buffer.from(deployedBytecode.slice(2), 'hex');
  for (const references of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of references) {
      if (start < 0 || length < 0 || start + length > normalized.length) {
        throw new EscrowProviderError('artifact_immutable_reference_invalid', false);
      }
      normalized.fill(0, start, start + length);
    }
  }
  return normalized;
}

export class ArcRpcAdapter implements ArcEscrowGateway {
  private readonly client: ArcRpcClient;
  private readonly sourceClients: Readonly<Record<FundingNetworkId, ArcRpcClient>>;
  private readonly configured: boolean;

  public constructor(
    private readonly config: ApiEnvironment,
    client?: ArcRpcClient,
    sourceClients?: Partial<Record<FundingNetworkId, ArcRpcClient>>,
  ) {
    this.configured =
      config.ARC_CHAIN_ID === ARC_CHAIN_ID && equalHex(config.USDC_ADDRESS, CANONICAL_USDC);
    const arc = defineChain({
      id: ARC_CHAIN_ID,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
    });
    this.client =
      client ??
      (createPublicClient({
        chain: arc,
        transport: http(config.ARC_RPC_URL, { retryCount: 3, timeout: 10_000 }),
      }) as unknown as ArcRpcClient);
    const createSourceClient = (network: FundingNetworkId, rpcUrl: string): ArcRpcClient => {
      const expected = FUNDING_NETWORK_CONFIG[network];
      const chain = defineChain({
        id: expected.chainId,
        name: network,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      });
      return createPublicClient({
        chain,
        transport: http(rpcUrl, { retryCount: 3, timeout: 10_000 }),
      }) as unknown as ArcRpcClient;
    };
    this.sourceClients = {
      Arc_Testnet: sourceClients?.Arc_Testnet ?? this.client,
      Ethereum_Sepolia:
        sourceClients?.Ethereum_Sepolia ??
        createSourceClient('Ethereum_Sepolia', config.ETHEREUM_SEPOLIA_RPC_URL),
      Arbitrum_Sepolia:
        sourceClients?.Arbitrum_Sepolia ??
        createSourceClient('Arbitrum_Sepolia', config.ARBITRUM_SEPOLIA_RPC_URL),
      Base_Sepolia:
        sourceClients?.Base_Sepolia ??
        createSourceClient('Base_Sepolia', config.BASE_SEPOLIA_RPC_URL),
    };
  }

  public async assertArcChain(): Promise<void> {
    if (!this.configured) {
      throw new EscrowProviderError('arc_escrow_config_invalid', false);
    }
    if ((await this.client.getChainId()) !== ARC_CHAIN_ID) {
      throw new EscrowProviderError('arc_chain_id_mismatch', false);
    }
  }

  public async getCanonicalUsdcBalance(address: `0x${string}`): Promise<bigint> {
    await this.assertArcChain();
    const result = await this.client.readContract({
      address: CANONICAL_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
    if (typeof result !== 'bigint') {
      throw new EscrowProviderError('arc_balance_response_invalid', true);
    }
    return result;
  }

  public async getEscrowTotalFunded(address: `0x${string}`): Promise<bigint> {
    await this.assertArcChain();
    const result = await this.client.readContract({
      address,
      abi: ESCROW_ABI,
      functionName: 'totalFunded',
    });
    if (typeof result !== 'bigint') {
      throw new EscrowProviderError('arc_total_funded_response_invalid', true);
    }
    return result;
  }

  public async getGatewayConfirmedBalance(
    network: FundingNetworkId,
    wallet: `0x${string}`,
  ): Promise<bigint> {
    const expected = FUNDING_NETWORK_CONFIG[network];
    let response: Response;
    try {
      response = await fetch(`${this.config.CIRCLE_GATEWAY_TESTNET_API_URL}/v1/balances`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: 'USDC',
          sources: [{ depositor: wallet, domain: expected.gatewayDomain }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new EscrowProviderError('gateway_balance_unavailable', true);
    }
    if (!response.ok) throw new EscrowProviderError('gateway_balance_unavailable', true);
    const body = (await response.json()) as unknown;
    if (
      typeof body !== 'object' ||
      body === null ||
      !('balances' in body) ||
      !Array.isArray(body.balances)
    ) {
      throw new EscrowProviderError('gateway_balance_response_invalid', true);
    }
    const matching = body.balances.filter(
      (entry): entry is { domain: number; depositor: string; balance: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { domain?: unknown }).domain === expected.gatewayDomain &&
        typeof (entry as { depositor?: unknown }).depositor === 'string' &&
        equalHex((entry as { depositor: string }).depositor, wallet) &&
        typeof (entry as { balance?: unknown }).balance === 'string',
    );
    if (matching.length > 1)
      throw new EscrowProviderError('gateway_balance_response_ambiguous', true);
    if (matching.length === 0) return 0n;
    const balance = parseUsdcBaseUnits(matching[0]!.balance);
    if (balance === undefined)
      throw new EscrowProviderError('gateway_balance_response_invalid', true);
    return balance;
  }

  public async getTransactionRecoveryEvidence(input: {
    network: FundingNetworkId;
    transactionHash: `0x${string}`;
  }): Promise<
    | { state: 'pending' }
    | {
        state: 'success' | 'reverted';
        blockNumber: bigint;
        blockHash: `0x${string}`;
      }
  > {
    const expected = FUNDING_NETWORK_CONFIG[input.network];
    const client = this.sourceClients[input.network];
    if ((await client.getChainId()) !== expected.chainId) {
      throw new EscrowProviderError('funding_recovery_chain_mismatch', false);
    }
    let receipt: RpcReceipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: input.transactionHash });
    } catch (error) {
      if (isTransactionReceiptMissing(error)) return { state: 'pending' };
      throw new EscrowProviderError('funding_recovery_rpc_unavailable', true);
    }
    await this.assertCommittedReceipt(receipt, client, 'funding_recovery');
    return {
      state: receipt.status,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async verifySourceDeposit(input: {
    network: FundingNetworkId;
    walletAddress: `0x${string}`;
    amountBaseUnits: bigint;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedSourceDeposit> {
    const expected = FUNDING_NETWORK_CONFIG[input.network];
    const client = this.sourceClients[input.network];
    if ((await client.getChainId()) !== expected.chainId) {
      throw new EscrowProviderError('source_deposit_chain_mismatch', false);
    }
    const receipt = await client.getTransactionReceipt({ hash: input.transactionHash });
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('source_deposit_reverted', false);
    }
    await this.assertCommittedReceipt(receipt, client, 'source_deposit');
    const gatewayLogs: number[] = [];
    const transferLogs: number[] = [];
    for (const log of receipt.logs) {
      if (log.logIndex === null) continue;
      if (equalHex(log.address, GATEWAY_WALLET)) {
        try {
          const decoded = decodeEventLog({
            abi: GATEWAY_ABI,
            eventName: 'Deposited',
            data: log.data,
            topics: [...log.topics],
          });
          if (
            equalHex(decoded.args.token, expected.tokenAddress) &&
            equalHex(decoded.args.depositor, input.walletAddress) &&
            equalHex(decoded.args.sender, input.walletAddress) &&
            decoded.args.value === input.amountBaseUnits
          )
            gatewayLogs.push(log.logIndex);
        } catch {
          /* Ignore unrelated Gateway logs. */
        }
      }
      if (equalHex(log.address, expected.tokenAddress)) {
        try {
          const decoded = decodeEventLog({
            abi: ERC20_ABI,
            eventName: 'Transfer',
            data: log.data,
            topics: [...log.topics],
          });
          if (
            equalHex(decoded.args.from, input.walletAddress) &&
            equalHex(decoded.args.to, GATEWAY_WALLET) &&
            decoded.args.value === input.amountBaseUnits
          )
            transferLogs.push(log.logIndex);
        } catch {
          /* Ignore unrelated token logs. */
        }
      }
    }
    if (gatewayLogs.length !== 1 || transferLogs.length !== 1) {
      throw new EscrowProviderError('source_deposit_evidence_mismatch', false);
    }
    return {
      transactionHash: input.transactionHash,
      gatewayLogIndex: gatewayLogs[0]!,
      transferLogIndex: transferLogs[0]!,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async verifyDeployment(input: {
    artifact: EscrowArtifact;
    contractAddress: `0x${string}`;
    transactionHash: `0x${string}`;
    expectedBlockNumber: bigint;
    expectedBlockHash: `0x${string}`;
    programKey: `0x${string}`;
    platformAdminWallet: `0x${string}`;
    ownerWallet?: `0x${string}`;
    refundUnlockAt: bigint;
    withdrawRecipient: `0x${string}`;
  }): Promise<void> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    if (
      receipt.status !== 'success' ||
      (receipt.contractAddress !== null &&
        !equalHex(receipt.contractAddress, input.contractAddress)) ||
      receipt.blockNumber !== input.expectedBlockNumber ||
      !equalHex(receipt.blockHash, input.expectedBlockHash)
    ) {
      throw new EscrowProviderError('escrow_deployment_receipt_mismatch', false);
    }
    let initializedEventVerified = false;
    for (const log of receipt.logs) {
      if (!equalHex(log.address, input.contractAddress)) continue;
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          eventName: 'EscrowInitialized',
          data: log.data,
          topics: [...log.topics],
        });
        const args = decoded.args as typeof decoded.args & {
          programOwner?: `0x${string}`;
          adminController?: `0x${string}`;
          platformAdmin?: `0x${string}`;
        };
        const expectedAdmin = input.platformAdminWallet ?? input.ownerWallet!;
        initializedEventVerified =
          equalHex(args.programKey, input.programKey) &&
          equalHex(args.programOwner ?? input.ownerWallet!, input.ownerWallet ?? args.programOwner!) &&
          equalHex(args.adminController ?? args.platformAdmin!, expectedAdmin) &&
          equalHex(args.token, CANONICAL_USDC) &&
          args.refundUnlockAt === input.refundUnlockAt &&
          equalHex(args.withdrawRecipient, input.withdrawRecipient);
      } catch {
        // Accept receipts from the pre-controller 1.1 deployment while old
        // records are being rolled forward. New deployments must satisfy the
        // programOwner/adminController event above.
        try {
          const legacy = decodeEventLog({
            abi: LEGACY_ESCROW_INITIALIZED_ABI,
            eventName: 'EscrowInitialized',
            data: log.data,
            topics: [...log.topics],
          });
          const args = legacy.args;
          initializedEventVerified =
            equalHex(args.programKey, input.programKey) &&
            equalHex(args.platformAdmin, input.platformAdminWallet ?? input.ownerWallet) &&
            equalHex(args.token, CANONICAL_USDC) &&
            args.refundUnlockAt === input.refundUnlockAt &&
            equalHex(args.withdrawRecipient, input.withdrawRecipient);
        } catch {
          // Ignore unrelated contract logs.
        }
      }
    }
    if (!initializedEventVerified) {
      throw new EscrowProviderError('escrow_initialized_event_mismatch', false);
    }
    const deployedBytecode = await this.client.getBytecode({ address: input.contractAddress });
    if (deployedBytecode === undefined || deployedBytecode === '0x') {
      throw new EscrowProviderError('escrow_runtime_missing', false);
    }
    const runtimeChecksum = `0x${createHash('sha256')
      .update(normalizeRuntimeBytecode(input.artifact, deployedBytecode))
      .digest('hex')}`;
    if (!equalHex(runtimeChecksum, input.artifact.runtimeBytecodeSha256)) {
      throw new EscrowProviderError('escrow_runtime_checksum_mismatch', false);
    }

    const read = (functionName: string) =>
      this.client.readContract({
        address: input.contractAddress,
        abi: ESCROW_ABI,
        functionName,
      });
    const [programKey, programOwner, adminController, token, refundUnlockAt, withdrawRecipient] = await Promise.all([
      read('programKey'),
      read('programOwner'),
      read('adminController'),
      read('token'),
      read('refundUnlockAt'),
      read('withdrawRecipient'),
    ]);
    const legacyPlatformAdmin =
      typeof programOwner !== 'string' || typeof adminController !== 'string'
        ? await read('platformAdmin')
        : undefined;
    const verifiedProgramOwner =
      typeof programOwner === 'string' ? programOwner : (input.ownerWallet ?? withdrawRecipient);
    const verifiedAdminController =
      typeof adminController === 'string' ? adminController : legacyPlatformAdmin;
    if (
      typeof programKey !== 'string' ||
      typeof verifiedProgramOwner !== 'string' ||
      typeof verifiedAdminController !== 'string' ||
      typeof token !== 'string' ||
      typeof refundUnlockAt !== 'bigint' ||
      typeof withdrawRecipient !== 'string' ||
      !equalHex(programKey, input.programKey) ||
      !equalHex(verifiedProgramOwner, input.ownerWallet ?? verifiedProgramOwner) ||
      !equalHex(verifiedAdminController, input.platformAdminWallet ?? input.ownerWallet!) ||
      !equalHex(token, CANONICAL_USDC) ||
      refundUnlockAt !== input.refundUnlockAt ||
      !equalHex(withdrawRecipient, input.withdrawRecipient)
    ) {
      throw new EscrowProviderError('escrow_immutable_mismatch', false);
    }
  }

  public async verifyDeploymentFeePayment(input: {
    transactionHash: `0x${string}`;
    payerAddress: `0x${string}`;
    recipientAddress: `0x${string}`;
    tokenAddress: `0x${string}`;
    amountBaseUnits: bigint;
    chainId: number;
  }): Promise<{ blockNumber: bigint; blockHash: `0x${string}`; logIndex: number }> {
    if (input.chainId !== ARC_CHAIN_ID) throw new EscrowProviderError('deployment_fee_chain_mismatch', false);
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    const matches: { logIndex: number; blockNumber: bigint; blockHash: `0x${string}` }[] = [];
    let feeEventMatches = 0;
    for (const log of receipt.logs) {
      if (equalHex(log.address, input.recipientAddress)) {
        try {
          const decoded = decodeEventLog({
            abi: BOUNTY_ESCROW_ADMIN_ABI,
            eventName: 'ProgramFeePaid',
            data: log.data,
            topics: [...log.topics],
          });
          if (equalHex(decoded.args.payer, input.payerAddress) && decoded.args.amount === input.amountBaseUnits) {
            feeEventMatches += 1;
          }
        } catch {
          // Ignore unrelated admin-controller logs.
        }
      }
      if (!equalHex(log.address, input.tokenAddress) || log.logIndex === null) continue;
      try {
        const decoded = decodeEventLog({ abi: ERC20_ABI, eventName: 'Transfer', data: log.data, topics: [...log.topics] });
        if (
          equalHex(decoded.args.from, input.payerAddress) &&
          equalHex(decoded.args.to, input.recipientAddress) &&
          decoded.args.value === input.amountBaseUnits
        ) {
          matches.push({ logIndex: log.logIndex, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash });
        }
      } catch {
        // Ignore unrelated logs.
      }
    }
    if (matches.length !== 1 || feeEventMatches !== 1) {
      throw new EscrowProviderError('deployment_fee_payment_not_found', false);
    }
    return matches[0]!;
  }

  public async verifyFundingDestination(input: {
    escrowAddress: `0x${string}`;
    routeMode: FundingRouteMode;
    walletAddress: `0x${string}`;
    destinationTransactionHash: `0x${string}`;
    preBalanceBaseUnits: bigint;
  }): Promise<VerifiedFundingDestination> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({
      hash: input.destinationTransactionHash,
    });
    await this.assertCommittedReceipt(receipt);
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('funding_destination_reverted', false);
    }

    const matchingTransfers: { value: bigint; logIndex: number }[] = [];
    for (const log of receipt.logs) {
      if (!equalHex(log.address, CANONICAL_USDC) || log.logIndex === null) continue;
      try {
        const decoded = decodeEventLog({
          abi: ERC20_ABI,
          eventName: 'Transfer',
          data: log.data,
          topics: [...log.topics],
        });
        const expectedFrom = input.routeMode === 'send' ? input.walletAddress : ZERO_ADDRESS;
        if (
          equalHex(decoded.args.from, expectedFrom) &&
          equalHex(decoded.args.to, input.escrowAddress)
        ) {
          matchingTransfers.push({ value: decoded.args.value, logIndex: log.logIndex });
        }
      } catch {
        // Non-Transfer log from the token is irrelevant.
      }
    }
    if (matchingTransfers.length === 0) {
      throw new EscrowProviderError('funding_transfer_log_missing', false);
    }
    if (matchingTransfers.length !== 1) {
      throw new EscrowProviderError('funding_transfer_log_ambiguous', false);
    }
    const netReceivedBaseUnits = matchingTransfers[0]!.value;
    return {
      destinationTransactionHash: input.destinationTransactionHash,
      destinationLogIndex: matchingTransfers[0]!.logIndex,
      netReceivedBaseUnits,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async verifyFundingSync(input: {
    escrowAddress: `0x${string}`;
    transactionHash: `0x${string}`;
    minimumTotalFundedBaseUnits: bigint;
  }): Promise<VerifiedSync> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('funding_sync_reverted', false);
    }
    let event:
      | { logIndex: number; newlyObservedBaseUnits: bigint; totalFundedBaseUnits: bigint }
      | undefined;
    for (const log of receipt.logs) {
      if (!equalHex(log.address, input.escrowAddress) || log.logIndex === null) continue;
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          eventName: 'ExternalFundingSynced',
          data: log.data,
          topics: [...log.topics],
        });
        event = {
          logIndex: log.logIndex,
          newlyObservedBaseUnits: decoded.args.newlyObserved,
          totalFundedBaseUnits: decoded.args.totalFunded,
        };
      } catch (error) {
        if (error instanceof EscrowProviderError) throw error;
      }
    }
    const onchainTotalFunded = await this.getEscrowTotalFunded(input.escrowAddress);
    if (onchainTotalFunded < input.minimumTotalFundedBaseUnits) {
      throw new EscrowProviderError('funding_sync_total_mismatch', false);
    }
    if (event !== undefined && event.totalFundedBaseUnits > onchainTotalFunded) {
      throw new EscrowProviderError('funding_sync_event_state_mismatch', false);
    }
    return {
      transactionHash: input.transactionHash,
      logIndex: event?.logIndex ?? null,
      newlyObservedBaseUnits: event?.newlyObservedBaseUnits ?? 0n,
      totalFundedBaseUnits: onchainTotalFunded,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async verifyRewardApproval(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedRewardApproval> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('reward_approval_reverted', false);
    }
    const events: number[] = [];
    for (const log of receipt.logs) {
      if (!equalHex(log.address, input.escrowAddress) || log.logIndex === null) continue;
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          eventName: 'RewardApproved',
          data: log.data,
          topics: [...log.topics],
        });
        if (
          equalHex(decoded.args.reportKey, input.reportKey) &&
          equalHex(decoded.args.approvedContentHash, input.approvedContentHash) &&
          equalHex(decoded.args.researcher, input.recipientAddress) &&
          decoded.args.amount === input.amountBaseUnits
        ) {
          events.push(log.logIndex);
        }
      } catch {
        // Ignore unrelated escrow logs.
      }
    }
    if (events.length !== 1) {
      throw new EscrowProviderError('reward_approval_event_mismatch', false);
    }
    const reward = await this.client.readContract({
      address: input.escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'rewards',
      args: [input.reportKey],
    });
    if (
      !Array.isArray(reward) ||
      reward.length !== 4 ||
      typeof reward[0] !== 'string' ||
      typeof reward[1] !== 'string' ||
      typeof reward[2] !== 'bigint' ||
      (reward[3] !== 1 && reward[3] !== 2 && reward[3] !== 1n && reward[3] !== 2n) ||
      !equalHex(reward[0], input.approvedContentHash) ||
      !equalHex(reward[1], input.recipientAddress) ||
      reward[2] !== input.amountBaseUnits
    ) {
      throw new EscrowProviderError('reward_approval_state_mismatch', false);
    }
    return {
      transactionHash: input.transactionHash,
      eventLogIndex: events[0]!,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async findRewardApproval(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    fromBlock: bigint;
  }): Promise<VerifiedRewardApproval | null> {
    await this.assertArcChain();
    const latestBlock = await this.client.getBlockNumber();
    if (input.fromBlock > latestBlock) return null;
    const logs = await this.client.getLogs({
      address: input.escrowAddress,
      event: ESCROW_ABI.find((item) => item.type === 'event' && item.name === 'RewardApproved'),
      args: { reportKey: input.reportKey },
      fromBlock: input.fromBlock,
      toBlock: latestBlock,
    });
    const hashes = [
      ...new Set(
        logs.flatMap((log) => {
          const hash = (log as RpcLog & { transactionHash?: Hex }).transactionHash;
          return hash === undefined ? [] : [hash as `0x${string}`];
        }),
      ),
    ];
    if (hashes.length > 1) {
      throw new EscrowProviderError('reward_approval_event_ambiguous', false);
    }
    if (hashes.length === 0) return null;
    return this.verifyRewardApproval({
      escrowAddress: input.escrowAddress,
      reportKey: input.reportKey,
      approvedContentHash: input.approvedContentHash,
      recipientAddress: input.recipientAddress,
      amountBaseUnits: input.amountBaseUnits,
      transactionHash: hashes[0]!,
    });
  }

  public async verifyRewardPayout(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedRewardPayout> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('reward_payout_reverted', false);
    }
    const events: number[] = [];
    const transfers: number[] = [];
    for (const log of receipt.logs) {
      if (log.logIndex === null) continue;
      if (equalHex(log.address, input.escrowAddress)) {
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            eventName: 'RewardPaid',
            data: log.data,
            topics: [...log.topics],
          });
          if (
            equalHex(decoded.args.reportKey, input.reportKey) &&
            equalHex(decoded.args.researcher, input.recipientAddress) &&
            decoded.args.amount === input.amountBaseUnits
          ) {
            events.push(log.logIndex);
          }
        } catch {
          // Ignore unrelated escrow logs.
        }
      }
      if (equalHex(log.address, CANONICAL_USDC)) {
        try {
          const decoded = decodeEventLog({
            abi: ERC20_ABI,
            eventName: 'Transfer',
            data: log.data,
            topics: [...log.topics],
          });
          if (
            equalHex(decoded.args.from, input.escrowAddress) &&
            equalHex(decoded.args.to, input.recipientAddress) &&
            decoded.args.value === input.amountBaseUnits
          ) {
            transfers.push(log.logIndex);
          }
        } catch {
          // Ignore unrelated USDC logs.
        }
      }
    }
    if (events.length !== 1 || transfers.length !== 1) {
      throw new EscrowProviderError('reward_payout_evidence_mismatch', false);
    }
    const readEscrowAtSettlement = (functionName: string) =>
      this.client.readContract({
        address: input.escrowAddress,
        abi: ESCROW_ABI,
        functionName,
        blockNumber: receipt.blockNumber,
      });
    const [reward, totalPaid, totalApprovedOutstanding, totalFunded, totalWithdrawn, balance] =
      await Promise.all([
        this.client.readContract({
          address: input.escrowAddress,
          abi: ESCROW_ABI,
          functionName: 'rewards',
          args: [input.reportKey],
          blockNumber: receipt.blockNumber,
        }),
        readEscrowAtSettlement('totalPaid'),
        readEscrowAtSettlement('totalApprovedOutstanding'),
        readEscrowAtSettlement('totalFunded'),
        readEscrowAtSettlement('totalWithdrawn'),
        this.client.readContract({
          address: CANONICAL_USDC,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [input.escrowAddress],
          blockNumber: receipt.blockNumber,
        }),
      ]);
    if (
      !Array.isArray(reward) ||
      reward.length !== 4 ||
      typeof reward[1] !== 'string' ||
      typeof reward[2] !== 'bigint' ||
      (reward[3] !== 2 && reward[3] !== 2n) ||
      typeof reward[0] !== 'string' ||
      !equalHex(reward[0], input.approvedContentHash) ||
      !equalHex(reward[1], input.recipientAddress) ||
      reward[2] !== input.amountBaseUnits
    ) {
      throw new EscrowProviderError('reward_payout_state_mismatch', false);
    }
    if (
      typeof totalPaid !== 'bigint' ||
      typeof totalApprovedOutstanding !== 'bigint' ||
      typeof totalFunded !== 'bigint' ||
      typeof totalWithdrawn !== 'bigint' ||
      typeof balance !== 'bigint' ||
      totalPaid < input.amountBaseUnits ||
      totalApprovedOutstanding > balance ||
      totalPaid + totalWithdrawn > totalFunded ||
      totalFunded !== balance + totalPaid + totalWithdrawn
    ) {
      throw new EscrowProviderError('reward_payout_accounting_mismatch', false);
    }
    return {
      transactionHash: input.transactionHash,
      eventLogIndex: events[0]!,
      transferLogIndex: transfers[0]!,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      accounting: {
        totalPaidBaseUnits: totalPaid,
        totalApprovedOutstandingBaseUnits: totalApprovedOutstanding,
        totalFundedBaseUnits: totalFunded,
        totalWithdrawnBaseUnits: totalWithdrawn,
        escrowBalanceBaseUnits: balance,
      },
    };
  }

  public async findRewardPayout(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    fromBlock: bigint;
  }): Promise<VerifiedRewardPayout | null> {
    await this.assertArcChain();
    const latestBlock = await this.client.getBlockNumber();
    if (input.fromBlock > latestBlock) return null;
    const logs = await this.client.getLogs({
      address: input.escrowAddress,
      event: ESCROW_ABI.find((item) => item.type === 'event' && item.name === 'RewardPaid'),
      args: { reportKey: input.reportKey },
      fromBlock: input.fromBlock,
      toBlock: latestBlock,
    });
    const hashes = [
      ...new Set(
        logs.flatMap((log) => {
          const hash = (log as RpcLog & { transactionHash?: Hex }).transactionHash;
          return hash === undefined ? [] : [hash as `0x${string}`];
        }),
      ),
    ];
    if (hashes.length > 1) {
      throw new EscrowProviderError('reward_payout_event_ambiguous', false);
    }
    if (hashes.length === 0) return null;
    return this.verifyRewardPayout({
      escrowAddress: input.escrowAddress,
      reportKey: input.reportKey,
      approvedContentHash: input.approvedContentHash,
      recipientAddress: input.recipientAddress,
      amountBaseUnits: input.amountBaseUnits,
      transactionHash: hashes[0]!,
    });
  }

  public async getWithdrawalState(address: `0x${string}`): Promise<EscrowWithdrawalState> {
    await this.assertArcChain();
    const read = (functionName: string) =>
      this.client.readContract({ address, abi: ESCROW_ABI, functionName });
    const [closed, refundUnlockAt, outstanding, totalWithdrawn, withdrawRecipient, balance] =
      await Promise.all([
        read('closed'),
        read('refundUnlockAt'),
        read('totalApprovedOutstanding'),
        read('totalWithdrawn'),
        read('withdrawRecipient'),
        this.getCanonicalUsdcBalance(address),
      ]);
    if (
      typeof closed !== 'boolean' ||
      typeof refundUnlockAt !== 'bigint' ||
      typeof outstanding !== 'bigint' ||
      typeof totalWithdrawn !== 'bigint' ||
      typeof withdrawRecipient !== 'string' ||
      !/^0x[0-9a-fA-F]{40}$/.test(withdrawRecipient)
    ) {
      throw new EscrowProviderError('escrow_withdrawal_state_invalid', true);
    }
    return {
      closed,
      refundUnlockAt,
      totalApprovedOutstandingBaseUnits: outstanding,
      totalWithdrawnBaseUnits: totalWithdrawn,
      balanceBaseUnits: balance,
      withdrawRecipient: withdrawRecipient as `0x${string}`,
    };
  }

  public async verifyClose(input: {
    escrowAddress: `0x${string}`;
    ownerWallet: `0x${string}`;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedClose> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('escrow_close_reverted', false);
    }
    const events: number[] = [];
    for (const log of receipt.logs) {
      if (!equalHex(log.address, input.escrowAddress) || log.logIndex === null) continue;
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          eventName: 'EscrowClosed',
          data: log.data,
          topics: [...log.topics],
        });
        if (equalHex(decoded.args.actor, input.ownerWallet)) events.push(log.logIndex);
      } catch {
        // Ignore unrelated escrow logs.
      }
    }
    if (events.length !== 1) {
      throw new EscrowProviderError('escrow_close_event_mismatch', false);
    }
    const closed = await this.client.readContract({
      address: input.escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'closed',
    });
    if (closed !== true) throw new EscrowProviderError('escrow_close_state_mismatch', false);
    return {
      transactionHash: input.transactionHash,
      logIndex: events[0]!,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async verifyWithdrawal(input: {
    escrowAddress: `0x${string}`;
    recipientAddress: `0x${string}`;
    transactionHash: `0x${string}`;
    expectedAmountBaseUnits: bigint;
    preTotalWithdrawnBaseUnits: bigint;
  }): Promise<VerifiedWithdrawal> {
    await this.assertArcChain();
    const receipt = await this.client.getTransactionReceipt({ hash: input.transactionHash });
    await this.assertCommittedReceipt(receipt);
    if (receipt.status !== 'success') {
      throw new EscrowProviderError('escrow_withdraw_reverted', false);
    }
    const withdrawalEvents: { amount: bigint; logIndex: number }[] = [];
    const transfers: { amount: bigint; logIndex: number }[] = [];
    for (const log of receipt.logs) {
      if (log.logIndex === null) continue;
      if (equalHex(log.address, input.escrowAddress)) {
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            eventName: 'RemainingFundsWithdrawn',
            data: log.data,
            topics: [...log.topics],
          });
          if (equalHex(decoded.args.recipient, input.recipientAddress)) {
            withdrawalEvents.push({ amount: decoded.args.amount, logIndex: log.logIndex });
          }
        } catch {
          // Ignore unrelated escrow logs.
        }
      }
      if (equalHex(log.address, CANONICAL_USDC)) {
        try {
          const decoded = decodeEventLog({
            abi: ERC20_ABI,
            eventName: 'Transfer',
            data: log.data,
            topics: [...log.topics],
          });
          if (
            equalHex(decoded.args.from, input.escrowAddress) &&
            equalHex(decoded.args.to, input.recipientAddress)
          ) {
            transfers.push({ amount: decoded.args.value, logIndex: log.logIndex });
          }
        } catch {
          // Ignore unrelated USDC logs.
        }
      }
    }
    if (
      withdrawalEvents.length !== 1 ||
      transfers.length !== 1 ||
      withdrawalEvents[0]!.amount !== input.expectedAmountBaseUnits ||
      transfers[0]!.amount !== input.expectedAmountBaseUnits
    ) {
      throw new EscrowProviderError('escrow_withdrawal_evidence_mismatch', false);
    }
    const totalWithdrawn = await this.client.readContract({
      address: input.escrowAddress,
      abi: ESCROW_ABI,
      functionName: 'totalWithdrawn',
    });
    if (
      typeof totalWithdrawn !== 'bigint' ||
      totalWithdrawn !== input.preTotalWithdrawnBaseUnits + input.expectedAmountBaseUnits
    ) {
      throw new EscrowProviderError('escrow_total_withdrawn_mismatch', false);
    }
    return {
      transactionHash: input.transactionHash,
      eventLogIndex: withdrawalEvents[0]!.logIndex,
      transferLogIndex: transfers[0]!.logIndex,
      amountBaseUnits: input.expectedAmountBaseUnits,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    };
  }

  public async findLateFunding(input: {
    escrowAddress: `0x${string}`;
    fromBlock: bigint;
  }): Promise<{ events: readonly VerifiedLateFundingEvent[]; scannedThroughBlock: bigint }> {
    await this.assertArcChain();
    const latestBlock = await this.client.getBlockNumber();
    if (input.fromBlock > latestBlock) return { events: [], scannedThroughBlock: latestBlock };
    const events: VerifiedLateFundingEvent[] = [];
    const transferEvent = ERC20_ABI[1];
    for (let fromBlock = input.fromBlock; fromBlock <= latestBlock; fromBlock += 50_000n) {
      const toBlock = fromBlock + 49_999n < latestBlock ? fromBlock + 49_999n : latestBlock;
      const logs = await this.client.getLogs({
        address: CANONICAL_USDC,
        event: transferEvent,
        args: { to: input.escrowAddress },
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        const transactionHash = (log as RpcLog & { transactionHash?: Hex }).transactionHash;
        const blockNumber = (log as RpcLog & { blockNumber?: bigint }).blockNumber;
        const blockHash = (log as RpcLog & { blockHash?: Hex }).blockHash;
        if (
          log.logIndex === null ||
          transactionHash === undefined ||
          blockNumber === undefined ||
          blockHash === undefined ||
          !equalHex(log.address, CANONICAL_USDC)
        ) {
          throw new EscrowProviderError('late_funding_log_incomplete', true);
        }
        const decoded = decodeEventLog({
          abi: ERC20_ABI,
          eventName: 'Transfer',
          data: log.data,
          topics: [...log.topics],
        });
        if (!equalHex(decoded.args.to, input.escrowAddress)) {
          throw new EscrowProviderError('late_funding_recipient_mismatch', false);
        }
        if (decoded.args.value === 0n) continue;
        const canonicalBlock = await this.client.getBlock({ blockNumber });
        if (canonicalBlock.hash === null || !equalHex(canonicalBlock.hash, blockHash)) {
          throw new EscrowProviderError('late_funding_block_evidence_mismatch', true);
        }
        events.push({
          transactionHash,
          logIndex: log.logIndex,
          fromAddress: decoded.args.from.toLowerCase() as `0x${string}`,
          amountBaseUnits: decoded.args.value,
          blockNumber,
          blockHash,
        });
      }
    }
    return { events, scannedThroughBlock: latestBlock };
  }

  private async assertCommittedReceipt(
    receipt: RpcReceipt,
    client: ArcRpcClient = this.client,
    errorPrefix = 'arc',
  ): Promise<void> {
    const latestBlock = await client.getBlockNumber();
    if (latestBlock < receipt.blockNumber) {
      throw new EscrowProviderError(`${errorPrefix}_receipt_not_committed`, true);
    }
    const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (canonicalBlock.hash === null || !equalHex(canonicalBlock.hash, receipt.blockHash)) {
      throw new EscrowProviderError(`${errorPrefix}_block_evidence_mismatch`, true);
    }
  }
}
