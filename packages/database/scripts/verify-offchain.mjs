import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { migrateAndResetDemo } from './reset-demo.mjs';

const packageDirectory = new URL('../', import.meta.url);
const migrationDirectory = new URL('migrations/', packageDirectory);
const schemaVerificationPath = new URL(
  'tests/backend-foundation/verify_schema.sql',
  packageDirectory,
);
const verificationPath = new URL('tests/offchain/verify_rls.sql', packageDirectory);
const workflowVerificationPath = new URL('tests/offchain/verify_workflows.sql', packageDirectory);
const escrowRecoveryVerificationPath = new URL(
  'tests/offchain/verify_escrow_recovery.sql',
  packageDirectory,
);
const walletControlVerificationPath = new URL(
  'tests/offchain/verify_wallet_control_and_withdrawal_gate.sql',
  packageDirectory,
);
const rewardSettlementVerificationPath = new URL(
  'tests/offchain/verify_reward_settlement.sql',
  packageDirectory,
);
const gatewaySubscriptionVerificationPath = new URL(
  'tests/offchain/verify_gateway_subscription_lifecycle.sql',
  packageDirectory,
);
const securityBoundaryMigration = '20260729000300_sec_prod_banned_auth_rls.sql';
// The core-schema suite asserts DB-001..DB-004 in isolation, so it needs its own database.
const coreSchemaMigrations = [
  '20260725000100_db_001_profiles.sql',
  '20260725000200_db_002_programs.sql',
  '20260725000300_db_003_program_scopes.sql',
  '20260725000400_db_004_program_reward_tiers.sql',
];
const coreVerificationPath = new URL('tests/core-schema/verify_core_schema.sql', packageDirectory);
const bootstrapSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    encrypted_password text,
    banned_until timestamp with time zone,
    updated_at timestamp with time zone not null default now(),
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null,
    owner_id text,
    created_at timestamp with time zone not null default now()
  );
  alter table storage.objects enable row level security;
