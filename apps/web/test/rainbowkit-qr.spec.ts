import { Cuer } from 'cuer';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

describe('RainbowKit WalletConnect QR renderer', () => {
  it('renders the borderless cuer matrix used by the MetaMask fallback', () => {
    let renderer: ReactTestRenderer | undefined;

    expect(() => {
      act(() => {
        renderer = create(
          createElement(Cuer, {
            size: 240,
            value: 'https://metamask.app.link/wc?uri=wc%3Aexample',
          }),
        );
      });
    }).not.toThrow();

    const svg = renderer?.root.findByType('svg');
    expect(svg?.props['viewBox']).toMatch(/^0 0 \d+ \d+$/u);
    expect(renderer?.root.findAllByType('path').length).toBeGreaterThan(0);
  });
});
