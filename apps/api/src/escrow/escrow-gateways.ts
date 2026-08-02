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
  platformAdminWallet?: `0x${string}`;
  /** @deprecated rolling-deploy compatibility; server code never uses it. */
  ownerWallet?: `0x${string}`;
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
  getDeploymentWalletAddress(): Promise<`0x${string}`>;
  deploy(input: CircleDeployInput): Promise<CircleDeploymentAccepted>;
  waitForDeployment(
    accepted: CircleDeploymentAccepted,
    signal?: AbortSignal,
  ): Promise<CircleDeploymentResult>;
  registerProgramEscrow(input: {
    idempotencyKey: string;
    adminContractAddress: `0x${string}`;
    programKey: `0x${string}`;
    escrowAddress: `0x${string}`;
  }): Promise<{ transactionId: string }>;
  submitSyncExternalFunding(input: {
    idempotencyKey: string;
    escrowAddress: `0x${string}`;
  }): Promise<{ transactionId: string }>;
  submitRewardPayout(input: {
    idempotencyKey: string;
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
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

export type TransactionRecoveryEvidence =
  | { state: 'pending' }
  | {
      state: 'success' | 'reverted';
      blockNumber: bigint;
      blockHash: `0x${string}`;
    };

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

export interface VerifiedRewardApproval {
  transactionHash: `0x${string}`;
  eventLogIndex: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
}

export interface VerifiedRewardPayout extends VerifiedRewardApproval {
  transferLogIndex: number;
  accounting: {
    totalPaidBaseUnits: bigint;
    totalApprovedOutstandingBaseUnits: bigint;
    totalFundedBaseUnits: bigint;
    totalWithdrawnBaseUnits: bigint;
    escrowBalanceBaseUnits: bigint;
  };
}

export interface ArcEscrowGateway {
  assertArcChain(): Promise<void>;
  getCanonicalUsdcBalance(address: `0x${string}`): Promise<bigint>;
  getEscrowTotalFunded(address: `0x${string}`): Promise<bigint>;
  getGatewayConfirmedBalance(
    network: import('@bug-bounty-escrow/shared').FundingNetworkId,
    wallet: `0x${string}`,
  ): Promise<bigint>;
  getTransactionRecoveryEvidence(input: {
    network: import('@bug-bounty-escrow/shared').FundingNetworkId;
    transactionHash: `0x${string}`;
  }): Promise<TransactionRecoveryEvidence>;
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
    platformAdminWallet?: `0x${string}`;
    ownerWallet?: `0x${string}`;
    refundUnlockAt: bigint;
    withdrawRecipient: `0x${string}`;
  }): Promise<void>;
  verifyDeploymentFeePayment(input: {
    transactionHash: `0x${string}`;
    payerAddress: `0x${string}`;
    recipientAddress: `0x${string}`;
    tokenAddress: `0x${string}`;
    amountBaseUnits: bigint;
    chainId: number;
  }): Promise<{ blockNumber: bigint; blockHash: `0x${string}`; logIndex: number }>;
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
  verifyRewardApproval(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedRewardApproval>;
  findRewardApproval(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    fromBlock: bigint;
  }): Promise<VerifiedRewardApproval | null>;
  verifyRewardPayout(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    transactionHash: `0x${string}`;
  }): Promise<VerifiedRewardPayout>;
  findRewardPayout(input: {
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
    approvedContentHash: `0x${string}`;
    recipientAddress: `0x${string}`;
    amountBaseUnits: bigint;
    fromBlock: bigint;
  }): Promise<VerifiedRewardPayout | null>;
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
    /** HTTP status returned by the provider when this was a request validation error. */
    public readonly providerStatus?: number,
  ) {
    super(code);
    this.name = 'EscrowProviderError';
  }
}
