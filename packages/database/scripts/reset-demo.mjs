import { PGlite } from '@electric-sql/pglite';
import { hashSync } from 'bcryptjs';
import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';

const packageDirectory = new URL('../', import.meta.url);
const migrationDirectory = new URL('migrations/', packageDirectory);
const seedPath = new URL('seeds/offchain-demo.sql', packageDirectory);

export function parseDemoResetEnvironment(environment) {
  const demoEnvironment = environment.DEMO_ENV;
  const confirmation = environment.DEMO_RESET_CONFIRM;
  const databasePath = environment.DEMO_DATABASE_PATH;

  if (!['local', 'demo', 'test'].includes(demoEnvironment)) {
    throw new Error('DEMO_ENV must be local, demo, or test');
  }
  if (confirmation !== 'RESET_OFFCHAIN_DEMO') {
    throw new Error('DEMO_RESET_CONFIRM=RESET_OFFCHAIN_DEMO is required');
  }
  if (typeof databasePath !== 'string' || databasePath.trim() === '') {
    throw new Error('DEMO_DATABASE_PATH is required');
  }

  return { databasePath };
}

export const compatibilityBootstrap = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    encrypted_password text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid()
  returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null, owner_id text,
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

export async function migrateAndResetDemo(database) {
  const relation = await database.query(`select to_regclass('public.profiles') as relation`);
  if (relation.rows[0]?.relation === null) {
    await database.exec(compatibilityBootstrap);
    for (const migration of readdirSync(migrationDirectory)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await database.exec(loadSql(new URL(migration, migrationDirectory)));
    }
  }
  const passwordHash = hashSync('local-demo-password', '$2b$10$abcdefghijklmnopqrstuu');
  await database.exec(loadSql(seedPath).replaceAll('__DEMO_PASSWORD_HASH__', passwordHash));
}

export async function resetDemo(environment) {
  const { databasePath } = parseDemoResetEnvironment(environment);
  const database = new PGlite(databasePath);
  try {
    await migrateAndResetDemo(database);
  } finally {
    await database.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await resetDemo(process.env);
  process.stdout.write('Off-chain demo database reset complete\n');
}
