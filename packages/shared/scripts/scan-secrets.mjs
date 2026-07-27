import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
]);
const includedExtensions = new Set([
  '.env',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const signatures = [
  { label: 'private key', pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'GitHub token', pattern: /\bgh[opsu]_[A-Za-z0-9_]{36,}\b/ },
  {
    label: 'Supabase JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  },
];

function extension(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

function inspect(directory, findings) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        inspect(`${directory}/${entry.name}`, findings);
      }
      continue;
    }
    if (!entry.isFile() || !includedExtensions.has(extension(entry.name))) continue;
    const path = `${directory}/${entry.name}`;
    const content = readFileSync(path, 'utf8');
    for (const signature of signatures) {
      if (signature.pattern.test(content)) {
        findings.push(`${signature.label}: ${path.slice(workspace.length + 1)}`);
      }
    }
  }
}

const findings = [];
inspect(workspace, findings);
if (findings.length > 0) {
  process.stderr.write(`Secret scan failed:\n${findings.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('Secret scan passed: no configured secret signatures found\n');
