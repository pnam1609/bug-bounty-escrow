# Self-hosted production CI/CD

GitHub stores the source code and workflow definition only. A GitHub Actions
self-hosted runner installed on the production VPS performs every step:

```text
push to master
  -> GitHub queues the workflow
  -> VPS runner checks out the commit
  -> lint, typecheck, and tests run on the VPS
  -> VPS builds the three Docker images locally
  -> migrations run
  -> Docker Compose replaces the application containers
  -> health checks pass or the previous application images are restored
```

This setup consumes no GitHub-hosted runner minutes and does not require GHCR,
deployment SSH keys, or application secrets stored on GitHub. You still pay for
the VPS and are responsible for its disk usage, security, and maintenance.

## Production images

The VPS builds three immutable images tagged with the Git commit SHA:

- `bbe-local/bug-bounty-escrow-web`
- `bbe-local/bug-bounty-escrow-api`
- `bbe-local/bug-bounty-escrow-migrations`

Database migrations must remain backward-compatible with the previous
application version because an application rollback cannot undo a migration.

## 1. Prepare the VPS

Use a Linux VPS with:

- Git
- Docker Engine
- Docker Compose v2.20 or newer
- An existing host-level Nginx, Caddy, or another TLS reverse proxy

Create a dedicated non-root user named `bbe-deploy`. Give it access to Docker and
the application directory. Node.js and pnpm run inside the project's Docker
build stages and do not need to be installed on the host:

```sh
sudo useradd --create-home --shell /bin/bash bbe-deploy
sudo usermod --append --groups docker bbe-deploy
sudo install -d -o bbe-deploy -g bbe-deploy -m 750 /opt/bounty-escrow
```

Adding a user to the Docker group grants root-equivalent control of the host.
Do not allow untrusted users to modify workflows or push to the deployment
branch.

## 2. Store production configuration on the VPS

Two files live only on the VPS:

```text
/opt/bounty-escrow/public-build.env
/opt/bounty-escrow/.env.production
```

`public-build.env` contains browser-visible `NEXT_PUBLIC_*` values used while
building Next.js. Create it from `deploy/public-build.env.example`.

`.env.production` contains API and database secrets. Create it from
`deploy/production.env.example`.

```sh
sudo -u bbe-deploy install -m 600 \
  deploy/public-build.env.example \
  /opt/bounty-escrow/public-build.env

sudo -u bbe-deploy install -m 600 \
  deploy/production.env.example \
  /opt/bounty-escrow/.env.production
```

Replace every placeholder before the first deployment. The `DATABASE_URL`
account must be allowed to create and alter the application schema. Prefer the
direct or session-mode PostgreSQL URL from the production database provider.

### Add or rotate Circle server credentials from Windows

Run the credential helper from PowerShell 7. It prompts for both values without
displaying them and sends them only through SSH standard input. The VPS must
have `python3` available:

```powershell
.\deploy\set-circle-secrets.ps1 -SshTarget bbe-deploy@YOUR_VPS_HOST
```

The helper updates `/opt/bounty-escrow/.env.production` atomically, preserves
unrelated entries and comments, removes duplicate target keys, sets mode `600`,
and creates a mode-`600` backup under
`/opt/bounty-escrow/.env-backups`. Its output verifies key presence using
`<redacted>` placeholders and never prints the values. Use `-RemoteEnvPath` only
for another `.env*` file directly under `/opt/bounty-escrow`.

SSH public-key or agent authentication and an already trusted host key are
required: password prompts are disabled and strict host-key checking is
enforced. To validate the two inputs without contacting the VPS, add
`-ValidateOnly`. The script intentionally does not restart the API; recreate or
redeploy the API container in a controlled maintenance step so Docker reloads
the environment file.

### Bootstrap Circle Contracts and Gateway webhooks

Use this two-phase bootstrap only for Arc Testnet. It avoids a circular
dependency: Circle needs a public webhook endpoint before a subscription can be
created, while this API refuses signed webhook traffic until exactly one
subscription ID is allow-listed.

