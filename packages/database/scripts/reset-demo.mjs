import { PGlite } from '@electric-sql/pglite';
import { hashSync } from 'bcryptjs';
import { readFileSync, readdirSync } from 'node:fs';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';

import { compatibilityBootstrap } from './compatibility-bootstrap.mjs';
import { DEMO_PASSWORD, DEMO_PASSWORD_SALT } from './production-safety.mjs';

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
  const passwordHash = hashSync(DEMO_PASSWORD, DEMO_PASSWORD_SALT);
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
