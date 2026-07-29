import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import solc from 'solc';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'src/BountyEscrow.sol');
const source = await readFile(sourcePath, 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'BountyEscrow.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    metadata: { bytecodeHash: 'none' },
    evmVersion: 'cancun',
    viaIR: false,
    outputSelection: {
      '*': {
        '*': [
          'abi',
          'evm.bytecode.object',
          'evm.deployedBytecode.object',
          'evm.deployedBytecode.immutableReferences',
        ],
      },
    },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import(importPath) {
      try {
        return { contents: readFileSync(resolve(root, 'node_modules', importPath), 'utf8') };
      } catch {
        return { error: `Import not found: ${importPath}` };
      }
    },
  }),
);
const errors = (output.errors ?? []).filter(({ severity }) => severity === 'error');
if (errors.length > 0) {
  throw new Error(errors.map(({ formattedMessage }) => formattedMessage).join('\n'));
}
const contract = output.contracts['BountyEscrow.sol'].BountyEscrow;
const immutableReferences = Object.fromEntries(
  Object.entries(contract.evm.deployedBytecode.immutableReferences).map(
    ([sourceId, references]) => [
      sourceId,
      references.map(({ start, length }) => ({ start, length })),
    ],
  ),
);
const normalizedRuntime = Buffer.from(contract.evm.deployedBytecode.object, 'hex');
for (const references of Object.values(immutableReferences)) {
  for (const { start, length } of references) {
    normalizedRuntime.fill(0, start, start + length);
  }
}
const artifact = {
  contractName: 'BountyEscrow',
  version: '1.1.0',
  compilerVersion: solc.version(),
  compilerSettings: {
    optimizer: { enabled: true, runs: 200 },
    metadata: { bytecodeHash: 'none' },
    evmVersion: 'cancun',
    viaIR: false,
  },
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
  immutableReferences,
};
const canonical = JSON.stringify(artifact);
const result = {
  ...artifact,
  artifactSha256: `0x${createHash('sha256').update(canonical).digest('hex')}`,
  runtimeBytecodeSha256: `0x${createHash('sha256').update(normalizedRuntime).digest('hex')}`,
};
const destination = resolve(root, 'artifacts/BountyEscrow.v1.json');
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`);
stdout.write(`Wrote ${destination}\n`);
