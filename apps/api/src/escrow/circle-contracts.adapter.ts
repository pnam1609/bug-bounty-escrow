import {
  initiateSmartContractPlatformClient,
  type CircleSmartContractPlatformClient,
} from '@circle-fin/smart-contract-platform';
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';
import { z } from 'zod';

import {
  EscrowProviderError,
  type CircleContractsGateway,
  type CircleDeployInput,
  type CircleDeploymentAccepted,
  type CircleDeploymentResult,
} from './escrow-gateways.js';

type ContractsClient = Pick<CircleSmartContractPlatformClient, 'deployContract' | 'getContract'>;
type WalletsClient = Pick<
  CircleDeveloperControlledWalletsClient,
  'createContractExecutionTransaction' | 'getTransaction' | 'getWallet'
>;

const uuidSchema = z.string().uuid();
const uuidV4Schema = uuidSchema.refine(
  (value) => value[14]?.toLowerCase() === '4',
  'Expected UUIDv4',
);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const acceptedSchema = z.union([
  z.object({ contractId: uuidSchema, transactionId: uuidSchema }),
  z
    .object({ contractIds: z.array(uuidSchema).min(1).max(1), transactionId: uuidSchema })
    .transform(({ contractIds, transactionId }) => ({
      contractId: contractIds[0]!,
      transactionId,
    })),
]);
const transactionSchema = z.object({
  id: uuidSchema,
  state: z.string(),
  blockchain: z.literal('ARC-TESTNET'),
  walletId: uuidSchema,
  txHash: hashSchema.optional(),
  contractAddress: addressSchema.optional(),
  sourceAddress: addressSchema.optional(),
  blockHash: hashSchema.optional(),
  blockHeight: z.number().int().nonnegative().optional(),
});
const contractSchema = z.object({
  id: uuidSchema,
  status: z.string(),
  blockchain: z.literal('ARC-TESTNET'),
  contractAddress: addressSchema.optional(),
});
const createdTransactionSchema = z.object({ id: uuidSchema });
const walletSchema = z.object({
  id: uuidSchema,
  address: addressSchema,
  blockchain: z.literal('ARC-TESTNET'),
  custodyType: z.literal('DEVELOPER'),
  accountType: z.literal('SCA'),
  state: z.literal('LIVE'),
});

function readCircleConfig(config: ApiEnvironment):
  | {
      apiKey: string;
      entitySecret: string;
      walletId: string;
    }
  | undefined {
  if (
    !config.CIRCLE_CONTRACTS_ENABLED ||
    config.CIRCLE_API_KEY === undefined ||
    config.CIRCLE_ENTITY_SECRET === undefined ||
    config.CIRCLE_DEPLOYMENT_WALLET_ID === undefined
  ) {
    return undefined;
  }
  return {
    apiKey: config.CIRCLE_API_KEY,
    entitySecret: config.CIRCLE_ENTITY_SECRET,
    walletId: config.CIRCLE_DEPLOYMENT_WALLET_ID,
  };
}

function extractSdkData(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || !('data' in input)) return undefined;
  return (input as { data?: unknown }).data;
}

export class CircleContractsAdapter implements CircleContractsGateway {
  private readonly contracts?: ContractsClient;
  private readonly wallets?: WalletsClient;
  private readonly walletId?: string;

  public constructor(
    private readonly config: ApiEnvironment,
    clients?: { contracts: ContractsClient; wallets: WalletsClient },
    private readonly delay: (milliseconds: number, signal?: AbortSignal) => Promise<void> = (
      milliseconds,
      signal,
    ) =>
      new Promise((resolve, reject) => {
        const finish = () => {
          signal?.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          reject(new EscrowProviderError('circle_request_aborted', true));
        };
        const timeout = setTimeout(finish, milliseconds);
        signal?.addEventListener('abort', abort, { once: true });
      }),
  ) {
    const required = readCircleConfig(config);
    if (required === undefined) return;
    this.walletId = required.walletId;
    this.contracts =
      clients?.contracts ??
      initiateSmartContractPlatformClient({
        apiKey: required.apiKey,
        entitySecret: required.entitySecret,
        baseUrl: config.CIRCLE_API_BASE_URL,
        userAgent: 'bounty-escrow-api/cp13',
      });
    this.wallets =
      clients?.wallets ??
      initiateDeveloperControlledWalletsClient({
        apiKey: required.apiKey,
        entitySecret: required.entitySecret,
        baseUrl: config.CIRCLE_API_BASE_URL,
        userAgent: 'bounty-escrow-api/cp13',
      });
  }

  public async getDeploymentWalletAddress(): Promise<`0x${string}`> {
    const { wallets, walletId } = this.requireClients();
    try {
      const response = await this.withTimeout(wallets.getWallet({ id: walletId }));
      const wallet = walletSchema.parse(
        (extractSdkData(response) as { wallet?: unknown } | undefined)?.wallet,
      );
      if (wallet.id !== walletId) {
        throw new EscrowProviderError('circle_deployment_wallet_mismatch', false);
      }
      return wallet.address.toLowerCase() as `0x${string}`;
    } catch (error) {
      throw this.providerError(error, 'circle_wallet_lookup_failed');
    }
  }

