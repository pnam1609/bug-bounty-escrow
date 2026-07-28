import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(projectDirectory, '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@bug-bounty-escrow/shared', '@bug-bounty-escrow/ui'],
  experimental: {
    /*
     * `@bug-bounty-escrow/ui` ships TypeScript source rather than a build, so its ESM-style
     * `./button.js` specifiers point at files that only exist as `.tsx`. TypeScript substitutes
     * the extension automatically; webpack and Turbopack do not, so without this every route that
     * imports the library fails to resolve at build time. This teaches the bundler the same
     * substitution TypeScript already performs.
     */
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    },
    /*
     * The UI barrel re-exports client components (`app-shell.tsx` is `'use client'`) through
     * `export *`. In dev, webpack cannot see named exports through that chain once Next has
     * replaced the client module with a reference proxy, so it logs "Attempted import error:
     * 'SiteBrand' is not exported" on pages that resolve and render perfectly well. Rewriting
     * barrel imports to direct module imports removes the ambiguity rather than silencing it —
     * and skips compiling the whole library for a page that wants two components.
     */
    optimizePackageImports: ['@bug-bounty-escrow/ui'],
  },
};

export default nextConfig;
