import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

// Keep type generation deterministic while matching the workspace CLI/config
// schema. Older pins reject current config keys before connecting to Postgres.
const SUPABASE_CLI_VERSION = '2.109.1';
const outputPath = fileURLToPath(new URL('../src/generated/database.types.ts', import.meta.url));
const mode = process.argv[2];

if (mode !== 'check' && mode !== 'generate') {
  throw new Error('Usage: node scripts/database-types.mjs <check|generate>');
}

const pnpmScript = process.env.npm_execpath;
const pnpmExecutable = pnpmScript === undefined ? 'pnpm' : process.execPath;
const pnpmArguments = pnpmScript === undefined ? [] : [pnpmScript];
const result = spawnSync(
  pnpmExecutable,
  [
    ...pnpmArguments,
    'dlx',
    `supabase@${SUPABASE_CLI_VERSION}`,
    'gen',
    'types',
    'typescript',
    '--local',
    '--schema',
    'public',
  ],
  {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  },
);

if (result.error !== undefined) {
  throw result.error;
}

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const generated = result.stdout.replaceAll('\r\n', '\n').trimEnd() + '\n';

if (!generated.includes('export type Json') || !generated.includes('export type Database')) {
  throw new Error('Supabase CLI returned an invalid or empty database type document');
}

if (mode === 'generate') {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated, 'utf8');
  process.stdout.write(`Generated ${outputPath}\n`);
  process.exit(0);
}

let existing;

try {
  existing = readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n');
} catch {
  throw new Error(
    'Generated database types are missing; run pnpm --filter @bug-bounty-escrow/database types:generate',
  );
}

if (existing !== generated) {
  throw new Error(
    'Generated database types are stale; run pnpm --filter @bug-bounty-escrow/database types:generate',
  );
}

process.stdout.write('Generated database types are current\n');
