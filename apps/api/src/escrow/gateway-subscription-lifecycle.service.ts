import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ApiEnvironment } from '@bug-bounty-escrow/shared';

import { API_CONFIG } from '../config/api-config.module.js';
import { AppLogger } from '../logging/app-logger.service.js';
import {
  CircleGatewaySubscriptionClient,
  GatewaySubscriptionProviderError,
} from './circle-gateway-subscription.client.js';
import {
  GATEWAY_SUBSCRIPTION_REGISTRATION_STORE,
  type GatewaySubscriptionRegistrationStore,
} from './gateway-subscription-registration.store.js';

const WAIT_INTERVAL_MS = 100;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const MAX_SYNC_LEASE_MS = 15 * 60_000;
const SYNC_LEASE_SAFETY_MARGIN_MS = 30_000;

/**
 * Reconcile performs GET/PATCH/GET. Each request can make three timed attempts
 * with two Retry-After waits, each bounded to the configured request timeout.
 */
export function gatewaySubscriptionSyncLeaseMs(requestTimeoutMs: number): number {
  const networkRequestBudgetMs = 3 * (3 * requestTimeoutMs + 2 * requestTimeoutMs);
  return Math.min(MAX_SYNC_LEASE_MS, networkRequestBudgetMs + SYNC_LEASE_SAFETY_MARGIN_MS);
}

