import { z } from 'zod';

import {
  evmAddressSchema,
  isoDateTimeSchema,
  monetaryAmountSchema,
  transactionHashSchema,
  uuidSchema,
} from '../schemas/primitives.js';

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const FUNDING_NETWORK_IDS = Object.freeze([
  'Arc_Testnet',
  'Ethereum_Sepolia',
  'Arbitrum_Sepolia',
  'Base_Sepolia',
] as const);

export const FUNDING_NETWORK_CONFIG = Object.freeze({
  Arc_Testnet: { chainId: 5_042_002, gatewayDomain: 26, tokenAddress: ARC_TESTNET_USDC_ADDRESS },
  Ethereum_Sepolia: {
    chainId: 11_155_111,
    gatewayDomain: 0,
    tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  Arbitrum_Sepolia: {
    chainId: 421_614,
    gatewayDomain: 3,
    tokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
  Base_Sepolia: {
    chainId: 84_532,
    gatewayDomain: 6,
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
} as const);
export const GATEWAY_WALLET_EVM_TESTNET_ADDRESS =
  '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

export const fundingNetworkIdSchema = z.enum(FUNDING_NETWORK_IDS);
export const fundingRouteModeSchema = z.enum(['send', 'bridge', 'unified_balance']);
export const uuidV4Schema = z
  .string()
  .uuid()
  .refine((value) => value[14]?.toLowerCase() === '4', 'Expected a UUIDv4');

const MAX_UINT256 = (1n << 256n) - 1n;
/** Matches PostgreSQL `numeric(30,6)` used by the program accounting projection. */
const MAX_PROGRAM_USDC_BASE_UNITS = 10n ** 30n - 1n;

export function parseUsdcBaseUnits(value: string): bigint | undefined {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (match === null) return undefined;
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(6, '0');
  const baseUnits = BigInt(whole) * 1_000_000n + BigInt(fraction);
  return baseUnits <= MAX_UINT256 && baseUnits <= MAX_PROGRAM_USDC_BASE_UNITS
    ? baseUnits
    : undefined;
}

export function formatUsdcBaseUnits(value: bigint): string {
  if (value < 0n || value > MAX_UINT256) {
    throw new RangeError('USDC base units must fit uint256');
  }
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

export function deriveFundingRouteMode(
  sources: readonly { network: FundingNetworkId }[],
): FundingRouteMode {
  if (sources.length >= 2) return 'unified_balance';
  return sources[0]?.network === 'Arc_Testnet' ? 'send' : 'bridge';
}

export const usdcAmountSchema = monetaryAmountSchema.refine(
  (value) => (parseUsdcBaseUnits(value) ?? 0n) > 0n,
  'USDC amount must be positive with at most 6 decimal places',
);
export const usdcNonNegativeAmountSchema = monetaryAmountSchema.refine(
  (value) => parseUsdcBaseUnits(value) !== undefined,
  'USDC amount must be non-negative, fit uint256, and have at most 6 decimal places',
);

export const fundingSourceSchema = z
  .object({
    network: fundingNetworkIdSchema,
    amount: usdcAmountSchema,
  })
  .strict();
export const fundingFeeAllocationSchema = z
  .object({
    network: fundingNetworkIdSchema,
    amount: usdcNonNegativeAmountSchema,
  })
  .strict();

export const sourceDepositStatusSchema = z.enum([
  'awaiting_signature',
  'submission_uncertain',
  'submitted',
  'onchain_verified',
  'gateway_finalized',
  'confirmed',
  'failed',
]);

export const sourceDepositSchema = z
  .object({
    id: uuidSchema,
    attemptNo: z.number().int().positive(),
    replacesDepositId: uuidSchema.optional(),
    network: fundingNetworkIdSchema,
    chainId: z.number().int().positive(),
    tokenAddress: evmAddressSchema,
    gatewayWalletAddress: evmAddressSchema,
    walletAddress: evmAddressSchema,
    amount: usdcAmountSchema,
    preGatewayBalance: usdcNonNegativeAmountSchema,
    status: sourceDepositStatusSchema,
    transactionHash: transactionHashSchema.optional(),
    logIndex: z.number().int().nonnegative().optional(),
    transferLogIndex: z.number().int().nonnegative().optional(),
    blockNumber: z.string().regex(/^(0|[1-9]\d*)$/).optional(),
    blockHash: transactionHashSchema.optional(),
    failureCode: z.string().regex(/^[a-z][a-z0-9._-]{0,127}$/).optional(),
    canAttach: z.literal(true),
    canRetry: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const expected = FUNDING_NETWORK_CONFIG[value.network];
    if (value.chainId !== expected.chainId) {
      context.addIssue({ code: 'custom', path: ['chainId'], message: 'Unexpected chain ID' });
    }
    if (value.tokenAddress.toLowerCase() !== expected.tokenAddress.toLowerCase()) {
      context.addIssue({ code: 'custom', path: ['tokenAddress'], message: 'Unexpected canonical USDC address' });
    }
    if (value.gatewayWalletAddress.toLowerCase() !== GATEWAY_WALLET_EVM_TESTNET_ADDRESS.toLowerCase()) {
      context.addIssue({ code: 'custom', path: ['gatewayWalletAddress'], message: 'Unexpected Gateway Wallet address' });
    }
    if (value.status === 'confirmed') {
      for (const field of ['transactionHash', 'logIndex', 'blockNumber', 'blockHash'] as const) {
        if (value[field] === undefined) {
          context.addIssue({ code: 'custom', path: [field], message: `${field} is required for a confirmed source deposit` });
        }
      }
    }
    if (value.status === 'failed' && value.failureCode === undefined) {
      context.addIssue({ code: 'custom', path: ['failureCode'], message: 'failureCode is required for a failed source deposit' });
    }
  });

export const createSourceDepositRequestSchema = z.object({ network: fundingNetworkIdSchema }).strict();
export const sourceDepositParamsSchema = z
  .object({ id: uuidSchema, intentId: uuidSchema, depositId: uuidSchema })
  .strict();
export const observeSourceDepositRequestSchema = z
  .object({
    outcome: z.enum(['submitted', 'submission_uncertain']),
    transactionHash: transactionHashSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === 'submitted' && value.transactionHash === undefined) {
      context.addIssue({ code: 'custom', path: ['transactionHash'], message: 'transactionHash is required for submitted' });
    }
  });
export const attachSourceDepositRequestSchema = z.object({ transactionHash: transactionHashSchema }).strict();
export const refreshFundingQuoteRequestSchema = z
  .object({
    estimatedFeeReserve: usdcNonNegativeAmountSchema,
    feeAllocations: z.array(fundingFeeAllocationSchema).min(1).max(FUNDING_NETWORK_IDS.length),
    quotedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const networks = value.feeAllocations.map(({ network }) => network);
    if (new Set(networks).size !== networks.length) {
      context.addIssue({ code: 'custom', path: ['feeAllocations'], message: 'Fee allocation networks must be unique' });
    }
    const total = value.feeAllocations.reduce(
      (sum, entry) => sum + (parseUsdcBaseUnits(entry.amount) ?? 0n),
      0n,
    );
    if (total !== parseUsdcBaseUnits(value.estimatedFeeReserve)) {
      context.addIssue({ code: 'custom', path: ['feeAllocations'], message: 'Fee allocations must equal estimatedFeeReserve' });
    }
  });
export const circleGatewayDepositFinalizedWebhookSchema = z
  .object({
    subscriptionId: uuidSchema,
    notificationId: uuidSchema,
    notificationType: z.literal('gateway.deposit.finalized'),
    notification: z
      .object({
        id: uuidSchema,
        walletAddress: evmAddressSchema,
        domain: z.enum(['0', '3', '6', '26']),
        env: z.literal('testnet'),
        tokenAddress: evmAddressSchema,
        amount: usdcAmountSchema,
        from: evmAddressSchema,
        to: evmAddressSchema,
        txHash: transactionHashSchema,
      })
      .strict(),
    timestamp: isoDateTimeSchema,
    version: z.literal(2),
  })
  .strict();

export const createFundingIntentRequestSchema = z
  .object({
    idempotencyKey: uuidV4Schema,
    walletAddress: evmAddressSchema,
    grossAmount: usdcAmountSchema,
    estimatedFeeReserve: usdcNonNegativeAmountSchema,
    feeAllocations: z.array(fundingFeeAllocationSchema).min(1).max(FUNDING_NETWORK_IDS.length),
    quoteQuotedAt: isoDateTimeSchema,
    quoteExpiresAt: isoDateTimeSchema,
    sources: z.array(fundingSourceSchema).min(1).max(FUNDING_NETWORK_IDS.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.quoteExpiresAt) <= Date.parse(value.quoteQuotedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['quoteExpiresAt'],
        message: 'quoteExpiresAt must be after quoteQuotedAt',
      });
    }
    const networks = value.sources.map(({ network }) => network);
    if (new Set(networks).size !== networks.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Each funding network may appear only once',
      });
    }
    const feeNetworks = value.feeAllocations.map(({ network }) => network);
    if (
      new Set(feeNetworks).size !== feeNetworks.length ||
      feeNetworks.length !== networks.length ||
      feeNetworks.some((network) => !networks.includes(network))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['feeAllocations'],
        message: 'Fee allocations must cover each selected source exactly once',
      });
    }

    const gross = parseUsdcBaseUnits(value.grossAmount);
    const fee = parseUsdcBaseUnits(value.estimatedFeeReserve);
    const sourceTotal = value.sources.reduce(
      (total, source) => total + (parseUsdcBaseUnits(source.amount) ?? 0n),
      0n,
    );
    const feeAllocationTotal = value.feeAllocations.reduce(
      (total, allocation) => total + (parseUsdcBaseUnits(allocation.amount) ?? 0n),
      0n,
    );
    if (gross !== undefined && sourceTotal !== gross) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Funding source allocations must equal grossAmount',
      });
    }
    if (fee !== undefined && feeAllocationTotal !== fee) {
      context.addIssue({
        code: 'custom',
        path: ['feeAllocations'],
        message: 'Fee allocations must equal estimatedFeeReserve',
      });
    }
    if (
      gross !== undefined &&
      fee !== undefined &&
      gross + fee > MAX_PROGRAM_USDC_BASE_UNITS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['estimatedFeeReserve'],
        message: 'Gross amount plus fee reserve exceeds the supported accounting bound',
      });
    }
  });

