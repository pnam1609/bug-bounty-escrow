import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  arcExplorerHref,
  CryptoValueAction,
  DEFAULT_ARC_EXPLORER_URL,
} from '@/components/reports/crypto-value';

describe('crypto display values', () => {
  it('builds an Arc address URL from the configured explorer', () => {
    expect(arcExplorerHref('0xabc', 'address', 'https://testnet.arcscan.app/')).toBe(
      'https://testnet.arcscan.app/address/0xabc',
    );
  });

  it('builds transaction and block URLs without inherited query or hash', () => {
    expect(
      arcExplorerHref('0xhash', 'tx', 'https://testnet.arcscan.app/explorer?network=arc#top'),
    ).toBe('https://testnet.arcscan.app/explorer/tx/0xhash');
    expect(arcExplorerHref('42', 'block', DEFAULT_ARC_EXPLORER_URL)).toContain('/block/42');
  });

  it('keeps the display value constrained while exposing copy and explorer actions', () => {
    const fullAddress = `0x${'a'.repeat(40)}`;
    const markup = renderToStaticMarkup(
      createElement(CryptoValueAction, {
        displayValue: '0xaaaa…aaaa',
        href: arcExplorerHref(fullAddress, 'address'),
        value: fullAddress,
        what: 'wallet address',
      }),
    );

    expect(markup).toContain('0xaaaa…aaaa');
    expect(markup).toContain(`Copy the full wallet address: ${fullAddress}`);
    expect(markup).toContain(`/address/${fullAddress}`);
    expect(markup).toContain('target="_blank"');
  });
});