Circle's Gateway webhook limits are 20 subscriptions and 50 registered
addresses per developer account. This application deliberately uses **one
stable `TEST` subscription**, restricts it to
`gateway.deposit.finalized`, and enforces a maximum of 50 lower-case EVM owner
addresses. See the
[Gateway webhook guide](https://developers.circle.com/gateway/webhooks) and
[permissionless subscription API](https://developers.circle.com/api-reference/gateway/all/create-permissionless-subscription).

The supported testnet domain mapping is:

| Network          | Circle domain |
| ---------------- | ------------: |
| Ethereum Sepolia |           `0` |
| Arbitrum Sepolia |           `3` |
| Base Sepolia     |           `6` |
| Arc Testnet      |          `26` |

#### Phase 1: publish the endpoint with Circle disabled

Keep both feature flags disabled in
`/opt/bounty-escrow/.env.production`. Credentials may already be present, but
must not be printed:

```dotenv
CIRCLE_CONTRACTS_ENABLED=false
CIRCLE_GATEWAY_WEBHOOKS_ENABLED=false
CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS=
```

Deploy the new application image through the CI/CD workflow, then verify the
public endpoint and the API container:

```sh
curl --fail --head https://bountyescrow.xyz/api/webhooks/circle/gateway
curl --fail http://127.0.0.1:7831/api/health
```

`HEAD /api/webhooks/circle/gateway` must return `200`. A signed test notification
cannot pass yet: while webhooks are disabled, the signed `POST` endpoint
intentionally returns `503`; after webhooks are enabled it also requires the
subscription ID to be allow-listed.

#### Create exactly one TEST subscription

Load the API key without displaying it. First list existing TEST subscriptions
and stop if the target endpoint already has one: reuse and verify that stable
subscription instead of creating a duplicate.

```sh
CIRCLE_API_KEY="$(
  python3 -c '
import sys
key = "CIRCLE_API_KEY"
values = [
    line.split("=", 1)[1].strip()
    for line in open(sys.argv[1], encoding="utf-8")
    if line.startswith(key + "=")
]
if len(values) != 1 or not values[0]:
    raise SystemExit("Expected exactly one non-empty " + key)
print(values[0])
' /opt/bounty-escrow/.env.production
)"
export CIRCLE_API_KEY

curl --fail --silent --show-error \
  --url 'https://api.circle.com/v2/notifications/subscriptions/permissionless?environment=TEST' \
  --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
  --header 'User-Agent: bounty-escrow-api/cp13' |
python3 -c '
import json, sys
for item in json.load(sys.stdin)["data"]:
    print(item["id"], item["endpoint"], item["environment"], item["enabled"])
'
```

Choose one real lower-case owner EVM wallet address and the exact two or more
domains planned for the first Unified Balance funding intent. Using the same
address and domains avoids an unnecessary filter replacement when that intent
is first registered. The following example uses Ethereum Sepolia and Arbitrum
Sepolia; replace both bootstrap values before running it:

```sh
BOOTSTRAP_ADDRESS='0xreplace-with-40-lower-case-hex-characters'
BOOTSTRAP_DOMAINS_JSON='["0","3"]'

CREATE_PAYLOAD="$(
  BOOTSTRAP_ADDRESS="${BOOTSTRAP_ADDRESS}" \
  BOOTSTRAP_DOMAINS_JSON="${BOOTSTRAP_DOMAINS_JSON}" \
  python3 -c '
import json, os, re
address = os.environ["BOOTSTRAP_ADDRESS"]
domains = json.loads(os.environ["BOOTSTRAP_DOMAINS_JSON"])
if not re.fullmatch(r"0x[0-9a-f]{40}", address):
    raise SystemExit("BOOTSTRAP_ADDRESS must be a lower-case EVM address")
if len(set(domains)) < 2 or any(domain not in {"0", "3", "6", "26"} for domain in domains):
    raise SystemExit("Choose at least two unique supported TEST domains")
print(json.dumps({
    "environment": "TEST",
    "endpoint": "https://bountyescrow.xyz/api/webhooks/circle/gateway",
    "addresses": [address],
    "domains": sorted(set(domains), key=int),
    "name": "BountyEscrow Gateway deposits",
    "enabled": True,
    "notificationTypes": ["gateway.deposit.finalized"],
}))
'
)"

CREATE_RESPONSE="$(
  curl --fail --silent --show-error \
    --request POST \
    --url 'https://api.circle.com/v2/notifications/subscriptions/permissionless' \
    --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
    --header 'Content-Type: application/json' \
    --header 'User-Agent: bounty-escrow-api/cp13' \
    --data "${CREATE_PAYLOAD}"
)"

CIRCLE_SUBSCRIPTION_ID="$(
  printf '%s' "${CREATE_RESPONSE}" |
  python3 -c '
import json, sys, uuid
data = json.load(sys.stdin)["data"]
uuid.UUID(data["id"])
assert data["environment"] == "TEST"
assert data["endpoint"] == "https://bountyescrow.xyz/api/webhooks/circle/gateway"
assert data["enabled"] is True
assert data["notificationTypes"] == ["gateway.deposit.finalized"]
print(data["id"])
'
)"
printf 'Created Circle subscription %s\n' "${CIRCLE_SUBSCRIPTION_ID}"
```

Test public reachability. A successful response contains
`{"data":{"statusCode":200}}`:

```sh
curl --fail --silent --show-error \
  --request POST \
  --url "https://api.circle.com/v2/notifications/subscriptions/permissionless/${CIRCLE_SUBSCRIPTION_ID}/testConnection" \
  --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
  --header 'User-Agent: bounty-escrow-api/cp13' |
python3 -c '
import json, sys
assert json.load(sys.stdin)["data"]["statusCode"] == 200
print("Circle testConnection: 200")
'
```

Do not send the signed test notification during phase 1; the application is
still fail-closed.

#### Phase 2: allow-list, enable, and recreate the API

Open `/opt/bounty-escrow/.env.production` in an editor and set the following.
There must be exactly one subscription UUID: do not use a comma-separated
migration list.

```dotenv
CIRCLE_CONTRACTS_ENABLED=true
CIRCLE_GATEWAY_WEBHOOKS_ENABLED=true
CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS=replace-with-the-created-subscription-id
CIRCLE_API_KEY=replace-with-circle-api-key
CIRCLE_ENTITY_SECRET=replace-with-64-character-circle-entity-secret
CIRCLE_DEPLOYMENT_WALLET_ID=replace-with-circle-sca-wallet-uuid
```

Also verify the Arc Testnet values required by the production preflight:

```dotenv
ARC_CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

Run the CI/CD deployment again. If only the environment changed after a
successful image deployment, recreate the API explicitly so Docker reloads the
env file (a restart is insufficient):

```sh
set -a
. /opt/bounty-escrow/.deployment.env
set +a

export API_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-api"
export WEB_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-web"
export MIGRATIONS_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-migrations"
export ENV_FILE=/opt/bounty-escrow/.env.production

docker compose \
  --project-directory /opt/bounty-escrow \
  --file /opt/bounty-escrow/docker-compose.production.yml \
  --env-file /opt/bounty-escrow/.env.production \
  run --rm --no-deps api node dist/config/validate-production.js

docker compose \
  --project-directory /opt/bounty-escrow \
  --file /opt/bounty-escrow/docker-compose.production.yml \
  --env-file /opt/bounty-escrow/.env.production \
  up --detach --force-recreate --wait api
```

Verify that the running container received all settings without revealing their
values:

```sh
docker compose \
  --project-directory /opt/bounty-escrow \
  --file /opt/bounty-escrow/docker-compose.production.yml \
  --env-file /opt/bounty-escrow/.env.production \
  exec -T api node -e "
const env = process.env;
const ids = (env.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
console.log(JSON.stringify({
  contractsEnabled: env.CIRCLE_CONTRACTS_ENABLED === 'true',
  webhooksEnabled: env.CIRCLE_GATEWAY_WEBHOOKS_ENABLED === 'true',
  apiKeyPresent: Boolean(env.CIRCLE_API_KEY),
  entitySecretPresent: Boolean(env.CIRCLE_ENTITY_SECRET),
  deploymentWalletIdPresent: Boolean(env.CIRCLE_DEPLOYMENT_WALLET_ID),
  subscriptionIdCount: ids.length
}));
"
```

All five booleans must be `true` and `subscriptionIdCount` must be `1`.

Now send a Circle-signed test notification. `testConnection` must still return
`200`, and the signed-test request must return HTTP `204`:

```sh
CIRCLE_API_KEY="$(
  python3 -c '
import sys
key = "CIRCLE_API_KEY"
values = [
    line.split("=", 1)[1].strip()
    for line in open(sys.argv[1], encoding="utf-8")
    if line.startswith(key + "=")
]
if len(values) != 1 or not values[0]:
    raise SystemExit("Expected exactly one non-empty " + key)
print(values[0])
' /opt/bounty-escrow/.env.production
)"
CIRCLE_SUBSCRIPTION_ID="$(
  python3 -c '
import sys, uuid
key = "CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS"
values = [
    line.split("=", 1)[1].strip()
    for line in open(sys.argv[1], encoding="utf-8")
    if line.startswith(key + "=")
]
if len(values) != 1 or "," in values[0]:
    raise SystemExit("Expected exactly one " + key)
uuid.UUID(values[0])
print(values[0])
' /opt/bounty-escrow/.env.production
)"
export CIRCLE_API_KEY CIRCLE_SUBSCRIPTION_ID

curl --fail --silent --show-error \
  --request POST \
  --url "https://api.circle.com/v2/notifications/subscriptions/permissionless/${CIRCLE_SUBSCRIPTION_ID}/testConnection" \
  --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
  --header 'User-Agent: bounty-escrow-api/cp13' |
python3 -c '
import json, sys
assert json.load(sys.stdin)["data"]["statusCode"] == 200
print("Circle testConnection: 200")
'

curl --fail --silent --show-error \
  --request POST \
  --url "https://api.circle.com/v2/notifications/subscriptions/permissionless/${CIRCLE_SUBSCRIPTION_ID}/test" \
  --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
  --header 'User-Agent: bounty-escrow-api/cp13' \
  --output /dev/null \
  --write-out 'Circle signed test: HTTP %{http_code}\n'
```

The API also runs the same operational preflight after startup and every five
minutes. Confirm at least one successful maintenance cycle; this proves the
signed `webhooks.test` callback passed signature verification and was persisted,
not merely that Circle accepted the send request:

```sh
docker compose \
  --project-directory /opt/bounty-escrow \
  --file /opt/bounty-escrow/docker-compose.production.yml \
  --env-file /opt/bounty-escrow/.env.production \
  logs --since 10m api |
grep -F 'Circle Gateway subscription maintenance completed'
```

Finally, verify Circle's remote configuration. This prints only non-secret
subscription metadata and fails if the stable identity or event filter drifted:

```sh
curl --fail --silent --show-error \
  --url "https://api.circle.com/v2/notifications/subscriptions/permissionless/${CIRCLE_SUBSCRIPTION_ID}" \
  --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
  --header 'User-Agent: bounty-escrow-api/cp13' |
CIRCLE_SUBSCRIPTION_ID="${CIRCLE_SUBSCRIPTION_ID}" python3 -c '
import json, os, sys
data = json.load(sys.stdin)["data"]
assert data["id"] == os.environ["CIRCLE_SUBSCRIPTION_ID"]
assert data["environment"] == "TEST"
assert data["endpoint"] == "https://bountyescrow.xyz/api/webhooks/circle/gateway"
assert data["enabled"] is True
assert data["notificationTypes"] == ["gateway.deposit.finalized"]
assert 1 <= len(data["addresses"]) <= 50
assert data["domains"] and set(data["domains"]) <= {"0", "3", "6", "26"}
print(json.dumps({
    "id": data["id"],
    "environment": data["environment"],
    "endpoint": data["endpoint"],
    "enabled": data["enabled"],
    "notificationTypes": data["notificationTypes"],
    "addressCount": len(data["addresses"]),
    "domains": data["domains"],
}, indent=2))
'
```

#### Capacity and rollback

The database and reconciliation service use an append-only union of owner
addresses and domains. They do not automatically remove an address when a
funding intent or program finishes. Do not manually remove addresses from
Circle: a later reconciliation restores the durable desired set, and removing
one early can lose a finalization event. At 50 distinct owner addresses, new
Unified Balance intents fail closed with
`gateway_subscription_address_capacity_exceeded`. Resolve capacity with an
explicitly reviewed lifecycle or account architecture change; do not create a
second subscription because the current runtime requires exactly one.

If phase 2 fails:

1. Disable the Circle subscription so Circle stops delivery:

   ```sh
   curl --fail --silent --show-error \
     --request PATCH \
     --url "https://api.circle.com/v2/notifications/subscriptions/permissionless/${CIRCLE_SUBSCRIPTION_ID}" \
     --header "Authorization: Bearer ${CIRCLE_API_KEY}" \
     --header 'Content-Type: application/json' \
     --header 'User-Agent: bounty-escrow-api/cp13' \
     --data '{"environment":"TEST","enabled":false}' \
     --output /dev/null
   ```

2. Restore `CIRCLE_CONTRACTS_ENABLED=false`,
   `CIRCLE_GATEWAY_WEBHOOKS_ENABLED=false`, and
   `CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS=` in the VPS env file.
3. Recreate the API container. Restore the previous image tag with
   `deploy/deploy.sh` if the new image itself is unhealthy.
4. Keep the disabled stable subscription for retry. Once any registration is
   persisted, do not delete it or replace its ID.

The deploy script automatically restores the previous application image when a
new deployment fails health checks. Database migrations are not rolled back, so
they must remain backward-compatible.

## 3. Install the GitHub runner on the VPS

Open the GitHub repository and go to:

**Settings -> Actions -> Runners -> New self-hosted runner**

Select Linux and the VPS architecture. GitHub shows repository-specific
download and registration commands. Run those commands as the `bbe-deploy` user.
When running the displayed `config.sh` command, add the production label:

```sh
./config.sh \
  --url https://github.com/OWNER/REPOSITORY \
  --token ONE_TIME_TOKEN_FROM_GITHUB \
  --labels bbe-production \
  --unattended
```

The registration token is short-lived. Use the exact URL and token displayed by
GitHub rather than copying the placeholders above.

Install the runner as a service using the service commands included with the
runner:

```sh
sudo ./svc.sh install bbe-deploy
sudo ./svc.sh start
sudo ./svc.sh status
```

The runner must appear as **Idle** with these labels:

```text
self-hosted, Linux, bbe-production
```

Use this runner only for this private repository. Workflow code executes on the
VPS and can access Docker, so a malicious workflow has control of the server.

## 4. Configure the reverse proxy

The containers bind only to loopback:

- Web: `127.0.0.1:7830`
- API: `127.0.0.1:7831`

Do not expose these ports directly to the internet. The provided
`deploy/nginx-site.example` and `deploy/Caddyfile.example` route `/api/*` to
NestJS and everything else to Next.js on one HTTPS domain. Use the reverse
proxy already installed on the host; do not add Nginx or Caddy to the Docker
Compose project.

If the API uses a separate domain, update both `WEB_APP_ORIGIN` and
`NEXT_PUBLIC_API_BASE_URL`.

For Google OAuth, add the production web callback to the Supabase redirect
allow-list and configure the Supabase provider callback in Google Cloud.

## 5. Deploy

Push a commit to `master`, or manually run the **CI/CD** workflow from the Actions
tab. GitHub only queues and reports the job; all commands execute on the VPS.

The workflow expects:

```text
/opt/bounty-escrow/public-build.env
/opt/bounty-escrow/.env.production
```

No GitHub Actions secrets or repository variables are required for deployment.

Verify the deployment on the VPS:

```sh
docker compose \
  --project-directory /opt/bounty-escrow \
  --file /opt/bounty-escrow/docker-compose.production.yml \
  ps

curl --fail http://127.0.0.1:7831/api/health
curl --fail http://127.0.0.1:7830/
```

## Operations

Every commit creates three local image tags. Monitor disk space:

```sh
docker system df
```

Keep at least the current and previous commit tags for rollback. Remove older
project image tags during a maintenance window after confirming the running
deployment is healthy. Avoid broad automated prune commands on a VPS that hosts
other Docker projects.
