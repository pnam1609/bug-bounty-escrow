import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const packageDirectory = new URL('../', import.meta.url);
const migrationsDirectory = new URL('migrations/', packageDirectory);
const runnerPath = new URL('tests/backend-foundation/apply-and-verify.sql', packageDirectory);

const expectedMigrations = [
  '20260725000100_db_001_profiles.sql',
  '20260725000200_db_002_programs.sql',
  '20260725000300_db_003_program_scopes.sql',
  '20260725000400_db_004_program_reward_tiers.sql',
  '20260725000410_db_004b_program_taxonomy.sql',
  '20260725000500_db_005_reports.sql',
  '20260725000550_db_005b_report_impacts.sql',
  '20260725000560_db_005c_report_disclosures.sql',
  '20260725000600_db_006_report_attachments.sql',
  '20260725000700_db_007_report_comments.sql',
  '20260725000800_db_008_report_reviews.sql',
  '20260725000900_db_009_ai_triage_results.sql',
  '20260725001000_db_010_escrow_contracts.sql',
  '20260725001100_db_011_escrow_transactions.sql',
  '20260725001200_db_012_notifications.sql',
  '20260725001300_db_013_audit_logs.sql',
  '20260725001400_db_014_indexes_and_constraints.sql',
  '20260725001500_auth_profile_onboarding.sql',
  '20260725001600_rls_001_profiles.sql',
  '20260725001700_rls_002_programs.sql',
  '20260725001800_rls_003_reports.sql',
  '20260725001900_rls_004_report_collaboration.sql',
  '20260725002000_storage_report_attachments.sql',
  '20260725002100_offchain_atomic_rpcs.sql',
  '20260725002200_lifecycle_and_settlement_rpcs.sql',
  '20260725002300_service_role_grants.sql',
  '20260727055104_cp01_tighten_program_write_grants.sql',
  '20260727060410_cp02_create_program_contract_rules.sql',
  '20260727063709_sr04_report_impact_row_guard.sql',
  '20260727064652_sr04b_reports_direct_insert_revoke.sql',
  '20260727071500_acc01_profiles_direct_update_revoke.sql',
  '20260727110000_bt03_public_paid_sort_key.sql',
  '20260727163500_mr02_report_program_filter_options.sql',
  '20260727170000_mr01_researcher_report_summary.sql',
];

const tableMigrations = new Map([
  ['20260725000100_db_001_profiles.sql', 'profiles'],
  ['20260725000200_db_002_programs.sql', 'programs'],
  ['20260725000300_db_003_program_scopes.sql', 'program_scopes'],
  ['20260725000400_db_004_program_reward_tiers.sql', 'program_reward_tiers'],
  ['20260725000500_db_005_reports.sql', 'reports'],
  ['20260725000550_db_005b_report_impacts.sql', 'report_impacts'],
  ['20260725000560_db_005c_report_disclosures.sql', 'report_disclosures'],
  ['20260725000600_db_006_report_attachments.sql', 'report_attachments'],
  ['20260725000700_db_007_report_comments.sql', 'report_comments'],
  ['20260725000800_db_008_report_reviews.sql', 'report_reviews'],
  ['20260725000900_db_009_ai_triage_results.sql', 'ai_triage_results'],
  ['20260725001000_db_010_escrow_contracts.sql', 'escrow_contracts'],
  ['20260725001100_db_011_escrow_transactions.sql', 'escrow_transactions'],
  ['20260725001200_db_012_notifications.sql', 'notifications'],
  ['20260725001300_db_013_audit_logs.sql', 'audit_logs'],
  ['20260725001700_rls_002_programs.sql', 'program_reviewers'],
]);

function fail(message) {
  throw new Error(`Migration contract check failed: ${message}`);
}

const actualMigrations = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) {
  fail(
    `ordered migration list differs.\nExpected ${expectedMigrations.join(', ')}\nActual ${actualMigrations.join(', ')}`,
  );
}

const migrationContents = new Map(
  expectedMigrations.map((name) => [
    name,
    readFileSync(new URL(name, migrationsDirectory), 'utf8'),
  ]),
);