@Injectable()
export class GatewaySubscriptionLifecycleService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private startupTimer: NodeJS.Timeout | undefined;
  private maintenanceTimer: NodeJS.Timeout | undefined;
  private maintenanceInFlight: Promise<void> | undefined;

  public constructor(
    @Inject(GATEWAY_SUBSCRIPTION_REGISTRATION_STORE)
    private readonly store: GatewaySubscriptionRegistrationStore,
    @Inject(CircleGatewaySubscriptionClient)
    private readonly client: CircleGatewaySubscriptionClient,
    @Inject(API_CONFIG) private readonly config: ApiEnvironment,
    @Inject(AppLogger) private readonly logger: AppLogger,
  ) {}

  /**
   * Bootstrap must never wait on Circle or on a webhook callback: Nest invokes
   * this hook before the HTTP listener is available. Source deposits are gated
   * synchronously by ensureIntentRegistered instead.
   */
  public onApplicationBootstrap(): void {
    if (!this.config.CIRCLE_GATEWAY_WEBHOOKS_ENABLED) return;
    this.startupTimer = setTimeout(() => {
      void this.runMaintenanceCoalesced();
    }, 0);
    this.startupTimer.unref();
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenanceCoalesced();
    }, MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref();
  }

  public onApplicationShutdown(): void {
    if (this.startupTimer !== undefined) clearTimeout(this.startupTimer);
    if (this.maintenanceTimer !== undefined) clearInterval(this.maintenanceTimer);
  }

  public async ensureIntentRegistered(intentId: string): Promise<void> {
    if (!this.config.CIRCLE_GATEWAY_WEBHOOKS_ENABLED) {
      throw new ConflictException('gateway_subscription_lifecycle_disabled');
    }
    const subscriptionId = this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS[0];
    if (subscriptionId === undefined) {
      throw new ConflictException('gateway_subscription_not_configured');
    }

    const syncLeaseMs = gatewaySubscriptionSyncLeaseMs(this.config.CIRCLE_REQUEST_TIMEOUT_MS);
    const deadline = Date.now() + syncLeaseMs * 2;
    while (Date.now() < deadline) {
      const leaseId = randomUUID();
      const prepared = await this.store.prepareRegistration({
        intentId,
        subscriptionId,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + syncLeaseMs).toISOString(),
      });
      if (!prepared.claimed) {
        await this.sleep(WAIT_INTERVAL_MS);
        continue;
      }

      try {
        const result = await this.client.reconcile({
          subscriptionId,
          addresses: prepared.addresses,
          domains: prepared.domains,
        });
        await this.store.completeSync({
          subscriptionId,
          leaseId,
          expectedRevision: prepared.revision,
          remoteAddresses: result.subscription.addresses,
          remoteDomains: result.subscription.domains.map(Number),
        });
      } catch (error) {
        const providerError = error instanceof GatewaySubscriptionProviderError ? error : undefined;
        await this.store.failSync({
          subscriptionId,
          leaseId,
          errorCode: providerError?.code ?? 'gateway_subscription_sync_failed',
          retryable: providerError?.retryable ?? true,
        });
        if (providerError?.retryable === false) {
          throw new ConflictException(providerError.code);
        }
        throw new ServiceUnavailableException(
          providerError?.code ?? 'gateway_subscription_sync_failed',
        );
      }

      if (await this.store.isIntentReady(intentId, subscriptionId)) return;
      try {
        await this.runOperationalPreflight(subscriptionId);
        if (await this.store.isIntentReady(intentId, subscriptionId)) return;
        throw new GatewaySubscriptionProviderError(
          'gateway_subscription_signed_test_not_ready',
          true,
        );
      } catch (error) {
        const providerError = error instanceof GatewaySubscriptionProviderError ? error : undefined;
        throw new ServiceUnavailableException(
          providerError?.code ?? 'gateway_subscription_signed_test_failed',
        );
      }
    }
    throw new ServiceUnavailableException('gateway_subscription_sync_timeout');
  }

  public async recordSignedTest(subscriptionId: string, notificationId: string): Promise<void> {
    if (!this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS.includes(subscriptionId)) {
      throw new ConflictException('gateway_subscription_not_allowlisted');
    }
    await this.store.recordSignedTest({
      subscriptionId,
      notificationId,
      receivedAt: new Date().toISOString(),
    });
  }

  public async runMaintenance(): Promise<void> {
    const subscriptionId = this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS[0];
    if (!this.config.CIRCLE_GATEWAY_WEBHOOKS_ENABLED || subscriptionId === undefined) return;

    let repairedIntentCount = 0;
    try {
      const intentIds = await this.store.listActiveUnifiedBalanceIntentIds();
      for (const intentId of intentIds) {
        try {
          await this.ensureIntentRegistered(intentId);
          repairedIntentCount += 1;
        } catch (error) {
          this.logger.errorEvent(
            { error, intentId, subscriptionId },
            'Circle Gateway subscription drift repair failed',
          );
        }
      }
      if (intentIds.length === 0) {
        await this.runOperationalPreflight(subscriptionId);
      }
      this.logger.info(
        { repairedIntentCount },
        'Circle Gateway subscription maintenance completed',
      );
    } catch (error) {
      this.logger.errorEvent(
        { error, subscriptionId },
        'Circle Gateway subscription maintenance failed',
      );
    }
  }

  public runMaintenanceCoalesced(): Promise<void> {
    if (this.maintenanceInFlight !== undefined) return this.maintenanceInFlight;
    const pass = this.runMaintenance();
    const observed = pass.finally(() => {
      if (this.maintenanceInFlight === observed) {
        this.maintenanceInFlight = undefined;
      }
    });
    this.maintenanceInFlight = observed;
    return observed;
  }

  private async runOperationalPreflight(subscriptionId: string): Promise<void> {
    await this.client.testConnection(subscriptionId);
    const startedAt = new Date().toISOString();
    await this.client.sendSignedTestNotification(subscriptionId);
    await this.waitForSignedTest(subscriptionId, startedAt);
  }

  private async waitForSignedTest(subscriptionId: string, startedAt: string): Promise<void> {
    const deadline = Date.now() + Math.min(this.config.CIRCLE_REQUEST_TIMEOUT_MS, 15_000);
    while (Date.now() < deadline) {
      if (await this.store.hasSignedTestAfter(subscriptionId, startedAt)) return;
      await this.sleep(WAIT_INTERVAL_MS);
    }
    throw new GatewaySubscriptionProviderError('gateway_subscription_signed_test_timeout', true);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
