import { hashSync } from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';

import { DEMO_PASSWORD, DEMO_PASSWORD_SALT } from './production-safety.mjs';

/*
 * Loads the demo seed into a real PostgreSQL and, when the target is a genuine Supabase stack,
 * finishes the demo users so GoTrue will actually authenticate them.
 *
 * `seeds/offchain-demo.sql` writes the four `auth.users` columns the PGlite shim defines. Real
 * GoTrue reads more than that: an account with no `email_confirmed_at` is rejected at sign-in, and
 * one with no `auth.identities` row has no email provider to sign in *with*. Rather than fork the
 * seed — two copies of the same data drift — the extra columns are filled in afterwards.
 *
 * Column sets differ across GoTrue releases, so every statement is built from the columns the
 * target actually has. A hard-coded list would break against whichever version `supabase start`
 * happens to pull.
 */

const seedPath = new URL('../seeds/offchain-demo.sql', import.meta.url);

/** Matches `reset-demo.mjs` so the demo password is identical on every target. */
export { DEMO_PASSWORD };

/** Every seeded account shares this id prefix, which is also how the seed deletes its own rows. */
const DEMO_USER_ID_PREFIX = '30000000-%';

/**
 * Read back from the seed rather than repeated here. A hard-coded list silently stops covering
 * accounts the seed adds, and the symptom is not an error — the extra users exist and look fine,
 * they just have no email identity, so signing in as them fails with "invalid credentials".
 */
async function demoUsers(client) {
  const { rows } = await client.query(
    `select id, email from auth.users where id::text like $1 order by id`,
    [DEMO_USER_ID_PREFIX],
  );
  return rows;
}

function loadSql(url) {
  return readFileSync(url, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

async function columnsOf(client, schema, table) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = $2`,
    [schema, table],
  );
  return new Set(rows.map((row) => row.column_name));
}

/**
 * Columns GoTrue expects on a password account. The token columns are set to '' rather than left
 * NULL: GoTrue scans them into Go strings, and a NULL there fails the sign-in query outright.
 */
function goTrueUserDefaults() {
  return {
    instance_id: "'00000000-0000-0000-0000-000000000000'::uuid",
    aud: "'authenticated'",
    role: "'authenticated'",
    email_confirmed_at: 'now()',
    created_at: 'now()',
    updated_at: 'now()',
    raw_app_meta_data: `'{"provider":"email","providers":["email"]}'::jsonb`,
    is_sso_user: 'false',
    is_anonymous: 'false',
    confirmation_token: "''",
    recovery_token: "''",
    email_change_token_new: "''",
    email_change_token_current: "''",
    email_change: "''",
    phone_change: "''",
    phone_change_token: "''",
    reauthentication_token: "''",
  };
}

async function completeGoTrueUsers(client, log) {
  const userColumns = await columnsOf(client, 'auth', 'users');
  const assignments = Object.entries(goTrueUserDefaults())
    .filter(([column]) => userColumns.has(column))
    .map(([column, value]) => `${column} = ${value}`);

  await client.query(`update auth.users set ${assignments.join(', ')} where id::text like $1`, [
    DEMO_USER_ID_PREFIX,
  ]);

  const identityColumns = await columnsOf(client, 'auth', 'identities');
  if (identityColumns.size === 0) {
    log('auth.identities absent — skipping identity rows');
    return;
  }

  // `provider_id` arrived in GoTrue 2.x and is part of the unique key; older schemas key on
  // (provider, id) instead, so it is only supplied when the column exists.
  const columns = ['user_id', 'provider', 'identity_data', 'last_sign_in_at'];
  const values = [
    '$1::uuid',
    "'email'",
    `jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true)`,
    'now()',
  ];

  for (const [column, value] of [
    ['id', 'gen_random_uuid()'],
    ['provider_id', '$1::text'],
    ['created_at', 'now()'],
    ['updated_at', 'now()'],
  ]) {
    if (identityColumns.has(column)) {
      columns.push(column);
      values.push(value);
    }
  }

  await client.query(`delete from auth.identities where user_id::text like $1`, [
    DEMO_USER_ID_PREFIX,
  ]);
  const users = await demoUsers(client);
  for (const user of users) {
    await client.query(
      `insert into auth.identities (${columns.join(', ')}) values (${values.join(', ')})`,
      [user.id, user.email],
    );
  }

  log(`completed ${String(users.length)} GoTrue identities`);
}

export async function seedDemoData(client, { log = () => {} } = {}) {
  const passwordHash = hashSync(DEMO_PASSWORD, DEMO_PASSWORD_SALT);
  await client.query(loadSql(seedPath).replaceAll('__DEMO_PASSWORD_HASH__', passwordHash));
  log('seeded demo programs, reports and escrow rows');

  // The shim's `auth.users` has none of these columns, so this is a no-op there by construction.
  const userColumns = await columnsOf(client, 'auth', 'users');
  if (userColumns.has('email_confirmed_at')) {
    await completeGoTrueUsers(client, log);
    const accounts = (await demoUsers(client)).map((user) => user.email).join(', ');
    log(`demo accounts ready (password: ${DEMO_PASSWORD}): ${accounts}`);
  }
}