export const fundingIntentStatusSchema = z.enum([
  'ready_to_sign',
  'awaiting_signature',
  'source_submitted',
  'destination_submitted',
  'delivery_pending',
  'verifying_destination',
  'syncing_pool',
  'sync_failed',
  'complete',
  'failed',
  'cancelled',
]);

export const fundingConfirmationArtifactSchema = z
  .object({
    fundingIntentId: uuidSchema,
    programId: uuidSchema,
    routeMode: fundingRouteModeSchema,
    escrowAddress: evmAddressSchema,
    artifactVersion: z.literal('1.1.0'),
    artifactChecksum: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    tokenAddress: z.literal(ARC_TESTNET_USDC_ADDRESS),
    tokenDecimals: z.literal(6),
    destinationTransactionHash: transactionHashSchema,
    destinationLogIndex: z.number().int().nonnegative(),
    destinationBlockNumber: z.string().regex(/^(0|[1-9]\d*)$/),
    destinationBlockHash: transactionHashSchema,
    syncTransactionHash: transactionHashSchema,
    syncLogIndex: z.number().int().nonnegative().optional(),
    syncBlockNumber: z.string().regex(/^(0|[1-9]\d*)$/),
    syncBlockHash: transactionHashSchema,
    grossAmount: usdcAmountSchema,
    estimatedFeeReserve: usdcNonNegativeAmountSchema,
    netReceivedAmount: usdcAmountSchema,
    preTotalFundedAmount: usdcNonNegativeAmountSchema,
    requiredTotalFundedAmount: usdcAmountSchema,
    postTotalFundedAmount: usdcAmountSchema,
    accounting: z
      .object({
        totalPool: usdcNonNegativeAmountSchema,
        totalPaid: usdcNonNegativeAmountSchema,
        totalWithdrawn: usdcNonNegativeAmountSchema,
        approvedOutstanding: usdcNonNegativeAmountSchema,
        availablePool: usdcNonNegativeAmountSchema,
      })
      .strict(),
    reconciledAt: isoDateTimeSchema,
  })
  .strict();

