import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { EscrowService } from '../src/escrow/escrow.service.js';
import { GatewaySubscriptionProviderError } from '../src/escrow/circle-gateway-subscription.client.js';
import {
  gatewaySubscriptionSyncLeaseMs,
  GatewaySubscriptionLifecycleService,
} from '../src/escrow/gateway-subscription-lifecycle.service.js';

const SUBSCRIPTION_ID = '31000000-0000-4000-8000-000000000001';
const INTENT_ID = '31000000-0000-4000-8000-000000000002';
const PROGRAM_ID = '31000000-0000-4000-8000-000000000003';
const WALLET = '0x1111111111111111111111111111111111111111';

function lifecycleConfig(requestTimeoutMs = 1_000) {
  return {
    CIRCLE_GATEWAY_WEBHOOKS_ENABLED: true,
    CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: [SUBSCRIPTION_ID],
    CIRCLE_REQUEST_TIMEOUT_MS: requestTimeoutMs,
  };
}

describe('GatewaySubscriptionLifecycleService', () => {
  it('uses a durable claim and completes only after remote exact verification', async () => {
    const requestTimeoutMs = 15_000;
    const startedAt = Date.now();
    const store = {
      prepareRegistration: vi.fn().mockResolvedValue({
        claimed: true,
        revision: 7,
        addresses: [WALLET],
        domains: [0, 6],
      }),
      completeSync: vi.fn().mockResolvedValue(undefined),
      failSync: vi.fn(),
      isIntentReady: vi.fn().mockResolvedValue(true),
    };
    const client = {
      reconcile: vi.fn().mockResolvedValue({
        changed: false,
        subscription: {
          addresses: [WALLET],
          domains: ['0', '6'],
        },
      }),
      testConnection: vi.fn(),
      sendSignedTestNotification: vi.fn(),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig(requestTimeoutMs) as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await expect(service.ensureIntentRegistered(INTENT_ID)).resolves.toBeUndefined();
    expect(store.prepareRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: INTENT_ID,
        subscriptionId: SUBSCRIPTION_ID,
        leaseId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        leaseExpiresAt: expect.any(String),
      }),
    );
    const preparedLeaseExpiresAt = Date.parse(
      store.prepareRegistration.mock.calls[0]![0].leaseExpiresAt,
    );
    expect(preparedLeaseExpiresAt - startedAt).toBeGreaterThanOrEqual(
      gatewaySubscriptionSyncLeaseMs(requestTimeoutMs) - 50,
    );
    expect(preparedLeaseExpiresAt - startedAt).toBeLessThanOrEqual(15 * 60_000);
    expect(store.completeSync).toHaveBeenCalledWith({
      subscriptionId: SUBSCRIPTION_ID,
      leaseId: expect.any(String),
      expectedRevision: 7,
      remoteAddresses: [WALLET],
      remoteDomains: [0, 6],
    });
    expect(client.testConnection).not.toHaveBeenCalled();
    expect(client.sendSignedTestNotification).not.toHaveBeenCalled();
  });

  it('records a failed durable claim and fails closed on provider failure', async () => {
    const store = {
      prepareRegistration: vi.fn().mockResolvedValue({
        claimed: true,
        revision: 1,
        addresses: [WALLET],
        domains: [0],
      }),
      completeSync: vi.fn(),
      failSync: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      reconcile: vi
        .fn()
        .mockRejectedValue(
          new GatewaySubscriptionProviderError('gateway_subscription_request_failed', true),
        ),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await expect(service.ensureIntentRegistered(INTENT_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(store.failSync).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        errorCode: 'gateway_subscription_request_failed',
        retryable: true,
      }),
    );
    expect(store.completeSync).not.toHaveBeenCalled();
  });

  it('waits for another replica lease, then claims and performs its own remote verification', async () => {
    const store = {
      prepareRegistration: vi
        .fn()
        .mockResolvedValueOnce({
          claimed: false,
          revision: 4,
          addresses: [WALLET],
          domains: [0],
        })
        .mockResolvedValueOnce({
          claimed: true,
          revision: 4,
          addresses: [WALLET],
          domains: [0],
        }),
      completeSync: vi.fn().mockResolvedValue(undefined),
      failSync: vi.fn(),
      isIntentReady: vi.fn().mockResolvedValue(true),
    };
    const client = {
      reconcile: vi.fn().mockResolvedValue({
        changed: false,
        subscription: { addresses: [WALLET], domains: ['0'] },
      }),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await service.ensureIntentRegistered(INTENT_ID);

    expect(store.prepareRegistration).toHaveBeenCalledTimes(2);
    expect(client.reconcile).toHaveBeenCalledTimes(1);
    expect(store.completeSync).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh signed callback after remote sync when DB readiness is stale', async () => {
    const store = {
      prepareRegistration: vi.fn().mockResolvedValue({
        claimed: true,
        revision: 7,
        addresses: [WALLET],
        domains: [0, 6],
      }),
      completeSync: vi.fn().mockResolvedValue(undefined),
      failSync: vi.fn(),
      isIntentReady: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      hasSignedTestAfter: vi.fn().mockResolvedValue(true),
    };
    const client = {
      reconcile: vi.fn().mockResolvedValue({
        changed: false,
        subscription: { addresses: [WALLET], domains: ['0', '6'] },
      }),
      testConnection: vi.fn().mockResolvedValue(undefined),
      sendSignedTestNotification: vi.fn().mockResolvedValue(undefined),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await expect(service.ensureIntentRegistered(INTENT_ID)).resolves.toBeUndefined();
    expect(client.testConnection).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(client.sendSignedTestNotification).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(store.hasSignedTestAfter).toHaveBeenCalledWith(SUBSCRIPTION_ID, expect.any(String));
    expect(store.isIntentReady).toHaveBeenCalledTimes(2);
  });

  it('fails closed after remote sync when no fresh signed callback arrives', async () => {
    const store = {
      prepareRegistration: vi.fn().mockResolvedValue({
        claimed: true,
        revision: 7,
        addresses: [WALLET],
        domains: [0],
      }),
      completeSync: vi.fn().mockResolvedValue(undefined),
      failSync: vi.fn(),
      isIntentReady: vi.fn().mockResolvedValue(false),
      hasSignedTestAfter: vi.fn().mockResolvedValue(false),
    };
    const client = {
      reconcile: vi.fn().mockResolvedValue({
        changed: false,
        subscription: { addresses: [WALLET], domains: ['0'] },
      }),
      testConnection: vi.fn().mockResolvedValue(undefined),
      sendSignedTestNotification: vi.fn().mockResolvedValue(undefined),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig(10) as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await expect(service.ensureIntentRegistered(INTENT_ID)).rejects.toMatchObject({
      status: 503,
      message: 'gateway_subscription_signed_test_timeout',
    });
    expect(store.failSync).not.toHaveBeenCalled();
  });

  it('maps a permanent provider rejection to a non-retryable conflict', async () => {
    const store = {
      prepareRegistration: vi.fn().mockResolvedValue({
        claimed: true,
        revision: 1,
        addresses: [WALLET],
        domains: [0],
      }),
      completeSync: vi.fn(),
      failSync: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      reconcile: vi
        .fn()
        .mockRejectedValue(
          new GatewaySubscriptionProviderError(
            'gateway_subscription_address_capacity_exceeded',
            false,
          ),
        ),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await expect(service.ensureIntentRegistered(INTENT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(store.failSync).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'gateway_subscription_address_capacity_exceeded',
        retryable: false,
      }),
    );
  });

  it('fails closed without remote work when the durable store is unavailable', async () => {
    const storeError = new Error('database unavailable');
    const store = {
      prepareRegistration: vi.fn().mockRejectedValue(storeError),
    };
    const client = { reconcile: vi.fn() };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    await expect(service.ensureIntentRegistered(INTENT_ID)).rejects.toBe(storeError);
    expect(client.reconcile).not.toHaveBeenCalled();
  });

  it('does not perform remote work synchronously inside the bootstrap hook', () => {
    const store = { listActiveUnifiedBalanceIntentIds: vi.fn() };
    const client = {};
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    service.onApplicationBootstrap();
    expect(store.listActiveUnifiedBalanceIntentIds).not.toHaveBeenCalled();
    service.onApplicationShutdown();
  });

  it('keeps maintenance alive and records the failure when Circle is unavailable', async () => {
    const store = {
      listActiveUnifiedBalanceIntentIds: vi.fn().mockResolvedValue([]),
    };
    const client = {
      testConnection: vi
        .fn()
        .mockRejectedValue(
          new GatewaySubscriptionProviderError('gateway_subscription_request_failed', true),
        ),
    };
    const logger = { info: vi.fn(), errorEvent: vi.fn() };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      logger as never,
    );

    await expect(service.runMaintenance()).resolves.toBeUndefined();
    expect(logger.errorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: SUBSCRIPTION_ID }),
      'Circle Gateway subscription maintenance failed',
    );
  });

  it('coalesces overlapping maintenance ticks into one in-process pass', async () => {
    let releaseList!: (value: readonly string[]) => void;
    const pendingList = new Promise<readonly string[]>((resolve) => {
      releaseList = resolve;
    });
    const store = {
      listActiveUnifiedBalanceIntentIds: vi.fn().mockReturnValueOnce(pendingList),
      hasSignedTestAfter: vi.fn().mockResolvedValue(true),
    };
    const client = {
      testConnection: vi.fn().mockResolvedValue(undefined),
      sendSignedTestNotification: vi.fn().mockResolvedValue(undefined),
    };
    const service = new GatewaySubscriptionLifecycleService(
      store as never,
      client as never,
      lifecycleConfig() as never,
      { info: vi.fn(), errorEvent: vi.fn() } as never,
    );

    const first = service.runMaintenanceCoalesced();
    const overlapping = service.runMaintenanceCoalesced();
    expect(overlapping).toBe(first);
    expect(store.listActiveUnifiedBalanceIntentIds).toHaveBeenCalledTimes(1);

    releaseList([]);
    await Promise.all([first, overlapping]);
  });
});

