import { describe, expect, it, vi } from 'vitest';

import {
  EscrowProviderError,
  type CircleDeploymentAccepted,
} from '../src/escrow/escrow-gateways.js';
import { EscrowService } from '../src/escrow/escrow.service.js';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const OWNER_ID = '30000000-0000-4000-8000-000000000001';
const OWNER_WALLET = `0x${'1'.repeat(40)}`;
const ADMIN_CONTRACT = `0x${'2'.repeat(40)}`;
const DEPLOYMENT_ID = '31990000-0000-4000-8000-000000000012';
const DEADLINE = '2099-01-01T00:00:00.000Z';

const principal = {
  userId: OWNER_ID,
  email: 'owner@example.test',
  role: 'owner' as const,
};

function deploymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DEPLOYMENT_ID,
    program_id: PROGRAM_ID,
    program_key: `0x${'3'.repeat(64)}`,
    chain_id: 5_042_002,
    token_address: `0x${'4'.repeat(40)}`,
    owner_wallet: OWNER_WALLET,
    withdraw_recipient: OWNER_WALLET,
    refund_unlock_at: DEADLINE,
    contract_version: '1.1.0',
    artifact_checksum: `0x${'5'.repeat(64)}`,
    circle_contract_id: null,
    circle_transaction_id: null,
    deploy_idempotency_key: '11111111-1111-4111-8111-111111111111',
    deployment_attempt: 1,
    deployment_request_hash: null,
    deployment_status: 'accepted',
    contract_address: null,
    deployment_transaction_hash: null,
    failure_code: null,
    updated_at: DEADLINE,
    ...overrides,
  };
}

function serviceWith(repository: Record<string, unknown>, circle: Record<string, unknown>) {
  return new EscrowService(
    repository as never,
    circle as never,
    {} as never,
    {
      BOUNTY_ESCROW_ADMIN_CONTRACT_ADDRESS: ADMIN_CONTRACT,
      BOUNTY_ESCROW_ARTIFACT_PATH: '../../packages/contracts/artifacts/BountyEscrow.v1.json',
      CIRCLE_POLL_TIMEOUT_MS: 1_000,
      CIRCLE_REQUEST_TIMEOUT_MS: 1_000,
    } as never,
    {} as never,
  );
}

describe('CP-13 deployment idempotency recovery', () => {
  it('rotates once for a Circle validation rejection before identifiers exist', async () => {
    const first = deploymentRow();
    const second = deploymentRow({
      deployment_attempt: 2,
      deploy_idempotency_key: '22222222-2222-4222-8222-222222222222',
    });
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findActiveDeploymentFeeQuote: vi.fn().mockResolvedValue({
        id: '41990000-0000-4000-8000-000000000001',
        status: 'paid',
        payer_address: OWNER_WALLET,
      }),
      getProgramDeadline: vi.fn().mockResolvedValue(DEADLINE),
      findDeployment: vi.fn().mockResolvedValue(null),
      createServerDeploymentRecord: vi.fn().mockResolvedValue(first),
      rotateDeploymentIdempotencyKey: vi.fn().mockResolvedValue(second),
      storeCircleDeploymentIdentifiers: vi.fn().mockResolvedValue({
        ...second,
        circle_contract_id: '41990000-0000-4000-8000-000000000002',
        circle_transaction_id: '41990000-0000-4000-8000-000000000003',
        deployment_status: 'pending',
      }),
      toEscrowDeployment: vi.fn().mockReturnValue({ status: 'pending' }),
    };
    const accepted: CircleDeploymentAccepted = {
      contractId: '41990000-0000-4000-8000-000000000002',
      transactionId: '41990000-0000-4000-8000-000000000003',
    };
    const circle = {
      getDeploymentWalletAddress: vi.fn().mockResolvedValue(ADMIN_CONTRACT),
      deploy: vi
        .fn()
        .mockRejectedValueOnce(new EscrowProviderError('circle_request_rejected', false, 400))
        .mockResolvedValueOnce(accepted),
      waitForDeployment: vi.fn().mockResolvedValue({ state: 'pending' }),
    };

    await expect(
      serviceWith(repository, circle).deploy(principal, PROGRAM_ID, {} as never),
    ).resolves.toEqual({
      status: 'pending',
    });

    expect(circle.deploy).toHaveBeenCalledTimes(2);
    const firstCall = circle.deploy.mock.calls[0]?.[0];
    const secondCall = circle.deploy.mock.calls[1]?.[0];
    expect(firstCall).toBeDefined();
    expect(secondCall).toBeDefined();
    expect(firstCall?.idempotencyKey).not.toBe(secondCall?.idempotencyKey);
    expect(repository.rotateDeploymentIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: DEPLOYMENT_ID,
        requestHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
        reason: 'circle_validation_rejection_without_provider_identifiers',
      }),
    );
  });

  it('does not rotate after the bounded attempt has already been used', async () => {
    const current = deploymentRow({ deployment_attempt: 2 });
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findActiveDeploymentFeeQuote: vi.fn().mockResolvedValue({
        id: '41990000-0000-4000-8000-000000000001',
        status: 'paid',
        payer_address: OWNER_WALLET,
      }),
      getProgramDeadline: vi.fn().mockResolvedValue(DEADLINE),
      findDeployment: vi.fn().mockResolvedValue(current),
      createServerDeploymentRecord: vi.fn().mockResolvedValue(current),
      rotateDeploymentIdempotencyKey: vi.fn(),
    };
    const circle = {
      getDeploymentWalletAddress: vi.fn().mockResolvedValue(ADMIN_CONTRACT),
      deploy: vi
        .fn()
        .mockRejectedValue(new EscrowProviderError('circle_request_rejected', false, 400)),
    };

    await expect(
      serviceWith(repository, circle).deploy(principal, PROGRAM_ID, {} as never),
    ).rejects.toThrow('circle_request_rejected');
    expect(repository.rotateDeploymentIdempotencyKey).not.toHaveBeenCalled();
    expect(circle.deploy).toHaveBeenCalledOnce();
  });
});
