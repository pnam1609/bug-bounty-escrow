# syntax=docker/dockerfile:1.7

FROM ghcr.io/foundry-rs/foundry@sha256:8347b728d5d393dac1c018691b36f506d23b9dcd78341d40ea0fcb11c3a19cdd AS foundry

FROM node:22-bookworm-slim AS workspace-base

ENV CI=true
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

WORKDIR /workspace

FROM workspace-base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/blockchain/package.json packages/blockchain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS source

COPY . .

FROM foundry AS contracts-quality

WORKDIR /workspace/packages/contracts

COPY --from=source --chown=foundry:foundry /workspace /workspace

RUN forge fmt --check \
    && forge test \
    && forge --version > /tmp/contracts-quality.passed

FROM source AS quality

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=contracts-quality /tmp/contracts-quality.passed /tmp/contracts-quality.passed

RUN test -s /tmp/contracts-quality.passed
RUN pnpm lint
RUN pnpm typecheck
RUN pnpm exec turbo run test --filter='!@bug-bounty-escrow/contracts'

FROM source AS web-builder

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ARC_RPC_URL
ARG NEXT_PUBLIC_ARC_EXPLORER_URL
ARG NEXT_PUBLIC_ARC_CHAIN_ID
ARG NEXT_PUBLIC_USDC_ADDRESS
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_DEMO_MODE=false

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_ARC_RPC_URL=${NEXT_PUBLIC_ARC_RPC_URL}
ENV NEXT_PUBLIC_ARC_EXPLORER_URL=${NEXT_PUBLIC_ARC_EXPLORER_URL}
ENV NEXT_PUBLIC_ARC_CHAIN_ID=${NEXT_PUBLIC_ARC_CHAIN_ID}
ENV NEXT_PUBLIC_USDC_ADDRESS=${NEXT_PUBLIC_USDC_ADDRESS}
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
ENV NEXT_PUBLIC_DEMO_MODE=${NEXT_PUBLIC_DEMO_MODE}
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @bug-bounty-escrow/web... build

FROM node:22-bookworm-slim AS web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=web-builder --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-builder --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static

USER node

EXPOSE 3000

CMD ["node", "apps/web/server.js"]

FROM source AS api-builder

RUN pnpm --filter @bug-bounty-escrow/contracts build
RUN pnpm --filter @bug-bounty-escrow/api... build
RUN pnpm --filter @bug-bounty-escrow/api deploy --prod --legacy /opt/api
RUN install -D -m 0444 \
    /workspace/packages/contracts/artifacts/BountyEscrow.v1.json \
    /opt/api/packages/contracts/artifacts/BountyEscrow.v1.json \
    && install -D -m 0444 \
    /workspace/packages/contracts/artifacts/BountyEscrowAdmin.v1.json \
    /opt/api/packages/contracts/artifacts/BountyEscrowAdmin.v1.json \
    && test -s /opt/api/packages/contracts/artifacts/BountyEscrow.v1.json

FROM node:22-bookworm-slim AS api

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY --from=api-builder --chown=node:node /opt/api ./

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]

FROM source AS migrations-builder

RUN pnpm --filter @bug-bounty-escrow/database deploy --prod --legacy /opt/migrations

FROM node:22-bookworm-slim AS migrations

ENV NODE_ENV=production

WORKDIR /app

COPY --from=migrations-builder --chown=node:node /opt/migrations ./

USER node

ENTRYPOINT ["node", "scripts/migrate.mjs"]