export const fundingConfirmationArtifactResponseSchema = z
  .object({ success: z.literal(true), data: fundingConfirmationArtifactSchema })
  .strict();

export const fundingIntentSchema = z
  .object({
    id: uuidSchema,
    programId: uuidSchema,
    walletAddress: evmAddressSchema,
    routeMode: fundingRouteModeSchema,
    grossAmount: usdcAmountSchema,
    estimatedFeeReserve: usdcNonNegativeAmountSchema,
    feeAllocations: z.array(fundingFeeAllocationSchema).min(1).max(FUNDING_NETWORK_IDS.length),
    quoteQuotedAt: isoDateTimeSchema.optional(),
    quoteExpiresAt: isoDateTimeSchema.optional(),
    sources: z.array(fundingSourceSchema),
    sourceDeposits: z.array(sourceDepositSchema),
    destinationChain: z.literal('Arc_Testnet'),
    recipientAddress: evmAddressSchema,
    recipientVerified: z.literal(true),
    status: fundingIntentStatusSchema,
    destinationTransactionHash: transactionHashSchema.optional(),
    transferId: z.string().max(256).optional(),
    netReceivedAmount: usdcAmountSchema.optional(),
    confirmationArtifact: fundingConfirmationArtifactSchema.optional(),
    failureCode: z.string().max(128).optional(),
    recovery: z
      .object({
        attemptNo: z.number().int().positive(),
        replacesOperationId: uuidSchema.optional(),
        operationId: z.string().min(1).max(320).optional(),
        transferId: z.string().min(1).max(256).optional(),
        failureCode: z.string().min(1).max(128).optional(),
        providerState: z.enum(['pending', 'success', 'error']).optional(),
        retryable: z.boolean(),
        submissionUncertain: z.boolean(),
        sourceTransactionHashes: z.array(transactionHashSchema).max(32),
        steps: z
          .array(
            z
              .object({
                name: z.string().min(1).max(64),
                state: z.enum(['pending', 'success', 'error']),
                transactionHash: transactionHashSchema.optional(),
                errorCode: z.string().min(1).max(128).optional(),
              })
              .strict(),
          )
          .max(32),
      })
      .strict()
      .optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (deriveFundingRouteMode(value.sources) !== value.routeMode) {
      context.addIssue({
        code: 'custom',
        path: ['routeMode'],
        message: 'routeMode does not match the selected funding sources',
      });
    }
    const networks = value.sources.map(({ network }) => network);
    if (new Set(networks).size !== networks.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Each funding network may appear only once',
      });
    }
    const feeNetworks = value.feeAllocations.map(({ network }) => network);
    if (
      new Set(feeNetworks).size !== feeNetworks.length ||
      feeNetworks.length !== networks.length ||
      feeNetworks.some((network) => !networks.includes(network))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['feeAllocations'],
        message: 'Fee allocations must cover each selected source exactly once',
      });
    }
    const gross = parseUsdcBaseUnits(value.grossAmount);
    const fee = parseUsdcBaseUnits(value.estimatedFeeReserve);
    const sourceTotal = value.sources.reduce(
      (total, source) => total + (parseUsdcBaseUnits(source.amount) ?? 0n),
      0n,
    );
    const feeAllocationTotal = value.feeAllocations.reduce(
      (total, allocation) => total + (parseUsdcBaseUnits(allocation.amount) ?? 0n),
      0n,
    );
    if (gross !== undefined && sourceTotal !== gross) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'Funding source allocations must equal grossAmount',
      });
    }
    if (fee !== undefined && feeAllocationTotal !== fee) {
      context.addIssue({
        code: 'custom',
        path: ['feeAllocations'],
        message: 'Fee allocations must equal estimatedFeeReserve',
      });
    }
    if (
      gross !== undefined &&
      fee !== undefined &&
      gross + fee > MAX_PROGRAM_USDC_BASE_UNITS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['estimatedFeeReserve'],
        message: 'Gross amount plus fee reserve exceeds the supported accounting bound',
      });
    }
    const destinationRequired = [
      'destination_submitted',
      'delivery_pending',
      'verifying_destination',
      'syncing_pool',
      'sync_failed',
      'complete',
    ].includes(value.status);
    if (destinationRequired && value.destinationTransactionHash === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['destinationTransactionHash'],
        message: `destinationTransactionHash is required for ${value.status}`,
      });
    }
    if (value.status === 'complete' && value.netReceivedAmount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['netReceivedAmount'],
        message: 'netReceivedAmount is required for a complete intent',
      });
    }
    if (value.status === 'complete' && value.confirmationArtifact === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['confirmationArtifact'],
        message: 'confirmationArtifact is required for a complete intent',
      });
    }
    if (value.status === 'failed' && value.failureCode === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'failureCode is required for a failed intent',
      });
    }
    if (!['failed', 'sync_failed'].includes(value.status) && value.failureCode !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: `failureCode is not valid for ${value.status}`,
      });
    }
  });

