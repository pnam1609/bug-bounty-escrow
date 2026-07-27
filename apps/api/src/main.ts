import 'reflect-metadata';

import { bootstrap, formatStartupError } from './bootstrap.js';

void bootstrap(process.env).catch((error: unknown) => {
  process.stderr.write(`${formatStartupError(error)}\n`);
  process.exitCode = 1;
});
