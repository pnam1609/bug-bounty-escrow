import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { buildEscrowWalletControlMessage, EscrowService } from '../src/escrow/escrow.service.js';
import type { EscrowWalletChallengeRow } from '../src/escrow/escrow.repository.js';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const OTHER_PROGRAM_ID = '31000000-0000-4000-8000-000000000002';
const OWNER_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_OWNER_ID = '30000000-0000-4000-8000-000000000004';
const CHALLENGE_ID = '31990000-0000-4000-8000-000000000011';
const DEPLOYMENT_ID = '31990000-0000-4000-8000-000000000012';
const owner = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const wrongOwner = privateKeyToAccount(`0x${'2'.repeat(64)}`);
const deadline = '2099-07-29T00:00:00.000Z';

const principal = {
  userId: OWNER_ID,
  email: 'owner@example.test',
  role: 'owner' as const,
};

function challenge(patch: Partial<EscrowWalletChallengeRow> = {}): EscrowWalletChallengeRow {
  return {
    id: CHALLENGE_ID,
    program_id: PROGRAM_ID,
    actor_id: OWNER_ID,
    owner_wallet: owner.address,
    withdraw_recipient: owner.address,
    chain_id: 5_042_002,
    nonce: `0x${'a'.repeat(64)}`,
    issued_at: '2099-07-28T23:55:00.000Z',
    expires_at: '2099-07-29T00:05:00.000Z',
    invalidated_at: null,
    consumed_at: null,
    deployment_id: null,
    ...patch,
  };
}

function message(row: EscrowWalletChallengeRow): string {
  return buildEscrowWalletControlMessage({
    programId: row.program_id,
    actorId: row.actor_id,
    ownerWallet: row.owner_wallet,
    withdrawRecipient: row.withdraw_recipient,
    nonce: row.nonce,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  });
}

function serviceWith(repository: Record<string, unknown>, circle = {}, arc = {}) {
  return new EscrowService(
    repository as never,
    circle as never,
    arc as never,
    {
      BOUNTY_ESCROW_ARTIFACT_PATH: '../../packages/contracts/artifacts/BountyEscrow.v1.json',
      CIRCLE_POLL_TIMEOUT_MS: 1_000,
      CIRCLE_REQUEST_TIMEOUT_MS: 1_000,
    } as never,
    {} as never,
  );
}

function deploymentInput(walletSignature: `0x${string}`) {
  return {
    ownerWallet: owner.address,
    withdrawRecipient: owner.address,
    refundUnlockAt: deadline,
    artifactVersion: '1.1.0' as const,
    walletChallengeId: CHALLENGE_ID,
    walletSignature,
  };
}

