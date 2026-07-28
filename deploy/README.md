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
