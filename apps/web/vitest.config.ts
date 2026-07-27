import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // The app tsconfig sets `jsx: "preserve"` for Next, which Vite cannot execute. Tests only ever
  // import pure logic, but that logic may live beside JSX (e.g. `role-options.tsx`), so the
  // transform must still understand it.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
