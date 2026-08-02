import { parseApiEnvironment } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { CircleContractsAdapter } from '../src/escrow/circle-contracts.adapter.js';

const WALLET_ID = '31000000-0000-4000-8000-000000000001';
const CONTRACT_ID = '31000000-0000-4000-8000-000000000002';
const TRANSACTION_ID = '31000000-0000-4000-8000-000000000003';
const HASH = `0x${'1'.repeat(64)}` as const;
const BLOCK_HASH = `0x${'2'.repeat(64)}` as const;
const CONTRACT = `0x${'a'.repeat(40)}` as const;
const DEPLOYER = `0x${'b'.repeat(40)}` as const;

function config(enabled = true) {
  return parseApiEnvironment({
    NODE_ENV: 'test',
    WEB_APP_ORIGIN: 'https://web.example.test',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ARC_RPC_URL: 'https://rpc.example.test',
    ARC_CHAIN_ID: '5042002',
    USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
    CIRCLE_CONTRACTS_ENABLED: String(enabled),
    ...(enabled
      ? {
          CIRCLE_API_KEY: 'circle-api-key',
          CIRCLE_ENTITY_SECRET: 'circle-entity-secret',
          CIRCLE_DEPLOYMENT_WALLET_ID: WALLET_ID,
          DEPLOYMENT_FEE_RECIPIENT_ADDRESS: DEPLOYER,
          DEPLOYMENT_FEE_AMOUNT_BASE_UNITS: '1000000',
          CIRCLE_GATEWAY_WEBHOOKS_ENABLED: 'true',
          CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: WALLET_ID,
        }
      : {}),
    CIRCLE_POLL_INTERVAL_MS: '1',
    CIRCLE_POLL_TIMEOUT_MS: '1000',
    AI_PROVIDER: 'disabled',
    LOG_LEVEL: 'silent',
  });
}

function clients(overrides?: {
  deployData?: unknown;
  transaction?: unknown;
  contract?: unknown;
  wallet?: unknown;
}) {
  return {
    contracts: {
      deployContract: vi.fn().mockResolvedValue({
        data:
          overrides?.deployData ??
          ({ contractIds: [CONTRACT_ID], transactionId: TRANSACTION_ID } as const),
      }),
      getContract: vi.fn().mockResolvedValue({
        data: {
          contract:
            overrides?.contract ??
            ({
              id: CONTRACT_ID,
              status: 'COMPLETE',
              blockchain: 'ARC-TESTNET',
              contractAddress: CONTRACT,
            } as const),
        },
      }),
    },
    wallets: {
      getWallet: vi.fn().mockResolvedValue({
        data: {
          wallet:
            overrides?.wallet ??
            ({
              id: WALLET_ID,
              address: DEPLOYER,
              blockchain: 'ARC-TESTNET',
              custodyType: 'DEVELOPER',
              accountType: 'SCA',
              state: 'LIVE',
            } as const),
        },
      }),
      createContractExecutionTransaction: vi.fn().mockResolvedValue({
        data: { id: TRANSACTION_ID, state: 'INITIATED' },
      }),
      getTransaction: vi.fn().mockResolvedValue({
        data: {
          transaction:
            overrides?.transaction ??
            ({
              id: TRANSACTION_ID,
              state: 'COMPLETE',
              blockchain: 'ARC-TESTNET',
              walletId: WALLET_ID,
              txHash: HASH,
              contractAddress: CONTRACT,
              sourceAddress: DEPLOYER,
              blockHash: BLOCK_HASH,
              blockHeight: 42,
            } as const),
        },
      }),
    },
  } as unknown as NonNullable<ConstructorParameters<typeof CircleContractsAdapter>[1]>;
}

const DEPLOY_INPUT = {
  idempotencyKey: '31000000-0000-4000-8000-000000000010',
  programId: '31000000-0000-4000-8000-000000000011',
  programKey: `0x${'3'.repeat(64)}` as const,
  platformAdminWallet: `0x${'c'.repeat(40)}` as const,
  tokenAddress: '0x3600000000000000000000000000000000000000' as const,
  refundUnlockAt: 2_000_000_000n,
  withdrawRecipient: `0x${'d'.repeat(40)}` as const,
  artifact: {
    version: '1.1.0' as const,
    abi: [],
    bytecode: '0x6000' as const,
    deployedBytecode: '0x6000' as const,
    immutableReferences: {},
    artifactSha256: `0x${'4'.repeat(64)}` as const,
    runtimeBytecodeSha256: `0x${'5'.repeat(64)}` as const,
  },
};

