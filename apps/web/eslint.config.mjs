import nextPlugin from '@next/eslint-plugin-next';

import rootConfig from '../../eslint.config.mjs';

export default [
  ...rootConfig,
  {
    // Next's own build-time lint pass runs these rules, so they have to be defined here too —
    // otherwise an `eslint-disable-next-line @next/next/...` comment fails the production build
    // with "Definition for rule was not found".
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  { ignores: ['next-env.d.ts', '.next/**'] },
];
