import { parseApiEnvironment } from '@bug-bounty-escrow/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CircleGatewaySubscriptionClient,
  GatewaySubscriptionProviderError,
} from '../src/escrow/circle-gateway-subscription.client.js';

const SUBSCRIPTION_ID = '31000000-0000-4000-8000-000000000001';
const ADDRESS_A = '0x1111111111111111111111111111111111111111';
const ADDRESS_B = '0x2222222222222222222222222222222222222222';

function config() {
  return parseApiEnvironment({
    NODE_ENV: 'test',
    WEB_APP_ORIGIN: 'https://web.example.test',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ARC_RPC_URL: 'https://rpc.example.test',
    ARC_CHAIN_ID: '5042002',
    USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
    CIRCLE_GATEWAY_WEBHOOKS_ENABLED: 'true',
    CIRCLE_API_KEY: 'api-key',
    CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: SUBSCRIPTION_ID,
    AI_PROVIDER: 'disabled',
    LOG_LEVEL: 'silent',
  });
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: SUBSCRIPTION_ID,
      endpoint: 'https://web.example.test/api/webhooks/circle/gateway',
      enabled: true,
      notificationTypes: ['gateway.deposit.finalized'],
      addresses: [ADDRESS_A],
      domains: ['0'],
      environment: 'TEST',
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('CircleGatewaySubscriptionClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not PATCH an already exact filter and still re-GETs for verification', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(subscription()))
      .mockResolvedValueOnce(jsonResponse(subscription()));
    vi.stubGlobal('fetch', request);

    const result = await new CircleGatewaySubscriptionClient(config()).reconcile({
      subscriptionId: SUBSCRIPTION_ID,
      addresses: [ADDRESS_A.toUpperCase().replace('0X', '0x')],
      domains: [0],
    });

    expect(result.changed).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET']);
    for (const [, init] of request.mock.calls) {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          authorization: 'Bearer api-key',
          'user-agent': 'bounty-escrow-api/cp13',
          'x-request-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('PATCHes the complete exact filter and verifies the complete replacement', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          subscription({
            enabled: false,
            notificationTypes: ['gateway.*'],
            addresses: [ADDRESS_A],
            domains: ['0'],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          subscription({
            addresses: [ADDRESS_B],
            domains: ['3', '6'],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          subscription({
            addresses: [ADDRESS_B],
            domains: ['3', '6'],
          }),
        ),
      );
    vi.stubGlobal('fetch', request);

    const result = await new CircleGatewaySubscriptionClient(config()).reconcile({
      subscriptionId: SUBSCRIPTION_ID,
      addresses: [ADDRESS_B],
      domains: [6, 3],
    });

    expect(result.changed).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]?.[0]).toContain(`/permissionless/${SUBSCRIPTION_ID}`);
    expect(request.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          environment: 'TEST',
          enabled: true,
          notificationTypes: ['gateway.deposit.finalized'],
          addresses: [ADDRESS_B],
          domains: ['3', '6'],
        }),
      }),
    );
  });

  it('rejects account-capacity overflow before attempting a PATCH', async () => {
    const addresses = Array.from(
      { length: 51 },
      (_, index) => `0x${index.toString(16).padStart(40, '0')}`,
    );
    const request = vi.fn();
    vi.stubGlobal('fetch', request);

    await expect(
      new CircleGatewaySubscriptionClient(config()).reconcile({
        subscriptionId: SUBSCRIPTION_ID,
        addresses,
        domains: [0],
      }),
    ).rejects.toMatchObject({
      code: 'gateway_subscription_address_capacity_exceeded',
      retryable: false,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('honors Retry-After and retains a stable request id across a retry', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse(subscription()))
      .mockResolvedValueOnce(jsonResponse(subscription()));
    vi.stubGlobal('fetch', request);

    await new CircleGatewaySubscriptionClient(config()).reconcile({
      subscriptionId: SUBSCRIPTION_ID,
      addresses: [ADDRESS_A],
      domains: [0],
    });

    const firstHeaders = request.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const retryHeaders = request.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders['x-request-id']).toBe(firstHeaders['x-request-id']);
  });

  it('retries a transient Circle 5xx response', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse(subscription()))
      .mockResolvedValueOnce(jsonResponse(subscription()));
    vi.stubGlobal('fetch', request);

    await expect(
      new CircleGatewaySubscriptionClient(config()).reconcile({
        subscriptionId: SUBSCRIPTION_ID,
        addresses: [ADDRESS_A],
        domains: [0],
      }),
    ).resolves.toMatchObject({ changed: false });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent Circle rejection', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: 400, message: 'invalid filter' }, 400));
    vi.stubGlobal('fetch', request);

    await expect(
      new CircleGatewaySubscriptionClient(config()).reconcile({
        subscriptionId: SUBSCRIPTION_ID,
        addresses: [ADDRESS_A],
        domains: [0],
      }),
    ).rejects.toMatchObject({
      code: 'gateway_subscription_request_rejected',
      retryable: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the re-GET does not exactly match desired filters', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(subscription()))
      .mockResolvedValueOnce(jsonResponse(subscription({ addresses: [ADDRESS_A, ADDRESS_B] })));
    vi.stubGlobal('fetch', request);

    await expect(
      new CircleGatewaySubscriptionClient(config()).reconcile({
        subscriptionId: SUBSCRIPTION_ID,
        addresses: [ADDRESS_A],
        domains: [0],
      }),
    ).rejects.toEqual(
      new GatewaySubscriptionProviderError('gateway_subscription_remote_verification_failed', true),
    );
  });
});
