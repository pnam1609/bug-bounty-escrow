import {
  EnvironmentValidationError,
  parseApiEnvironment,
} from '@bug-bounty-escrow/shared';

import { loadEscrowArtifact } from '../escrow/escrow-artifact.js';

async function validateProductionEnvironment(): Promise<void> {
  const config = parseApiEnvironment(process.env);
  if (config.NODE_ENV !== 'production') {
    throw new Error('NODE_ENV must be production');
  }

  if (config.CIRCLE_CONTRACTS_ENABLED) {
    await loadEscrowArtifact(config.BOUNTY_ESCROW_ARTIFACT_PATH);
  }

  process.stdout.write(
    `API production configuration is valid (Circle contracts: ${
      config.CIRCLE_CONTRACTS_ENABLED ? 'enabled' : 'disabled'
    }; Gateway webhooks: ${config.CIRCLE_GATEWAY_WEBHOOKS_ENABLED ? 'enabled' : 'disabled'})\n`,
  );
}

void validateProductionEnvironment().catch((error: unknown) => {
  if (error instanceof EnvironmentValidationError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write('API production configuration preflight failed\n');
  }
  process.exitCode = 1;
});
