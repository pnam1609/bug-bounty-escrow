#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/bounty-escrow}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.production}"

: "${API_IMAGE:?API_IMAGE is required}"
: "${WEB_IMAGE:?WEB_IMAGE is required}"
: "${MIGRATIONS_IMAGE:?MIGRATIONS_IMAGE is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"

docker compose \
  --project-directory "${APP_DIR}" \
  --file "${COMPOSE_FILE}" \
  --env-file "${ENV_FILE}" \
  exec -T api node --input-type=module - <<'NODE'
const expectedSubscriptionId = '39f66f5f-600d-4efa-9d99-a725c0af80f8';
const ids = (process.env.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
let apiHealthy = false;
try {
  const health = await fetch('http://127.0.0.1:3001/api/health', {
    signal: AbortSignal.timeout(10_000),
  });
  apiHealthy = health.ok;
} catch {
  apiHealthy = false;
}
const status = {
  apiHealthy,
  contractsEnabled: process.env.CIRCLE_CONTRACTS_ENABLED === 'true',
  webhooksEnabled: process.env.CIRCLE_GATEWAY_WEBHOOKS_ENABLED === 'true',
  apiKeyPresent: Boolean(process.env.CIRCLE_API_KEY),
  entitySecretPresent: Boolean(process.env.CIRCLE_ENTITY_SECRET),
  deploymentWalletIdPresent: Boolean(process.env.CIRCLE_DEPLOYMENT_WALLET_ID),
  subscriptionIdCount: ids.length,
  subscriptionIdMatches: ids.length === 1 && ids[0] === expectedSubscriptionId,
};
console.log(JSON.stringify(status));
if (
  !status.apiHealthy ||
  !status.contractsEnabled ||
  !status.webhooksEnabled ||
  !status.apiKeyPresent ||
  !status.entitySecretPresent ||
  !status.deploymentWalletIdPresent ||
  status.subscriptionIdCount !== 1 ||
  !status.subscriptionIdMatches
) {
  throw new Error('Circle phase-2 runtime configuration smoke failed');
}

const receiptStartedAt = new Date(Date.now() - 2_000).toISOString();
let testResponse;
try {
  testResponse = await fetch(
    `https://api.circle.com/v2/notifications/subscriptions/permissionless/${expectedSubscriptionId}/test`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
        'content-type': 'application/json',
        'user-agent': 'bounty-escrow-api/cp13',
        'x-request-id': crypto.randomUUID(),
      },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    },
  );
} catch {
  throw new Error('Circle signed test request was unavailable');
}
if (testResponse.status !== 204) {
  throw new Error(`Circle signed test request returned HTTP ${testResponse.status}`);
}

const { createClient } = await import('@supabase/supabase-js');
const database = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
let receiptPersisted = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const result = await database
    .from('circle_gateway_webhook_tests')
    .select('notification_id', { count: 'exact', head: true })
    .eq('subscription_id', expectedSubscriptionId)
    .gte('received_at', receiptStartedAt)
    .abortSignal(AbortSignal.timeout(5_000));
  if (result.error !== null) {
    throw new Error('Signed test receipt verification query failed');
  }
  if ((result.count ?? 0) > 0) {
    receiptPersisted = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
console.log(JSON.stringify({ signedTestReceiptPersisted: receiptPersisted }));
if (!receiptPersisted) {
  throw new Error('Fresh signed test receipt was not persisted');
}
NODE
