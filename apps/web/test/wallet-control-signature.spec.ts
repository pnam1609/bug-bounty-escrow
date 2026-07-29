import type { EIP1193Provider } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { signEscrowWalletChallenge } from '@/components/owner/circle-funding-executor';

const OWNER = `0x${'1'.repeat(40)}`;
const OTHER = `0x${'2'.repeat(40)}`;
const SIGNATURE = `0x${'a'.repeat(130)}`;

describe('escrow wallet-control signature', () => {
  it('checks the active account on both sides of the wallet prompt', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([OWNER])
      .mockResolvedValueOnce(SIGNATURE)
      .mockResolvedValueOnce([OWNER]);
    const provider = { request } as unknown as EIP1193Provider;

    await expect(
      signEscrowWalletChallenge(provider, OWNER, 'Bound server challenge'),
    ).resolves.toBe(SIGNATURE);
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      'eth_accounts',
      'personal_sign',
      'eth_accounts',
    ]);
  });

  it('fails closed when the account changes while the prompt is open', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([OWNER])
      .mockResolvedValueOnce(SIGNATURE)
      .mockResolvedValueOnce([OTHER]);
    const provider = { request } as unknown as EIP1193Provider;

    await expect(
      signEscrowWalletChallenge(provider, OWNER, 'Bound server challenge'),
    ).rejects.toThrow('active wallet account changed');
  });

  it('does not open a signature prompt for an already-mismatched account', async () => {
    const request = vi.fn().mockResolvedValueOnce([OTHER]);
    const provider = { request } as unknown as EIP1193Provider;

    await expect(
      signEscrowWalletChallenge(provider, OWNER, 'Bound server challenge'),
    ).rejects.toThrow('active wallet account changed');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
