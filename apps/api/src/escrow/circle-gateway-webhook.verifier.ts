import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

import { API_CONFIG } from '../config/api-config.module.js';

interface CirclePublicKeyResponse {
  data?: { id?: unknown; algorithm?: unknown; publicKey?: unknown };
}

interface CachedKey {
  readonly key: KeyObject;
  readonly expiresAt: number;
}

const POSITIVE_CACHE_TTL_MS = 10 * 60_000;
const NEGATIVE_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;
const UNKNOWN_KEY_LOOKUP_WINDOW_MS = 60_000;
const MAX_UNKNOWN_KEY_LOOKUPS_PER_WINDOW = 16;

@Injectable()
export class CircleGatewayWebhookVerifier {
  private readonly keys = new Map<string, CachedKey>();
  private readonly unknownKeys = new Map<string, number>();
  private unknownLookupWindowStartedAt = Date.now();
  private unknownLookupCount = 0;

  public constructor(@Inject(API_CONFIG) private readonly config: ApiEnvironment) {}

  public async verify(
    rawBody: Buffer,
    keyId: string | undefined,
    signature: string | undefined,
  ): Promise<void> {
    if (!this.config.CIRCLE_GATEWAY_WEBHOOKS_ENABLED) {
      throw new ServiceUnavailableException('circle_gateway_webhooks_disabled');
    }
    if (
      keyId === undefined ||
      signature === undefined ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(keyId) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
    ) {
      throw new UnauthorizedException('circle_webhook_signature_invalid');
    }
    const key = await this.getKey(keyId);
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();
    if (!verifier.verify(key, Buffer.from(signature, 'base64'))) {
      throw new UnauthorizedException('circle_webhook_signature_invalid');
    }
  }

  private async getKey(keyId: string): Promise<KeyObject> {
    this.pruneCaches();
    const cached = this.keys.get(keyId);
    if (cached !== undefined) return cached.key;
    const unknownUntil = this.unknownKeys.get(keyId);
    if (unknownUntil !== undefined) {
      if (unknownUntil > Date.now()) throw new UnauthorizedException('circle_webhook_key_unknown');
      this.unknownKeys.delete(keyId);
    }
    if (this.config.CIRCLE_API_KEY === undefined) {
      throw new ServiceUnavailableException('circle_webhook_key_lookup_unconfigured');
    }
    this.consumeUnknownKeyLookupBudget();
    let response: Response;
    try {
      response = await fetch(
        `${this.config.CIRCLE_API_BASE_URL}/v2/notifications/publicKey/${keyId}`,
        {
          headers: {
            authorization: `Bearer ${this.config.CIRCLE_API_KEY}`,
            // Circle currently rejects the runtime default Node fetch user-agent
            // for this endpoint. Keep this aligned with the Circle SDK clients.
            'user-agent': 'bounty-escrow-api/cp13',
          },
          signal: AbortSignal.timeout(this.config.CIRCLE_REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ServiceUnavailableException('circle_webhook_key_lookup_failed');
    }
    if (!response.ok) {
      // Circle documents 400 and 404 as authoritative unknown/invalid key
      // responses. Authentication, throttling and server failures stay retryable.
      if (response.status === 400 || response.status === 404) {
        this.setBounded(this.unknownKeys, keyId, Date.now() + NEGATIVE_CACHE_TTL_MS);
        throw new UnauthorizedException('circle_webhook_key_unknown');
      }
      throw new ServiceUnavailableException('circle_webhook_key_lookup_failed');
    }
    const body = (await response.json()) as CirclePublicKeyResponse;
    if (
      body.data?.id !== keyId ||
      body.data.algorithm !== 'ECDSA_SHA_256' ||
      typeof body.data.publicKey !== 'string'
    ) {
      throw new UnauthorizedException('circle_webhook_key_invalid');
    }
    let key: KeyObject;
    try {
      key = createPublicKey({
        key: Buffer.from(body.data.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });
    } catch {
      throw new UnauthorizedException('circle_webhook_key_invalid');
    }
    this.setBounded(this.keys, keyId, {
      key,
      expiresAt: Date.now() + POSITIVE_CACHE_TTL_MS,
    });
    return key;
  }

  private pruneCaches(): void {
    const now = Date.now();
    for (const [id, cached] of this.keys) {
      if (cached.expiresAt <= now) this.keys.delete(id);
    }
    for (const [id, expiresAt] of this.unknownKeys) {
      if (expiresAt <= now) this.unknownKeys.delete(id);
    }
  }

  private consumeUnknownKeyLookupBudget(): void {
    const now = Date.now();
    if (now - this.unknownLookupWindowStartedAt >= UNKNOWN_KEY_LOOKUP_WINDOW_MS) {
      this.unknownLookupWindowStartedAt = now;
      this.unknownLookupCount = 0;
    }
    if (this.unknownLookupCount >= MAX_UNKNOWN_KEY_LOOKUPS_PER_WINDOW) {
      throw new ServiceUnavailableException('circle_webhook_key_lookup_budget_exhausted');
    }
    this.unknownLookupCount += 1;
  }

  private setBounded<T>(cache: Map<string, T>, key: string, value: T): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
}
