import {
  createEscrowWalletChallengeRequestSchema,
  deployEscrowWithCircleRequestSchema,
  escrowWalletChallengeResponseSchema,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const CHALLENGE_ID = '31990000-0000-4000-8000-000000000011';
const WALLET = `0x${'1'.repeat(40)}`;
const SIGNATURE = `0x${'a'.repeat(130)}`;

describe('wallet-control API contract', () => {
  it('binds a challenge to both immutable deployment wallet fields', () => {
    expect(
      createEscrowWalletChallengeRequestSchema.parse({
        ownerWallet: WALLET,
        withdrawRecipient: WALLET,
      }),
    ).toEqual({ ownerWallet: WALLET, withdrawRecipient: WALLET });

    expect(
      escrowWalletChallengeResponseSchema.parse({
        success: true,
        data: {
          challengeId: CHALLENGE_ID,
          programId: PROGRAM_ID,
          ownerWallet: WALLET,
          withdrawRecipient: WALLET,
          chainId: 5_042_002,
          message: 'Bound server challenge',
          issuedAt: '2026-07-29T00:00:00.000Z',
          expiresAt: '2026-07-29T00:05:00.000Z',
        },
      }).data.challengeId,
    ).toBe(CHALLENGE_ID);
  });

  it('does not accept browser wallet authority fields on deployment', () => {
    expect(deployEscrowWithCircleRequestSchema.parse({})).toEqual({});
    expect(
      deployEscrowWithCircleRequestSchema.safeParse({
        ownerWallet: WALLET,
        walletChallengeId: CHALLENGE_ID,
        walletSignature: SIGNATURE,
      }).success,
    ).toBe(false);
  });
});
