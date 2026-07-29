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

  it('requires the challenge id and EVM signature on deployment', () => {
    const deployment = {
      ownerWallet: WALLET,
      withdrawRecipient: WALLET,
      refundUnlockAt: '2026-08-29T00:00:00.000Z',
      artifactVersion: '1.1.0',
    };

    expect(deployEscrowWithCircleRequestSchema.safeParse(deployment).success).toBe(false);
    expect(
      deployEscrowWithCircleRequestSchema.parse({
        ...deployment,
        walletChallengeId: CHALLENGE_ID,
        walletSignature: SIGNATURE,
      }).walletChallengeId,
    ).toBe(CHALLENGE_ID);
  });
});