describe('Circle Contracts adapter', () => {
  it('boots disabled but fails closed only when an escrow operation is invoked', async () => {
    const adapter = new CircleContractsAdapter(config(false));
    await expect(adapter.deploy(DEPLOY_INPUT)).rejects.toMatchObject({
      code: 'circle_contracts_disabled',
      retryable: false,
    });
  });

  it('uses the real custom-bytecode contract shape and preserves Circle IDs', async () => {
    const fakeClients = clients();
    const adapter = new CircleContractsAdapter(config(), fakeClients);

    await expect(adapter.deploy(DEPLOY_INPUT)).resolves.toEqual({
      contractId: CONTRACT_ID,
      transactionId: TRANSACTION_ID,
    });
    expect(fakeClients.contracts.deployContract).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: DEPLOY_INPUT.idempotencyKey,
        walletId: WALLET_ID,
        blockchain: 'ARC-TESTNET',
        bytecode: DEPLOY_INPUT.artifact.bytecode,
        constructorParameters: [
          DEPLOY_INPUT.programKey,
          DEPLOY_INPUT.platformAdminWallet,
          DEPLOY_INPUT.tokenAddress,
          DEPLOY_INPUT.refundUnlockAt.toString(),
          DEPLOY_INPUT.withdrawRecipient,
        ],
      }),
    );
  });

  it('treats Circle SDK top-level 4xx status as a terminal request rejection', async () => {
    const fakeClients = clients();
    fakeClients.contracts.deployContract = vi
      .fn()
      .mockRejectedValue({ status: 400, code: 2, message: 'API parameter invalid' });
    const adapter = new CircleContractsAdapter(config(), fakeClients);

    await expect(adapter.deploy(DEPLOY_INPUT)).rejects.toMatchObject({
      code: 'circle_request_rejected',
      retryable: false,
    });
  });

  it('accepts only the configured LIVE developer-controlled Arc SCA as deployer', async () => {
    const adapter = new CircleContractsAdapter(config(), clients());
    await expect(adapter.getDeploymentWalletAddress()).resolves.toBe(DEPLOYER);

    for (const wallet of [
      {
        id: WALLET_ID,
        address: DEPLOYER,
        blockchain: 'ARC-TESTNET',
        custodyType: 'ENDUSER',
        accountType: 'SCA',
        state: 'LIVE',
      },
      {
        id: WALLET_ID,
        address: DEPLOYER,
        blockchain: 'ARC-TESTNET',
        custodyType: 'DEVELOPER',
        accountType: 'EOA',
        state: 'LIVE',
      },
      {
        id: WALLET_ID,
        address: DEPLOYER,
        blockchain: 'ARC-TESTNET',
        custodyType: 'DEVELOPER',
        accountType: 'SCA',
        state: 'FROZEN',
      },
    ]) {
      await expect(
        new CircleContractsAdapter(config(), clients({ wallet })).getDeploymentWalletAddress(),
      ).rejects.toMatchObject({ code: 'circle_response_invalid', retryable: false });
    }
  });

  it('polls both Circle records and binds chain, wallet, address, hash, and block', async () => {
    const adapter = new CircleContractsAdapter(config(), clients());
    await expect(
      adapter.waitForDeployment({ contractId: CONTRACT_ID, transactionId: TRANSACTION_ID }),
    ).resolves.toEqual({
      state: 'confirmed',
      contractAddress: CONTRACT,
      transactionHash: HASH,
      blockHash: BLOCK_HASH,
      blockNumber: 42n,
      deploymentWalletAddress: DEPLOYER,
    });
  });

  it('treats malformed provider responses as terminal instead of polling to timeout', async () => {
    const adapter = new CircleContractsAdapter(
      config(),
      clients({ transaction: { state: 'COMPLETE' } }),
    );
    await expect(
      adapter.waitForDeployment({ contractId: CONTRACT_ID, transactionId: TRANSACTION_ID }),
    ).rejects.toMatchObject({ code: 'circle_response_invalid', retryable: false });
  });

  it('maps denied Circle transactions to a terminal failed state', async () => {
    const adapter = new CircleContractsAdapter(
      config(),
      clients({
        transaction: {
          id: TRANSACTION_ID,
          state: 'DENIED',
          blockchain: 'ARC-TESTNET',
          walletId: WALLET_ID,
        },
      }),
    );
    await expect(
      adapter.waitForDeployment({ contractId: CONTRACT_ID, transactionId: TRANSACTION_ID }),
    ).resolves.toEqual({ state: 'failed', failureCode: 'circle_deployment_failed' });
  });
});