describe('EscrowService Gateway registration gate', () => {
  it('does not read Gateway balance or create a transfer operation when registration fails', async () => {
    const intent = {
      id: INTENT_ID,
      program_id: PROGRAM_ID,
      route_mode: 'unified_balance',
      funding_phase: 'collecting_deposits',
      wallet_address: WALLET,
      sources: [{ network: 'Base_Sepolia', amountBaseUnits: '1000000' }],
      fee_allocations: [],
    };
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findFundingIntentRow: vi.fn().mockResolvedValue(intent),
      createSourceDeposit: vi.fn(),
    };
    const arc = { getGatewayConfirmedBalance: vi.fn() };
    const subscriptions = {
      ensureIntentRegistered: vi
        .fn()
        .mockRejectedValue(new ServiceUnavailableException('gateway_subscription_request_failed')),
    };
    const service = new EscrowService(
      repository as never,
      {} as never,
      arc as never,
      {} as never,
      subscriptions as never,
    );

    await expect(
      service.createSourceDeposit(
        {
          userId: '31000000-0000-4000-8000-000000000004',
          email: 'owner@example.test',
          role: 'owner',
        },
        PROGRAM_ID,
        INTENT_ID,
        { network: 'Base_Sepolia' },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(subscriptions.ensureIntentRegistered).toHaveBeenCalledWith(INTENT_ID);
    expect(arc.getGatewayConfirmedBalance).not.toHaveBeenCalled();
    expect(repository.createSourceDeposit).not.toHaveBeenCalled();
  });
});