  public async deploy(input: CircleDeployInput): Promise<CircleDeploymentAccepted> {
    const { contracts, walletId } = this.requireClients();
    try {
      uuidV4Schema.parse(input.idempotencyKey);
      const response = await this.withTimeout(
        // Circle's deploy endpoint requires both the target network and the
        // configured developer-controlled wallet. The wallet ID selects the
        // source SCA while blockchain binds the request to Arc Testnet.
        contracts.deployContract({
          idempotencyKey: input.idempotencyKey,
          name: `BountyEscrow${input.programId.replaceAll('-', '').slice(0, 12)}`,
          description: `BountyEscrowProgram${input.programId.replaceAll('-', '')}`,
          blockchain: 'ARC-TESTNET',
          walletId,
          abiJson: JSON.stringify(input.artifact.abi),
          bytecode: input.artifact.bytecode,
          constructorParameters: input.ownerWallet === undefined
            ? [input.programKey, input.platformAdminWallet, input.tokenAddress, input.refundUnlockAt.toString(), input.withdrawRecipient]
            : [input.programKey, input.ownerWallet, input.platformAdminWallet, input.tokenAddress, input.refundUnlockAt.toString(), input.withdrawRecipient],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        } as unknown as Parameters<ContractsClient['deployContract']>[0]),
      );
      return acceptedSchema.parse(extractSdkData(response));
    } catch (error) {
      throw this.providerError(error, 'circle_deploy_failed');
    }
  }

  public async waitForDeployment(
    accepted: CircleDeploymentAccepted,
    signal?: AbortSignal,
  ): Promise<CircleDeploymentResult> {
    const { contracts, wallets, walletId } = this.requireClients();
    const deadline = Date.now() + this.config.CIRCLE_POLL_TIMEOUT_MS;
    let attempt = 0;
    while (Date.now() < deadline) {
      try {
        const [transactionResponse, contractResponse] = await Promise.all([
          this.withTimeout(wallets.getTransaction({ id: accepted.transactionId }), signal),
          this.withTimeout(contracts.getContract({ id: accepted.contractId }), signal),
        ]);
        const transaction = transactionSchema.parse(
          (extractSdkData(transactionResponse) as { transaction?: unknown } | undefined)
            ?.transaction,
        );
        const contract = contractSchema.parse(
          (extractSdkData(contractResponse) as { contract?: unknown } | undefined)?.contract,
        );
        if (transaction.walletId !== walletId) {
          throw new EscrowProviderError('circle_deployment_wallet_mismatch', false);
        }
        if (
          ['FAILED', 'CANCELLED', 'DENIED'].includes(transaction.state) ||
          contract.status === 'FAILED'
        ) {
          return { state: 'failed', failureCode: 'circle_deployment_failed' };
        }
        if (
          transaction.state === 'COMPLETE' &&
          contract.status === 'COMPLETE' &&
          transaction.txHash !== undefined &&
          transaction.blockHash !== undefined &&
          transaction.blockHeight !== undefined &&
          transaction.sourceAddress !== undefined &&
          contract.contractAddress !== undefined
        ) {
          if (
            transaction.contractAddress !== undefined &&
            transaction.contractAddress.toLowerCase() !== contract.contractAddress.toLowerCase()
          ) {
            throw new EscrowProviderError('circle_contract_address_mismatch', false);
          }
          return {
            state: 'confirmed',
            contractAddress: contract.contractAddress as `0x${string}`,
            transactionHash: transaction.txHash as `0x${string}`,
            blockHash: transaction.blockHash as `0x${string}`,
            blockNumber: BigInt(transaction.blockHeight),
            deploymentWalletAddress: transaction.sourceAddress as `0x${string}`,
          };
        }
      } catch (error) {
        const mapped = this.providerError(error, 'circle_poll_failed');
        if (!mapped.retryable) throw mapped;
      }
      await this.delay(this.pollDelay(attempt++), signal);
    }
    throw new EscrowProviderError('circle_poll_timeout', true);
  }

  public async submitSyncExternalFunding(input: {
    idempotencyKey: string;
    escrowAddress: `0x${string}`;
  }): Promise<{ transactionId: string }> {
    const { wallets, walletId } = this.requireClients();
    try {
      uuidV4Schema.parse(input.idempotencyKey);
      const response = await this.withTimeout(
        wallets.createContractExecutionTransaction({
          idempotencyKey: input.idempotencyKey,
          walletId,
          contractAddress: input.escrowAddress,
          abiFunctionSignature: 'syncExternalFunding()',
          abiParameters: [],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        }),
      );
      const parsed = createdTransactionSchema.parse(extractSdkData(response));
      return { transactionId: parsed.id };
    } catch (error) {
      throw this.providerError(error, 'circle_sync_submit_failed');
    }
  }

