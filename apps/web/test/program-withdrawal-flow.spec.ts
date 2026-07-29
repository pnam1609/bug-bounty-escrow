import { encodeFunctionData } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { CircleAppKitFundingExecutor } from '@/components/owner/circle-funding-executor';
import {
  clearPendingWithdrawalHash,
  persistPendingWithdrawalHash,
  readPendingWithdrawalHash,
  withdrawalContinuationAction,
} from '@/components/owner/program-withdrawal-flow';

const hash = `0x${'a'.repeat(64)}`;

function storageFixture(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } as unknown as Storage;
}

describe('CP-13 withdrawal recovery', () => {
  it('binds withdrawRemaining to the exact server-verified amount', async () => {
    const owner = '0x1111111111111111111111111111111111111111';
    const escrow = '0x2222222222222222222222222222222222222222';
    const transactionHash = `0x${'b'.repeat(64)}`;
    const request = vi.fn(async ({ method }: { readonly method: string }) => {
      if (method === 'eth_accounts') return [owner];
      if (method === 'eth_chainId') return '0x4cef52';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_gasPrice') return '0x1';
      if (method === 'eth_getBalance') return '0x100000';
      if (method === 'eth_sendTransaction') return transactionHash;
      throw new Error(`Unexpected method ${method}`);
    });
    const executor = new CircleAppKitFundingExecutor(
      { ensureChain: vi.fn(async () => undefined) } as never,
      { request } as never,
      owner,
    );
    const expectedAmount = 12_345_678n;

    await expect(
      executor.withdrawRemaining({ request } as never, owner, escrow, expectedAmount),
    ).resolves.toBe(transactionHash);

    const send = request.mock.calls.find(([input]) => input.method === 'eth_sendTransaction');
    expect(send?.[0]).toEqual({
      method: 'eth_sendTransaction',
      params: [
        {
          from: owner,
          to: escrow,
          data: encodeFunctionData({
            abi: [
              {
                type: 'function',
                name: 'withdrawRemaining',
                stateMutability: 'nonpayable',
                inputs: [{ name: 'expectedAmount', type: 'uint256' }],
                outputs: [{ name: 'amount', type: 'uint256' }],
              },
            ],
            functionName: 'withdrawRemaining',
            args: [expectedAmount],
          }),
          value: '0x0',
        },
      ],
    });
  });

  it('fails Arc gas readiness before any owner transaction can be submitted', async () => {
    const owner = '0x1111111111111111111111111111111111111111';
    const escrow = '0x2222222222222222222222222222222222222222';
    const request = vi.fn(async ({ method }: { readonly method: string }) => {
      if (method === 'eth_accounts') return [owner];
      if (method === 'eth_chainId') return '0x4cef52';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_gasPrice') return '0x10';
      if (method === 'eth_getBalance') return '0x1';
      throw new Error(`Unexpected method ${method}`);
    });
    const executor = new CircleAppKitFundingExecutor(
      { ensureChain: vi.fn(async () => undefined) } as never,
      { request } as never,
      owner,
    );

    await expect(
      executor.prepareEscrowOwnerCall(
        { request } as never,
        owner,
        escrow,
        'withdrawRemaining',
        1_000_000n,
      ),
    ).rejects.toThrow('does not have enough Arc native USDC');
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_sendTransaction' }),
    );
  });

  it('observes a returned close hash before considering another signature', () => {
    const storage = storageFixture();
    persistPendingWithdrawalHash(storage, 'program', 'intent', 'close', hash);
    const pending = readPendingWithdrawalHash(storage, 'program', 'intent', 'close');

    expect(
      withdrawalContinuationAction(
        { status: 'ready_to_close' } as never,
        pending,
        undefined,
      ),
    ).toBe('observe_close');
    clearPendingWithdrawalHash(storage, 'program', 'intent', 'close');
    expect(readPendingWithdrawalHash(storage, 'program', 'intent', 'close')).toBeUndefined();
  });

  it('observes a returned withdrawal hash before considering another signature', () => {
    const storage = storageFixture();
    persistPendingWithdrawalHash(storage, 'program', 'intent', 'withdraw', hash);
    const pending = readPendingWithdrawalHash(storage, 'program', 'intent', 'withdraw');

    expect(
      withdrawalContinuationAction(
        { status: 'ready_to_withdraw' } as never,
        undefined,
        pending,
      ),
    ).toBe('observe_withdraw');
  });

  it('starts a new server intent after a complete or failed withdrawal round', () => {
    expect(
      withdrawalContinuationAction({ status: 'complete' } as never, undefined, undefined),
    ).toBe('new_round');
    expect(
      withdrawalContinuationAction({ status: 'failed' } as never, undefined, undefined),
    ).toBe('new_round');
  });

  it('never re-signs after the durable close or withdrawal wallet boundary', () => {
    expect(
      withdrawalContinuationAction(
        { status: 'close_submission_uncertain' } as never,
        undefined,
        undefined,
      ),
    ).toBe('attach_close');
    expect(
      withdrawalContinuationAction(
        { status: 'withdraw_submission_uncertain' } as never,
        undefined,
        undefined,
      ),
    ).toBe('attach_withdraw');
  });
});
