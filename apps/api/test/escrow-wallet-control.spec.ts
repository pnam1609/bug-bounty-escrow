import { ConflictException } from '@nestjs/common';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { EscrowService } from '../src/escrow/escrow.service.js';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const OWNER_ID = '30000000-0000-4000-8000-000000000001';
const DEPLOYMENT_ID = '31990000-0000-4000-8000-000000000012';
const owner = privateKeyToAccount(`0x${'1'.repeat(64)}`);

const principal = {
  userId: OWNER_ID,
  email: 'owner@example.test',
  role: 'owner' as const,
};

function serviceWith(repository: Record<string, unknown>, circle = {}, arc = {}) {
  return new EscrowService(
    repository as never,
    circle as never,
    arc as never,
    {
      BOUNTY_ESCROW_ARTIFACT_PATH: '../../packages/contracts/artifacts/BountyEscrow.v1.json',
      CIRCLE_POLL_TIMEOUT_MS: 1_000,
      CIRCLE_REQUEST_TIMEOUT_MS: 1_000,
      DEPLOYMENT_FEE_RECIPIENT_ADDRESS: owner.address,
      DEPLOYMENT_FEE_AMOUNT_BASE_UNITS: 1_000_000,
      DEPLOYMENT_FEE_CHAIN_ID: 5_042_002,
      DEPLOYMENT_FEE_TOKEN_ADDRESS: '0x3600000000000000000000000000000000000000',
    } as never,
    {} as never,
  );
}

describe('CP-13 server-controlled deployment gate', () => {
  it('requires a verified deployment-fee payment before any deployment side effect', async () => {
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findActiveDeploymentFeeQuote: vi.fn().mockResolvedValue(null),
      createServerDeploymentRecord: vi.fn(),
    };

    await expect(serviceWith(repository).deploy(principal, PROGRAM_ID, {} as never)).rejects.toThrow(
      'deployment_fee_payment_required',
    );
    expect(repository.createServerDeploymentRecord).not.toHaveBeenCalled();
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
