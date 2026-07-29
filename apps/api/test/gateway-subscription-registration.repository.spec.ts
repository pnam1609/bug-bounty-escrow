import { describe, expect, it, vi } from 'vitest';

import { EscrowRepository } from '../src/escrow/escrow.repository.js';

const INTENT_ID = '31000000-0000-4000-8000-000000000001';
const SUBSCRIPTION_ID = '31000000-0000-4000-8000-000000000002';
const LEASE_ID = '31000000-0000-4000-8000-000000000003';
const NOTIFICATION_ID = '31000000-0000-4000-8000-000000000004';
const WALLET = '0x1111111111111111111111111111111111111111';

describe('EscrowRepository Gateway subscription adapter', () => {
  it('maps every lifecycle method to its durable service-role RPC', async () => {
    const rpc = vi.fn(async (name: string) => {
      const data: Record<string, unknown> = {
        list_active_unified_balance_gateway_intent_ids: [{ intent_id: INTENT_ID }],
        prepare_gateway_subscription_registration_atomic: {
          claimed: true,
          revision: '7',
          addresses: [WALLET],
          domains: [0, 6],
        },
        gateway_subscription_intent_ready: true,
        complete_gateway_subscription_sync_atomic: true,
        fail_gateway_subscription_sync_atomic: true,
        record_gateway_webhook_test_atomic: false,
        gateway_webhook_test_received_after: true,
      };
      return { data: data[name], error: null };
    });
    const repository = new EscrowRepository({ rpc } as never);
    const receivedAt = '2026-07-29T01:00:00.000Z';

    await expect(repository.listActiveUnifiedBalanceIntentIds()).resolves.toEqual([INTENT_ID]);
    await expect(
      repository.prepareRegistration({
        intentId: INTENT_ID,
        subscriptionId: SUBSCRIPTION_ID,
        leaseId: LEASE_ID,
        leaseExpiresAt: '2026-07-29T01:01:00.000Z',
      }),
    ).resolves.toEqual({
      claimed: true,
      revision: 7,
      addresses: [WALLET],
      domains: [0, 6],
    });
    await expect(repository.isIntentReady(INTENT_ID, SUBSCRIPTION_ID)).resolves.toBe(true);
    await expect(
      repository.completeSync({
        subscriptionId: SUBSCRIPTION_ID,
        leaseId: LEASE_ID,
        expectedRevision: 7,
        remoteAddresses: [WALLET],
        remoteDomains: [0, 6],
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.failSync({
        subscriptionId: SUBSCRIPTION_ID,
        leaseId: LEASE_ID,
        errorCode: 'gateway_subscription_request_failed',
        retryable: true,
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.recordSignedTest({
        subscriptionId: SUBSCRIPTION_ID,
        notificationId: NOTIFICATION_ID,
        receivedAt,
      }),
    ).resolves.toBeUndefined();
    await expect(repository.hasSignedTestAfter(SUBSCRIPTION_ID, receivedAt)).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith('record_gateway_webhook_test_atomic', {
      subscription_id: SUBSCRIPTION_ID,
      notification_id: NOTIFICATION_ID,
      received_at: receivedAt,
    });
  });

  it('fails closed when a completion lease is stale', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const repository = new EscrowRepository({ rpc } as never);

    await expect(
      repository.completeSync({
        subscriptionId: SUBSCRIPTION_ID,
        leaseId: LEASE_ID,
        expectedRevision: 7,
        remoteAddresses: [WALLET],
        remoteDomains: [0],
      }),
    ).rejects.toThrow('gateway_subscription_sync_lease_lost');
  });
});
