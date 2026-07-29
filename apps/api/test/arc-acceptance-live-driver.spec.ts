import { encodeAbiParameters, encodeEventTopics, padHex, type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import {
  FUNDING_NETWORK_CONFIG,
  GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
} from '@bug-bounty-escrow/shared';

import {
  LiveArcAcceptanceDriver,
  runtimeMatchesPinnedArtifact,
} from '../scripts/arc-acceptance/live-driver.js';
import { loadEscrowArtifact } from '../src/escrow/escrow-artifact.js';
import {
  createArcAcceptanceState,
  type ArcAcceptanceState,
} from '../scripts/arc-acceptance/runner.js';

const PROGRAM_ID = '31990000-0000-4000-8000-000000000001';
const REPORT_ID = '33990000-0000-4000-8000-000000000001';
const INTENT_ID = '31990000-0000-4000-8000-000000000011';
const APPROVAL_OPERATION_ID = '31990000-0000-4000-8000-000000000021';
const PAYOUT_OPERATION_ID = '31990000-0000-4000-8000-000000000022';
const OWNER_ID = '30990000-0000-4000-8000-000000000001';
const ESCROW = `0x${'1'.repeat(40)}` as const;
const OWNER = `0x${'2'.repeat(40)}` as const;
const RECIPIENT = `0x${'3'.repeat(40)}` as const;
const USDC = '0x3600000000000000000000000000000000000000';
const CLOSE_HASH = `0x${'a'.repeat(64)}` as const;
const WITHDRAW_HASH = `0x${'b'.repeat(64)}` as const;
const APPROVAL_HASH = `0x${'c'.repeat(64)}` as const;
const PAYOUT_HASH = `0x${'d'.repeat(64)}` as const;
const BRIDGE_BURN_HASH = `0x${'6'.repeat(64)}` as const;
const BRIDGE_DESTINATION_HASH = `0x${'7'.repeat(64)}` as const;
const BRIDGE_SYNC_HASH = `0x${'8'.repeat(64)}` as const;
const ETHEREUM_DEPOSIT_HASH = `0x${'9'.repeat(64)}` as const;
const DEPLOYMENT_HASH = `0x${'f'.repeat(64)}` as const;
const BLOCK_HASH = `0x${'e'.repeat(64)}` as const;
const REPORT_KEY = `0x${'4'.repeat(64)}` as const;
const CONTENT_HASH = `0x${'5'.repeat(64)}` as const;
const NOW = '2026-07-29T10:00:00.000Z';
const AMOUNT = 5_000_000n;
const ETHEREUM_DEPOSIT_AMOUNT = 1_000_000n;
const ETHEREUM_DEPOSIT_ID = '31990000-0000-4000-8000-000000000013';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASE_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const BASE_TOKEN_MESSENGER = '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa';
const BASE_TOKEN_MINTER = '0xb43db544e2c27092c107639ad201b3defabcf192';
const ARC_TOKEN_MESSENGER = '0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa';
const ARC_GATEWAY_MINTER = '0x0022222abe238cc2c7bb1f21003f0a260052475b';
const ETHEREUM_TRANSFER_SPEC_HASH = `0x${'1a'.repeat(32)}` as const;
const ARBITRUM_TRANSFER_SPEC_HASH = `0x${'1b'.repeat(32)}` as const;
const BASE_TRANSFER_SPEC_HASH = `0x${'1c'.repeat(32)}` as const;
const SOURCE_WALLET_IDENTITY = padHex(OWNER, { size: 32 });
const OFFICIAL_DEPOSIT_FOR_BURN_TOPIC =
  '0xca755bee3eb35c17472c94a58affff227ad9d8333b625e0f678ad839d43f1852';
const OFFICIAL_MINT_AND_WITHDRAW_TOPIC =
  '0x1b2a7ff080b8cb6ff436ce0372e399692bbfb6d4ae5766fd8d58a7b8cc6142e6';
const PINNED_ARTIFACT_CHECKSUM =
  '0xdb9fa4e445203b4b27bef0b4d4d7c159580447776e0d24a154cba89041e1058c';

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
const ESCROW_ABI = [
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

function acceptanceState(): ArcAcceptanceState {
  const state = createArcAcceptanceState({
    apiOrigin: 'https://api.example.test',
    webOrigin: 'https://app.example.test',
    programId: PROGRAM_ID,
    reportId: REPORT_ID,
    now: new Date(NOW),
  });
  state.evidence.push(
    {
      stepId: 'bridge_wallet_signatures',
      recordedAt: NOW,
      kind: 'transaction',
      label: 'bridge_wallet_public_operation',
      intentId: INTENT_ID,
      transactionHash: BRIDGE_BURN_HASH,
    },
    {
      stepId: 'ub_spend_signatures',
      recordedAt: NOW,
      kind: 'transaction',
      label: 'ub_spend_public_operation',
      intentId: INTENT_ID,
      transactionHash: BRIDGE_DESTINATION_HASH,
    },
    {
      stepId: 'close_wallet_signature',
      recordedAt: NOW,
      kind: 'transaction',
      label: 'close_wallet_public_operation',
      intentId: INTENT_ID,
      transactionHash: CLOSE_HASH,
    },
    {
      stepId: 'withdraw_wallet_signature',
      recordedAt: NOW,
      kind: 'transaction',
      label: 'withdraw_wallet_public_operation',
      intentId: INTENT_ID,
      transactionHash: WITHDRAW_HASH,
    },
  );
  return state;
}

function log(input: { address: string; data?: Hex; topics: readonly unknown[]; index: number }) {
  return {
    address: input.address,
    data: input.data ?? '0x',
    topics: input.topics as readonly Hex[],
    logIndex: `0x${input.index.toString(16)}`,
  };
}

function receipt(
  transactionHash: string,
  logs: readonly ReturnType<typeof log>[],
  contractAddress: string | null = null,
) {
  return {
    status: '0x1',
    transactionHash,
    blockNumber: '0x64',
    blockHash: BLOCK_HASH,
    contractAddress,
    logs,
  };
}

function response(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function withdrawalApiResponse() {
  return {
    success: true,
    data: {
      id: INTENT_ID,
      programId: PROGRAM_ID,
      escrowAddress: ESCROW,
      recipientAddress: RECIPIENT,
      walletAddress: OWNER,
      amount: '5',
      closeRequired: true,
      status: 'complete',
      closeTransactionHash: CLOSE_HASH,
      withdrawTransactionHash: WITHDRAW_HASH,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

function rewardApiResponse() {
  return {
    success: true,
    data: {
      id: INTENT_ID,
      reportId: REPORT_ID,
      programId: PROGRAM_ID,
      escrowAddress: ESCROW,
      ownerWallet: OWNER,
      reportKey: REPORT_KEY,
      approvedContentHash: CONTENT_HASH,
      recipientAddress: RECIPIENT,
      calculationType: 'flat',
      amount: '5',
      status: 'paid',
      operations: [
        {
          id: APPROVAL_OPERATION_ID,
          operationType: 'approval',
          attemptNo: 1,
          status: 'confirmed',
          transactionHash: APPROVAL_HASH,
          eventLogIndex: 1,
          blockNumber: '100',
          blockHash: BLOCK_HASH,
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: PAYOUT_OPERATION_ID,
          operationType: 'payout',
          attemptNo: 1,
          status: 'confirmed',
          transactionHash: PAYOUT_HASH,
          eventLogIndex: 2,
          transferLogIndex: 3,
          blockNumber: '100',
          blockHash: BLOCK_HASH,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

function bridgeApiResponse() {
  return {
    success: true,
    data: {
      id: INTENT_ID,
      programId: PROGRAM_ID,
      walletAddress: OWNER,
      routeMode: 'bridge',
      grossAmount: '5',
      estimatedFeeReserve: '0',
      feeAllocations: [
        {
          network: 'Base_Sepolia',
          amount: '0',
          components: [
            { network: 'Base_Sepolia', type: 'provider', token: 'USDC', amount: '0' },
            { network: 'Base_Sepolia', type: 'gas', token: 'USDC', amount: '0' },
            { network: 'Base_Sepolia', type: 'kit', token: 'USDC', amount: '0' },
            { network: 'Base_Sepolia', type: 'forwarder', token: 'USDC', amount: '0' },
          ],
        },
      ],
      sources: [{ network: 'Base_Sepolia', amount: '5' }],
      sourceDeposits: [],
      fundingPhase: 'ready_for_destination',
      destinationChain: 'Arc_Testnet',
      recipientAddress: ESCROW,
      recipientVerified: true,
      status: 'complete',
      destinationTransactionHash: BRIDGE_DESTINATION_HASH,
      netReceivedAmount: '5',
      confirmationArtifact: {
        fundingIntentId: INTENT_ID,
        programId: PROGRAM_ID,
        routeMode: 'bridge',
        escrowAddress: ESCROW,
        artifactVersion: '1.1.0',
        artifactChecksum: PINNED_ARTIFACT_CHECKSUM,
        tokenAddress: USDC,
        tokenDecimals: 6,
        destinationTransactionHash: BRIDGE_DESTINATION_HASH,
        destinationLogIndex: 6,
        destinationBlockNumber: '100',
        destinationBlockHash: BLOCK_HASH,
        syncTransactionHash: BRIDGE_SYNC_HASH,
        syncLogIndex: 7,
        syncBlockNumber: '100',
        syncBlockHash: BLOCK_HASH,
        grossAmount: '5',
        estimatedFeeReserve: '0',
        netReceivedAmount: '5',
        preTotalFundedAmount: '0',
        requiredTotalFundedAmount: '5',
        postTotalFundedAmount: '5',
        accounting: {
          totalPool: '5',
          totalPaid: '0',
          totalWithdrawn: '0',
          approvedOutstanding: '0',
          availablePool: '5',
        },
        reconciledAt: NOW,
      },
      recovery: {
        operationRecordId: APPROVAL_OPERATION_ID,
        operationType: 'bridge',
        attemptNo: 1,
        status: 'confirmed',
        retryable: false,
        submissionUncertain: false,
        sourceTransactionHashes: [BRIDGE_BURN_HASH],
        steps: [
          {
            name: 'burn',
            state: 'success',
            transactionHash: BRIDGE_BURN_HASH,
          },
        ],
      },
      expiresAt: '2026-07-29T01:00:00.000Z',
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

function unifiedBalanceApiResponse(transferId?: string) {
  const bridge = bridgeApiResponse();
  return {
    ...bridge,
    data: {
      ...bridge.data,
      routeMode: 'unified_balance',
      ...(transferId === undefined ? {} : { transferId }),
      sources: [
        { network: 'Ethereum_Sepolia', amount: '1' },
        { network: 'Base_Sepolia', amount: '2' },
        { network: 'Arbitrum_Sepolia', amount: '2' },
      ],
      feeAllocations: [
        {
          network: 'Ethereum_Sepolia',
          amount: '0',
          components: [
            {
              network: 'Ethereum_Sepolia',
              type: 'provider',
              token: 'USDC',
              amount: '0',
            },
            { network: 'Ethereum_Sepolia', type: 'gas', token: 'USDC', amount: '0' },
            { network: 'Ethereum_Sepolia', type: 'kit', token: 'USDC', amount: '0' },
            {
              network: 'Ethereum_Sepolia',
              type: 'forwarder',
              token: 'USDC',
              amount: '0',
            },
          ],
        },
        {
          network: 'Base_Sepolia',
          amount: '0',
          components: [
            { network: 'Base_Sepolia', type: 'provider', token: 'USDC', amount: '0' },
            { network: 'Base_Sepolia', type: 'gas', token: 'USDC', amount: '0' },
            { network: 'Base_Sepolia', type: 'kit', token: 'USDC', amount: '0' },
            { network: 'Base_Sepolia', type: 'forwarder', token: 'USDC', amount: '0' },
          ],
        },
        {
          network: 'Arbitrum_Sepolia',
          amount: '0',
          components: [
            {
              network: 'Arbitrum_Sepolia',
              type: 'provider',
              token: 'USDC',
              amount: '0',
            },
            { network: 'Arbitrum_Sepolia', type: 'gas', token: 'USDC', amount: '0' },
            { network: 'Arbitrum_Sepolia', type: 'kit', token: 'USDC', amount: '0' },
            {
              network: 'Arbitrum_Sepolia',
              type: 'forwarder',
              token: 'USDC',
              amount: '0',
            },
          ],
        },
      ],
      confirmationArtifact: {
        ...bridge.data.confirmationArtifact,
        routeMode: 'unified_balance',
      },
      recovery: {
        ...bridge.data.recovery,
        operationType: 'spend',
        ...(transferId === undefined ? {} : { transferId }),
      },
    },
  };
}

function ethereumSourceDepositApiResponse() {
  const unified = unifiedBalanceApiResponse();
  return {
    ...unified,
    data: {
      ...unified.data,
      sourceDeposits: [
        {
          id: ETHEREUM_DEPOSIT_ID,
          attemptNo: 1,
          network: 'Ethereum_Sepolia',
          chainId: FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.chainId,
          tokenAddress: FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.tokenAddress,
          gatewayWalletAddress: GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
          walletAddress: OWNER,
          amount: '1',
          preGatewayBalance: '0',
          status: 'confirmed',
          transactionHash: ETHEREUM_DEPOSIT_HASH,
          transferLogIndex: 1,
          logIndex: 2,
          blockNumber: '100',
          blockHash: BLOCK_HASH,
          canAttach: true,
          canRetry: false,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    },
  };
}

function deploymentApiResponse(artifactChecksum: string) {
  return {
    success: true,
    data: {
      programId: PROGRAM_ID,
      programKey: REPORT_KEY,
      chainId: 5_042_002,
      tokenAddress: USDC,
      ownerWallet: OWNER,
      withdrawRecipient: RECIPIENT,
      refundUnlockAt: NOW,
      artifactVersion: '1.1.0',
      artifactChecksum,
      circleContractId: '31990000-0000-4000-8000-000000000041',
      circleTransactionId: '31990000-0000-4000-8000-000000000042',
      status: 'confirmed',
      contractAddress: ESCROW,
      transactionHash: DEPLOYMENT_HASH,
      updatedAt: NOW,
    },
  };
}

function driver(fetchMock: typeof fetch) {
  return new LiveArcAcceptanceDriver({
    accessToken: 'test-access-token-with-enough-length',
    expectedOwnerId: OWNER_ID,
    expectedApiOrigin: 'https://api.example.test',
    expectedWebOrigin: 'https://app.example.test',
    arcRpcUrl: 'https://arc-rpc.example.test',
    arbitrumSepoliaRpcUrl: 'https://arb-rpc.example.test',
    baseSepoliaRpcUrl: 'https://base-rpc.example.test',
    ethereumSepoliaRpcUrl: 'https://ethereum-rpc.example.test',
    artifactPath: '../../packages/contracts/artifacts/BountyEscrow.v1.json',
    circleApiBaseUrl: 'https://circle.example.test',
    circleApiKey: 'test-circle-key-with-enough-length',
    circleDeploymentWalletId: '31990000-0000-4000-8000-000000000031',
    gatewaySubscriptionId: '31990000-0000-4000-8000-000000000032',
    fetch: fetchMock,
  });
}

function rpcMock(input: {
  apiBody: unknown | ((url: string) => unknown);
  code?: string;
  receipts: Readonly<Record<string, unknown>>;
}): typeof fetch {
  return vi.fn(async (request, init) => {
    const url =
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;
    if (url.startsWith('https://api.example.test/')) {
      return response(typeof input.apiBody === 'function' ? input.apiBody(url) : input.apiBody);
    }
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: string[];
    };
    if (body.method === 'eth_getTransactionReceipt') {
      return response({ jsonrpc: '2.0', id: 1, result: input.receipts[body.params[0]!] });
    }
    if (body.method === 'eth_getBlockByNumber') {
      return response({ jsonrpc: '2.0', id: 1, result: { hash: BLOCK_HASH } });
    }
    if (body.method === 'eth_getCode') {
      return response({ jsonrpc: '2.0', id: 1, result: input.code ?? '0x01' });
    }
    throw new Error(`Unexpected mocked request: ${url} ${body.method}`);
  }) as typeof fetch;
}

function preflightMock(input?: {
  endpoint?: string;
  notificationTypes?: string[];
  domains?: string[];
}): typeof fetch {
  return vi.fn(async (request, init) => {
    const url =
      typeof request === 'string'
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;
    if (url.includes('/v1/w3s/wallets/')) {
      return response({
        data: {
          wallet: {
            id: '31990000-0000-4000-8000-000000000031',
            address: OWNER,
            blockchain: 'ARC-TESTNET',
            custodyType: 'DEVELOPER',
            accountType: 'SCA',
            state: 'LIVE',
          },
        },
      });
    }
    if (url.includes('/v2/notifications/subscriptions/permissionless/')) {
      return response({
        data: {
          id: '31990000-0000-4000-8000-000000000032',
          environment: 'TEST',
          enabled: true,
          endpoint: input?.endpoint ?? 'https://app.example.test/api/webhooks/circle/gateway',
          notificationTypes: input?.notificationTypes ?? ['gateway.deposit.finalized'],
          addresses: [OWNER],
          domains: input?.domains ?? ['0', '3', '6', '26'],
        },
      });
    }
    const body = JSON.parse(String(init?.body)) as {
      method: string;
    };
    if (body.method === 'eth_getCode') {
      return response({ jsonrpc: '2.0', id: 1, result: '0x01' });
    }
    if (body.method === 'eth_chainId') {
      const chainId = url.includes('base-rpc')
        ? 84_532
        : url.includes('arb-rpc')
          ? 421_614
          : url.includes('ethereum-rpc')
            ? 11_155_111
            : 5_042_002;
      return response({
        jsonrpc: '2.0',
        id: 1,
        result: `0x${chainId.toString(16)}`,
      });
    }
    throw new Error(`Unexpected mocked request: ${url} ${body.method}`);
  }) as typeof fetch;
}

describe('QA-ARC-01 live read-only verifier', () => {
  it('rejects mismatched or private API origins before making any fetch call', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const verifier = driver(fetchMock);
    const mismatched = acceptanceState();
    mismatched.apiOrigin = 'https://attacker.example.test';

    await expect(verifier.verify('dedicated_draft', mismatched)).rejects.toMatchObject({
      code: 'acceptance_api_origin_mismatch',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const privateIp = acceptanceState();
    privateIp.apiOrigin = 'https://10.0.0.7';
    await expect(verifier.verify('dedicated_draft', privateIp)).rejects.toMatchObject({
      code: 'acceptance_api_origin_invalid',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the exact trusted Gateway webhook endpoint and notification type set', async () => {
    const exactPreflight = preflightMock({ domains: ['0', '3', '6', '26'] });
    await expect(
      driver(exactPreflight).verify('production_preflight', acceptanceState()),
    ).resolves.toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          label: 'gateway_test_subscription_capacity',
        }),
        expect.objectContaining({
          label: 'ethereum_sepolia_source_ready',
          network: 'Ethereum_Sepolia',
        }),
      ]),
    });
    expect(vi.mocked(exactPreflight)).toHaveBeenCalledWith(
      expect.stringContaining('ethereum-rpc.example.test'),
      expect.anything(),
    );

    await expect(
      driver(
        preflightMock({
          endpoint: 'https://collector.example.test/circle',
          notificationTypes: ['gateway.deposit.finalized', 'gateway.transfer.completed'],
        }),
      ).verify('production_preflight', acceptanceState()),
    ).rejects.toMatchObject({
      code: 'gateway_subscription_preflight_failed',
    });

    await expect(
      driver(preflightMock({ domains: ['3', '6', '26'] })).verify(
        'production_preflight',
        acceptanceState(),
      ),
    ).rejects.toMatchObject({
      code: 'gateway_subscription_preflight_failed',
    });

    await expect(
      driver(preflightMock({ domains: ['0', '3', '6'] })).verify(
        'production_preflight',
        acceptanceState(),
      ),
    ).rejects.toMatchObject({
      code: 'gateway_subscription_preflight_failed',
    });
  });

  it('verifies Ethereum Sepolia Unified Balance deposits with exact canonical dual proof', async () => {
    const transfer = log({
      address: FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.tokenAddress,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: OWNER, to: GATEWAY_WALLET_EVM_TESTNET_ADDRESS },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [ETHEREUM_DEPOSIT_AMOUNT]),
      index: 1,
    });
    const deposited = log({
      address: GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
      topics: encodeEventTopics({
        abi: GATEWAY_ABI,
        eventName: 'Deposited',
        args: {
          token: FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.tokenAddress,
          depositor: OWNER,
          sender: OWNER,
        },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [ETHEREUM_DEPOSIT_AMOUNT]),
      index: 2,
    });
    const state = acceptanceState();
    state.evidence.push({
      stepId: 'ub_ethereum_deposit_signatures',
      recordedAt: NOW,
      kind: 'transaction',
      label: 'ethereum_deposit_public_operation',
      intentId: INTENT_ID,
      depositId: ETHEREUM_DEPOSIT_ID,
      transactionHash: ETHEREUM_DEPOSIT_HASH,
    });
    const exactFetch = rpcMock({
      apiBody: ethereumSourceDepositApiResponse(),
      receipts: {
        [ETHEREUM_DEPOSIT_HASH]: receipt(ETHEREUM_DEPOSIT_HASH, [transfer, deposited]),
      },
    });

    await expect(
      driver(exactFetch).verify('ub_ethereum_deposit_verify', state),
    ).resolves.toMatchObject({
      evidence: [
        expect.objectContaining({
          label: 'ethereum_sepolia_gateway_and_transfer_dual_proof',
          network: 'Ethereum_Sepolia',
          transactionHash: ETHEREUM_DEPOSIT_HASH,
          transferLogIndex: 1,
          logIndex: 2,
          amountBaseUnits: ETHEREUM_DEPOSIT_AMOUNT.toString(),
        }),
      ],
    });
    expect(vi.mocked(exactFetch)).toHaveBeenCalledWith(
      expect.stringContaining('ethereum-rpc.example.test'),
      expect.anything(),
    );

    await expect(
      driver(
        rpcMock({
          apiBody: ethereumSourceDepositApiResponse(),
          receipts: {
            [ETHEREUM_DEPOSIT_HASH]: receipt(ETHEREUM_DEPOSIT_HASH, [transfer]),
          },
        }),
      ).verify('ub_ethereum_deposit_verify', state),
    ).rejects.toMatchObject({
      code: 'source_deposit_dual_proof_mismatch',
    });
  });

  it('matches only the pinned normalized 1.1.0 runtime bytecode', async () => {
    const artifact = await loadEscrowArtifact(
      '../../packages/contracts/artifacts/BountyEscrow.v1.json',
    );
    expect(runtimeMatchesPinnedArtifact(artifact, artifact.deployedBytecode)).toBe(true);
    const firstByte = artifact.deployedBytecode.slice(2, 4) === '00' ? '01' : '00';
    const mutated = `0x${firstByte}${artifact.deployedBytecode.slice(4)}`;
    expect(runtimeMatchesPinnedArtifact(artifact, mutated)).toBe(false);
    expect(runtimeMatchesPinnedArtifact(artifact, '0x')).toBe(false);
  });

  it('rejects a deployment whose API checksum is not the locally pinned artifact', async () => {
    const artifact = await loadEscrowArtifact(
      '../../packages/contracts/artifacts/BountyEscrow.v1.json',
    );
    const initialized = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'EscrowInitialized',
        args: { programKey: REPORT_KEY, owner: OWNER, token: USDC },
      }),
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'address' }],
        [BigInt(Math.floor(Date.parse(NOW) / 1_000)), RECIPIENT],
      ),
      index: 1,
    });
    const verifier = driver(
      rpcMock({
        apiBody: deploymentApiResponse(`0x${'0'.repeat(64)}`),
        code: artifact.deployedBytecode,
        receipts: {
          [DEPLOYMENT_HASH]: receipt(DEPLOYMENT_HASH, [initialized], ESCROW),
        },
      }),
    );

    await expect(verifier.verify('deploy_verify', acceptanceState())).rejects.toMatchObject({
      code: 'deployment_event_or_runtime_mismatch',
    });

    const exact = driver(
      rpcMock({
        apiBody: deploymentApiResponse(artifact.artifactSha256),
        code: artifact.deployedBytecode,
        receipts: {
          [DEPLOYMENT_HASH]: receipt(DEPLOYMENT_HASH, [initialized], ESCROW),
        },
      }),
    );
    await expect(exact.verify('deploy_verify', acceptanceState())).resolves.toMatchObject({
      evidence: [
        expect.objectContaining({
          label: 'verified_escrow_address',
          address: ESCROW,
          durableStatus: 'confirmed',
        }),
        expect.objectContaining({
          label: 'verified_deployment_transaction',
          transactionHash: DEPLOYMENT_HASH,
          logIndex: 1,
        }),
        expect.objectContaining({
          label: 'deployment_artifact_checksum',
          checksum: artifact.artifactSha256,
        }),
      ],
    });
  });

  it('parses exact EscrowClosed and RemainingFundsWithdrawn + USDC Transfer receipts', async () => {
    const closeLog = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'EscrowClosed',
        args: { actor: OWNER },
      }),
      index: 1,
    });
    const withdrawalLog = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'RemainingFundsWithdrawn',
        args: { recipient: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 2,
    });
    const transferLog = log({
      address: USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: ESCROW, to: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 3,
    });
    const verifier = driver(
      rpcMock({
        apiBody: withdrawalApiResponse(),
        receipts: {
          [CLOSE_HASH]: receipt(CLOSE_HASH, [closeLog]),
          [WITHDRAW_HASH]: receipt(WITHDRAW_HASH, [withdrawalLog, transferLog]),
        },
      }),
    );

    await expect(verifier.verify('close_verify', acceptanceState())).resolves.toMatchObject({
      evidence: [
        expect.objectContaining({
          label: 'escrow_closed',
          transactionHash: CLOSE_HASH,
          logIndex: 1,
          blockHash: BLOCK_HASH,
        }),
      ],
    });
    await expect(verifier.verify('withdraw_verify', acceptanceState())).resolves.toMatchObject({
      evidence: [
        expect.objectContaining({
          label: 'remaining_funds_withdrawn',
          address: RECIPIENT,
          amountBaseUnits: AMOUNT.toString(),
          logIndex: 2,
          transferLogIndex: 3,
        }),
      ],
    });
  });

  it('rejects a status-only withdrawal when the canonical transfer amount is wrong', async () => {
    const withdrawalLog = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'RemainingFundsWithdrawn',
        args: { recipient: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 2,
    });
    const wrongTransfer = log({
      address: USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: ESCROW, to: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT - 1n]),
      index: 3,
    });
    const verifier = driver(
      rpcMock({
        apiBody: withdrawalApiResponse(),
        receipts: {
          [WITHDRAW_HASH]: receipt(WITHDRAW_HASH, [withdrawalLog, wrongTransfer]),
        },
      }),
    );

    await expect(verifier.verify('withdraw_verify', acceptanceState())).rejects.toMatchObject({
      code: 'withdrawal_exact_evidence_mismatch',
    });
  });

  it('requires exact RewardApproved, RewardPaid and payout Transfer evidence', async () => {
    const approvalLog = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'RewardApproved',
        args: {
          reportKey: REPORT_KEY,
          approvedContentHash: CONTENT_HASH,
          researcher: RECIPIENT,
        },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 1,
    });
    const payoutLog = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'RewardPaid',
        args: { reportKey: REPORT_KEY, researcher: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 2,
    });
    const transferLog = log({
      address: USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: ESCROW, to: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 3,
    });
    const verifier = driver(
      rpcMock({
        apiBody: rewardApiResponse(),
        receipts: {
          [APPROVAL_HASH]: receipt(APPROVAL_HASH, [approvalLog]),
          [PAYOUT_HASH]: receipt(PAYOUT_HASH, [payoutLog, transferLog]),
        },
      }),
    );

    const result = await verifier.verify('reward_payout_verify', acceptanceState());
    expect(result.evidence.map(({ label }) => label)).toEqual(['reward_approval', 'reward_payout']);
    expect(result.evidence[1]).toMatchObject({
      operationId: PAYOUT_OPERATION_ID,
      amountBaseUnits: AMOUNT.toString(),
      logIndex: 2,
      transferLogIndex: 3,
      durableStatus: 'paid',
    });
  });

  it('accepts Base Bridge only with the exact CCTP v2 burn and Arc mint evidence', async () => {
    const burn = log({
      address: BASE_TOKEN_MESSENGER,
      topics: encodeEventTopics({
        abi: CCTP_V2_ABI,
        eventName: 'DepositForBurn',
        args: {
          nonce: 42n,
          burnToken: BASE_USDC,
          depositor: OWNER,
        },
      }),
      data: encodeAbiParameters(
        [
          { type: 'uint256' },
          { type: 'bytes32' },
          { type: 'uint32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'uint32' },
        ],
        [
          AMOUNT,
          padHex(ESCROW, { size: 32 }),
          26,
          padHex(ARC_TOKEN_MESSENGER, { size: 32 }),
          `0x${'0'.repeat(64)}`,
          0n,
          1_000,
        ],
      ),
      index: 2,
    });
    const ownerToMinter = log({
      address: BASE_USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: OWNER, to: BASE_TOKEN_MINTER },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 3,
    });
    const minterBurn = log({
      address: BASE_USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: BASE_TOKEN_MINTER, to: ZERO_ADDRESS },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 4,
    });
    const mintAndWithdraw = log({
      address: ARC_TOKEN_MESSENGER,
      topics: encodeEventTopics({
        abi: CCTP_V2_ABI,
        eventName: 'MintAndWithdraw',
        args: { mintRecipient: ESCROW, mintToken: USDC },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 5,
    });
    expect(burn.topics[0]).toBe(OFFICIAL_DEPOSIT_FOR_BURN_TOPIC);
    expect(burn.topics).toHaveLength(4);
    expect(burn.topics[1]).toBe(padHex('0x2a', { size: 32 }));
    expect(mintAndWithdraw.topics[0]).toBe(OFFICIAL_MINT_AND_WITHDRAW_TOPIC);
    const destinationMint = log({
      address: USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: ZERO_ADDRESS, to: ESCROW },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 6,
    });
    const fundingSynced = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'ExternalFundingSynced',
        // syncExternalFunding is permissionless; the verifier intentionally binds
        // escrow and accounting args, not the caller identity.
        args: { actor: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [AMOUNT, AMOUNT]),
      index: 7,
    });
    const verifier = driver(
      rpcMock({
        apiBody: bridgeApiResponse(),
        receipts: {
          [BRIDGE_BURN_HASH]: receipt(BRIDGE_BURN_HASH, [burn, ownerToMinter, minterBurn]),
          [BRIDGE_DESTINATION_HASH]: receipt(BRIDGE_DESTINATION_HASH, [
            mintAndWithdraw,
            destinationMint,
          ]),
          [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
        },
      }),
    );

    const result = await verifier.verify('bridge_verify', acceptanceState());
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        label: 'bridge_base_cctp_burn',
        transactionHash: BRIDGE_BURN_HASH,
        logIndex: 2,
        transferLogIndex: 3,
        burnTransferLogIndex: 4,
        address: OWNER,
        amountBaseUnits: AMOUNT.toString(),
      }),
    );

    const statusOnly = driver(
      rpcMock({
        apiBody: bridgeApiResponse(),
        receipts: {
          [BRIDGE_BURN_HASH]: receipt(BRIDGE_BURN_HASH, []),
          [BRIDGE_DESTINATION_HASH]: receipt(BRIDGE_DESTINATION_HASH, [
            mintAndWithdraw,
            destinationMint,
          ]),
          [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
        },
      }),
    );
    await expect(statusOnly.verify('bridge_verify', acceptanceState())).rejects.toMatchObject({
      code: 'bridge_source_burn_evidence_mismatch',
    });

    const transferOnlyDestination = driver(
      rpcMock({
        apiBody: bridgeApiResponse(),
        receipts: {
          [BRIDGE_BURN_HASH]: receipt(BRIDGE_BURN_HASH, [burn, ownerToMinter, minterBurn]),
          [BRIDGE_DESTINATION_HASH]: receipt(BRIDGE_DESTINATION_HASH, [destinationMint]),
          [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
        },
      }),
    );
    await expect(
      transferOnlyDestination.verify('bridge_verify', acceptanceState()),
    ).rejects.toMatchObject({
      code: 'bridge_destination_mint_evidence_mismatch',
    });

    const wrongDomainBurn = {
      ...burn,
      data: encodeAbiParameters(
        [
          { type: 'uint256' },
          { type: 'bytes32' },
          { type: 'uint32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'uint32' },
        ],
        [
          AMOUNT,
          padHex(ESCROW, { size: 32 }),
          3,
          padHex(ARC_TOKEN_MESSENGER, { size: 32 }),
          `0x${'0'.repeat(64)}`,
          0n,
          1_000,
        ],
      ),
    };
    const wrongSource = driver(
      rpcMock({
        apiBody: bridgeApiResponse(),
        receipts: {
          [BRIDGE_BURN_HASH]: receipt(BRIDGE_BURN_HASH, [
            wrongDomainBurn,
            ownerToMinter,
            minterBurn,
          ]),
          [BRIDGE_DESTINATION_HASH]: receipt(BRIDGE_DESTINATION_HASH, [
            mintAndWithdraw,
            destinationMint,
          ]),
          [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
        },
      }),
    );
    await expect(wrongSource.verify('bridge_verify', acceptanceState())).rejects.toMatchObject({
      code: 'bridge_source_burn_evidence_mismatch',
    });

    const wrongMintAndWithdraw = {
      ...mintAndWithdraw,
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT - 1n]),
    };
    const wrongDestination = driver(
      rpcMock({
        apiBody: bridgeApiResponse(),
        receipts: {
          [BRIDGE_BURN_HASH]: receipt(BRIDGE_BURN_HASH, [burn, ownerToMinter, minterBurn]),
          [BRIDGE_DESTINATION_HASH]: receipt(BRIDGE_DESTINATION_HASH, [
            wrongMintAndWithdraw,
            destinationMint,
          ]),
          [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
        },
      }),
    );
    await expect(wrongDestination.verify('bridge_verify', acceptanceState())).rejects.toMatchObject(
      { code: 'bridge_destination_mint_evidence_mismatch' },
    );
  });

  it('accepts Unified Balance only with the exact three-source Gateway attestation set and aggregate mint', async () => {
    const attestation = (input: {
      domain: number;
      transferSpecHash: Hex;
      value: bigint;
      index: number;
      sourceDepositor?: Hex;
      sourceSigner?: Hex;
    }) =>
      log({
        address: ARC_GATEWAY_MINTER,
        topics: encodeEventTopics({
          abi: GATEWAY_MINTER_ABI,
          eventName: 'AttestationUsed',
          args: {
            token: USDC,
            recipient: ESCROW,
            transferSpecHash: input.transferSpecHash,
          },
        }),
        data: encodeAbiParameters(
          [{ type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
          [
            input.domain,
            input.sourceDepositor ?? SOURCE_WALLET_IDENTITY,
            input.sourceSigner ?? SOURCE_WALLET_IDENTITY,
            input.value,
          ],
        ),
        index: input.index,
      });
    const ethereumAttestation = attestation({
      domain: 0,
      transferSpecHash: ETHEREUM_TRANSFER_SPEC_HASH,
      value: 1_000_000n,
      index: 3,
    });
    const arbitrumAttestation = attestation({
      domain: 3,
      transferSpecHash: ARBITRUM_TRANSFER_SPEC_HASH,
      value: 2_000_000n,
      index: 4,
    });
    const baseAttestation = attestation({
      domain: 6,
      transferSpecHash: BASE_TRANSFER_SPEC_HASH,
      value: 2_000_000n,
      index: 5,
    });
    const destinationMint = log({
      address: USDC,
      topics: encodeEventTopics({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        args: { from: ZERO_ADDRESS, to: ESCROW },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [AMOUNT]),
      index: 6,
    });
    const fundingSynced = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'ExternalFundingSynced',
        // Prove Unified Balance accepts a non-owner sync caller while requiring exact amounts.
        args: { actor: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [AMOUNT, AMOUNT]),
      index: 7,
    });
    const verificationDriver = (
      attestations: readonly ReturnType<typeof log>[],
      transferId?: string,
    ) =>
      driver(
        rpcMock({
          apiBody: unifiedBalanceApiResponse(transferId),
          receipts: {
            [BRIDGE_DESTINATION_HASH]: receipt(BRIDGE_DESTINATION_HASH, [
              ...attestations,
              destinationMint,
            ]),
            [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
          },
        }),
      );
    const exactAttestations = [baseAttestation, ethereumAttestation, arbitrumAttestation];

    for (const transferId of [undefined, 'gateway-forwarder-group-status-id']) {
      const result = await verificationDriver(exactAttestations, transferId).verify(
        'ub_spend_verify',
        acceptanceState(),
      );
      const evidence = result.evidence.filter(
        (item) => item.label === 'unified_balance_gateway_attestation',
      );
      expect(evidence).toMatchObject([
        {
          transferSpecHash: ETHEREUM_TRANSFER_SPEC_HASH,
          sourceDomain: 0,
          sourceDepositor: SOURCE_WALLET_IDENTITY,
          sourceSigner: SOURCE_WALLET_IDENTITY,
          amountBaseUnits: '1000000',
          logIndex: 3,
        },
        {
          transferSpecHash: ARBITRUM_TRANSFER_SPEC_HASH,
          sourceDomain: 3,
          amountBaseUnits: '2000000',
          logIndex: 4,
        },
        {
          transferSpecHash: BASE_TRANSFER_SPEC_HASH,
          sourceDomain: 6,
          amountBaseUnits: '2000000',
          logIndex: 5,
        },
      ]);
      expect(result.evidence).toContainEqual(
        expect.objectContaining({ label: 'unified_balance_arc_sync', logIndex: 7 }),
      );
    }

    const invalidAttestationSets = [
      exactAttestations.slice(0, 2),
      [
        ethereumAttestation,
        arbitrumAttestation,
        attestation({
          domain: 3,
          transferSpecHash: BASE_TRANSFER_SPEC_HASH,
          value: 2_000_000n,
          index: 5,
        }),
      ],
      [
        ethereumAttestation,
        arbitrumAttestation,
        attestation({
          domain: 26,
          transferSpecHash: BASE_TRANSFER_SPEC_HASH,
          value: 2_000_000n,
          index: 5,
        }),
      ],
      [
        ethereumAttestation,
        arbitrumAttestation,
        attestation({
          domain: 6,
          transferSpecHash: ARBITRUM_TRANSFER_SPEC_HASH,
          value: 2_000_000n,
          index: 5,
        }),
      ],
      [
        attestation({
          domain: 0,
          transferSpecHash: ETHEREUM_TRANSFER_SPEC_HASH,
          value: 500_000n,
          index: 3,
        }),
        arbitrumAttestation,
        baseAttestation,
      ],
      [
        ethereumAttestation,
        arbitrumAttestation,
        attestation({
          domain: 6,
          transferSpecHash: BASE_TRANSFER_SPEC_HASH,
          value: 2_000_000n,
          index: 5,
          sourceDepositor: padHex(RECIPIENT, { size: 32 }),
        }),
      ],
      [
        ethereumAttestation,
        arbitrumAttestation,
        attestation({
          domain: 6,
          transferSpecHash: BASE_TRANSFER_SPEC_HASH,
          value: 2_000_000n,
          index: 5,
          sourceSigner: padHex(RECIPIENT, { size: 32 }),
        }),
      ],
    ];
    for (const invalidAttestations of invalidAttestationSets) {
      await expect(
        verificationDriver(invalidAttestations).verify('ub_spend_verify', acceptanceState()),
      ).rejects.toMatchObject({ code: 'unified_balance_destination_attestation_mismatch' });
    }
  });

  it('links CP-13 exactly to the Unified Balance intent, deployment, lifetime pool, and decoded sync args', async () => {
    const unified = unifiedBalanceApiResponse();
    const fundingSynced = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'ExternalFundingSynced',
        // Prove CP-13 accepts a non-owner sync caller while requiring exact amounts.
        args: { actor: RECIPIENT },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [AMOUNT, AMOUNT]),
      index: 7,
    });
    const apiBody = (url: string) => {
      if (url.includes('/funding-confirmations/latest')) {
        return {
          success: true,
          data: unified.data.confirmationArtifact,
        };
      }
      if (url.includes('/escrow-deployments/current')) {
        return deploymentApiResponse(PINNED_ARTIFACT_CHECKSUM);
      }
      if (url.includes(`/funding-intents/${INTENT_ID}`)) return unified;
      throw new Error(`Unexpected API URL: ${url}`);
    };
    const exact = driver(
      rpcMock({
        apiBody,
        receipts: {
          [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [fundingSynced]),
        },
      }),
    );

    await expect(exact.verify('cp13_artifact_verify', acceptanceState())).resolves.toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          label: 'cp13_pool_conservation',
          amountBaseUnits: AMOUNT.toString(),
          expectedAmountBaseUnits: AMOUNT.toString(),
        }),
        expect.objectContaining({
          label: 'cp13_sync_transaction',
          logIndex: 7,
        }),
      ]),
    });

    const wrongSync = log({
      address: ESCROW,
      topics: encodeEventTopics({
        abi: ESCROW_ABI,
        eventName: 'ExternalFundingSynced',
        args: { actor: OWNER },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [AMOUNT - 1n, AMOUNT]),
      index: 7,
    });
    await expect(
      driver(
        rpcMock({
          apiBody,
          receipts: {
            [BRIDGE_SYNC_HASH]: receipt(BRIDGE_SYNC_HASH, [wrongSync]),
          },
        }),
      ).verify('cp13_artifact_verify', acceptanceState()),
    ).rejects.toMatchObject({ code: 'cp13_sync_evidence_mismatch' });

    const wrongDeployment = deploymentApiResponse(PINNED_ARTIFACT_CHECKSUM);
    wrongDeployment.data.programId = REPORT_ID;
    const wrongDeploymentApiBody = (url: string) => {
      if (url.includes('/funding-confirmations/latest')) {
        return {
          success: true,
          data: unified.data.confirmationArtifact,
        };
      }
      if (url.includes('/escrow-deployments/current')) {
        return wrongDeployment;
      }
      if (url.includes(`/funding-intents/${INTENT_ID}`)) return unified;
      throw new Error(`Unexpected API URL: ${url}`);
    };
    await expect(
      driver(
        rpcMock({
          apiBody: wrongDeploymentApiBody,
          receipts: {},
        }),
      ).verify('cp13_artifact_verify', acceptanceState()),
    ).rejects.toMatchObject({ code: 'cp13_accounting_invariant_failed' });
  });
});
