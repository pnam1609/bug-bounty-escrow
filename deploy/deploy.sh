#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/bounty-escrow}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.production}"
STATE_FILE="${STATE_FILE:-${APP_DIR}/.deployment.env}"
PULL_IMAGES="${PULL_IMAGES:-true}"
VERIFY_CIRCLE_PHASE2="${VERIFY_CIRCLE_PHASE2:-false}"
deployment_stage='initialization'
rollback_active=false

: "${IMAGE_NAMESPACE:?IMAGE_NAMESPACE is required, for example bbe-local}"
: "${IMAGE_TAG:?IMAGE_TAG is required, normally the Git commit SHA}"

export API_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-api"
export WEB_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-web"
export MIGRATIONS_IMAGE="${IMAGE_NAMESPACE}/bug-bounty-escrow-migrations"
export IMAGE_TAG
export ENV_FILE

mark_stage() {
  deployment_stage="$1"
  printf 'Deployment stage: %s\n' "${deployment_stage}"
}

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  printf 'Compose file not found: %s\n' "${COMPOSE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Production environment file not found: %s\n' "${ENV_FILE}" >&2
  exit 1
fi

if [[ "${VERIFY_CIRCLE_PHASE2}" == 'true' ]]; then
  if [[ ! -x "${APP_DIR}/verify-circle-phase2.sh" ]]; then
    printf 'Circle phase-2 verifier is not installed or executable\n' >&2
    exit 1
  fi
elif [[ "${VERIFY_CIRCLE_PHASE2}" != 'false' ]]; then
  printf 'VERIFY_CIRCLE_PHASE2 must be true or false\n' >&2
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

  printf '::error title=Deployment failed::stage=%s exit_code=%s\n' \
    "${deployment_stage}" "${exit_code}" >&2

  if [[ "${rollback_active}" == 'true' && -n "${previous_tag}" && "${previous_tag}" != "${IMAGE_TAG}" ]]; then
    printf 'Deployment failed; restoring application images tagged %s\n' "${previous_tag}" >&2
    export IMAGE_TAG="${previous_tag}"
    compose up --detach --remove-orphans --wait api web || true
  elif [[ "${rollback_active}" == 'true' && -z "${previous_tag}" ]]; then
    printf 'Deployment failed with no previous image tag; stopping failed application containers\n' >&2
    compose stop api web || true
  fi

  exit "${exit_code}"
}

trap rollback ERR

mark_stage compose_config
compose config --quiet

mark_stage image_inspect
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

mark_stage api_validation
printf 'Validating the new API image and production configuration\n'
compose run --rm --no-deps api node dist/config/validate-production.js

mark_stage migrations
printf 'Applying database migrations for %s\n' "${IMAGE_TAG}"
compose run --rm migrate

rollback_active=true
mark_stage application_start
printf 'Starting application images for %s\n' "${IMAGE_TAG}"
compose up --detach --remove-orphans --wait api web

if [[ "${VERIFY_CIRCLE_PHASE2}" == 'true' ]]; then
  mark_stage circle_verify
  printf 'Verifying Circle phase-2 runtime and signed receipt\n'
  APP_DIR="${APP_DIR}" \
  COMPOSE_FILE="${COMPOSE_FILE}" \
  ENV_FILE="${ENV_FILE}" \
    "${APP_DIR}/verify-circle-phase2.sh"
fi

mark_stage state
state_tmp="${STATE_FILE}.tmp"
printf 'IMAGE_NAMESPACE=%s\nIMAGE_TAG=%s\n' "${IMAGE_NAMESPACE}" "${IMAGE_TAG}" >"${state_tmp}"
mv "${state_tmp}" "${STATE_FILE}"

trap - ERR

printf 'Deployment %s is healthy\n' "${IMAGE_TAG}"
