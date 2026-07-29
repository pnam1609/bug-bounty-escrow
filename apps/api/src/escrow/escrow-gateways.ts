export const CIRCLE_CONTRACTS_GATEWAY = Symbol('CIRCLE_CONTRACTS_GATEWAY');
export const ARC_ESCROW_GATEWAY = Symbol('ARC_ESCROW_GATEWAY');

export interface EscrowArtifact {
  version: '1.1.0';
  abi: readonly unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
  immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>>;
  artifactSha256: `0x${string}`;
  runtimeBytecodeSha256: `0x${string}`;
}

export interface CircleDeployInput {
  idempotencyKey: string;
  programId: string;
  programKey: `0x${string}`;
  ownerWallet: `0x${string}`;
  tokenAddress: `0x${string}`;
  refundUnlockAt: bigint;
  withdrawRecipient: `0x${string}`;
  artifact: EscrowArtifact;
}

export interface CircleDeploymentAccepted {
  contractId: string;
  transactionId: string;
}

export type CircleDeploymentResult =
  | { state: 'pending' }
  | { state: 'failed'; failureCode: string }
  | {
      state: 'confirmed';
      contractAddress: `0x${string}`;
      transactionHash: `0x${string}`;
      blockHash: `0x${string}`;
      blockNumber: bigint;
      deploymentWalletAddress: `0x${string}`;
    };

export interface CircleContractsGateway {
  deploy(input: CircleDeployInput): Promise<CircleDeploymentAccepted>;
  waitForDeployment(
    accepted: CircleDeploymentAccepted,
    signal?: AbortSignal,
  ): Promise<CircleDeploymentResult>;
  submitSyncExternalFunding(input: {
    idempotencyKey: string;
    escrowAddress: `0x${string}`;
  }): Promise<{ transactionId: string }>;
  waitForTransaction(
    transactionId: string,
    signal?: AbortSignal,
  ): Promise<{
    state: 'confirmed' | 'failed';
    transactionHash?: `0x${string}`;
    failureCode?: string;
  }>;
}

export interface VerifiedFundingDestination {
  destinationTransactionHash: `0x${string}`;
  destinationLogIndex: number;
  netReceivedBaseUnits: bigint;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface VerifiedSourceDeposit {
  transactionHash: `0x${string}`;
  gatewayLogIndex: number;
  transferLogIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface VerifiedSync {
  transactionHash: `0x${string}`;
  logIndex: number | null;
  newlyObservedBaseUnits: bigint;
  totalFundedBaseUnits: bigint;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface EscrowWithdrawalState {
  closed: boolean;
  refundUnlockAt: bigint;
  totalApprovedOutstandingBaseUnits: bigint;
  totalWithdrawnBaseUnits: bigint;
  balanceBaseUnits: bigint;
  withdrawRecipient: `0x${string}`;
}

export interface VerifiedClose {
  transactionHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface VerifiedWithdrawal {
  transactionHash: `0x${string}`;
  eventLogIndex: number;
  transferLogIndex: number;
  amountBaseUnits: bigint;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface VerifiedLateFundingEvent {
  transactionHash: `0x${string}`;
  logIndex: number;
  fromAddress: `0x${string}`;
  amountBaseUnits: bigint;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface ArcEscrowGateway {
  assertArcChain(): Promise<void>;
  getCanonicalUsdcBalance(address: `0x${string}`): Promise<bigint>;
  getEscrowTotalFunded(address: `0x${string}`): Promise<bigint>;
  getGatewayConfirmedBalance(network: import('@bug-bounty-escrow/shared').FundingNetworkId, wallet: `0x${string}`): Promise<bigint>;
  verifySourceDeposit(input: {
    network: import('@bug-bounty-escrow/shared').FundingNetworkId;
    walletAddress: `0x${string}`;
    amountBaseUnits: bigint;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedSourceDeposit>;
  verifyDeployment(input: {
    artifact: EscrowArtifact;
    contractAddress: `0x${string}`;
    transactionHash: `0x${string}`;
    expectedBlockNumber: bigint;
    expectedBlockHash: `0x${string}`;
    programKey: `0x${string}`;
    ownerWallet: `0x${string}`;
    refundUnlockAt: bigint;
    withdrawRecipient: `0x${string}`;
  }): Promise<void>;
  verifyFundingDestination(input: {
    escrowAddress: `0x${string}`;
    routeMode: import('@bug-bounty-escrow/shared').FundingRouteMode;
    walletAddress: `0x${string}`;
    destinationTransactionHash: `0x${string}`;
    preBalanceBaseUnits: bigint;
  }): Promise<VerifiedFundingDestination>;
  verifyFundingSync(input: {
    escrowAddress: `0x${string}`;
    transactionHash: `0x${string}`;
    minimumTotalFundedBaseUnits: bigint;
  }): Promise<VerifiedSync>;
  getWithdrawalState(address: `0x${string}`): Promise<EscrowWithdrawalState>;
  verifyClose(input: {
    escrowAddress: `0x${string}`;
    ownerWallet: `0x${string}`;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedClose>;
  verifyWithdrawal(input: {
    escrowAddress: `0x${string}`;
    recipientAddress: `0x${string}`;
    transactionHash: `0x${string}`;
    expectedAmountBaseUnits: bigint;
    preTotalWithdrawnBaseUnits: bigint;
  }): Promise<VerifiedWithdrawal>;
  findLateFunding(input: {
    escrowAddress: `0x${string}`;
    fromBlock: bigint;
  }): Promise<{ events: readonly VerifiedLateFundingEvent[]; scannedThroughBlock: bigint }>;
}

export class EscrowProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'EscrowProviderError';
  }
}