export const fundingIntentResponseSchema = z
  .object({ success: z.literal(true), data: fundingIntentSchema })
  .strict();

export const gatewayFundingReadinessSchema = z
  .object({
    intentId: uuidSchema,
    ready: z.boolean(),
    requiredConfirmedTotal: usdcAmountSchema,
    confirmedSelectedTotal: usdcNonNegativeAmountSchema,
    sources: z
      .array(
        z
          .object({
            network: fundingNetworkIdSchema,
            hasFeeHeadroom: z.boolean(),
            allocation: usdcAmountSchema,
            feeReserve: usdcNonNegativeAmountSchema,
            requiredConfirmed: usdcAmountSchema,
            confirmed: usdcNonNegativeAmountSchema,
            deficit: usdcNonNegativeAmountSchema,
          })
          .strict(),
      )
      .min(2)
      .max(FUNDING_NETWORK_IDS.length),
  })
  .strict();
export const gatewayFundingReadinessResponseSchema = z
  .object({ success: z.literal(true), data: gatewayFundingReadinessSchema })
  .strict();

export const fundingIntentParamsSchema = z
  .object({ id: uuidSchema, intentId: uuidSchema })
  .strict();

export const observeFundingOperationRequestSchema = z
  .object({
    operationId: z.string().max(256).optional(),
    destinationTransactionHash: transactionHashSchema.optional(),
    transferId: z.string().max(256).optional(),
    sourceTransactionHashes: z.array(transactionHashSchema).max(32).optional(),
    providerState: z.enum(['pending', 'success', 'error']).optional(),
    retryable: z.boolean().optional(),
    submissionUncertain: z.boolean().optional(),
    steps: z
      .array(
        z
          .object({
            name: z.string().min(1).max(64),
            state: z.enum(['pending', 'success', 'error']),
            transactionHash: transactionHashSchema.optional(),
            errorCode: z.string().min(1).max(128).optional(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.operationId === undefined &&
      value.destinationTransactionHash === undefined &&
      value.transferId === undefined &&
      (value.sourceTransactionHashes?.length ?? 0) === 0 &&
      (value.steps?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'At least one durable operation identifier or step is required',
      });
    }
  });

export const deployEscrowWithCircleRequestSchema = z
  .object({
    ownerWallet: evmAddressSchema,
    withdrawRecipient: evmAddressSchema,
    refundUnlockAt: isoDateTimeSchema,
    artifactVersion: z.literal('1.1.0'),
  })
  .strict();

export const escrowDeploymentStatusSchema = z.enum([
  'accepted',
  'pending',
  'verifying',
  'confirmed',
  'reverted',
  'failed',
]);

export const escrowDeploymentSchema = z
  .object({
    programId: uuidSchema,
    programKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    chainId: z.literal(ARC_TESTNET_CHAIN_ID),
    tokenAddress: z.literal(ARC_TESTNET_USDC_ADDRESS),
    ownerWallet: evmAddressSchema,
    withdrawRecipient: evmAddressSchema,
    refundUnlockAt: isoDateTimeSchema,
    artifactVersion: z.literal('1.1.0'),
    artifactChecksum: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    circleContractId: uuidSchema,
    circleTransactionId: uuidSchema,
    status: escrowDeploymentStatusSchema,
    contractAddress: evmAddressSchema.optional(),
    transactionHash: transactionHashSchema.optional(),
    failureCode: z.string().max(128).optional(),
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === 'confirmed' &&
      (value.contractAddress === undefined || value.transactionHash === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['contractAddress'],
        message: 'Confirmed deployment requires contractAddress and transactionHash',
      });
    }
    if (['failed', 'reverted'].includes(value.status) && value.failureCode === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: `${value.status} deployment requires failureCode`,
      });
    }
  });

