import { getAddress, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import {
  buildResearcherPayoutWalletMessage,
  RewardService,
} from '../src/rewards/reward.service.js';

const RESEARCHER_ID = '10000000-0000-4000-8000-000000000001';
const CHALLENGE_ID = '20000000-0000-4000-8000-000000000001';
const WALLET_ID = '30000000-0000-4000-8000-000000000001';
const issuedAt = '2026-08-10T10:00:00.000Z';
const expiresAt = '2099-08-10T10:05:00.000Z';
const account = privateKeyToAccount(`0x${'1'.padStart(64, '0')}`);
const otherAccount = privateKeyToAccount(`0x${'2'.padStart(64, '0')}`);

const principal = {
  userId: RESEARCHER_ID,
  role: 'researcher' as const,
  email: 'researcher@example.test',
};

function serviceWith(repository: Record<string, unknown>): RewardService {
  return new RewardService(
    repository as never,
    {
      WEB_APP_ORIGIN: 'https://bountyescrow.xyz',
    } as never,
  );
}

function challenge(message: string) {
  return {
    id: CHALLENGE_ID,
    researcher_id: RESEARCHER_ID,
    address: account.address.toLowerCase(),
    chain_id: 5_042_002,
    domain: 'bountyescrow.xyz',
    uri: 'https://bountyescrow.xyz/rewards/wallets',
    purpose: 'researcher_payout_wallet_verification',
    nonce: '0123456789abcdef0123456789abcdef',
    message,
    message_hash: keccak256(stringToHex(message)),
    issued_at: issuedAt,
    expires_at: expiresAt,
    consumed_at: null,
    invalidated_at: null,
    created_at: issuedAt,
  };
}

function wallet() {
  return {
    id: WALLET_ID,
    address: account.address.toLowerCase(),
    maskedAddress: `${account.address.toLowerCase().slice(0, 6)}…${account.address.toLowerCase().slice(-4)}`,
    walletType: 'evm' as const,
    network: 'Arc Testnet' as const,
    chainId: 5_042_002 as const,
    verificationMethod: 'eip191_personal_sign' as const,
    verifiedAt: issuedAt,
    createdAt: issuedAt,
  };
}

describe('researcher payout-wallet verification service', () => {
  it('persists and returns the exact UUID embedded in the canonical server message', async () => {
    const createPayoutWalletChallenge = vi
      .fn()
      .mockImplementation((input: { challengeId: string }) => Promise.resolve(input.challengeId));
    const service = serviceWith({ createPayoutWalletChallenge });

    const result = await service.createPayoutWalletChallenge(principal, {
      address: account.address.toLowerCase(),
    });
    const persisted = createPayoutWalletChallenge.mock.calls[0]?.[0] as {
      challengeId: string;
      domain: string;
      uri: string;
      purpose: string;
      issuedAt: string;
      expiresAt: string;
      message: string;
    };

    expect(result.id).toBe(persisted.challengeId);
    expect(result.message).toContain(`Request ID: ${result.id}`);
    expect(result.message).toContain('Chain ID: 5042002');
    expect(result.message).toContain('URI: https://bountyescrow.xyz/rewards/wallets');
    expect(result.message).toContain(getAddress(account.address));
    expect(persisted.domain).toBe('bountyescrow.xyz');
    expect(persisted.purpose).toBe('researcher_payout_wallet_verification');
    expect(Date.parse(persisted.expiresAt) - Date.parse(persisted.issuedAt)).toBe(5 * 60 * 1000);
  });

  it('recovers the exact EIP-191 signer before atomically consuming the challenge', async () => {
    const message = buildResearcherPayoutWalletMessage({
      domain: 'bountyescrow.xyz',
      uri: 'https://bountyescrow.xyz/rewards/wallets',
      address: account.address,
      nonce: '0123456789abcdef0123456789abcdef',
      issuedAt,
      expiresAt,
      challengeId: CHALLENGE_ID,
    });
    const signature = await account.signMessage({ message });
    const completePayoutWalletVerification = vi.fn().mockResolvedValue(WALLET_ID);
    const repository = {
      findPayoutWalletChallenge: vi.fn().mockResolvedValue(challenge(message)),
      completePayoutWalletVerification,
      findVerifiedPayoutWallet: vi.fn().mockResolvedValue(wallet()),
    };

    await expect(
      serviceWith(repository).verifyPayoutWallet(principal, CHALLENGE_ID, { signature }),
    ).resolves.toEqual(wallet());
    expect(completePayoutWalletVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        researcherId: RESEARCHER_ID,
        challengeId: CHALLENGE_ID,
        verifiedAddress: getAddress(account.address),
        verifiedMessageHash: keccak256(stringToHex(message)),
      }),
    );
  });

  it('rejects a valid signature from the wrong connected account without consuming the nonce', async () => {
    const message = buildResearcherPayoutWalletMessage({
      domain: 'bountyescrow.xyz',
      uri: 'https://bountyescrow.xyz/rewards/wallets',
      address: account.address,
      nonce: '0123456789abcdef0123456789abcdef',
      issuedAt,
      expiresAt,
      challengeId: CHALLENGE_ID,
    });
    const completePayoutWalletVerification = vi.fn();
    const service = serviceWith({
      findPayoutWalletChallenge: vi.fn().mockResolvedValue(challenge(message)),
      completePayoutWalletVerification,
    });

    await expect(
      service.verifyPayoutWallet(principal, CHALLENGE_ID, {
        signature: await otherAccount.signMessage({ message }),
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(completePayoutWalletVerification).not.toHaveBeenCalled();
  });

  it('fails closed when persisted domain/URI/message provenance is tampered', async () => {
    const message = buildResearcherPayoutWalletMessage({
      domain: 'bountyescrow.xyz',
      uri: 'https://bountyescrow.xyz/rewards/wallets',
      address: account.address,
      nonce: '0123456789abcdef0123456789abcdef',
      issuedAt,
      expiresAt,
      challengeId: CHALLENGE_ID,
    });
    const completePayoutWalletVerification = vi.fn();
    const service = serviceWith({
      findPayoutWalletChallenge: vi.fn().mockResolvedValue({
        ...challenge(message),
        uri: 'https://evil.example/rewards/wallets',
      }),
      completePayoutWalletVerification,
    });

    await expect(
      service.verifyPayoutWallet(principal, CHALLENGE_ID, {
        signature: await account.signMessage({ message }),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(completePayoutWalletVerification).not.toHaveBeenCalled();
  });

  it('returns the durable wallet on a same-challenge retry after successful consumption', async () => {
    const message = 'already consumed';
    const existing = wallet();
    const service = serviceWith({
      findPayoutWalletChallenge: vi.fn().mockResolvedValue({
        ...challenge(message),
        consumed_at: issuedAt,
      }),
      findVerifiedPayoutWalletByAddress: vi.fn().mockResolvedValue(existing),
      completePayoutWalletVerification: vi.fn(),
    });

    await expect(
      service.verifyPayoutWallet(principal, CHALLENGE_ID, {
        signature: `0x${'a'.repeat(130)}`,
      }),
    ).resolves.toEqual(existing);
  });
});
