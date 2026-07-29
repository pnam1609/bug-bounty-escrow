#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/bounty-escrow}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.production}"
STATE_FILE="${STATE_FILE:-${APP_DIR}/.deployment.env}"
PULL_IMAGES="${PULL_IMAGES:-true}"

: "${IMAGE_NAMESPACE:?IMAGE_NAMESPACE is required, for example bbe-local}"
: "${IMAGE_TAG:?IMAGE_TAG is required, normally the Git commit SHA}"

export API_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-api"
export WEB_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-web"
export MIGRATIONS_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-migrations"
export IMAGE_TAG
export ENV_FILE

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  printf 'Compose file not found: %s\n' "${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Production environment file not found: %s\n' "${ENV_FILE}" >&2
  exit 1
fi

previous_tag=''
if [[ -f "${STATE_FILE}" ]]; then
  previous_tag="$(sed -n 's/^IMAGE_TAG=//p' "${STATE_FILE}" | head -n 1)"
fi

compose() {
  docker compose \
    --project-directory "${APP_DIR}" \
    --file "${COMPOSE_FILE}" \
    --env-file "${ENV_FILE}" \
    "$@"
}

rollback() {
  local exit_code=$?

  if [[ -n "${previous_tag}" && "${previous_tag}" != "${IMAGE_TAG}" ]]; then
    printf 'Deployment failed; restoring application images tagged %s\n' "${previous_tag}" >&2
    export IMAGE_TAG="${previous_tag}"
    compose up --detach --remove-orphans --wait api web || true
  fi

  exit "${exit_code}"
}

compose config --quiet

if [[ "${PULL_IMAGES}" == 'true' ]]; then
  compose pull api web migrate
elif [[ "${PULL_IMAGES}" == 'false' ]]; then
  docker image inspect \
    "${API_IMAGE}:${IMAGE_TAG}" \
    "${WEB_IMAGE}:${IMAGE_TAG}" \
    "${MIGRATIONS_IMAGE}:${IMAGE_TAG}" \
    >/dev/null
else
  printf 'PULL_IMAGES must be true or false\n' >&2
  exit 1
fi

printf 'Validating the new API image and production configuration\n'
compose run --rm --no-deps api node dist/config/validate-production.js

printf 'Applying database migrations for %s\n' "${IMAGE_TAG}"
compose run --rm migrate

printf 'Starting application images for %s\n' "${IMAGE_TAG}"
trap rollback ERR
compose up --detach --remove-orphans --wait api web

state_tmp="${STATE_FILE}.tmp"
printf 'IMAGE_NAMESPACE=%s\nIMAGE_TAG=%s\n' "${IMAGE_NAMESPACE}" "${IMAGE_TAG}" >"${state_tmp}"
mv "${state_tmp}" "${STATE_FILE}"

trap - ERR

printf 'Deployment %s is healthy\n' "${IMAGE_TAG}"