export const escrowDeploymentResponseSchema = z
  .object({ success: z.literal(true), data: escrowDeploymentSchema })
  .strict();

export const createWithdrawalIntentRequestSchema = z
  .object({ idempotencyKey: uuidV4Schema, walletAddress: evmAddressSchema })
  .strict();

export const withdrawalIntentStatusSchema = z.enum([
  'ready_to_close',
  'ready_to_withdraw',
  'close_submission_uncertain',
  'withdraw_submission_uncertain',
  'close_submitted',
  'withdraw_submitted',
  'verifying',
  'complete',
  'failed',
]);

export const withdrawalIntentSchema = z
  .object({
    id: uuidSchema,
    programId: uuidSchema,
    escrowAddress: evmAddressSchema,
    recipientAddress: evmAddressSchema,
    walletAddress: evmAddressSchema,
    amount: usdcAmountSchema,
    closeRequired: z.boolean(),
    status: withdrawalIntentStatusSchema,
    closeTransactionHash: transactionHashSchema.optional(),
    withdrawTransactionHash: transactionHashSchema.optional(),
    failureCode: z.string().max(128).optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.closeRequired &&
      ['ready_to_withdraw', 'close_submitted', 'withdraw_submitted', 'verifying', 'complete'].includes(value.status) &&
      value.closeTransactionHash === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['closeTransactionHash'],
        message: `closeTransactionHash is required for ${value.status}`,
      });
    }
    if (
      ['withdraw_submitted', 'verifying', 'complete'].includes(value.status) &&
      value.withdrawTransactionHash === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['withdrawTransactionHash'],
        message: `withdrawTransactionHash is required for ${value.status}`,
      });
    }
    if (value.status === 'failed' && value.failureCode === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'failureCode is required for a failed withdrawal',
      });
    }
  });

