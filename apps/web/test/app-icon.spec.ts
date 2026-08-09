import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APP_ICON_PATH = fileURLToPath(new URL('../src/app/icon.svg', import.meta.url));

describe('browser tab icon', () => {
  it('uses the same BB mark and escrow color as the header brand', () => {
    const icon = readFileSync(APP_ICON_PATH, 'utf8');

    expect(icon).toContain('viewBox="0 0 36 36"');
    expect(icon).toContain('fill="#22d3a6"');
    expect(icon).toContain('>BB</text>');
  });
});
