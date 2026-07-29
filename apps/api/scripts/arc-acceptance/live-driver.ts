import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_ADDRESS,
  FUNDING_NETWORK_CONFIG,
  GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
  escrowDeploymentResponseSchema,
  fundingConfirmationArtifactResponseSchema,
  fundingIntentResponseSchema,
  parseUsdcBaseUnits,
  programResponseSchema,
  rewardSettlementIntentResponseSchema,
  withdrawalIntentResponseSchema,
} from '@bug-bounty-escrow/shared';
import { decodeEventLog, padHex, type Hex } from 'viem';
import { z } from 'zod';

import { loadEscrowArtifact } from '../../src/escrow/escrow-artifact.js';
import type { EscrowArtifact } from '../../src/escrow/escrow-gateways.js';
import {
  AcceptanceAssertionError,
  type ArcAcceptanceDriver,
  type ArcAcceptanceState,
  type ArcAcceptanceStepId,
  type PublicEvidence,
  type VerificationResult,
  fingerprintPublicEvidence,
} from './runner.js';

const ARC_GAS_STATION_PAYMASTER = '0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25';
const BASE_SEPOLIA_CCTP_V2_TOKEN_MESSENGER = '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa';
const BASE_SEPOLIA_CCTP_V2_TOKEN_MINTER = '0xb43db544e2c27092c107639ad201b3defabcf192';
const ARC_CCTP_V2_TOKEN_MESSENGER = '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa';
const ARC_GATEWAY_MINTER = '0x0022222abe238cc2c7bb1f21003f0a260052475b';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const dataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
const quantitySchema = z.string().regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/);
const rpcReceiptSchema = z
  .object({
    status: quantitySchema,
    transactionHash: hashSchema,
    blockNumber: quantitySchema,
    blockHash: hashSchema,
    contractAddress: addressSchema.nullable(),
    logs: z.array(
      z
        .object({
          address: addressSchema,
          data: dataSchema,
          topics: z.array(hashSchema).min(1),
          logIndex: quantitySchema,
        })
        .passthrough(),
    ),
  })
  .passthrough();
