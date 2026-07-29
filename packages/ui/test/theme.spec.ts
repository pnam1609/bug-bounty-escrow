import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
const containerNames = [
  '3xs',
  '2xs',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
] as const;

describe('Tailwind dimension namespaces', () => {
  it('maps every max-width utility to the matching container token', () => {
    for (const name of containerNames) {
      expect(theme).toContain(`--max-width-${name}: var(--container-${name});`);
    }
  });

  it('does not replace spacing-powered dimension utilities with container sizes', () => {
    for (const namespace of ['size', 'width', 'height', 'min-width', 'min-height']) {
      expect(theme).not.toMatch(
        new RegExp(`--${namespace}-(?:${containerNames.join('|')}):\\s*var\\(--container-`),
      );
    }

    expect(theme).toContain('--spacing-sm: 8px;');
    expect(theme).toContain('--spacing-lg: 16px;');
    expect(theme).toContain('--spacing-2xl: 32px;');
    expect(theme).toContain('--spacing-3xl: 48px;');
  });
});
