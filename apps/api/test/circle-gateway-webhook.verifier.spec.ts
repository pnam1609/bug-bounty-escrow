import { generateKeyPairSync, sign } from 'node:crypto';

import { parseApiEnvironment } from '@bug-bounty-escrow/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CircleGatewayWebhookVerifier } from '../src/escrow/circle-gateway-webhook.verifier.js';

const KEY_ID = '31000000-0000-4000-8000-000000000001';

function config(webhooksEnabled = true) {
  return parseApiEnvironment({
    NODE_ENV: 'test',
    WEB_APP_ORIGIN: 'https://web.example.test',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ARC_RPC_URL: 'https://rpc.example.test',
    ARC_CHAIN_ID: '5042002',
    USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
    CIRCLE_GATEWAY_WEBHOOKS_ENABLED: String(webhooksEnabled),
    CIRCLE_API_KEY: 'api-key',
    CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: KEY_ID,
    AI_PROVIDER: 'disabled',
    LOG_LEVEL: 'silent',
  });
}

describe('CircleGatewayWebhookVerifier', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('verifies the exact raw bytes and rejects whitespace/key-order mutation', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const lookup = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: KEY_ID,
            algorithm: 'ECDSA_SHA_256',
            publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', lookup);
    const exact = Buffer.from('{"a":1,"b":2}');
    const signature = sign('sha256', exact, privateKey).toString('base64');
    const verifier = new CircleGatewayWebhookVerifier(config());
    await expect(verifier.verify(exact, KEY_ID, signature)).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith(
      expect.stringContaining(`/v2/notifications/publicKey/${KEY_ID}`),
      expect.objectContaining({
        headers: expect.objectContaining({ 'user-agent': 'bounty-escrow-api/cp13' }),
      }),
    );
    await expect(
      verifier.verify(Buffer.from('{ "b":2,"a":1 }'), KEY_ID, signature),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('fails closed for a bad key id or signature', async () => {
    const verifier = new CircleGatewayWebhookVerifier(config());
    await expect(verifier.verify(Buffer.from('{}'), 'not-a-key', 'bad')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('still verifies the exact Circle signature while business webhooks are disabled', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              id: KEY_ID,
              algorithm: 'ECDSA_SHA_256',
              publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const exact = Buffer.from('{"notificationType":"webhooks.test"}');
    const signature = sign('sha256', exact, privateKey).toString('base64');
    const verifier = new CircleGatewayWebhookVerifier(config(false));

    await expect(verifier.verify(exact, KEY_ID, signature)).resolves.toBeUndefined();
    await expect(
      verifier.verify(
        Buffer.from('{"notificationType":"gateway.deposit.finalized"}'),
        KEY_ID,
        signature,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it.each([400, 404])(
    'briefly negative-caches authoritative HTTP %s unknown-key responses',
    async (status) => {
      const lookup = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal('fetch', lookup);
      const verifier = new CircleGatewayWebhookVerifier(config());
      await expect(verifier.verify(Buffer.from('{}'), KEY_ID, 'YWJj')).rejects.toMatchObject({
        status: 401,
      });
      await expect(verifier.verify(Buffer.from('{}'), KEY_ID, 'YWJj')).rejects.toMatchObject({
        status: 401,
      });
      expect(lookup).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 429, 500])(
    'keeps HTTP %s key lookup failures retryable instead of negative-caching them',
    async (status) => {
      const lookup = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal('fetch', lookup);
      const verifier = new CircleGatewayWebhookVerifier(config());
      await expect(verifier.verify(Buffer.from('{}'), KEY_ID, 'YWJj')).rejects.toMatchObject({
        status: 503,
      });
      await expect(verifier.verify(Buffer.from('{}'), KEY_ID, 'YWJj')).rejects.toMatchObject({
        status: 503,
      });
      expect(lookup).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds outbound lookups when an attacker rotates valid-looking UUID key ids', async () => {
    const lookup = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', lookup);
    const verifier = new CircleGatewayWebhookVerifier(config());
    for (let index = 0; index < 16; index += 1) {
      const keyId = `31000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
      await expect(verifier.verify(Buffer.from('{}'), keyId, 'YWJj')).rejects.toMatchObject({
        status: 503,
        message: 'circle_webhook_key_lookup_failed',
      });
    }

    await expect(
      verifier.verify(Buffer.from('{}'), '31000000-0000-4000-8000-000000000999', 'YWJj'),
    ).rejects.toMatchObject({
      status: 503,
      message: 'circle_webhook_key_lookup_budget_exhausted',
    });
    expect(lookup).toHaveBeenCalledTimes(16);
  });
});