`;

function loadSql(url) {
  return readFileSync(url, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const schemaVerificationSql = loadSql(schemaVerificationPath);
const verificationSql = loadSql(verificationPath);
const workflowVerificationSql = loadSql(workflowVerificationPath);
const escrowRecoveryVerificationSql = loadSql(escrowRecoveryVerificationPath);
const walletControlVerificationSql = loadSql(walletControlVerificationPath);
const rewardSettlementVerificationSql = loadSql(rewardSettlementVerificationPath);
const gatewaySubscriptionVerificationSql = loadSql(gatewaySubscriptionVerificationPath);
let verificationFailed = false;

{
  const coreDatabase = new PGlite();
  let coreFile = 'Supabase compatibility bootstrap';

  try {
    await coreDatabase.exec(bootstrapSql);

    for (const migration of coreSchemaMigrations) {
      coreFile = migration;
      await coreDatabase.exec(loadSql(new URL(migration, migrationDirectory)));
    }

    coreFile = 'verify_core_schema.sql';
    await coreDatabase.exec(loadSql(coreVerificationPath));
    process.stdout.write('Core-schema verification: passed\n');
  } catch (error) {
    process.stderr.write(`Core-schema verification failed in ${coreFile}\n${String(error)}\n`);
    verificationFailed = true;
  } finally {
    await coreDatabase.close();
  }
}

for (let pass = 1; pass <= 2 && !verificationFailed; pass += 1) {
  const database = new PGlite();
  let currentFile = 'Supabase compatibility bootstrap';

  try {
    await database.exec(bootstrapSql);

    for (const migration of migrations) {
      currentFile = migration;
      const migrationSql = loadSql(new URL(migration, migrationDirectory));

      if (migration === securityBoundaryMigration && pass === 1) {
        await database.exec('begin; alter table storage.objects disable row level security;');
        let rejectedUnsafeStorage = false;
        try {
          await database.exec(migrationSql);
        } catch (error) {
          rejectedUnsafeStorage = String(error).includes(
            'Storage RLS security boundary is unavailable',
          );
        } finally {
          await database.exec('rollback;');
        }

        if (!rejectedUnsafeStorage) {
          throw new Error('SEC-PROD-001 accepted storage.objects without RLS');
        }
      }

      await database.exec(migrationSql);
    }

    /*
     * Only `storage` is granted here. The `public` grants used to live in this block too, which
     * meant the harness handed `service_role` the access the migrations had forgotten to declare —
     * every test passed while a real deployment got 42501 on the first select. They now come from
     * 20260725002300_service_role_grants.sql, so removing that migration fails this run.
     *
     * `storage` stays because the schema here is a shim invented by `compatibilityBootstrap`; a
     * real Supabase project grants it through its own default ACLs, and a migration that assumed
     * ownership of `storage.objects` would fail against a hosted project.
     */
    await database.exec(`
      grant all on all tables in schema storage to service_role;
      grant usage on schema storage to service_role;
      grant usage on schema storage to authenticated;
      grant select, insert, update, delete on storage.objects to authenticated;
    `);
    currentFile = 'verify_schema.sql';
    await database.exec(schemaVerificationSql);
    currentFile = 'verify_rls.sql';
    await database.exec(verificationSql);
    currentFile = 'seeds/offchain-demo.sql';
    await migrateAndResetDemo(database);
    await migrateAndResetDemo(database);
    const seedCounts = await database.query(`
      select
        (select count(*)::integer from auth.users where id::text like '30000000-%') as users,
        (select count(*)::integer from public.programs where id::text like '31000000-%') as programs,
        (select count(*)::integer from public.reports where id::text like '33000000-%') as reports,
        (select count(*)::integer from public.report_comments where id::text like '34000000-%') as comments,
        (select count(*)::integer from public.report_reviews where id::text like '35000000-%') as reviews,
        (select count(*)::integer from public.report_attachments where report_id::text like '33000000-%') as attachments,
        (select count(*)::integer from public.ai_triage_results where report_id::text like '33000000-%') as triage,
        (select count(*)::integer from public.notifications where recipient_id::text like '30000000-%') as notifications
    `);
    const counts = seedCounts.rows[0];
    if (
      counts?.users !== 7 ||
      counts.programs !== 10 ||
      counts.reports !== 60 ||
      counts.comments !== 60 ||
      counts.reviews !== 52 ||
      counts.attachments !== 36 ||
      counts.triage !== 52 ||
      counts.notifications !== 112
    ) {
      throw new Error(`Unexpected idempotent demo seed counts: ${JSON.stringify(counts)}`);
    }
    currentFile = 'verify_workflows.sql';
    await database.exec(workflowVerificationSql);
    currentFile = 'verify_wallet_control_and_withdrawal_gate.sql';
    await database.exec(walletControlVerificationSql);
    currentFile = 'verify_escrow_recovery.sql';
    await database.exec(escrowRecoveryVerificationSql);
    currentFile = 'verify_gateway_subscription_lifecycle.sql';
    await database.exec(gatewaySubscriptionVerificationSql);
    currentFile = 'verify_reward_settlement.sql';
    await database.exec(rewardSettlementVerificationSql);
    process.stdout.write(`Off-chain database verification pass ${pass}: passed\n`);
  } catch (error) {
    const databaseDetail =
      error && typeof error === 'object'
        ? `\nposition=${String(error.position ?? '')} internal=${String(error.internalPosition ?? '')} detail=${String(error.detail ?? '')} where=${String(error.where ?? '')}`
        : '';
    process.stderr.write(
      `Off-chain database verification pass ${pass} failed in ${currentFile}\n${String(error)}${databaseDetail}\n`,
    );
    verificationFailed = true;
    break;
  } finally {
    await database.close();
  }
}

if (verificationFailed) {
  process.exit(1);
}

process.stdout.write(
  `Verified ${migrations.length} migrations twice from ${fileURLToPath(migrationDirectory)}\n`,
);
