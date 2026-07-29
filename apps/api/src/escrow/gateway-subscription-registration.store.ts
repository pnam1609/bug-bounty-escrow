export const GATEWAY_SUBSCRIPTION_REGISTRATION_STORE = Symbol(
  'GATEWAY_SUBSCRIPTION_REGISTRATION_STORE',
);

export interface PreparedGatewaySubscriptionRegistration {
  readonly claimed: boolean;
  readonly revision: number;
  readonly addresses: readonly string[];
  readonly domains: readonly number[];
}

/**
 * Durable coordination boundary for Circle Gateway subscription changes.
 *
 * Implementations must use database-backed claims/revisions. Process-local
 * mutexes are not sufficient because the API can run in multiple replicas.
 */
export interface GatewaySubscriptionRegistrationStore {
  listActiveUnifiedBalanceIntentIds(): Promise<readonly string[]>;
  prepareRegistration(input: {
    intentId: string;
    subscriptionId: string;
    leaseId: string;
    leaseExpiresAt: string;
  }): Promise<PreparedGatewaySubscriptionRegistration>;
  isIntentReady(intentId: string, subscriptionId: string): Promise<boolean>;
  completeSync(input: {
    subscriptionId: string;
    leaseId: string;
    expectedRevision: number;
    remoteAddresses: readonly string[];
    remoteDomains: readonly number[];
  }): Promise<void>;
  failSync(input: {
    subscriptionId: string;
    leaseId: string;
    errorCode: string;
    retryable: boolean;
  }): Promise<void>;
  recordSignedTest(input: {
    subscriptionId: string;
    notificationId: string;
    receivedAt: string;
  }): Promise<void>;
  hasSignedTestAfter(subscriptionId: string, startedAt: string): Promise<boolean>;
}
