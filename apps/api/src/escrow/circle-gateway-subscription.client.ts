import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';
import { z } from 'zod';

import { API_CONFIG } from '../config/api-config.module.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const subscriptionSchema = z
  .object({
    id: z.string().uuid(),
    endpoint: z.string().url(),
    enabled: z.boolean(),
    notificationTypes: z.array(z.string()),
    addresses: z.array(addressSchema).max(50),
    domains: z.array(z.enum(['0', '3', '6', '26'])),
    environment: z.literal('TEST'),
  })
  .passthrough();
const subscriptionResponseSchema = z.object({ data: subscriptionSchema }).passthrough();
const connectionResponseSchema = z
  .object({ data: z.object({ statusCode: z.number().int() }).passthrough() })
  .passthrough();

export interface GatewaySubscription {
  readonly id: string;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly notificationTypes: readonly string[];
  readonly addresses: readonly string[];
  readonly domains: readonly string[];
  readonly environment: 'TEST';
}

export interface GatewaySubscriptionReconciliation {
  readonly changed: boolean;
  readonly subscription: GatewaySubscription;
}

export class GatewaySubscriptionProviderError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'GatewaySubscriptionProviderError';
  }
}

@Injectable()
export class CircleGatewaySubscriptionClient {
  private static readonly USER_AGENT = 'bounty-escrow-api/cp13';

  public constructor(@Inject(API_CONFIG) private readonly config: ApiEnvironment) {}

