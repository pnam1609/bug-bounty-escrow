import type { EIP1193Provider } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_DRAFT,
  readDraft,
  validateRewardWalletStep,
} from '@/components/submit-bug/submit-bug-model';
import {
  challengeStillMatches,
  payoutWalletSelectionError,
} from '@/components/wallets/researcher-wallet-model';
import { walletDialogLayerState } from '@/components/wallets/add-researcher-wallet-dialog';
import {
  ARC_TESTNET_CHAIN_ID,
  signResearcherWalletChallenge,
} from '@/components/wallets/wallet-signature';

const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WALLET = {
  id: '46000000-0000-4000-8000-000000000001',
  label: 'Research wallet',
  address: ADDRESS,
  maskedAddress: '0xaaaa…aaaa',
  walletType: 'evm' as const,
  network: 'Arc Testnet' as const,
  chainId: ARC_TESTNET_CHAIN_ID as 5042002,
  verificationMethod: 'eip191_personal_sign' as const,
  verifiedAt: '2026-08-10T00:00:00.000Z',
  createdAt: '2026-08-10T00:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('verified researcher wallet selection', () => {
  it('requires a current server-listed wallet and blocks loading or stale state', () => {
    expect(validateRewardWalletStep('', [WALLET], 'ready')['payoutWalletId']).toContain('Select');
    expect(validateRewardWalletStep(WALLET.id, [WALLET], 'ready')).toEqual({});
    expect(validateRewardWalletStep(WALLET.id, [], 'ready')['payoutWalletId']).toContain(
      'no longer available',
    );
    expect(validateRewardWalletStep(WALLET.id, [WALLET], 'loading')['payoutWalletId']).toContain(
      'finish loading',
    );
    expect(payoutWalletSelectionError([WALLET], WALLET.id)).toBeNull();
  });

  it('migrates a four-step draft by adding only an empty wallet id', () => {
    const stored = { ...EMPTY_DRAFT } as Record<string, unknown>;
    delete stored['payoutWalletId'];
    const localStorage = {
      getItem: vi.fn(() => JSON.stringify(stored)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage });

    expect(readDraft('aegis')).toEqual({ ...EMPTY_DRAFT, payoutWalletId: '' });
    expect(JSON.stringify(readDraft('aegis'))).not.toMatch(/signature|challenge|address/i);
  });

  it('binds a challenge to the connected address', () => {
    const challenge = {
      id: '47000000-0000-4000-8000-000000000001',
      address: ADDRESS,
      chainId: ARC_TESTNET_CHAIN_ID as 5042002,
      message: 'Verify wallet',
      issuedAt: '2026-08-10T00:00:00.000Z',
      expiresAt: '2026-08-10T00:05:00.000Z',
    };
    expect(challengeStillMatches(challenge, ADDRESS.toUpperCase())).toBe(true);
    expect(challengeStillMatches(challenge, OTHER)).toBe(false);
  });
});

describe('add wallet and RainbowKit modal lifecycle', () => {
  const closed = {
    accountModalOpen: false,
    chainModalOpen: false,
    connectModalOpen: false,
  };

  it('keeps the Add Wallet dialog modal and interactive while RainbowKit is closed', () => {
    expect(walletDialogLayerState(closed)).toEqual({
      ariaHidden: false,
      className: '',
      inert: false,
      modal: true,
      overlayClassName: '',
      suspended: false,
    });
  });

  it.each(['connectModalOpen', 'accountModalOpen', 'chainModalOpen'] as const)(
    'makes Add Wallet inert and places it below the %s portal',
    (modal) => {
      const state = walletDialogLayerState({ ...closed, [modal]: true });

      expect(state).toMatchObject({
        ariaHidden: true,
        inert: true,
        modal: false,
        suspended: true,
      });
      expect(state.className).toContain('pointer-events-none');
      expect(state.className).toContain('z-40');
      expect(state.overlayClassName).toContain('pointer-events-none');
      expect(state.overlayClassName).toContain('z-40');
    },
  );

  it('resumes the Add Wallet focus scope after RainbowKit closes', () => {
    const suspended = walletDialogLayerState({ ...closed, connectModalOpen: true });
    const resumed = walletDialogLayerState(closed);

    expect(suspended.modal).toBe(false);
    expect(resumed).toMatchObject({ inert: false, modal: true, suspended: false });
  });
});

describe('researcher wallet signature boundary', () => {
  it('checks account and Arc chain before and after personal_sign', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([ADDRESS])
      .mockResolvedValueOnce(`0x${ARC_TESTNET_CHAIN_ID.toString(16)}`)
      .mockResolvedValueOnce(`0x${'a'.repeat(130)}`)
      .mockResolvedValueOnce([ADDRESS])
      .mockResolvedValueOnce(`0x${ARC_TESTNET_CHAIN_ID.toString(16)}`);
    const provider = { request } as unknown as EIP1193Provider;

    await expect(
      signResearcherWalletChallenge(provider, ADDRESS, 'Verify wallet'),
    ).resolves.toMatch(/^0x/);
    expect(request.mock.calls.map(([input]) => input.method)).toEqual([
      'eth_accounts',
      'eth_chainId',
      'personal_sign',
      'eth_accounts',
      'eth_chainId',
    ]);
  });

  it('does not open a signature prompt when the active account is already different', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([OTHER])
      .mockResolvedValueOnce(`0x${ARC_TESTNET_CHAIN_ID.toString(16)}`);
    const provider = { request } as unknown as EIP1193Provider;

    await expect(signResearcherWalletChallenge(provider, ADDRESS, 'Verify wallet')).rejects.toThrow(
      'wallet_account_changed',
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});
