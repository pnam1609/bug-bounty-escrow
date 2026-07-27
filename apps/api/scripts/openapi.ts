import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

import { OPENAPI_OUTPUT_FILE, serializeOpenApiDocument } from '../src/openapi/openapi.js';
import { createOpenApiDocument } from '../src/openapi/openapi-snapshot.js';

const mode = process.argv[2];
const outputPath = fileURLToPath(new URL(`../${OPENAPI_OUTPUT_FILE}`, import.meta.url));

if (mode !== 'check' && mode !== 'generate') {
  throw new Error('Usage: tsx scripts/openapi.ts <check|generate>');
}

const serialized = await format(serializeOpenApiDocument(await createOpenApiDocument()), {
  parser: 'json',
});

if (mode === 'generate') {
  await writeFile(outputPath, serialized, 'utf8');
  process.stdout.write(`Generated ${outputPath}\n`);
  process.exit(0);
}

let existing: string;

try {
  existing = await readFile(outputPath, 'utf8');
} catch {
  throw new Error(
    'OpenAPI output is missing; run pnpm --filter @bug-bounty-escrow/api openapi:generate',
  );
}

if (existing !== serialized) {
  throw new Error(
    'OpenAPI output is stale; run pnpm --filter @bug-bounty-escrow/api openapi:generate',
  );
}

process.stdout.write('OpenAPI output is current\n');