for (const [name, table] of tableMigrations) {
  const sql = migrationContents.get(name);

  if (!sql.includes(`create table public.${table}`)) {
    fail(`${name} does not create public.${table}`);
  }

  if (!sql.includes(`alter table public.${table} enable row level security`)) {
    fail(`${name} does not enable RLS on public.${table}`);
  }
}

for (const taxonomyTable of [
  'program_tags',
  'program_resources',
  'program_impacts',
  'program_prohibited_activities',
]) {
  const sql = migrationContents.get('20260725000410_db_004b_program_taxonomy.sql');

  if (!sql.includes(`create table public.${taxonomyTable}`)) {
    fail(`DB-004b does not create public.${taxonomyTable}`);
  }

  if (!sql.includes(`alter table public.${taxonomyTable} enable row level security`)) {
    fail(`DB-004b does not enable RLS on public.${taxonomyTable}`);
  }
}

const attachmentSql = migrationContents.get('20260725000600_db_006_report_attachments.sql');
const attachmentColumns = attachmentSql
  .slice(
    attachmentSql.indexOf('create table public.report_attachments'),
    attachmentSql.indexOf(');', attachmentSql.indexOf('create table public.report_attachments')),
  )
  .toLowerCase();

if (/\b(public_url|signed_url|url)\b/.test(attachmentColumns)) {
  fail('report_attachments persists a URL column');
}

const triageSql = migrationContents
  .get('20260725000900_db_009_ai_triage_results.sql')
  .toLowerCase();

if (/\b(api_key|secret|credential)\s+(text|jsonb|varchar)\b/.test(triageSql)) {
  fail('ai_triage_results persists a credential column');
}

const db014 = migrationContents.get('20260725001400_db_014_indexes_and_constraints.sql');
const requiredIndexes = [
  'programs_owner_status_created_at_idx',
  'programs_public_created_at_idx',
  'programs_public_max_bounty_idx',
  'programs_public_paid_pool_idx',
  'programs_public_deadline_idx',
  'programs_in_scope_asset_types_idx',
  'programs_reward_severities_idx',
  'reports_program_status_submitted_at_idx',
  'reports_researcher_status_submitted_at_idx',
  'report_attachments_report_created_at_idx',
  'report_comments_report_created_at_idx',
  'report_reviews_report_created_at_idx',
  'ai_triage_results_report_created_at_idx',
  'escrow_transactions_program_created_at_idx',
  'escrow_transactions_report_created_at_idx',
  'escrow_transactions_status_created_at_idx',
  'notifications_recipient_read_created_at_idx',
  'notifications_recipient_unread_created_at_idx',
  'audit_logs_actor_created_at_idx',
  'audit_logs_entity_created_at_idx',
];

for (const indexName of requiredIndexes) {
  if (!db014.includes(indexName)) {
    fail(`DB-014 is missing ${indexName}`);
  }
}

const runner = readFileSync(runnerPath, 'utf8');
let previousPosition = -1;

for (const migration of expectedMigrations.slice(0, 17)) {
  const position = runner.indexOf(migration);

  if (position <= previousPosition) {
    fail(`full-schema runner omits or misorders ${migration}`);
  }

  previousPosition = position;
}

if (!runner.includes('verify_schema.sql')) {
  fail('full-schema runner does not execute transactional verification');
}

for (const policyMigration of [
  '20260725001600_rls_001_profiles.sql',
  '20260725001700_rls_002_programs.sql',
  '20260725001800_rls_003_reports.sql',
  '20260725001900_rls_004_report_collaboration.sql',
  '20260725002000_storage_report_attachments.sql',
]) {
  if (!/\bcreate\s+policy\b/i.test(migrationContents.get(policyMigration))) {
    fail(`${policyMigration} does not create its required policies`);
  }
}

process.stdout.write(
  `Verified ${expectedMigrations.length} ordered migrations from ${fileURLToPath(migrationsDirectory)}\n`,
);