  public async reconcile(input: {
    subscriptionId: string;
    addresses: readonly string[];
    domains: readonly number[];
  }): Promise<GatewaySubscriptionReconciliation> {
    this.assertConfiguredSubscription(input.subscriptionId);
    const parsedAddresses = z.array(addressSchema).safeParse(input.addresses);
    if (!parsedAddresses.success) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_address_invalid', false);
    }
    const addresses = [
      ...new Set(parsedAddresses.data.map((address) => address.toLowerCase())),
    ].sort();
    if (addresses.length === 0) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_address_required', false);
    }
    if (addresses.length > 50) {
      throw new GatewaySubscriptionProviderError(
        'gateway_subscription_address_capacity_exceeded',
        false,
      );
    }
    const domains = [...new Set(input.domains)].sort((left, right) => left - right);
    if (domains.length === 0) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_domain_required', false);
    }
    if (domains.some((domain) => ![0, 3, 6, 26].includes(domain))) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_domain_invalid', false);
    }

    const current = await this.get(input.subscriptionId);
    this.assertStableSubscriptionIdentity(current);
    const currentAddresses = [
      ...new Set(current.addresses.map((address) => address.toLowerCase())),
    ].sort();
    const currentDomains = [...new Set(current.domains.map(Number))].sort(
      (left, right) => left - right,
    );
    const requiresPatch =
      !current.enabled ||
      current.notificationTypes.length !== 1 ||
      current.notificationTypes[0] !== 'gateway.deposit.finalized' ||
      !sameValues(addresses, currentAddresses) ||
      !sameValues(domains, currentDomains);

    if (requiresPatch) {
      await this.request(
        `/v2/notifications/subscriptions/permissionless/${input.subscriptionId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            environment: 'TEST',
            enabled: true,
            notificationTypes: ['gateway.deposit.finalized'],
            addresses,
            domains: domains.map(String),
          }),
        },
        [200],
      );
    }

    const verified = await this.get(input.subscriptionId);
    this.assertStableSubscriptionIdentity(verified);
    const verifiedAddresses = [
      ...new Set(verified.addresses.map((address) => address.toLowerCase())),
    ].sort();
    const verifiedDomains = [...new Set(verified.domains.map(Number))].sort(
      (left, right) => left - right,
    );
    if (
      !sameValues(addresses, verifiedAddresses) ||
      !sameValues(domains, verifiedDomains) ||
      !verified.enabled ||
      verified.notificationTypes.length !== 1 ||
      verified.notificationTypes[0] !== 'gateway.deposit.finalized'
    ) {
      throw new GatewaySubscriptionProviderError(
        'gateway_subscription_remote_verification_failed',
        true,
      );
    }
    return { changed: requiresPatch, subscription: verified };
  }

  public async testConnection(subscriptionId: string): Promise<void> {
    this.assertConfiguredSubscription(subscriptionId);
    const response = await this.request(
      `/v2/notifications/subscriptions/permissionless/${subscriptionId}/testConnection`,
      { method: 'POST' },
      [200],
    );
    const parsed = connectionResponseSchema.safeParse(await this.readJson(response));
    if (!parsed.success || parsed.data.data.statusCode !== 200) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_endpoint_unreachable', true);
    }
  }

  public async sendSignedTestNotification(subscriptionId: string): Promise<void> {
    this.assertConfiguredSubscription(subscriptionId);
    await this.request(
      `/v2/notifications/subscriptions/permissionless/${subscriptionId}/test`,
      { method: 'POST' },
      [204],
    );
  }

  private async get(subscriptionId: string): Promise<GatewaySubscription> {
    const response = await this.request(
      `/v2/notifications/subscriptions/permissionless/${subscriptionId}`,
      { method: 'GET' },
      [200],
    );
    const parsed = subscriptionResponseSchema.safeParse(await this.readJson(response));
    if (!parsed.success) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_response_invalid', true);
    }
    return parsed.data.data;
  }

  private assertConfiguredSubscription(subscriptionId: string): void {
    if (
      this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS.length !== 1 ||
      this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS[0] !== subscriptionId
    ) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_not_allowlisted', false);
    }
  }

  private assertStableSubscriptionIdentity(subscription: GatewaySubscription): void {
    const expectedEndpoint = new URL(
      '/api/webhooks/circle/gateway',
      this.config.WEB_APP_ORIGIN,
    ).toString();
    if (
      subscription.id !== this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS[0] ||
      subscription.environment !== 'TEST' ||
      subscription.endpoint !== expectedEndpoint
    ) {
      throw new GatewaySubscriptionProviderError(
        'gateway_subscription_configuration_invalid',
        false,
      );
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    expectedStatuses: readonly number[],
  ): Promise<Response> {
    if (this.config.CIRCLE_API_KEY === undefined) {
      throw new GatewaySubscriptionProviderError('gateway_subscription_unconfigured', false);
    }
    const requestId = randomUUID();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.config.CIRCLE_API_BASE_URL}${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${this.config.CIRCLE_API_KEY}`,
            'content-type': 'application/json',
            'user-agent': CircleGatewaySubscriptionClient.USER_AGENT,
            'x-request-id': requestId,
            ...init.headers,
          },
          signal: AbortSignal.timeout(this.config.CIRCLE_REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (attempt < 2) {
          await this.sleep(this.backoffWithJitter(attempt));
          continue;
        }
        throw new GatewaySubscriptionProviderError('gateway_subscription_request_failed', true);
      }
      if (expectedStatuses.includes(response.status)) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 2) {
        await this.sleep(
          Math.min(
            parseRetryAfter(response.headers.get('retry-after')) ?? this.backoffWithJitter(attempt),
            this.config.CIRCLE_REQUEST_TIMEOUT_MS,
          ),
        );
        continue;
      }
      throw new GatewaySubscriptionProviderError(
        retryable ? 'gateway_subscription_request_failed' : 'gateway_subscription_request_rejected',
        retryable,
      );
    }
    throw new GatewaySubscriptionProviderError('gateway_subscription_request_failed', true);
  }

  private backoffWithJitter(attempt: number): number {
    return 250 * 2 ** attempt + Math.floor(Math.random() * 101);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GatewaySubscriptionProviderError('gateway_subscription_response_invalid', true);
    }
  }
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - Date.now());
}
