import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';

import pg from 'pg';

import { compatibilityBootstrap } from './compatibility-bootstrap.mjs';

/*
 * Applies `migrations/` to a real PostgreSQL over a connection string.
 *
 * The PGlite harness in `verify-migrations.mjs` proves the migrations are correct, but it throws
 * the database away each run and cannot serve an HTTP client. This runner is what puts the same
 * SQL into a database the API can actually talk to — local Supabase, a hosted project, or bare
 * PostgreSQL — without a second copy of the migrations drifting away from the tested ones.
 *
 * Usage:
 *   node scripts/migrate.mjs --seed
 *   DATABASE_URL=postgresql://… node scripts/migrate.mjs
 */

const packageDirectory = new URL('../', import.meta.url);
const migrationDirectory = new URL('migrations/', packageDirectory);

/** Same as `reset-demo.mjs`: psql meta-commands are not SQL and the driver would choke on them. */
function loadSql(url) {
  return readFileSync(url, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

export function migrationFiles() {
  return readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * Supabase ships `auth`, `storage` and the three roles already. Bare PostgreSQL does not, and the
 * migrations assume they exist, so the shim runs only where something is actually missing —
 * running it on Supabase would fail on `create role anon`.
 */
export async function ensureCompatibilityLayer(client) {
  const { rows } = await client.query(`
    select
      to_regclass('auth.users') is not null as has_auth_users,
      exists (select 1 from pg_roles where rolname = 'authenticated') as has_roles
  `);

  if (rows[0].has_auth_users && rows[0].has_roles) return false;

  await client.query(compatibilityBootstrap);
  return true;
}

async function ensureLedger(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamp with time zone not null default now()
    )
  `);
  const { rows } = await client.query('select version from public.schema_migrations');
  return new Set(rows.map((row) => row.version));
}

export async function migrate(client, { seed = false, log = () => {} } = {}) {
  if (await ensureCompatibilityLayer(client)) {
    log('applied the Supabase compatibility shim (bare PostgreSQL target)');
  }

  const applied = await ensureLedger(client);
  let count = 0;

  for (const version of migrationFiles()) {
    if (applied.has(version)) continue;

    /*
     * One transaction per migration: a half-applied file would leave the ledger honest but the
     * schema wrong, which is far harder to recover from than a clean failure.
     */
    await client.query('begin');
    try {
      await client.query(loadSql(new URL(version, migrationDirectory)));
      await client.query('insert into public.schema_migrations (version) values ($1)', [version]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`migration ${version} failed: ${error.message}`, { cause: error });
    }

    count += 1;
    log(`applied ${version}`);
  }

  log(count === 0 ? 'schema already up to date' : `applied ${String(count)} migration(s)`);

  if (seed) {
    const { seedDemoData } = await import('./seed-demo.mjs');
    await seedDemoData(client, { log });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === '') {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(client, {
      seed: process.argv.includes('--seed'),
      log: (message) => process.stdout.write(`${message}\n`),
    });
  } finally {
    await client.end();
  }
}
