import { createHash } from 'node:crypto';

import { parseApiEnvironment } from '@bug-bounty-escrow/shared';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { ArcRpcAdapter } from '../src/escrow/arc-rpc.adapter.js';

const USDC = '0x3600000000000000000000000000000000000000' as const;
const ESCROW = `0x${'a'.repeat(40)}` as const;
const OWNER = `0x${'b'.repeat(40)}` as const;
const RECIPIENT = `0x${'c'.repeat(40)}` as const;
const PROGRAM_KEY = `0x${'1'.repeat(64)}` as const;
const TRANSACTION_HASH = `0x${'2'.repeat(64)}` as const;
const BLOCK_HASH = `0x${'3'.repeat(64)}` as const;
const RUNTIME = '0x6001600055' as const;
const UNLOCK = 2_000_000_000n;

const INITIALIZED_ABI = {
  type: 'event',
  name: 'EscrowInitialized',
  anonymous: false,
  inputs: [
    { name: 'programKey', type: 'bytes32', indexed: true },
    { name: 'platformAdmin', type: 'address', indexed: true },
    { name: 'token', type: 'address', indexed: true },
    { name: 'refundUnlockAt', type: 'uint256', indexed: false },
    { name: 'withdrawRecipient', type: 'address', indexed: false },
  ],
} as const;
const CLOSED_ABI = {
  type: 'event',
  name: 'EscrowClosed',
  anonymous: false,
  inputs: [{ name: 'actor', type: 'address', indexed: true }],
} as const;
const WITHDRAWN_ABI = {
  type: 'event',
  name: 'RemainingFundsWithdrawn',
  anonymous: false,
  inputs: [
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ],
} as const;
const TRANSFER_ABI = {
  type: 'event',
  name: 'Transfer',
  anonymous: false,
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const;
const DEPOSITED_ABI = {
  type: 'event',
  name: 'Deposited',
  anonymous: false,
  inputs: [
    { name: 'token', type: 'address', indexed: true },
    { name: 'depositor', type: 'address', indexed: true },
    { name: 'sender', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const;
const REWARD_APPROVED_ABI = {
  type: 'event',
  name: 'RewardApproved',
  anonymous: false,
  inputs: [
    { name: 'reportKey', type: 'bytes32', indexed: true },
    { name: 'approvedContentHash', type: 'bytes32', indexed: true },
    { name: 'researcher', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ],
} as const;
const REWARD_PAID_ABI = {
  type: 'event',
  name: 'RewardPaid',
  anonymous: false,
  inputs: [
    { name: 'reportKey', type: 'bytes32', indexed: true },
    { name: 'researcher', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ],
} as const;

function config() {
  return parseApiEnvironment({
    NODE_ENV: 'test',
    WEB_APP_ORIGIN: 'https://web.example.test',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ARC_RPC_URL: 'https://rpc.example.test',
    ARC_CHAIN_ID: '5042002',
    USDC_ADDRESS: USDC,
    AI_PROVIDER: 'disabled',
    LOG_LEVEL: 'silent',
  });
}

function initializedLog(platformAdmin = OWNER) {
  return {
    address: ESCROW,
    topics: encodeEventTopics({
      abi: [INITIALIZED_ABI],
      eventName: 'EscrowInitialized',
      args: { programKey: PROGRAM_KEY, platformAdmin, token: USDC },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }], [UNLOCK, RECIPIENT]),
    logIndex: 0,
  };
}

function rpc(log = initializedLog(), status: 'success' | 'reverted' = 'success') {
  return {
    getChainId: vi.fn().mockResolvedValue(5_042_002),
    getBlockNumber: vi.fn().mockResolvedValue(42n),
    getBlock: vi.fn().mockResolvedValue({ hash: BLOCK_HASH }),
    getBytecode: vi.fn().mockResolvedValue(RUNTIME),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status,
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [log],
    }),
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      const values: Record<string, unknown> = {
        programKey: PROGRAM_KEY,
        platformAdmin: OWNER,
        token: USDC,
        refundUnlockAt: UNLOCK,
        withdrawRecipient: RECIPIENT,
        totalFunded: 0n,
        totalWithdrawn: 10_000_000n,
        totalApprovedOutstanding: 0n,
        closed: true,
      };
      return Promise.resolve(values[functionName]);
    }),
  } as unknown as NonNullable<ConstructorParameters<typeof ArcRpcAdapter>[1]>;
}

const ARTIFACT = {
  version: '1.1.0' as const,
  abi: [],
  bytecode: '0x6000' as const,
  deployedBytecode: RUNTIME,
  immutableReferences: {},
  artifactSha256: `0x${'4'.repeat(64)}` as const,
  runtimeBytecodeSha256: `0x${createHash('sha256')
    .update(Buffer.from(RUNTIME.slice(2), 'hex'))
    .digest('hex')}` as const,
};

describe('Arc RPC escrow verifier', () => {
  it('accepts exact RewardApproved evidence even when a permissionless payout already advanced state', async () => {
    const reportKey = `0x${'6'.repeat(64)}` as const;
    const contentHash = `0x${'7'.repeat(64)}` as const;
    const amount = 10_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: ESCROW,
          topics: encodeEventTopics({
            abi: [REWARD_APPROVED_ABI],
            eventName: 'RewardApproved',
            args: { reportKey, approvedContentHash: contentHash, researcher: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 2,
        },
      ],
    });
    client.readContract = vi
      .fn()
      .mockImplementation(({ functionName }: { functionName: string }) => {
        const values: Record<string, unknown> = {
          rewards: [contentHash, RECIPIENT, amount, 2],
          totalPaid: amount,
          totalApprovedOutstanding: 0n,
          totalFunded: 50_000_000n,
          totalWithdrawn: 0n,
          balanceOf: 40_000_000n,
        };
        return Promise.resolve(values[functionName]);
      });
    const adapter = new ArcRpcAdapter(config(), client);

    await expect(
      adapter.verifyRewardApproval({
        escrowAddress: ESCROW,
        reportKey,
        approvedContentHash: contentHash,
        recipientAddress: RECIPIENT,
        amountBaseUnits: amount,
        transactionHash: TRANSACTION_HASH,
      }),
    ).resolves.toMatchObject({ eventLogIndex: 2, blockNumber: 42n });
  });

  it('requires one exact RewardPaid event and canonical USDC transfer', async () => {
    const reportKey = `0x${'6'.repeat(64)}` as const;
    const contentHash = `0x${'7'.repeat(64)}` as const;
    const amount = 10_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: ESCROW,
          topics: encodeEventTopics({
            abi: [REWARD_PAID_ABI],
            eventName: 'RewardPaid',
            args: { reportKey, researcher: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 3,
        },
        {
          address: USDC,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: ESCROW, to: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 4,
        },
      ],
    });
    client.readContract = vi
      .fn()
      .mockImplementation(({ functionName }: { functionName: string }) => {
        const values: Record<string, unknown> = {
          rewards: [contentHash, RECIPIENT, amount, 2],
          totalPaid: amount,
          totalApprovedOutstanding: 0n,
          totalFunded: 50_000_000n,
          totalWithdrawn: 0n,
          balanceOf: 40_000_000n,
        };
        return Promise.resolve(values[functionName]);
      });
    const adapter = new ArcRpcAdapter(config(), client);

    await expect(
      adapter.verifyRewardPayout({
        escrowAddress: ESCROW,
        reportKey,
        approvedContentHash: contentHash,
        recipientAddress: RECIPIENT,
        amountBaseUnits: amount,
        transactionHash: TRANSACTION_HASH,
      }),
    ).resolves.toMatchObject({
      eventLogIndex: 3,
      transferLogIndex: 4,
      accounting: {
        totalPaidBaseUnits: amount,
        totalFundedBaseUnits: 50_000_000n,
        escrowBalanceBaseUnits: 40_000_000n,
      },
    });
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'totalPaid', blockNumber: 42n }),
    );
  });

  it('rejects payout evidence when the receipt-block global accounting is inconsistent', async () => {
    const reportKey = `0x${'6'.repeat(64)}` as const;
    const contentHash = `0x${'7'.repeat(64)}` as const;
    const amount = 10_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: ESCROW,
          topics: encodeEventTopics({
            abi: [REWARD_PAID_ABI],
            eventName: 'RewardPaid',
            args: { reportKey, researcher: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 3,
        },
        {
          address: USDC,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: ESCROW, to: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 4,
        },
      ],
    });
    client.readContract = vi
      .fn()
      .mockImplementation(({ functionName }: { functionName: string }) => {
        const values: Record<string, unknown> = {
          rewards: [contentHash, RECIPIENT, amount, 2],
          totalPaid: amount,
          totalApprovedOutstanding: 0n,
          totalFunded: 50_000_000n,
          totalWithdrawn: 0n,
          balanceOf: 50_000_000n,
        };
        return Promise.resolve(values[functionName]);
      });

    await expect(
      new ArcRpcAdapter(config(), client).verifyRewardPayout({
        escrowAddress: ESCROW,
        reportKey,
        approvedContentHash: contentHash,
        recipientAddress: RECIPIENT,
        amountBaseUnits: amount,
        transactionHash: TRANSACTION_HASH,
      }),
    ).rejects.toMatchObject({ code: 'reward_payout_accounting_mismatch', retryable: false });
  });

  it('accepts an SCA internal CREATE only after receipt, event, runtime, and immutables match', async () => {
    const adapter = new ArcRpcAdapter(config(), rpc());
    await expect(
      adapter.verifyDeployment({
        artifact: ARTIFACT,
        contractAddress: ESCROW,
        transactionHash: TRANSACTION_HASH,
        expectedBlockNumber: 42n,
        expectedBlockHash: BLOCK_HASH,
        programKey: PROGRAM_KEY,
        platformAdminWallet: OWNER,
        refundUnlockAt: UNLOCK,
        withdrawRecipient: RECIPIENT,
      }),
    ).resolves.toBeUndefined();
  });

  it('serializes immutable reads to stay below Arc public RPC burst limits', async () => {
    const client = rpc();
    let inFlight = 0;
    let maxInFlight = 0;
    client.readContract = vi.fn().mockImplementation(async (input: { functionName: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const values: Record<string, unknown> = {
        programKey: PROGRAM_KEY,
        programOwner: OWNER,
        adminController: OWNER,
        token: USDC,
        refundUnlockAt: UNLOCK,
        withdrawRecipient: RECIPIENT,
      };
      return values[input.functionName];
    });

    await new ArcRpcAdapter(config(), client).verifyDeployment({
      artifact: ARTIFACT,
      contractAddress: ESCROW,
      transactionHash: TRANSACTION_HASH,
      expectedBlockNumber: 42n,
      expectedBlockHash: BLOCK_HASH,
      programKey: PROGRAM_KEY,
      platformAdminWallet: OWNER,
      refundUnlockAt: UNLOCK,
      withdrawRecipient: RECIPIENT,
    });

    expect(maxInFlight).toBe(1);
  });

  it('rejects a reverted deployment receipt', async () => {
    const adapter = new ArcRpcAdapter(config(), rpc(initializedLog(), 'reverted'));
    await expect(
      adapter.verifyDeployment({
        artifact: ARTIFACT,
        contractAddress: ESCROW,
        transactionHash: TRANSACTION_HASH,
        expectedBlockNumber: 42n,
        expectedBlockHash: BLOCK_HASH,
        programKey: PROGRAM_KEY,
        platformAdminWallet: OWNER,
        refundUnlockAt: UNLOCK,
        withdrawRecipient: RECIPIENT,
      }),
    ).rejects.toMatchObject({ code: 'escrow_deployment_receipt_mismatch' });
  });

  it('rejects a deployment whose initialization event binds another owner', async () => {
    const wrongPlatformAdmin = `0x${'d'.repeat(40)}` as const;
    const adapter = new ArcRpcAdapter(config(), rpc(initializedLog(wrongPlatformAdmin)));
    await expect(
      adapter.verifyDeployment({
        artifact: ARTIFACT,
        contractAddress: ESCROW,
        transactionHash: TRANSACTION_HASH,
        expectedBlockNumber: 42n,
        expectedBlockHash: BLOCK_HASH,
        programKey: PROGRAM_KEY,
        platformAdminWallet: OWNER,
        refundUnlockAt: UNLOCK,
        withdrawRecipient: RECIPIENT,
      }),
    ).rejects.toMatchObject({ code: 'escrow_initialized_event_mismatch' });
  });

  it('verifies the owner close event and closed contract state', async () => {
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: ESCROW,
          topics: encodeEventTopics({
            abi: [CLOSED_ABI],
            eventName: 'EscrowClosed',
            args: { actor: OWNER },
          }),
          data: '0x',
          logIndex: 2,
        },
      ],
    });
    await expect(
      new ArcRpcAdapter(config(), client).verifyClose({
        escrowAddress: ESCROW,
        ownerWallet: OWNER,
        transactionHash: TRANSACTION_HASH,
      }),
    ).resolves.toMatchObject({ logIndex: 2, blockNumber: 42n });
  });

  it('classifies a reverted close receipt as a deterministic non-retryable failure', async () => {
    const client = rpc(initializedLog(), 'reverted');
    await expect(
      new ArcRpcAdapter(config(), client).verifyClose({
        escrowAddress: ESCROW,
        ownerWallet: OWNER,
        transactionHash: TRANSACTION_HASH,
      }),
    ).rejects.toMatchObject({ code: 'escrow_close_reverted', retryable: false });
  });

  it('requires matching escrow and canonical USDC withdrawal evidence', async () => {
    const amount = 10_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: ESCROW,
          topics: encodeEventTopics({
            abi: [WITHDRAWN_ABI],
            eventName: 'RemainingFundsWithdrawn',
            args: { recipient: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 3,
        },
        {
          address: USDC,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: ESCROW, to: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 4,
        },
      ],
    });
    await expect(
      new ArcRpcAdapter(config(), client).verifyWithdrawal({
        escrowAddress: ESCROW,
        recipientAddress: RECIPIENT,
        transactionHash: TRANSACTION_HASH,
        expectedAmountBaseUnits: amount,
        preTotalWithdrawnBaseUnits: 0n,
      }),
    ).resolves.toMatchObject({ eventLogIndex: 3, transferLogIndex: 4, amountBaseUnits: amount });
  });

  it('rejects a reverted withdrawal receipt without accepting event-shaped logs', async () => {
    const client = rpc(initializedLog(), 'reverted');
    await expect(
      new ArcRpcAdapter(config(), client).verifyWithdrawal({
        escrowAddress: ESCROW,
        recipientAddress: RECIPIENT,
        transactionHash: TRANSACTION_HASH,
        expectedAmountBaseUnits: 10_000_000n,
        preTotalWithdrawnBaseUnits: 0n,
      }),
    ).rejects.toMatchObject({ code: 'escrow_withdraw_reverted', retryable: false });
  });

  it('requires totalWithdrawn to increase by exactly the verified withdrawal amount', async () => {
    const amount = 10_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: ESCROW,
          topics: encodeEventTopics({
            abi: [WITHDRAWN_ABI],
            eventName: 'RemainingFundsWithdrawn',
            args: { recipient: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 3,
        },
        {
          address: USDC,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: ESCROW, to: RECIPIENT },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 4,
        },
      ],
    });
    client.readContract = vi.fn().mockResolvedValue(10_000_001n);
    await expect(
      new ArcRpcAdapter(config(), client).verifyWithdrawal({
        escrowAddress: ESCROW,
        recipientAddress: RECIPIENT,
        transactionHash: TRANSACTION_HASH,
        expectedAmountBaseUnits: amount,
        preTotalWithdrawnBaseUnits: 0n,
      }),
    ).rejects.toMatchObject({ code: 'escrow_total_withdrawn_mismatch', retryable: false });
  });

  it('returns exact canonical late-funding Transfer events with a scan watermark', async () => {
    const amount = 5_000_000n;
    const client = rpc() as ReturnType<typeof rpc> & { getLogs: ReturnType<typeof vi.fn> };
    client.getLogs = vi.fn().mockResolvedValue([
      {
        address: USDC,
        topics: encodeEventTopics({
          abi: [TRANSFER_ABI],
          eventName: 'Transfer',
          args: { from: OWNER, to: ESCROW },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
        logIndex: 7,
        transactionHash: TRANSACTION_HASH,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
      },
    ]);
    await expect(
      new ArcRpcAdapter(config(), client).findLateFunding({
        escrowAddress: ESCROW,
        fromBlock: 40n,
      }),
    ).resolves.toEqual({
      events: [
        {
          transactionHash: TRANSACTION_HASH,
          logIndex: 7,
          fromAddress: OWNER,
          amountBaseUnits: amount,
          blockNumber: 42n,
          blockHash: BLOCK_HASH,
        },
      ],
      scannedThroughBlock: 42n,
    });
  });

  it('verifies one exact Gateway Deposited event and one canonical USDC transfer', async () => {
    const gateway = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
    const baseUsdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
    const amount = 5_000_000n;
    const source = rpc();
    source.getChainId = vi.fn().mockResolvedValue(84_532);
    source.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: gateway,
          topics: encodeEventTopics({
            abi: [DEPOSITED_ABI],
            eventName: 'Deposited',
            args: { token: baseUsdc, depositor: OWNER, sender: OWNER },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 7,
        },
        {
          address: baseUsdc,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: OWNER, to: gateway },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 8,
        },
      ],
    });
    await expect(
      new ArcRpcAdapter(config(), rpc(), { Base_Sepolia: source }).verifySourceDeposit({
        network: 'Base_Sepolia',
        walletAddress: OWNER,
        amountBaseUnits: amount,
        transactionHash: TRANSACTION_HASH,
      }),
    ).resolves.toEqual({
      transactionHash: TRANSACTION_HASH,
      gatewayLogIndex: 7,
      transferLogIndex: 8,
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
    });
  });

  it('rejects source deposits when the Gateway depositor tuple is not exact', async () => {
    const gateway = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
    const baseUsdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
    const source = rpc();
    source.getChainId = vi.fn().mockResolvedValue(84_532);
    source.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: gateway,
          topics: encodeEventTopics({
            abi: [DEPOSITED_ABI],
            eventName: 'Deposited',
            args: { token: baseUsdc, depositor: RECIPIENT, sender: OWNER },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [5_000_000n]),
          logIndex: 7,
        },
      ],
    });
    await expect(
      new ArcRpcAdapter(config(), rpc(), { Base_Sepolia: source }).verifySourceDeposit({
        network: 'Base_Sepolia',
        walletAddress: OWNER,
        amountBaseUnits: 5_000_000n,
        transactionHash: TRANSACTION_HASH,
      }),
    ).rejects.toMatchObject({ code: 'source_deposit_evidence_mismatch', retryable: false });
  });

  it('attributes Arc Send to the locked owner even when concurrent payouts invalidate a balance delta', async () => {
    const amount = 5_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: USDC,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: OWNER, to: ESCROW },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 6,
        },
      ],
    });
    client.readContract = vi.fn().mockResolvedValue(amount);
    await expect(
      new ArcRpcAdapter(config(), client).verifyFundingDestination({
        escrowAddress: ESCROW,
        routeMode: 'send',
        walletAddress: OWNER,
        destinationTransactionHash: TRANSACTION_HASH,
        preBalanceBaseUnits: 100_000_000n,
      }),
    ).resolves.toMatchObject({ netReceivedBaseUnits: amount, destinationLogIndex: 6 });

    await expect(
      new ArcRpcAdapter(config(), client).verifyFundingDestination({
        escrowAddress: ESCROW,
        routeMode: 'send',
        walletAddress: RECIPIENT,
        destinationTransactionHash: TRANSACTION_HASH,
        preBalanceBaseUnits: 0n,
      }),
    ).rejects.toMatchObject({ code: 'funding_transfer_log_missing' });
  });

  it('attributes Bridge and Unified Balance destinations only to canonical mint transfers', async () => {
    const amount = 5_000_000n;
    const client = rpc();
    client.getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      blockNumber: 42n,
      blockHash: BLOCK_HASH,
      contractAddress: null,
      logs: [
        {
          address: USDC,
          topics: encodeEventTopics({
            abi: [TRANSFER_ABI],
            eventName: 'Transfer',
            args: { from: '0x0000000000000000000000000000000000000000', to: ESCROW },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
          logIndex: 6,
        },
      ],
    });
    client.readContract = vi.fn().mockResolvedValue(amount);
    for (const routeMode of ['bridge', 'unified_balance'] as const) {
      await expect(
        new ArcRpcAdapter(config(), client).verifyFundingDestination({
          escrowAddress: ESCROW,
          routeMode,
          walletAddress: OWNER,
          destinationTransactionHash: TRANSACTION_HASH,
          preBalanceBaseUnits: 0n,
        }),
      ).resolves.toMatchObject({ netReceivedBaseUnits: amount });
    }
  });

  it('rejects receipt evidence whose block hash no longer matches the canonical block', async () => {
    const client = rpc();
    client.getBlock = vi.fn().mockResolvedValue({ hash: `0x${'9'.repeat(64)}` });
    await expect(
      new ArcRpcAdapter(config(), client).verifyClose({
        escrowAddress: ESCROW,
        ownerWallet: OWNER,
        transactionHash: TRANSACTION_HASH,
      }),
    ).rejects.toMatchObject({ code: 'arc_block_evidence_mismatch', retryable: true });
  });

  it('ignores zero-value late transfers instead of allowing scan grief', async () => {
    const client = rpc() as ReturnType<typeof rpc> & { getLogs: ReturnType<typeof vi.fn> };
    client.getLogs = vi.fn().mockResolvedValue([
      {
        address: USDC,
        topics: encodeEventTopics({
          abi: [TRANSFER_ABI],
          eventName: 'Transfer',
          args: { from: OWNER, to: ESCROW },
        }),
        data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
        logIndex: 7,
        transactionHash: TRANSACTION_HASH,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
      },
    ]);
    await expect(
      new ArcRpcAdapter(config(), client).findLateFunding({
        escrowAddress: ESCROW,
        fromBlock: 42n,
      }),
    ).resolves.toEqual({ events: [], scannedThroughBlock: 42n });
  });
});