const rpcBlockSchema = z.object({ hash: hashSchema }).passthrough();
const ERC20_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    anonymous: false,
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;
const GATEWAY_ABI = [
  {
    type: 'event',
    name: 'Deposited',
    anonymous: false,
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;
const CCTP_V2_ABI = [
  {
    type: 'event',
    name: 'DepositForBurn',
    anonymous: false,
    inputs: [
      { name: 'nonce', type: 'uint64', indexed: true },
      { name: 'burnToken', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'mintRecipient', type: 'bytes32', indexed: false },
      { name: 'destinationDomain', type: 'uint32', indexed: false },
      { name: 'destinationTokenMessenger', type: 'bytes32', indexed: false },
      { name: 'destinationCaller', type: 'bytes32', indexed: false },
      { name: 'maxFee', type: 'uint256', indexed: false },
      { name: 'minFinalityThreshold', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'MintAndWithdraw',
    anonymous: false,
    inputs: [
      { name: 'mintRecipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'mintToken', type: 'address', indexed: true },
    ],
  },
] as const;
const GATEWAY_MINTER_ABI = [
  {
    type: 'event',
    name: 'AttestationUsed',
    anonymous: false,
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'transferSpecHash', type: 'bytes32', indexed: true },
      { name: 'sourceDomain', type: 'uint32', indexed: false },
      { name: 'sourceDepositor', type: 'bytes32', indexed: false },
      { name: 'sourceSigner', type: 'bytes32', indexed: false },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;
const ESCROW_ABI = [
  {
    type: 'event',
    name: 'EscrowInitialized',
    anonymous: false,
    inputs: [
      { name: 'programKey', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'refundUnlockAt', type: 'uint256', indexed: false },
      { name: 'withdrawRecipient', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ExternalFundingSynced',
    anonymous: false,
    inputs: [
      { name: 'actor', type: 'address', indexed: true },
      { name: 'newlyObserved', type: 'uint256', indexed: false },
      { name: 'totalFunded', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RewardApproved',
    anonymous: false,
    inputs: [
      { name: 'reportKey', type: 'bytes32', indexed: true },
      { name: 'approvedContentHash', type: 'bytes32', indexed: true },
      { name: 'researcher', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RewardPaid',
    anonymous: false,
    inputs: [
      { name: 'reportKey', type: 'bytes32', indexed: true },
      { name: 'researcher', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EscrowClosed',
    anonymous: false,
    inputs: [{ name: 'actor', type: 'address', indexed: true }],
  },
  {
    type: 'event',
    name: 'RemainingFundsWithdrawn',
    anonymous: false,
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;
const circleWalletResponseSchema = z
  .object({
    data: z.object({
      wallet: z
        .object({
          id: z.string().uuid(),
          address: addressSchema,
          blockchain: z.literal('ARC-TESTNET'),
          custodyType: z.literal('DEVELOPER'),
          accountType: z.literal('SCA'),
          state: z.literal('LIVE'),
        })
        .passthrough(),
    }),
  })
  .passthrough();
const gatewaySubscriptionResponseSchema = z
  .object({
    data: z
      .object({
        id: z.string().uuid(),
        environment: z.literal('TEST'),
        enabled: z.literal(true),
        endpoint: z.string().url(),
        notificationTypes: z.array(z.string()),
        addresses: z.array(addressSchema).max(50),
        domains: z.array(z.enum(['0', '3', '6', '26'])),
      })
      .passthrough(),
  })
  .passthrough();

export interface LiveArcAcceptanceConfig {
  readonly accessToken: string;
  readonly expectedOwnerId: string;
  readonly expectedApiOrigin: string;
  readonly expectedWebOrigin: string;
  readonly arcRpcUrl: string;
  readonly arbitrumSepoliaRpcUrl: string;
  readonly artifactPath: string;
  readonly baseSepoliaRpcUrl: string;
  readonly ethereumSepoliaRpcUrl: string;
  readonly circleApiBaseUrl: string;
  readonly circleApiKey: string;
  readonly circleDeploymentWalletId: string;
  readonly gatewaySubscriptionId: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export class LiveArcAcceptanceDriver implements ArcAcceptanceDriver {
  private readonly request: typeof fetch;
  private readonly now: () => Date;

  public constructor(private readonly config: LiveArcAcceptanceConfig) {
    if (config.accessToken.length < 16 || config.circleApiKey.length < 16) {
      throw new AcceptanceAssertionError(
        'acceptance_credentials_missing',
        'Live acceptance credentials must be supplied through environment variables.',
        false,
      );
    }
    this.request = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  public async verify(
    stepId: ArcAcceptanceStepId,
    state: Readonly<ArcAcceptanceState>,
  ): Promise<VerificationResult> {
    this.assertTrustedOrigins(state);
    switch (stepId) {
      case 'dedicated_draft':
        return this.verifyDedicatedDraft(state);
      case 'production_preflight':
        return this.verifyPreflight();
      case 'deploy_verify':
        return this.verifyDeployment(state);
      case 'send_verify':
        return this.verifyCompletedFunding(state, 'send', 'send_wallet_signature');
      case 'bridge_verify':
        return this.verifyCompletedFunding(state, 'bridge', 'bridge_wallet_signatures');
      case 'ub_ethereum_deposit_verify':
        return this.verifySourceDeposit(
          state,
          'Ethereum_Sepolia',
          'ub_ethereum_deposit_signatures',
        );
      case 'ub_base_deposit_verify':
        return this.verifySourceDeposit(state, 'Base_Sepolia', 'ub_base_deposit_signatures');
      case 'ub_arbitrum_deposit_verify':
        return this.verifySourceDeposit(
          state,
          'Arbitrum_Sepolia',
          'ub_arbitrum_deposit_signatures',
        );
      case 'ub_spend_verify':
        return this.verifyCompletedFunding(state, 'unified_balance', 'ub_spend_signatures');
      case 'cp13_artifact_verify':
        return this.verifyCp13Artifact(state);
      case 'reward_payout_verify':
        return this.verifyRewardPayout(state);
      case 'end_program_verify':
        return this.verifyEndedProgram(state);
      case 'close_verify':
        return this.verifyWithdrawal(state, false);
      case 'withdraw_verify':
        return this.verifyWithdrawal(state, true);
      case 'reload_after_deploy':
        return this.reloadVerification(await this.verifyDeployment(state));
      case 'reload_after_send':
        return this.reloadVerification(
          await this.verifyCompletedFunding(state, 'send', 'send_wallet_signature'),
        );
      case 'reload_after_bridge':
        return this.reloadVerification(
          await this.verifyCompletedFunding(state, 'bridge', 'bridge_wallet_signatures'),
        );
      case 'reload_before_cp13':
        return this.reloadVerification(
          await this.verifyCompletedFunding(state, 'unified_balance', 'ub_spend_signatures'),
        );
      case 'reload_after_close':
        return this.reloadVerification(await this.verifyWithdrawal(state, false));
      default:
        throw new AcceptanceAssertionError(
          'automatic_step_not_supported',
          `No automatic verifier is registered for ${stepId}.`,
          false,
        );
    }
  }

  private async verifyDedicatedDraft(state: Readonly<ArcAcceptanceState>) {
    const response = programResponseSchema.parse(
      await this.apiGet(`/api/owner/programs/${state.programId}`, state),
    );
    const program = response.data;
    const deadline = program.deadline === undefined ? undefined : Date.parse(program.deadline);
    const remaining = deadline === undefined ? undefined : deadline - this.now().getTime();
    if (
      program.ownerId !== this.config.expectedOwnerId ||
      program.status !== 'draft' ||
      !program.slug.startsWith('qa-arc-acceptance-') ||
      program.id.startsWith('31000000-') ||
      program.ownerId.startsWith('30000000-') ||
      remaining === undefined ||
      remaining < 2 * 60_000 ||
      remaining > 24 * 60 * 60_000
    ) {
      throw new AcceptanceAssertionError(
        'dedicated_draft_invalid',
        'Select a non-demo qa-arc-acceptance-* owner draft with a server-returned deadline between 2 minutes and 24 hours.',
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'invariant' as const,
          label: 'dedicated_non_demo_short_deadline_draft',
          invariantPassed: true,
          productStatus: program.status,
        },
      ],
    };
  }

  private async verifyPreflight(): Promise<VerificationResult> {
    const artifact = await loadEscrowArtifact(this.config.artifactPath);
    const [
      chainId,
      usdcCode,
      paymasterCode,
      ethereumChainId,
      ethereumUsdcCode,
      ethereumGatewayCode,
      baseChainId,
      baseUsdcCode,
      baseGatewayCode,
      arbitrumChainId,
      arbitrumUsdcCode,
      arbitrumGatewayCode,
      wallet,
      subscription,
    ] = await Promise.all([
      this.rpc<string>('eth_chainId', []),
      this.rpc<string>('eth_getCode', [ARC_TESTNET_USDC_ADDRESS, 'latest']),
      this.rpc<string>('eth_getCode', [ARC_GAS_STATION_PAYMASTER, 'latest']),
      this.rpcAt<string>(this.config.ethereumSepoliaRpcUrl, 'eth_chainId', []),
      this.rpcAt<string>(this.config.ethereumSepoliaRpcUrl, 'eth_getCode', [
        FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.tokenAddress,
        'latest',
      ]),
      this.rpcAt<string>(this.config.ethereumSepoliaRpcUrl, 'eth_getCode', [
        GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
        'latest',
      ]),
      this.rpcAt<string>(this.config.baseSepoliaRpcUrl, 'eth_chainId', []),
      this.rpcAt<string>(this.config.baseSepoliaRpcUrl, 'eth_getCode', [
        FUNDING_NETWORK_CONFIG.Base_Sepolia.tokenAddress,
        'latest',
      ]),
      this.rpcAt<string>(this.config.baseSepoliaRpcUrl, 'eth_getCode', [
        GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
        'latest',
      ]),
      this.rpcAt<string>(this.config.arbitrumSepoliaRpcUrl, 'eth_chainId', []),
      this.rpcAt<string>(this.config.arbitrumSepoliaRpcUrl, 'eth_getCode', [
        FUNDING_NETWORK_CONFIG.Arbitrum_Sepolia.tokenAddress,
        'latest',
      ]),
      this.rpcAt<string>(this.config.arbitrumSepoliaRpcUrl, 'eth_getCode', [
        GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
        'latest',
      ]),
      this.circleGet(`/v1/w3s/wallets/${this.config.circleDeploymentWalletId}`).then((value) =>
        circleWalletResponseSchema.parse(value),
      ),
      this.circleGet(
        `/v2/notifications/subscriptions/permissionless/${this.config.gatewaySubscriptionId}`,
      ).then((value) => gatewaySubscriptionResponseSchema.parse(value)),
    ]);
    if (Number.parseInt(chainId, 16) !== ARC_TESTNET_CHAIN_ID) {
      throw new AcceptanceAssertionError(
        'arc_chain_mismatch',
        'The configured RPC is not Arc Testnet.',
        false,
      );
    }
    if (usdcCode === '0x' || paymasterCode === '0x') {
      throw new AcceptanceAssertionError(
        'arc_preflight_contract_missing',
        'Canonical Arc USDC or the Arc Testnet Gas Station paymaster has no bytecode.',
        false,
      );
    }
    if (
      Number.parseInt(ethereumChainId, 16) !== FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.chainId ||
      Number.parseInt(baseChainId, 16) !== FUNDING_NETWORK_CONFIG.Base_Sepolia.chainId ||
      Number.parseInt(arbitrumChainId, 16) !== FUNDING_NETWORK_CONFIG.Arbitrum_Sepolia.chainId ||
      [
        ethereumUsdcCode,
        ethereumGatewayCode,
        baseUsdcCode,
        baseGatewayCode,
        arbitrumUsdcCode,
        arbitrumGatewayCode,
      ].some((code) => code === '0x')
    ) {
      throw new AcceptanceAssertionError(
        'source_network_preflight_failed',
        'Ethereum, Base, or Arbitrum Sepolia RPC, canonical USDC, or Gateway Wallet bytecode is invalid.',
        false,
      );
    }
    if (wallet.data.wallet.id !== this.config.circleDeploymentWalletId) {
      throw new AcceptanceAssertionError(
        'circle_deployment_wallet_mismatch',
        'Circle returned a different deployment wallet.',
        false,
      );
    }
    const gateway = subscription.data;
    const expectedGatewayEndpoint = new URL(
      '/api/webhooks/circle/gateway',
      this.config.expectedWebOrigin,
    ).toString();
    if (
      gateway.id !== this.config.gatewaySubscriptionId ||
      gateway.endpoint !== expectedGatewayEndpoint ||
      new URL(gateway.endpoint).origin !== this.config.expectedWebOrigin ||
      gateway.notificationTypes.length !== 1 ||
      gateway.notificationTypes[0] !== 'gateway.deposit.finalized' ||
      !gateway.domains.includes('0') ||
      !gateway.domains.includes('3') ||
      !gateway.domains.includes('6') ||
      gateway.addresses.length > 48
    ) {
      throw new AcceptanceAssertionError(
        'gateway_subscription_preflight_failed',
        'The stable TEST Gateway subscription must use the expected webhook endpoint and exact notification type, cover Ethereum, Base and Arbitrum, and retain capacity for the dedicated run.',
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'preflight',
          label: 'circle_deployment_sca_live',
          address: wallet.data.wallet.address,
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'arc_canonical_usdc_code_present',
          address: ARC_TESTNET_USDC_ADDRESS,
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'arc_gas_station_paymaster_code_present',
          address: ARC_GAS_STATION_PAYMASTER,
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'artifact_checksum',
          checksum: artifact.artifactSha256,
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'gateway_test_subscription_capacity',
          operationId: gateway.id,
          capacityUsed: gateway.addresses.length,
          capacityLimit: 50 as const,
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'ethereum_sepolia_source_ready',
          network: 'Ethereum_Sepolia',
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'base_sepolia_source_ready',
          network: 'Base_Sepolia',
          invariantPassed: true,
        },
        {
          kind: 'preflight',
          label: 'arbitrum_sepolia_source_ready',
          network: 'Arbitrum_Sepolia',
          invariantPassed: true,
        },
      ],
    };
  }

  private async verifyDeployment(state: Readonly<ArcAcceptanceState>): Promise<VerificationResult> {
    const artifact = await loadEscrowArtifact(this.config.artifactPath);
    const response = escrowDeploymentResponseSchema.parse(
      await this.apiGet(`/api/programs/${state.programId}/escrow-deployments/current`, state),
    );
    const deployment = response.data;
    if (
      deployment.status !== 'confirmed' ||
      deployment.contractAddress === undefined ||
      deployment.transactionHash === undefined
    ) {
      throw new AcceptanceAssertionError(
        'deployment_not_confirmed',
        'The same durable Circle deployment is not Arc-verified yet.',
      );
    }
    const contractAddress = deployment.contractAddress;
    const deploymentTransactionHash = deployment.transactionHash;
    const receipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      deploymentTransactionHash,
      'deployment_receipt_not_committed',
    );
    if (receipt.contractAddress === null || !equalHex(receipt.contractAddress, contractAddress)) {
      throw new AcceptanceAssertionError(
        'deployment_contract_address_mismatch',
        'The committed deployment receipt created a different contract address.',
        false,
      );
    }
    const refundUnlockAt = BigInt(Math.floor(Date.parse(deployment.refundUnlockAt) / 1_000));
    const deploymentLogs = receipt.logs.filter((log) => {
      if (!equalHex(log.address, contractAddress)) return false;
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          eventName: 'EscrowInitialized',
          data: log.data,
          topics: [...log.topics],
        });
        return (
          equalHex(decoded.args.programKey, deployment.programKey) &&
          equalHex(decoded.args.owner, deployment.ownerWallet) &&
          equalHex(decoded.args.token, ARC_TESTNET_USDC_ADDRESS) &&
          decoded.args.refundUnlockAt === refundUnlockAt &&
          equalHex(decoded.args.withdrawRecipient, deployment.withdrawRecipient)
        );
      } catch {
        return false;
      }
    });
    const deployedCode = await this.rpc<string>('eth_getCode', [
      deployment.contractAddress,
      'latest',
    ]);
    if (
      deploymentLogs.length !== 1 ||
      !equalHex(deployment.artifactChecksum, artifact.artifactSha256) ||
      !runtimeMatchesPinnedArtifact(artifact, deployedCode)
    ) {
      throw new AcceptanceAssertionError(
        'deployment_event_or_runtime_mismatch',
        'The exact artifact checksum, EscrowInitialized event, or normalized runtime bytecode is mismatched.',
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'address',
          label: 'verified_escrow_address',
          address: deployment.contractAddress,
          operationId: deployment.circleTransactionId,
          durableStatus: 'confirmed',
        },
        {
          kind: 'transaction',
          label: 'verified_deployment_transaction',
          transactionHash: deployment.transactionHash,
          blockHash: receipt.blockHash,
          blockNumber: receipt.blockNumber.toString(),
          logIndex: deploymentLogs[0]!.logIndex,
          durableStatus: 'confirmed',
        },
        {
          kind: 'invariant',
          label: 'deployment_artifact_checksum',
          checksum: deployment.artifactChecksum,
          invariantPassed: true,
        },
      ],
    };
  }

  private async verifyCompletedFunding(
    state: Readonly<ArcAcceptanceState>,
    routeMode: 'send' | 'bridge' | 'unified_balance',
    evidenceStep: ArcAcceptanceStepId,
  ): Promise<VerificationResult> {
    const intentId = this.requireEvidenceId(state, evidenceStep, 'intentId');
    const response = fundingIntentResponseSchema.parse(
      await this.apiGet(`/api/programs/${state.programId}/funding-intents/${intentId}`, state),
    );
    const intent = response.data;
    const expectedNetworks =
      routeMode === 'send'
        ? ['Arc_Testnet']
        : routeMode === 'bridge'
          ? ['Base_Sepolia']
          : ['Ethereum_Sepolia', 'Base_Sepolia', 'Arbitrum_Sepolia'];
    const actualNetworks = intent.sources.map(({ network }) => network).sort();
    if (
      intent.routeMode !== routeMode ||
      actualNetworks.join(',') !== [...expectedNetworks].sort().join(',') ||
      intent.status !== 'complete' ||
      intent.confirmationArtifact === undefined ||
      intent.destinationTransactionHash === undefined ||
      intent.netReceivedAmount === undefined
    ) {
      throw new AcceptanceAssertionError(
        `${routeMode}_funding_not_complete`,
        `The durable ${routeMode} intent is not fully reconciled.`,
      );
    }
    const destinationTransactionHash = intent.destinationTransactionHash;
    const netReceivedAmount = intent.netReceivedAmount;
    const confirmationArtifact = intent.confirmationArtifact;
    const artifact = confirmationArtifact;
    const pinnedArtifact = await loadEscrowArtifact(this.config.artifactPath);
    const grossAmount = parseUsdcBaseUnits(intent.grossAmount) ?? 0n;
    const feeReserve = parseUsdcBaseUnits(intent.estimatedFeeReserve) ?? 0n;
    const netReceived = parseUsdcBaseUnits(netReceivedAmount) ?? 0n;
    const artifactGross = parseUsdcBaseUnits(artifact.grossAmount) ?? 0n;
    const artifactFeeReserve = parseUsdcBaseUnits(artifact.estimatedFeeReserve) ?? 0n;
    const artifactNet = parseUsdcBaseUnits(artifact.netReceivedAmount) ?? 0n;
    const preTotalFunded = parseUsdcBaseUnits(artifact.preTotalFundedAmount) ?? 0n;
    const postTotalFunded = parseUsdcBaseUnits(artifact.postTotalFundedAmount) ?? 0n;
    const totalPool = parseUsdcBaseUnits(artifact.accounting.totalPool) ?? 0n;
    const accountingComponents =
      (parseUsdcBaseUnits(artifact.accounting.totalPaid) ?? 0n) +
      (parseUsdcBaseUnits(artifact.accounting.totalWithdrawn) ?? 0n) +
      (parseUsdcBaseUnits(artifact.accounting.approvedOutstanding) ?? 0n) +
      (parseUsdcBaseUnits(artifact.accounting.availablePool) ?? 0n);
    if (
      intent.programId !== state.programId ||
      artifact.programId !== state.programId ||
      artifact.fundingIntentId !== intentId ||
      artifact.routeMode !== routeMode ||
      !equalHex(artifact.escrowAddress, intent.recipientAddress) ||
      !equalHex(artifact.tokenAddress, ARC_TESTNET_USDC_ADDRESS) ||
      !equalHex(artifact.destinationTransactionHash, destinationTransactionHash) ||
      artifact.artifactVersion !== '1.1.0' ||
      !equalHex(artifact.artifactChecksum, pinnedArtifact.artifactSha256) ||
      grossAmount !== artifactGross ||
      feeReserve !== artifactFeeReserve ||
      netReceived !== artifactNet ||
      netReceived <= 0n ||
      netReceived > grossAmount ||
      postTotalFunded !== preTotalFunded + netReceived ||
      totalPool !== postTotalFunded ||
      totalPool !== accountingComponents
    ) {
      throw new AcceptanceAssertionError(
        `${routeMode}_funding_artifact_link_mismatch`,
        'The completed funding intent is not exactly linked to the pinned escrow artifact, destination, amounts, and lifetime pool accounting.',
        false,
      );
    }
    const bridgeSourceReceipts =
      routeMode === 'bridge'
        ? await Promise.all(
            (intent.recovery?.sourceTransactionHashes ?? []).map((hash) =>
              this.committedReceipt(
                this.config.baseSepoliaRpcUrl,
                hash,
                'bridge_source_receipt_not_committed',
              ),
            ),
          )
        : [];
    if (routeMode === 'bridge' && bridgeSourceReceipts.length === 0) {
      throw new AcceptanceAssertionError(
        'bridge_source_operation_missing',
        'The durable Base bridge source transaction is missing.',
        false,
      );
    }
    const bridgeBurnEvidence =
      routeMode === 'bridge'
        ? bridgeSourceReceipts.flatMap((receipt) => {
            const depositLogs = receipt.logs.filter((log) => {
              if (!equalHex(log.address, BASE_SEPOLIA_CCTP_V2_TOKEN_MESSENGER)) {
                return false;
              }
              try {
                const decoded = decodeEventLog({
                  abi: CCTP_V2_ABI,
                  eventName: 'DepositForBurn',
                  data: log.data,
                  topics: [...log.topics],
                });
                return (
                  equalHex(
                    decoded.args.burnToken,
                    FUNDING_NETWORK_CONFIG.Base_Sepolia.tokenAddress,
                  ) &&
                  decoded.args.amount === (parseUsdcBaseUnits(intent.grossAmount) ?? 0n) &&
                  equalHex(decoded.args.depositor, intent.walletAddress) &&
                  equalHex(
                    decoded.args.mintRecipient,
                    padHex(intent.recipientAddress as Hex, { size: 32 }),
                  ) &&
                  decoded.args.destinationDomain ===
                    FUNDING_NETWORK_CONFIG.Arc_Testnet.gatewayDomain &&
                  equalHex(
                    decoded.args.destinationTokenMessenger,
                    padHex(ARC_CCTP_V2_TOKEN_MESSENGER as Hex, { size: 32 }),
                  ) &&
                  equalHex(decoded.args.destinationCaller, padHex(ZERO_ADDRESS, { size: 32 }))
                );
              } catch {
                return false;
              }
            });
            const ownerToMinterTransfers = receipt.logs.filter((log) => {
              if (!equalHex(log.address, FUNDING_NETWORK_CONFIG.Base_Sepolia.tokenAddress)) {
                return false;
              }
              try {
                const decoded = decodeEventLog({
                  abi: ERC20_ABI,
                  eventName: 'Transfer',
                  data: log.data,
                  topics: [...log.topics],
                });
                return (
                  equalHex(decoded.args.from, intent.walletAddress) &&
                  equalHex(decoded.args.to, BASE_SEPOLIA_CCTP_V2_TOKEN_MINTER) &&
                  decoded.args.value === grossAmount
                );
              } catch {
                return false;
              }
            });
            const minterBurnTransfers = receipt.logs.filter((log) => {
              if (!equalHex(log.address, FUNDING_NETWORK_CONFIG.Base_Sepolia.tokenAddress)) {
                return false;
              }
              try {
                const decoded = decodeEventLog({
                  abi: ERC20_ABI,
                  eventName: 'Transfer',
                  data: log.data,
                  topics: [...log.topics],
                });
                return (
                  equalHex(decoded.args.from, BASE_SEPOLIA_CCTP_V2_TOKEN_MINTER) &&
                  equalHex(decoded.args.to, ZERO_ADDRESS) &&
                  decoded.args.value === grossAmount
                );
              } catch {
                return false;
              }
            });
            return depositLogs.length === 1 &&
              ownerToMinterTransfers.length === 1 &&
              minterBurnTransfers.length === 1
              ? [
                  {
                    receipt,
                    eventLogIndex: depositLogs[0]!.logIndex,
                    transferLogIndex: ownerToMinterTransfers[0]!.logIndex,
                    burnTransferLogIndex: minterBurnTransfers[0]!.logIndex,
                  },
                ]
              : [];
          })
        : [];
    if (routeMode === 'bridge' && bridgeBurnEvidence.length !== 1) {
      throw new AcceptanceAssertionError(
        'bridge_source_burn_evidence_mismatch',
        'The exact Base CCTP v2 DepositForBurn, owner-to-TokenMinter debit, and TokenMinter-to-zero burn are missing or ambiguous.',
        false,
      );
    }
    const destinationReceipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      destinationTransactionHash,
      `${routeMode}_destination_receipt_not_committed`,
    );
    if (
      !equalHex(destinationReceipt.blockHash, artifact.destinationBlockHash) ||
      destinationReceipt.blockNumber.toString() !== artifact.destinationBlockNumber
    ) {
      throw new AcceptanceAssertionError(
        `${routeMode}_destination_block_mismatch`,
        'The durable destination block evidence is not canonical.',
        false,
      );
    }
    const destinationTransfers = destinationReceipt.logs.filter((log) => {
      if (
        log.logIndex !== artifact.destinationLogIndex ||
        !equalHex(log.address, ARC_TESTNET_USDC_ADDRESS)
      ) {
        return false;
      }
      try {
        const decoded = decodeEventLog({
          abi: ERC20_ABI,
          eventName: 'Transfer',
          data: log.data,
          topics: [...log.topics],
        });
        return (
          equalHex(decoded.args.from, routeMode === 'send' ? intent.walletAddress : ZERO_ADDRESS) &&
          equalHex(decoded.args.to, intent.recipientAddress) &&
          decoded.args.value === netReceived
        );
      } catch {
        return false;
      }
    });
    let protocolLogIndex: number | undefined;
    let gatewayEvidence: readonly {
      transferSpecHash: `0x${string}`;
      sourceDomain: number;
      sourceDepositor: `0x${string}`;
      sourceSigner: `0x${string}`;
      value: bigint;
      logIndex: number;
    }[] = [];
    if (routeMode === 'bridge') {
      const mintEvents = destinationReceipt.logs.filter((log) => {
        if (!equalHex(log.address, ARC_CCTP_V2_TOKEN_MESSENGER)) return false;
        try {
          const decoded = decodeEventLog({
            abi: CCTP_V2_ABI,
            eventName: 'MintAndWithdraw',
            data: log.data,
            topics: [...log.topics],
          });
          return (
            equalHex(decoded.args.mintRecipient, intent.recipientAddress) &&
            decoded.args.amount === netReceived &&
            equalHex(decoded.args.mintToken, ARC_TESTNET_USDC_ADDRESS)
          );
        } catch {
          return false;
        }
      });
      if (mintEvents.length !== 1) {
        throw new AcceptanceAssertionError(
          'bridge_destination_mint_evidence_mismatch',
          'The exact canonical Arc CCTP MintAndWithdraw receipt is missing or ambiguous.',
          false,
        );
      }
      protocolLogIndex = mintEvents[0]!.logIndex;
    } else if (routeMode === 'unified_balance') {
      const expectedSourceDomains = [0, 3, 6] as const;
      const expectedWalletIdentity = padHex(intent.walletAddress as Hex, { size: 32 });
      const zeroIdentity = padHex(ZERO_ADDRESS, { size: 32 });
      const attestationEvents = destinationReceipt.logs.flatMap((log) => {
        if (!equalHex(log.address, ARC_GATEWAY_MINTER)) return [];
        try {
          const decoded = decodeEventLog({
            abi: GATEWAY_MINTER_ABI,
            eventName: 'AttestationUsed',
            data: log.data,
            topics: [...log.topics],
          });
          return [{ log, decoded }];
        } catch {
          return [];
        }
      });
      const sourceDomains = attestationEvents.map(({ decoded }) => decoded.args.sourceDomain);
      const uniqueSourceDomains = new Set(sourceDomains);
      const uniqueTransferSpecHashes = new Set(
        attestationEvents.map(({ decoded }) => decoded.args.transferSpecHash.toLowerCase()),
      );
      const attestedValue = attestationEvents.reduce(
        (total, { decoded }) => total + decoded.args.value,
        0n,
      );
      const exactSourceDomainSet = expectedSourceDomains.every((domain) =>
        uniqueSourceDomains.has(domain),
      );
      const invalidAttestation = attestationEvents.some(
        ({ decoded }) =>
          !equalHex(decoded.args.token, ARC_TESTNET_USDC_ADDRESS) ||
          !equalHex(decoded.args.recipient, intent.recipientAddress) ||
          decoded.args.value <= 0n ||
          equalHex(decoded.args.sourceDepositor, zeroIdentity) ||
          equalHex(decoded.args.sourceSigner, zeroIdentity) ||
          !equalHex(decoded.args.sourceDepositor, expectedWalletIdentity) ||
          !equalHex(decoded.args.sourceSigner, expectedWalletIdentity),
      );
      if (
        attestationEvents.length !== expectedSourceDomains.length ||
        uniqueSourceDomains.size !== expectedSourceDomains.length ||
        !exactSourceDomainSet ||
        uniqueTransferSpecHashes.size !== expectedSourceDomains.length ||
        attestedValue !== netReceived ||
        invalidAttestation
      ) {
        throw new AcceptanceAssertionError(
          'unified_balance_destination_attestation_mismatch',
          'The canonical Arc Gateway receipt must contain exactly one wallet-bound AttestationUsed event for each Ethereum, Arbitrum, and Base source, with unique transfer specs whose values sum to the aggregate mint.',
          false,
        );
      }
      gatewayEvidence = attestationEvents
        .map(({ log, decoded }) => ({
          transferSpecHash: decoded.args.transferSpecHash,
          sourceDomain: decoded.args.sourceDomain,
          sourceDepositor: decoded.args.sourceDepositor,
          sourceSigner: decoded.args.sourceSigner,
          value: decoded.args.value,
          logIndex: log.logIndex,
        }))
        .sort((left, right) => left.logIndex - right.logIndex);
    }
    const syncReceipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      artifact.syncTransactionHash,
      `${routeMode}_sync_receipt_not_committed`,
    );
    if (
      destinationTransfers.length !== 1 ||
      !equalHex(syncReceipt.blockHash, artifact.syncBlockHash) ||
      syncReceipt.blockNumber.toString() !== artifact.syncBlockNumber
    ) {
      throw new AcceptanceAssertionError(
        `${routeMode}_arc_evidence_mismatch`,
        'The canonical Arc transfer or sync receipt differs from the durable artifact.',
        false,
      );
    }
    const syncEvents =
      artifact.syncLogIndex === undefined
        ? []
        : syncReceipt.logs.filter((log) => {
            if (
              log.logIndex !== artifact.syncLogIndex ||
              !equalHex(log.address, intent.recipientAddress)
            ) {
              return false;
            }
            try {
              const decoded = decodeEventLog({
                abi: ESCROW_ABI,
                eventName: 'ExternalFundingSynced',
                data: log.data,
                topics: [...log.topics],
              });
              // syncExternalFunding is permissionless by design. Bind the escrow and
              // accounting arguments exactly, but do not treat actor as an owner identity.
              return (
                decoded.args.newlyObserved === netReceived &&
                decoded.args.totalFunded === postTotalFunded
              );
            } catch {
              return false;
            }
          });
    if (syncEvents.length !== 1) {
      throw new AcceptanceAssertionError(
        `${routeMode}_sync_event_mismatch`,
        'The exact durable ExternalFundingSynced newlyObserved and totalFunded log is not present in the canonical receipt.',
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'operation',
          label: `${routeMode}_funding_intent`,
          intentId,
          routeMode,
          durableStatus: 'complete',
        },
        {
          kind: 'transaction',
          label: `${routeMode}_arc_destination`,
          transactionHash: intent.destinationTransactionHash,
          logIndex: intent.confirmationArtifact.destinationLogIndex,
          blockHash: intent.confirmationArtifact.destinationBlockHash,
          blockNumber: intent.confirmationArtifact.destinationBlockNumber,
          ...(protocolLogIndex === undefined ? {} : { protocolLogIndex }),
          durableStatus: 'complete',
        },
        {
          kind: 'accounting',
          label: `${routeMode}_net_received`,
          amountBaseUnits: netReceived.toString(),
          invariantPassed: true,
          routeMode,
          durableStatus: 'complete',
        },
        {
          kind: 'transaction',
          label: `${routeMode}_arc_sync`,
          intentId,
          transactionHash: artifact.syncTransactionHash,
          blockHash: artifact.syncBlockHash,
          blockNumber: artifact.syncBlockNumber,
          logIndex: artifact.syncLogIndex,
          durableStatus: 'complete',
        },
        ...gatewayEvidence.map((attestation): Omit<PublicEvidence, 'stepId' | 'recordedAt'> => ({
          kind: 'event',
          label: 'unified_balance_gateway_attestation',
          intentId,
          transactionHash: destinationTransactionHash,
          logIndex: attestation.logIndex,
          transferSpecHash: attestation.transferSpecHash,
          sourceDomain: attestation.sourceDomain,
          sourceDepositor: attestation.sourceDepositor,
          sourceSigner: attestation.sourceSigner,
          amountBaseUnits: attestation.value.toString(),
          routeMode,
          durableStatus: 'complete',
        })),
        ...bridgeBurnEvidence.map(
          ({
            receipt,
            eventLogIndex,
            transferLogIndex,
            burnTransferLogIndex,
          }): Omit<PublicEvidence, 'stepId' | 'recordedAt'> => ({
            kind: 'transaction',
            label: 'bridge_base_cctp_burn',
            intentId,
            transactionHash: receipt.transactionHash,
            blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber.toString(),
            logIndex: eventLogIndex,
            transferLogIndex,
            burnTransferLogIndex,
            amountBaseUnits: (parseUsdcBaseUnits(intent.grossAmount) ?? 0n).toString(),
            address: intent.walletAddress,
            routeMode,
            network: 'Base_Sepolia',
            durableStatus: 'complete',
          }),
        ),
      ],
    };
  }

  private async verifySourceDeposit(
    state: Readonly<ArcAcceptanceState>,
    network: 'Ethereum_Sepolia' | 'Base_Sepolia' | 'Arbitrum_Sepolia',
    evidenceStep: ArcAcceptanceStepId,
  ): Promise<VerificationResult> {
    const intentId = this.requireEvidenceId(state, evidenceStep, 'intentId');
    const depositId = this.requireEvidenceId(state, evidenceStep, 'depositId');
    const response = fundingIntentResponseSchema.parse(
      await this.apiGet(`/api/programs/${state.programId}/funding-intents/${intentId}`, state),
    );
    const deposit = response.data.sourceDeposits.find(({ id }) => id === depositId);
    if (
      response.data.routeMode !== 'unified_balance' ||
      deposit?.network !== network ||
      deposit.status !== 'confirmed' ||
      deposit.transactionHash === undefined ||
      deposit.logIndex === undefined ||
      deposit.transferLogIndex === undefined ||
      deposit.blockHash === undefined ||
      deposit.blockNumber === undefined
    ) {
      throw new AcceptanceAssertionError(
        'source_dual_proof_not_confirmed',
        `${network} source deposit lacks the confirmed Gateway and token-transfer proof.`,
      );
    }
    const sourceRpcUrl = {
      Ethereum_Sepolia: this.config.ethereumSepoliaRpcUrl,
      Base_Sepolia: this.config.baseSepoliaRpcUrl,
      Arbitrum_Sepolia: this.config.arbitrumSepoliaRpcUrl,
    }[network];
    const receipt = await this.committedReceipt(
      sourceRpcUrl,
      deposit.transactionHash,
      'source_deposit_receipt_not_committed',
    );
    const amount = parseUsdcBaseUnits(deposit.amount) ?? 0n;
    if (
      !equalHex(receipt.blockHash, deposit.blockHash) ||
      receipt.blockNumber.toString() !== deposit.blockNumber
    ) {
      throw new AcceptanceAssertionError(
        'source_deposit_block_mismatch',
        `${network} durable source block evidence is not canonical.`,
        false,
      );
    }
    const gatewayEvidence = receipt.logs.filter((log) => {
      if (
        log.logIndex !== deposit.logIndex ||
        !equalHex(log.address, GATEWAY_WALLET_EVM_TESTNET_ADDRESS)
      ) {
        return false;
      }
      try {
        const decoded = decodeEventLog({
          abi: GATEWAY_ABI,
          eventName: 'Deposited',
          data: log.data,
          topics: [...log.topics],
        });
        return (
          equalHex(decoded.args.token, deposit.tokenAddress) &&
          equalHex(decoded.args.depositor, deposit.walletAddress) &&
          equalHex(decoded.args.sender, deposit.walletAddress) &&
          decoded.args.value === amount
        );
      } catch {
        return false;
      }
    });
    const transferEvidence = receipt.logs.filter((log) => {
      if (
        log.logIndex !== deposit.transferLogIndex ||
        !equalHex(log.address, deposit.tokenAddress)
      ) {
        return false;
      }
      try {
        const decoded = decodeEventLog({
          abi: ERC20_ABI,
          eventName: 'Transfer',
          data: log.data,
          topics: [...log.topics],
        });
        return (
          equalHex(decoded.args.from, deposit.walletAddress) &&
          equalHex(decoded.args.to, GATEWAY_WALLET_EVM_TESTNET_ADDRESS) &&
          decoded.args.value === amount
        );
      } catch {
        return false;
      }
    });
    if (gatewayEvidence.length !== 1 || transferEvidence.length !== 1) {
      throw new AcceptanceAssertionError(
        'source_deposit_dual_proof_mismatch',
        `${network} canonical receipt does not contain the exact Gateway and USDC proofs.`,
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'event',
          label: `${network.toLowerCase()}_gateway_and_transfer_dual_proof`,
          intentId,
          depositId,
          transactionHash: deposit.transactionHash,
          logIndex: deposit.logIndex,
          blockHash: deposit.blockHash,
          blockNumber: deposit.blockNumber,
          amountBaseUnits: amount.toString(),
          invariantPassed: true,
          transferLogIndex: deposit.transferLogIndex,
          network,
          durableStatus: 'confirmed',
        },
      ],
    };
  }

  private async verifyCp13Artifact(
    state: Readonly<ArcAcceptanceState>,
  ): Promise<VerificationResult> {
    const [artifactResponse, deploymentResponse, pinnedArtifact] = await Promise.all([
      this.apiGet(`/api/programs/${state.programId}/funding-confirmations/latest`, state).then(
        (value) => fundingConfirmationArtifactResponseSchema.parse(value),
      ),
      this.apiGet(`/api/programs/${state.programId}/escrow-deployments/current`, state).then(
        (value) => escrowDeploymentResponseSchema.parse(value),
      ),
      loadEscrowArtifact(this.config.artifactPath),
    ]);
    const artifact = artifactResponse.data;
    const intent = fundingIntentResponseSchema.parse(
      await this.apiGet(
        `/api/programs/${state.programId}/funding-intents/${artifact.fundingIntentId}`,
        state,
      ),
    ).data;
    const deployment = deploymentResponse.data;
    const gross = parseUsdcBaseUnits(artifact.grossAmount) ?? 0n;
    const fee = parseUsdcBaseUnits(artifact.estimatedFeeReserve) ?? 0n;
    const net = parseUsdcBaseUnits(artifact.netReceivedAmount) ?? 0n;
    const pre = parseUsdcBaseUnits(artifact.preTotalFundedAmount) ?? 0n;
    const post = parseUsdcBaseUnits(artifact.postTotalFundedAmount) ?? 0n;
    const required = parseUsdcBaseUnits(artifact.requiredTotalFundedAmount) ?? 1n;
    const total = parseUsdcBaseUnits(artifact.accounting.totalPool) ?? 0n;
    const components =
      (parseUsdcBaseUnits(artifact.accounting.totalPaid) ?? 0n) +
      (parseUsdcBaseUnits(artifact.accounting.totalWithdrawn) ?? 0n) +
      (parseUsdcBaseUnits(artifact.accounting.approvedOutstanding) ?? 0n) +
      (parseUsdcBaseUnits(artifact.accounting.availablePool) ?? 0n);
    const intentNetworks = intent.sources
      .map(({ network }) => network)
      .sort()
      .join(',');
    if (
      artifact.programId !== state.programId ||
      intent.id !== artifact.fundingIntentId ||
      intent.programId !== state.programId ||
      intent.routeMode !== 'unified_balance' ||
      intentNetworks !==
        ['Ethereum_Sepolia', 'Arbitrum_Sepolia', 'Base_Sepolia'].sort().join(',') ||
      intent.status !== 'complete' ||
      intent.confirmationArtifact === undefined ||
      JSON.stringify(intent.confirmationArtifact) !== JSON.stringify(artifact) ||
      !equalHex(intent.recipientAddress, artifact.escrowAddress) ||
      !equalHex(intent.destinationTransactionHash ?? '', artifact.destinationTransactionHash) ||
      parseUsdcBaseUnits(intent.grossAmount) !== gross ||
      parseUsdcBaseUnits(intent.estimatedFeeReserve) !== fee ||
      parseUsdcBaseUnits(intent.netReceivedAmount ?? '') !== net ||
      deployment.status !== 'confirmed' ||
      deployment.programId !== state.programId ||
      deployment.contractAddress === undefined ||
      !equalHex(deployment.contractAddress, artifact.escrowAddress) ||
      deployment.artifactVersion !== '1.1.0' ||
      !equalHex(deployment.artifactChecksum, artifact.artifactChecksum) ||
      artifact.artifactVersion !== '1.1.0' ||
      !equalHex(artifact.artifactChecksum, pinnedArtifact.artifactSha256) ||
      net <= 0n ||
      net > gross ||
      post !== pre + net ||
      required !== pre + net ||
      post < required ||
      total !== post ||
      total !== components ||
      artifact.tokenAddress !== ARC_TESTNET_USDC_ADDRESS
    ) {
      throw new AcceptanceAssertionError(
        'cp13_accounting_invariant_failed',
        'The immutable CP-13 artifact failed lifetime funding or accounting invariants.',
        false,
      );
    }
    const syncReceipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      artifact.syncTransactionHash,
      'cp13_sync_receipt_not_committed',
    );
    const syncEvents =
      artifact.syncLogIndex === undefined
        ? []
        : syncReceipt.logs.filter((log) => {
            if (
              !equalHex(log.address, artifact.escrowAddress) ||
              log.logIndex !== artifact.syncLogIndex
            ) {
              return false;
            }
            try {
              const decoded = decodeEventLog({
                abi: ESCROW_ABI,
                eventName: 'ExternalFundingSynced',
                data: log.data,
                topics: [...log.topics],
              });
              return decoded.args.newlyObserved === net && decoded.args.totalFunded === post;
            } catch {
              return false;
            }
          });
    if (
      !equalHex(syncReceipt.blockHash, artifact.syncBlockHash) ||
      syncReceipt.blockNumber.toString() !== artifact.syncBlockNumber ||
      syncEvents.length !== 1
    ) {
      throw new AcceptanceAssertionError(
        'cp13_sync_evidence_mismatch',
        'The CP-13 sync block and log evidence is not canonical.',
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'invariant',
          label: 'cp13_lifetime_funding_threshold',
          intentId: artifact.fundingIntentId,
          amountBaseUnits: post.toString(),
          expectedAmountBaseUnits: required.toString(),
          invariantPassed: true,
          durableStatus: 'complete',
        },
        {
          kind: 'accounting',
          label: 'cp13_pool_conservation',
          amountBaseUnits: total.toString(),
          expectedAmountBaseUnits: post.toString(),
          invariantPassed: true,
          durableStatus: 'complete',
        },
        {
          kind: 'transaction',
          label: 'cp13_sync_transaction',
          transactionHash: artifact.syncTransactionHash,
          blockHash: artifact.syncBlockHash,
          blockNumber: artifact.syncBlockNumber,
          logIndex: artifact.syncLogIndex,
          durableStatus: 'complete',
        },
      ],
    };
  }

  private async verifyRewardPayout(
    state: Readonly<ArcAcceptanceState>,
  ): Promise<VerificationResult> {
    const response = rewardSettlementIntentResponseSchema.parse(
      await this.apiGet(`/api/reports/${state.reportId}/reward-settlement-intents/current`, state),
    );
    const intent = response.data;
    const approval = intent.operations.find(
      ({ operationType, status }) => operationType === 'approval' && status === 'confirmed',
    );
    const payout = intent.operations.find(
      ({ operationType, status }) => operationType === 'payout' && status === 'confirmed',
    );
    if (
      intent.programId !== state.programId ||
      intent.status !== 'paid' ||
      approval?.transactionHash === undefined ||
      approval.eventLogIndex === undefined ||
      approval.blockNumber === undefined ||
      approval.blockHash === undefined ||
      payout?.transactionHash === undefined ||
      payout.eventLogIndex === undefined ||
      payout.transferLogIndex === undefined ||
      payout.blockNumber === undefined ||
      payout.blockHash === undefined
    ) {
      throw new AcceptanceAssertionError(
        'reward_payout_not_verified',
        'The selected report payout is not confirmed with both escrow and transfer events.',
      );
    }
    const amount = parseUsdcBaseUnits(intent.amount) ?? 0n;
    const approvalReceipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      approval.transactionHash,
      'reward_approval_receipt_not_committed',
    );
    const payoutReceipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      payout.transactionHash,
      'reward_payout_receipt_not_committed',
    );
    const approvalExact =
      equalHex(approvalReceipt.blockHash, approval.blockHash) &&
      approvalReceipt.blockNumber.toString() === approval.blockNumber &&
      approvalReceipt.logs.filter((log) => {
        if (
          log.logIndex !== approval.eventLogIndex ||
          !equalHex(log.address, intent.escrowAddress)
        ) {
          return false;
        }
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            eventName: 'RewardApproved',
            data: log.data,
            topics: [...log.topics],
          });
          // Anyone may call syncExternalFunding. Actor is intentionally not an
          // authorization assertion; escrow/newlyObserved/totalFunded are exact.
          return (
            equalHex(decoded.args.reportKey, intent.reportKey) &&
            equalHex(decoded.args.approvedContentHash, intent.approvedContentHash) &&
            equalHex(decoded.args.researcher, intent.recipientAddress) &&
            decoded.args.amount === amount
          );
        } catch {
          return false;
        }
      }).length === 1;
    const payoutEventExact =
      equalHex(payoutReceipt.blockHash, payout.blockHash) &&
      payoutReceipt.blockNumber.toString() === payout.blockNumber &&
      payoutReceipt.logs.filter((log) => {
        if (log.logIndex !== payout.eventLogIndex || !equalHex(log.address, intent.escrowAddress)) {
          return false;
        }
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            eventName: 'RewardPaid',
            data: log.data,
            topics: [...log.topics],
          });
          return (
            equalHex(decoded.args.reportKey, intent.reportKey) &&
            equalHex(decoded.args.researcher, intent.recipientAddress) &&
            decoded.args.amount === amount
          );
        } catch {
          return false;
        }
      }).length === 1;
    const payoutTransferExact =
      payoutReceipt.logs.filter((log) => {
        if (
          log.logIndex !== payout.transferLogIndex ||
          !equalHex(log.address, ARC_TESTNET_USDC_ADDRESS)
        ) {
          return false;
        }
        try {
          const decoded = decodeEventLog({
            abi: ERC20_ABI,
            eventName: 'Transfer',
            data: log.data,
            topics: [...log.topics],
          });
          return (
            equalHex(decoded.args.from, intent.escrowAddress) &&
            equalHex(decoded.args.to, intent.recipientAddress) &&
            decoded.args.value === amount
          );
        } catch {
          return false;
        }
      }).length === 1;
    if (!approvalExact || !payoutEventExact || !payoutTransferExact) {
      throw new AcceptanceAssertionError(
        'reward_settlement_exact_evidence_mismatch',
        'Canonical Arc RewardApproved, RewardPaid, or USDC Transfer evidence is not exact.',
        false,
      );
    }
    return {
      evidence: [
        {
          kind: 'transaction',
          label: 'reward_approval',
          operationId: approval.id,
          intentId: intent.id,
          transactionHash: approval.transactionHash,
          blockHash: approval.blockHash,
          blockNumber: approval.blockNumber,
          logIndex: approval.eventLogIndex,
          amountBaseUnits: amount.toString(),
          durableStatus: 'confirmed',
          invariantPassed: true,
        },
        {
          kind: 'transaction',
          label: 'reward_payout',
          operationId: payout.id,
          intentId: intent.id,
          transactionHash: payout.transactionHash,
          blockHash: payout.blockHash,
          blockNumber: payout.blockNumber,
          logIndex: payout.eventLogIndex,
          amountBaseUnits: amount.toString(),
          transferLogIndex: payout.transferLogIndex,
          durableStatus: 'paid',
          invariantPassed: true,
        },
      ],
    };
  }

  private async verifyEndedProgram(
    state: Readonly<ArcAcceptanceState>,
  ): Promise<VerificationResult> {
    const response = programResponseSchema.parse(
      await this.apiGet(`/api/owner/programs/${state.programId}`, state),
    );
    if (response.data.status !== 'expired' && response.data.status !== 'closed') {
      throw new AcceptanceAssertionError(
        'program_not_ended',
        'The product state must be expired or closed before withdrawal.',
      );
    }
    return {
      evidence: [
        {
          kind: 'invariant',
          label: 'program_product_state_ended',
          productStatus: response.data.status,
          durableStatus: response.data.status,
          invariantPassed: true,
        },
      ],
    };
  }

  private reloadVerification(result: VerificationResult): VerificationResult {
    return {
      evidence: result.evidence,
      durableFingerprint: fingerprintPublicEvidence(result.evidence),
    };
  }

  private async verifyWithdrawal(
    state: Readonly<ArcAcceptanceState>,
    complete: boolean,
  ): Promise<VerificationResult> {
    const intentId = this.requireEvidenceId(
      state,
      complete ? 'withdraw_wallet_signature' : 'close_wallet_signature',
      'intentId',
    );
    const response = withdrawalIntentResponseSchema.parse(
      await this.apiGet(`/api/programs/${state.programId}/withdrawal-intents/${intentId}`, state),
    );
    const intent = response.data;
    if (
      (complete &&
        (intent.status !== 'complete' || intent.withdrawTransactionHash === undefined)) ||
      (!complete &&
        (!intent.closeRequired ||
          intent.closeTransactionHash === undefined ||
          !['ready_to_withdraw', 'withdraw_submitted', 'verifying', 'complete'].includes(
            intent.status,
          )))
    ) {
      throw new AcceptanceAssertionError(
        complete ? 'withdrawal_not_verified' : 'escrow_close_not_verified',
        complete
          ? 'The final withdrawal receipt and event are not verified.'
          : 'The close transaction is not verified yet.',
      );
    }
    const amount = parseUsdcBaseUnits(intent.amount) ?? 0n;
    const transactionHash = complete
      ? intent.withdrawTransactionHash!
      : intent.closeTransactionHash!;
    const receipt = await this.committedReceipt(
      this.config.arcRpcUrl,
      transactionHash,
      complete ? 'withdrawal_receipt_not_committed' : 'escrow_close_receipt_not_committed',
    );
    let eventLogIndex: number;
    let transferLogIndex: number | undefined;
    if (complete) {
      const events = receipt.logs.filter((log) => {
        if (!equalHex(log.address, intent.escrowAddress)) return false;
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            eventName: 'RemainingFundsWithdrawn',
            data: log.data,
            topics: [...log.topics],
          });
          return (
            equalHex(decoded.args.recipient, intent.recipientAddress) &&
            decoded.args.amount === amount
          );
        } catch {
          return false;
        }
      });
      const transfers = receipt.logs.filter((log) => {
        if (!equalHex(log.address, ARC_TESTNET_USDC_ADDRESS)) return false;
        try {
          const decoded = decodeEventLog({
            abi: ERC20_ABI,
            eventName: 'Transfer',
            data: log.data,
            topics: [...log.topics],
          });
          return (
            equalHex(decoded.args.from, intent.escrowAddress) &&
            equalHex(decoded.args.to, intent.recipientAddress) &&
            decoded.args.value === amount
          );
        } catch {
          return false;
        }
      });
      if (events.length !== 1 || transfers.length !== 1) {
        throw new AcceptanceAssertionError(
          'withdrawal_exact_evidence_mismatch',
          'The exact RemainingFundsWithdrawn and USDC Transfer evidence is missing.',
          false,
        );
      }
      eventLogIndex = events[0]!.logIndex;
      transferLogIndex = transfers[0]!.logIndex;
    } else {
      const events = receipt.logs.filter((log) => {
        if (!equalHex(log.address, intent.escrowAddress)) return false;
        try {
          const decoded = decodeEventLog({
            abi: ESCROW_ABI,
            eventName: 'EscrowClosed',
            data: log.data,
            topics: [...log.topics],
          });
          return equalHex(decoded.args.actor, intent.walletAddress);
        } catch {
          return false;
        }
      });
      if (events.length !== 1) {
        throw new AcceptanceAssertionError(
          'escrow_close_exact_evidence_mismatch',
          'The exact EscrowClosed owner event is missing.',
          false,
        );
      }
      eventLogIndex = events[0]!.logIndex;
    }
    return {
      evidence: [
        {
          kind: complete ? 'transaction' : 'event',
          label: complete ? 'remaining_funds_withdrawn' : 'escrow_closed',
          intentId,
          transactionHash,
          blockHash: receipt.blockHash,
          blockNumber: receipt.blockNumber.toString(),
          logIndex: eventLogIndex,
          ...(transferLogIndex === undefined ? {} : { transferLogIndex }),
          address: intent.recipientAddress,
          amountBaseUnits: amount.toString(),
          durableStatus: complete
            ? 'complete'
            : (intent.status as
                'ready_to_withdraw' | 'withdraw_submitted' | 'verifying' | 'complete'),
          invariantPassed: true,
        },
      ],
    };
  }

  private requireEvidenceId(
    state: Readonly<ArcAcceptanceState>,
    stepId: ArcAcceptanceStepId,
    field: 'intentId' | 'depositId',
  ): string {
    const value = [...state.evidence]
      .reverse()
      .find((item) => item.stepId === stepId && item[field] !== undefined)?.[field];
    if (value === undefined) {
      throw new AcceptanceAssertionError(
        'durable_operation_id_required',
        `Record ${field} at ${stepId}; the runner never guesses or blind-retries an operation.`,
        false,
      );
    }
    return value;
  }

  private assertTrustedOrigins(state: Readonly<ArcAcceptanceState>): void {
    const expectedApiOrigin = requirePublicHttpsOrigin(
      this.config.expectedApiOrigin,
      'acceptance_expected_api_origin_invalid',
    );
    const expectedWebOrigin = requirePublicHttpsOrigin(
      this.config.expectedWebOrigin,
      'acceptance_expected_web_origin_invalid',
    );
    const apiOrigin = requirePublicHttpsOrigin(state.apiOrigin, 'acceptance_api_origin_invalid');
    const webOrigin = requirePublicHttpsOrigin(state.webOrigin, 'acceptance_web_origin_invalid');
    if (apiOrigin !== expectedApiOrigin) {
      throw new AcceptanceAssertionError(
        'acceptance_api_origin_mismatch',
        'The state API origin does not exactly match the explicitly trusted acceptance origin.',
        false,
      );
    }
    if (webOrigin !== expectedWebOrigin) {
      throw new AcceptanceAssertionError(
        'acceptance_web_origin_mismatch',
        'The state web origin does not exactly match the explicitly trusted acceptance origin.',
        false,
      );
    }
  }

  private async apiGet(path: string, state: Readonly<ArcAcceptanceState>): Promise<unknown> {
    return this.readJson(
      await this.request(new URL(path, state.apiOrigin), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.config.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }),
      'acceptance_api_read_failed',
    );
  }

  private async circleGet(path: string): Promise<unknown> {
    return this.readJson(
      await this.request(new URL(path, this.config.circleApiBaseUrl), {
        method: 'GET',
        headers: { authorization: `Bearer ${this.config.circleApiKey}` },
        signal: AbortSignal.timeout(15_000),
      }),
      'circle_read_only_preflight_failed',
    );
  }

  private async rpc<T>(method: string, params: readonly unknown[]): Promise<T> {
    return this.rpcAt<T>(this.config.arcRpcUrl, method, params);
  }

  private async rpcAt<T>(rpcUrl: string, method: string, params: readonly unknown[]): Promise<T> {
    const response = await this.request(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = z
      .object({ result: z.unknown().optional(), error: z.unknown().optional() })
      .parse(await this.readJson(response, 'arc_rpc_preflight_failed'));
    if (payload.error !== undefined || payload.result === undefined) {
      throw new AcceptanceAssertionError(
        'arc_rpc_preflight_failed',
        'Arc RPC returned an error during the read-only preflight.',
      );
    }
    return payload.result as T;
  }

  private async committedReceipt(
    rpcUrl: string,
    transactionHash: string,
    code: string,
  ): Promise<{
    readonly transactionHash: `0x${string}`;
    readonly blockNumber: bigint;
    readonly blockHash: `0x${string}`;
    readonly contractAddress: `0x${string}` | null;
    readonly logs: readonly {
      readonly address: `0x${string}`;
      readonly data: Hex;
      readonly topics: readonly [Hex, ...Hex[]];
      readonly logIndex: number;
    }[];
  }> {
    let raw: unknown;
    try {
      raw = await this.rpcAt<unknown>(rpcUrl, 'eth_getTransactionReceipt', [transactionHash]);
    } catch {
      throw new AcceptanceAssertionError(
        code,
        'The canonical transaction receipt is not available yet.',
      );
    }
    const parsed = rpcReceiptSchema.safeParse(raw);
    if (
      !parsed.success ||
      BigInt(parsed.data.status) !== 1n ||
      !equalHex(parsed.data.transactionHash, transactionHash)
    ) {
      throw new AcceptanceAssertionError(
        code,
        'The canonical transaction receipt is missing, reverted, or mismatched.',
      );
    }
    const block = rpcBlockSchema.safeParse(
      await this.rpcAt<unknown>(rpcUrl, 'eth_getBlockByNumber', [parsed.data.blockNumber, false]),
    );
    if (!block.success || !equalHex(block.data.hash, parsed.data.blockHash)) {
      throw new AcceptanceAssertionError(
        `${code}_reorged`,
        'The receipt block is no longer canonical.',
      );
    }
    return {
      transactionHash: parsed.data.transactionHash as `0x${string}`,
      blockNumber: BigInt(parsed.data.blockNumber),
      blockHash: parsed.data.blockHash as `0x${string}`,
      contractAddress: parsed.data.contractAddress as `0x${string}` | null,
      logs: parsed.data.logs.map((log) => ({
        address: log.address as `0x${string}`,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
        logIndex: Number(BigInt(log.logIndex)),
      })),
    };
  }

  private async readJson(response: Response, code: string): Promise<unknown> {
    if (!response.ok) {
      throw new AcceptanceAssertionError(
        code,
        `Read-only request failed with HTTP ${response.status}.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new AcceptanceAssertionError(code, 'Read-only response was not valid JSON.');
    }
  }
}

function equalHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function requirePublicHttpsOrigin(value: string, code: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AcceptanceAssertionError(
      code,
      'Acceptance origins must be valid public HTTPS origins.',
      false,
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const ipCandidate =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    isIP(ipCandidate) !== 0 ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new AcceptanceAssertionError(
      code,
      'Acceptance origins must be explicit public HTTPS origins without credentials, paths, query strings, fragments, IP literals, or private hostnames.',
      false,
    );
  }
  return parsed.origin;
}

export function runtimeMatchesPinnedArtifact(
  artifact: EscrowArtifact,
  deployedCode: string,
): boolean {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(deployedCode)) return false;
  const normalized = Buffer.from(deployedCode.slice(2), 'hex');
  for (const references of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of references) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start < 0 ||
        length <= 0 ||
        start + length > normalized.length
      ) {
        return false;
      }
      normalized.fill(0, start, start + length);
    }
  }
  const checksum = `0x${createHash('sha256').update(normalized).digest('hex')}`;
  return equalHex(checksum, artifact.runtimeBytecodeSha256);
}
