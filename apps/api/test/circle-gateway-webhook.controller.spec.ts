import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { API_CONFIG } from '../src/config/api-config.module.js';
import { CircleGatewayWebhookController } from '../src/escrow/circle-gateway-webhook.controller.js';
import { CircleGatewayWebhookVerifier } from '../src/escrow/circle-gateway-webhook.verifier.js';
import { EscrowService } from '../src/escrow/escrow.service.js';
import { GatewaySubscriptionLifecycleService } from '../src/escrow/gateway-subscription-lifecycle.service.js';

const SUBSCRIPTION_ID = '31000000-0000-4000-8000-000000000001';
const NOTIFICATION_ID = '31000000-0000-4000-8000-000000000002';

describe('CircleGatewayWebhookController', () => {
  it('returns HTTP 200 for Circle testConnection-compatible signed POST callbacks', async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(undefined) };
    const lifecycle = { recordSignedTest: vi.fn() };
    const moduleReference = await Test.createTestingModule({
      controllers: [CircleGatewayWebhookController],
      providers: [
        { provide: CircleGatewayWebhookVerifier, useValue: verifier },
        { provide: EscrowService, useValue: { ingestGatewayDepositFinalized: vi.fn() } },
        { provide: GatewaySubscriptionLifecycleService, useValue: lifecycle },
        {
          provide: API_CONFIG,
          useValue: { CIRCLE_GATEWAY_WEBHOOKS_ENABLED: false },
        },
      ],
    }).compile();
    const app = moduleReference.createNestApplication({ rawBody: true });
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .post('/webhooks/circle/gateway')
        .set('x-circle-key-id', 'circle-key-id')
        .set('x-circle-signature', 'circle-signature')
        .send({
          subscriptionId: SUBSCRIPTION_ID,
          notificationId: NOTIFICATION_ID,
          notificationType: 'webhooks.test',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(verifier.verify).toHaveBeenCalledOnce();
      expect(lifecycle.recordSignedTest).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns a public readiness response without touching business services', () => {
    const controller = new CircleGatewayWebhookController(
      { verify: vi.fn() } as never,
      { ingestGatewayDepositFinalized: vi.fn() } as never,
      { recordSignedTest: vi.fn() } as never,
      { CIRCLE_GATEWAY_WEBHOOKS_ENABLED: true } as never,
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
      { CIRCLE_GATEWAY_WEBHOOKS_ENABLED: true } as never,
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

  it('accepts a verified bootstrap test while disabled without persisting its unknown ID', async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(undefined) };
    const escrow = { ingestGatewayDepositFinalized: vi.fn() };
    const lifecycle = { recordSignedTest: vi.fn() };
    const controller = new CircleGatewayWebhookController(
      verifier as never,
      escrow as never,
      lifecycle as never,
      { CIRCLE_GATEWAY_WEBHOOKS_ENABLED: false } as never,
    );

    await expect(
      controller.gateway(
        { rawBody: Buffer.from('signed bootstrap test') } as never,
        {
          subscriptionId: SUBSCRIPTION_ID,
          notificationId: NOTIFICATION_ID,
          notificationType: 'webhooks.test',
        },
        'circle-key-id',
        'circle-signature',
      ),
    ).resolves.toEqual({ success: true });

    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(lifecycle.recordSignedTest).not.toHaveBeenCalled();
    expect(escrow.ingestGatewayDepositFinalized).not.toHaveBeenCalled();
  });

  it('rejects a signed deposit payload while business webhooks are disabled', async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(undefined) };
    const escrow = { ingestGatewayDepositFinalized: vi.fn() };
    const lifecycle = { recordSignedTest: vi.fn() };
    const controller = new CircleGatewayWebhookController(
      verifier as never,
      escrow as never,
      lifecycle as never,
      { CIRCLE_GATEWAY_WEBHOOKS_ENABLED: false } as never,
    );

    await expect(
      controller.gateway(
        { rawBody: Buffer.from('signed deposit') } as never,
        {
          subscriptionId: SUBSCRIPTION_ID,
          notificationId: NOTIFICATION_ID,
          notificationType: 'gateway.deposit.finalized',
        },
        'circle-key-id',
        'circle-signature',
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: 'circle_gateway_webhooks_disabled',
    });

    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(lifecycle.recordSignedTest).not.toHaveBeenCalled();
    expect(escrow.ingestGatewayDepositFinalized).not.toHaveBeenCalled();
  });

  it('never acknowledges an invalid signature during disabled bootstrap', async () => {
    const verifier = {
      verify: vi
        .fn()
        .mockRejectedValue(new UnauthorizedException('circle_webhook_signature_invalid')),
    };
    const escrow = { ingestGatewayDepositFinalized: vi.fn() };
    const lifecycle = { recordSignedTest: vi.fn() };
    const controller = new CircleGatewayWebhookController(
      verifier as never,
      escrow as never,
      lifecycle as never,
      { CIRCLE_GATEWAY_WEBHOOKS_ENABLED: false } as never,
    );

    await expect(
      controller.gateway(
        { rawBody: Buffer.from('tampered test') } as never,
        {
          subscriptionId: SUBSCRIPTION_ID,
          notificationId: NOTIFICATION_ID,
          notificationType: 'webhooks.test',
        },
        'circle-key-id',
        'invalid-signature',
      ),
    ).rejects.toMatchObject({ status: 401 });

    expect(lifecycle.recordSignedTest).not.toHaveBeenCalled();
    expect(escrow.ingestGatewayDepositFinalized).not.toHaveBeenCalled();
  });
});