export const withdrawalIntentResponseSchema = z
  .object({ success: z.literal(true), data: withdrawalIntentSchema })
  .strict();

export const withdrawalIntentParamsSchema = z
  .object({ id: uuidSchema, intentId: uuidSchema })
  .strict();

export const observeWithdrawalRequestSchema = z
  .object({
    operation: z.enum(['close', 'withdraw']),
    outcome: z.enum(['submitted', 'submission_uncertain']).optional(),
    transactionHash: transactionHashSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.outcome ?? 'submitted') === 'submitted' && value.transactionHash === undefined) {
      context.addIssue({ code: 'custom', path: ['transactionHash'], message: 'transactionHash is required for submitted' });
    }
    if (value.outcome === 'submission_uncertain' && value.transactionHash !== undefined) {
      context.addIssue({ code: 'custom', path: ['transactionHash'], message: 'Attach a known hash using submitted outcome' });
    }
  });

export type FundingNetworkId = z.output<typeof fundingNetworkIdSchema>;
export type FundingRouteMode = z.output<typeof fundingRouteModeSchema>;
export type FundingSource = z.output<typeof fundingSourceSchema>;
export type FundingFeeAllocation = z.output<typeof fundingFeeAllocationSchema>;
export type SourceDepositStatus = z.output<typeof sourceDepositStatusSchema>;
export type SourceDeposit = z.output<typeof sourceDepositSchema>;
export type CreateSourceDepositRequest = z.output<typeof createSourceDepositRequestSchema>;
export type SourceDepositParams = z.output<typeof sourceDepositParamsSchema>;
export type ObserveSourceDepositRequest = z.output<typeof observeSourceDepositRequestSchema>;
export type AttachSourceDepositRequest = z.output<typeof attachSourceDepositRequestSchema>;
export type RefreshFundingQuoteRequest = z.output<typeof refreshFundingQuoteRequestSchema>;
export type CircleGatewayDepositFinalizedWebhook = z.output<typeof circleGatewayDepositFinalizedWebhookSchema>;
export type CreateFundingIntentRequest = z.output<typeof createFundingIntentRequestSchema>;
export type FundingIntent = z.output<typeof fundingIntentSchema>;
export type FundingConfirmationArtifact = z.output<typeof fundingConfirmationArtifactSchema>;
export type FundingConfirmationArtifactResponse = z.output<
  typeof fundingConfirmationArtifactResponseSchema
>;
export type FundingIntentResponse = z.output<typeof fundingIntentResponseSchema>;
export type GatewayFundingReadiness = z.output<typeof gatewayFundingReadinessSchema>;
export type GatewayFundingReadinessResponse = z.output<typeof gatewayFundingReadinessResponseSchema>;
export type FundingIntentParams = z.output<typeof fundingIntentParamsSchema>;
export type ObserveFundingOperationRequest = z.output<typeof observeFundingOperationRequestSchema>;
export type DeployEscrowWithCircleRequest = z.output<typeof deployEscrowWithCircleRequestSchema>;
export type EscrowDeployment = z.output<typeof escrowDeploymentSchema>;
export type EscrowDeploymentResponse = z.output<typeof escrowDeploymentResponseSchema>;
export type CreateWithdrawalIntentRequest = z.output<typeof createWithdrawalIntentRequestSchema>;
export type WithdrawalIntent = z.output<typeof withdrawalIntentSchema>;
export type WithdrawalIntentResponse = z.output<typeof withdrawalIntentResponseSchema>;
export type WithdrawalIntentParams = z.output<typeof withdrawalIntentParamsSchema>;
export type ObserveWithdrawalRequest = z.output<typeof observeWithdrawalRequestSchema>;