  public async registerProgramEscrow(input: {
    idempotencyKey: string;
    adminContractAddress: `0x${string}`;
    programKey: `0x${string}`;
    escrowAddress: `0x${string}`;
  }): Promise<{ transactionId: string }> {
    const { wallets, walletId } = this.requireClients();
    try {
      uuidV4Schema.parse(input.idempotencyKey);
      const response = await this.withTimeout(
        wallets.createContractExecutionTransaction({
          idempotencyKey: input.idempotencyKey,
          walletId,
          contractAddress: input.adminContractAddress,
          abiFunctionSignature: 'registerProgramEscrow(bytes32,address)',
          abiParameters: [input.programKey, input.escrowAddress],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        }),
      );
      const parsed = createdTransactionSchema.parse(extractSdkData(response));
      return { transactionId: parsed.id };
    } catch (error) {
      throw this.providerError(error, 'circle_admin_registration_submit_failed');
    }
  }

  public async submitRewardPayout(input: {
    idempotencyKey: string;
    escrowAddress: `0x${string}`;
    reportKey: `0x${string}`;
  }): Promise<{ transactionId: string }> {
    const { wallets, walletId } = this.requireClients();
    try {
      uuidV4Schema.parse(input.idempotencyKey);
      const response = await this.withTimeout(
        wallets.createContractExecutionTransaction({
          idempotencyKey: input.idempotencyKey,
          walletId,
          contractAddress: input.escrowAddress,
          abiFunctionSignature: 'payReward(bytes32)',
          abiParameters: [input.reportKey],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
        }),
      );
      const parsed = createdTransactionSchema.parse(extractSdkData(response));
      return { transactionId: parsed.id };
    } catch (error) {
      throw this.providerError(error, 'circle_reward_payout_submit_failed');
    }
  }

  public async waitForTransaction(
    transactionId: string,
    signal?: AbortSignal,
  ): Promise<{
    state: 'confirmed' | 'failed';
    transactionHash?: `0x${string}`;
    failureCode?: string;
  }> {
    const { wallets, walletId } = this.requireClients();
    const deadline = Date.now() + this.config.CIRCLE_POLL_TIMEOUT_MS;
    let attempt = 0;
    while (Date.now() < deadline) {
      try {
        const response = await this.withTimeout(
          wallets.getTransaction({ id: transactionId }),
          signal,
        );
        const transaction = transactionSchema.parse(
          (extractSdkData(response) as { transaction?: unknown } | undefined)?.transaction,
        );
        if (transaction.walletId !== walletId) {
          throw new EscrowProviderError('circle_transaction_wallet_mismatch', false);
        }
        if (['FAILED', 'CANCELLED', 'DENIED'].includes(transaction.state)) {
          return { state: 'failed', failureCode: 'circle_transaction_failed' };
        }
        if (transaction.state === 'COMPLETE' && transaction.txHash !== undefined) {
          return {
            state: 'confirmed',
            transactionHash: transaction.txHash as `0x${string}`,
          };
        }
      } catch (error) {
        const mapped = this.providerError(error, 'circle_poll_failed');
        if (!mapped.retryable) throw mapped;
      }
      await this.delay(this.pollDelay(attempt++), signal);
    }
    throw new EscrowProviderError('circle_poll_timeout', true);
  }

  private async withTimeout<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EscrowProviderError('circle_request_timeout', true)),
        this.config.CIRCLE_REQUEST_TIMEOUT_MS,
      );
      abortListener = () => reject(new EscrowProviderError('circle_request_aborted', true));
      signal?.addEventListener('abort', abortListener, { once: true });
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortListener !== undefined) signal?.removeEventListener('abort', abortListener);
    }
  }

  private providerError(error: unknown, fallbackCode: string): EscrowProviderError {
    if (error instanceof EscrowProviderError) return error;
    if (error instanceof z.ZodError) {
      return new EscrowProviderError('circle_response_invalid', false);
    }
    if (typeof error === 'object' && error !== null) {
      // The Circle SDK exposes HTTP status on the error itself (`status`).
      // Some HTTP clients wrap it under `response.status`, so support both
      // shapes.  Without the top-level check, a Circle 4xx validation error
      // is treated as an unknown/retryable failure and surfaces as HTTP 503.
      const providerError = error as {
        status?: unknown;
        response?: { status?: unknown };
      };
      const status =
        typeof providerError.status === 'number'
          ? providerError.status
          : providerError.response?.status;
      if (typeof status === 'number') {
        const retryable = status === 408 || status === 429 || status >= 500;
        return new EscrowProviderError(
          retryable ? 'circle_temporarily_unavailable' : 'circle_request_rejected',
          retryable,
          status,
        );
      }
    }
    return new EscrowProviderError(fallbackCode, true);
  }

  private pollDelay(attempt: number): number {
    return Math.min(this.config.CIRCLE_POLL_INTERVAL_MS * 2 ** Math.min(attempt, 4), 10_000);
  }

  private requireClients(): {
    contracts: ContractsClient;
    wallets: WalletsClient;
    walletId: string;
  } {
    if (this.contracts === undefined || this.wallets === undefined || this.walletId === undefined) {
      throw new EscrowProviderError('circle_contracts_disabled', false);
    }
    return { contracts: this.contracts, wallets: this.wallets, walletId: this.walletId };
  }
}
