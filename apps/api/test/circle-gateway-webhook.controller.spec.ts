import { describe, expect, it, vi } from 'vitest';

import { CircleGatewayWebhookController } from '../src/escrow/circle-gateway-webhook.controller.js';

const SUBSCRIPTION_ID = '31000000-0000-4000-8000-000000000001';
const NOTIFICATION_ID = '31000000-0000-4000-8000-000000000002';

describe('CircleGatewayWebhookController', () => {
  it('returns a public readiness response without touching business services', () => {
    const controller = new CircleGatewayWebhookController(
      { verify: vi.fn() } as never,
      { ingestGatewayDepositFinalized: vi.fn() } as never,
      { recordSignedTest: vi.fn() } as never,
    );
    expect(controller.readiness()).toBeUndefined();
  });

  it('accepts a verified webhooks.test callback without inserting a deposit event', async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(undefined) };
    const escrow = { ingestGatewayDepositFinalized: vi.fn() };
    const lifecycle = { recordSignedTest: vi.fn().mockResolvedValue(undefined) };
    const controller = new CircleGatewayWebhookController(
      verifier as never,
      escrow as never,
      lifecycle as never,
    );
    const rawBody = Buffer.from('{"notificationType":"webhooks.test"}');

    await expect(
      controller.gateway(
        { rawBody } as never,
        {
          subscriptionId: SUBSCRIPTION_ID,
          notificationId: NOTIFICATION_ID,
          notificationType: 'webhooks.test',
          notification: {},
        },
        'key-id',
        'signature',
      ),
    ).resolves.toEqual({ success: true });

    expect(verifier.verify).toHaveBeenCalledWith(rawBody, 'key-id', 'signature');
    expect(lifecycle.recordSignedTest).toHaveBeenCalledWith(SUBSCRIPTION_ID, NOTIFICATION_ID);
    expect(escrow.ingestGatewayDepositFinalized).not.toHaveBeenCalled();
  });
});
