import { hashSync } from 'bcryptjs';
import { URL } from 'node:url';

const LOCAL_DATABASE_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const REMOTE_DEMO_CONFIRMATION = 'SEED_REMOTE_DEMO_DATABASE';
const PRODUCTION_PREFLIGHT_ERROR = 'Production demo-identity safety preflight failed';
export const DEMO_PASSWORD = 'local-demo-password';
export const DEMO_PASSWORD_SALT = '$2b$10$abcdefghijklmnopqrstuu';

/**
 * Keep the existing local Supabase seed command convenient while making a
 * remote target an explicit, reviewable choice. Production is never a valid
 * demo-seed target, even with the remote-demo confirmation.
 */
export function assertDemoSeedTargetSafety(environment) {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Demo data cannot be seeded in production');
  }

  const connectionString = environment.DATABASE_URL;
  if (typeof connectionString !== 'string' || connectionString.trim() === '') {
    throw new Error('DATABASE_URL is required to seed demo data');
  }

  let hostname;
  try {
    hostname = new URL(connectionString).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL is invalid');
  }

  if (LOCAL_DATABASE_HOSTS.has(hostname)) {
    return;
  }

  if (
    ['demo', 'test'].includes(environment.DEMO_ENV) &&
    environment.DEMO_SEED_CONFIRM === REMOTE_DEMO_CONFIRMATION
  ) {
    return;
  }

  throw new Error(
    `Remote demo seeding requires DEMO_ENV=demo or test and DEMO_SEED_CONFIRM=${REMOTE_DEMO_CONFIRMATION}`,
  );
}

/**
 * Production migrations fail before making schema changes while a known local
 * demo identity can authenticate. The query returns one aggregate boolean and
 * never returns an email, credential, token, password hash, or user row.
 *
 * Any unavailable or unexpected Auth-schema result fails closed with the same
 * generic message so deployment logs cannot disclose database details.
 */
export async function assertProductionDemoIdentitySafety(client, environment) {
  if (environment.NODE_ENV !== 'production') {
    return;
  }

  try {
    const catalogResult = await client.query(`
      select
        pg_catalog.to_regclass('auth.users') is not null as has_auth_users,
        exists (
          select 1
          from pg_catalog.pg_roles
          where rolname = 'authenticated'
        ) as has_authenticated_role
    `);
    const catalog = catalogResult.rows[0];

    if (
      catalogResult.rows.length !== 1 ||
      typeof catalog?.has_auth_users !== 'boolean' ||
      typeof catalog.has_authenticated_role !== 'boolean'
    ) {
      throw new Error(PRODUCTION_PREFLIGHT_ERROR);
    }

    // A completely fresh bare PostgreSQL target is safe: migrate.mjs installs the compatibility
    // Auth/Storage shim immediately after this preflight. A half-present Auth catalog is neither
    // a fresh bare target nor a valid Supabase target, so fail closed instead of attempting a
    // bootstrap over an inconsistent security boundary.
    if (!catalog.has_auth_users && !catalog.has_authenticated_role) {
      return;
    }
    if (!catalog.has_auth_users || !catalog.has_authenticated_role) {
      throw new Error(PRODUCTION_PREFLIGHT_ERROR);
    }

    const deterministicDemoPasswordHash = hashSync(DEMO_PASSWORD, DEMO_PASSWORD_SALT);
    const result = await client.query(
      `
        select exists (
          select 1
          from auth.users
          where (
            id in (
              '30000000-0000-4000-8000-000000000001'::uuid,
              '30000000-0000-4000-8000-000000000002'::uuid,
              '30000000-0000-4000-8000-000000000003'::uuid,
              '30000000-0000-4000-8000-000000000004'::uuid,
              '30000000-0000-4000-8000-000000000005'::uuid,
              '30000000-0000-4000-8000-000000000006'::uuid,
              '30000000-0000-4000-8000-000000000007'::uuid
            )
            or lower(coalesce(email, '')) like '%@local.demo'
            or encrypted_password = $1
          )
          and (banned_until is null or banned_until <= now())
        ) as has_active_demo_identity
      `,
      [deterministicDemoPasswordHash],
    );

    if (
      result.rows.length !== 1 ||
      typeof result.rows[0]?.has_active_demo_identity !== 'boolean' ||
      result.rows[0].has_active_demo_identity
    ) {
      throw new Error(PRODUCTION_PREFLIGHT_ERROR);
    }
  } catch {
    throw new Error(PRODUCTION_PREFLIGHT_ERROR);
  }
}

export const productionSafetyTestConstants = Object.freeze({
  productionPreflightError: PRODUCTION_PREFLIGHT_ERROR,
  remoteDemoConfirmation: REMOTE_DEMO_CONFIRMATION,
});