describe('CP-13 wallet-control proof', () => {
  it.each([
    ['program', { program_id: OTHER_PROGRAM_ID }],
    ['authenticated user', { actor_id: OTHER_OWNER_ID }],
  ])('rejects a challenge bound to a different %s', async (_label, patch) => {
    const row = challenge(patch);
    const signature = await owner.signMessage({ message: message(row) });
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findWalletChallenge: vi.fn().mockResolvedValue(row),
      createDeploymentRecord: vi.fn(),
    };

    await expect(
      serviceWith(repository).deploy(principal, PROGRAM_ID, deploymentInput(signature)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createDeploymentRecord).not.toHaveBeenCalled();
  });

  it('rejects a valid signature from the wrong account', async () => {
    const row = challenge();
    const signature = await wrongOwner.signMessage({ message: message(row) });
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findWalletChallenge: vi.fn().mockResolvedValue(row),
      createDeploymentRecord: vi.fn(),
    };

    await expect(
      serviceWith(repository).deploy(principal, PROGRAM_ID, deploymentInput(signature)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createDeploymentRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', { expires_at: '2020-01-01T00:00:00.000Z' }],
    [
      'replayed',
      {
        consumed_at: '2099-07-28T23:56:00.000Z',
        deployment_id: DEPLOYMENT_ID,
      },
    ],
    ['invalidated', { invalidated_at: '2099-07-28T23:56:00.000Z' }],
  ])('rejects an %s challenge before deployment side effects', async (_label, patch) => {
    const row = challenge(patch);
    const signature = await owner.signMessage({ message: message(row) });
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findWalletChallenge: vi.fn().mockResolvedValue(row),
      createDeploymentRecord: vi.fn(),
    };

    await expect(
      serviceWith(repository).deploy(principal, PROGRAM_ID, deploymentInput(signature)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createDeploymentRecord).not.toHaveBeenCalled();
  });

  it('accepts the bound owner signature and passes the challenge to atomic consumption', async () => {
    const row = challenge();
    const signature = await owner.signMessage({ message: message(row) });
    const pending = {
      id: DEPLOYMENT_ID,
      program_id: PROGRAM_ID,
      deployment_status: 'pending',
      circle_contract_id: '31990000-0000-4000-8000-000000000021',
      circle_transaction_id: '31990000-0000-4000-8000-000000000022',
    };
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findWalletChallenge: vi.fn().mockResolvedValue(row),
      getProgramDeadline: vi.fn().mockResolvedValue(deadline),
      findDeployment: vi.fn().mockResolvedValue(null),
      createDeploymentRecord: vi.fn().mockResolvedValue(pending),
      toEscrowDeployment: vi.fn().mockReturnValue({ status: 'pending' }),
    };
    const circle = {
      getDeploymentWalletAddress: vi.fn().mockResolvedValue(`0x${'4'.repeat(40)}`),
      waitForDeployment: vi.fn().mockResolvedValue({ state: 'pending' }),
    };

    await expect(
      serviceWith(repository, circle).deploy(principal, PROGRAM_ID, deploymentInput(signature)),
    ).resolves.toEqual({ status: 'pending' });
    expect(repository.createDeploymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        programId: PROGRAM_ID,
        walletChallengeId: CHALLENGE_ID,
        ownerWallet: owner.address,
      }),
    );
  });
});

describe('CP-13 withdrawal product-status gate', () => {
  it.each(['draft', 'awaiting_funding', 'active', 'paused'] as const)(
    'rejects withdrawal while the program is %s',
    async (status) => {
      const repository = {
        isProgramOwner: vi.fn().mockResolvedValue(true),
        getProgramStatus: vi.fn().mockResolvedValue(status),
        findConfirmedEscrow: vi.fn(),
      };

      await expect(
        serviceWith(repository).createWithdrawalIntent(principal, PROGRAM_ID, {
          idempotencyKey: '31990000-0000-4000-8000-000000000031',
          walletAddress: owner.address,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.findConfirmedEscrow).not.toHaveBeenCalled();
    },
  );

  it.each(['expired', 'closed'] as const)(
    'allows an ended %s program to proceed through verified chain-state checks',
    async (status) => {
      const escrowAddress = `0x${'3'.repeat(40)}` as const;
      const escrow = {
        id: DEPLOYMENT_ID,
        owner_wallet: owner.address,
        withdraw_recipient: owner.address,
        refund_unlock_at: '2020-01-01T00:00:00.000Z',
        contract_address: escrowAddress,
        deployment_block_number: '1',
        late_funding_scanned_through_block: '1',
      };
      const repository = {
        isProgramOwner: vi.fn().mockResolvedValue(true),
        getProgramStatus: vi.fn().mockResolvedValue(status),
        findConfirmedEscrow: vi.fn().mockResolvedValue(escrow),
        reconcileLateFunding: vi.fn(),
        createWithdrawalIntent: vi.fn().mockResolvedValue({ id: 'intent' }),
        toWithdrawalIntent: vi.fn().mockReturnValue({ status: 'ready_to_close' }),
      };
      const arc = {
        findLateFunding: vi.fn().mockResolvedValue({
          events: [],
          scannedThroughBlock: 2n,
        }),
        getWithdrawalState: vi.fn().mockResolvedValue({
          refundUnlockAt: 1n,
          totalApprovedOutstandingBaseUnits: 0n,
          balanceBaseUnits: 1_000_000n,
          totalWithdrawnBaseUnits: 0n,
          withdrawRecipient: owner.address,
          closed: false,
        }),
      };

      await expect(
        serviceWith(repository, {}, arc).createWithdrawalIntent(principal, PROGRAM_ID, {
          idempotencyKey: '31990000-0000-4000-8000-000000000031',
          walletAddress: owner.address,
        }),
      ).resolves.toEqual({ status: 'ready_to_close' });
      expect(repository.createWithdrawalIntent).toHaveBeenCalledOnce();
    },
  );
});
