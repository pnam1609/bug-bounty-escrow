'use client';

import { ExternalLink } from 'lucide-react';

import { CopyValueAction } from './copy-value';

export type ArcExplorerResource = 'address' | 'tx' | 'block';

export const DEFAULT_ARC_EXPLORER_URL =
  process.env['NEXT_PUBLIC_ARC_EXPLORER_URL'] ?? 'https://testnet.arcscan.app';

/** Build a canonical ArcScan URL without carrying query parameters from the configured base. */
export function arcExplorerHref(
  value: string,
  resource: ArcExplorerResource,
  explorerBaseUrl = DEFAULT_ARC_EXPLORER_URL,
): string {
  const base = new URL(explorerBaseUrl);
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/${resource}/${value}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export interface CryptoValueActionProps {
  /** The constrained value shown to the user, usually a masked address or short hash. */
  readonly displayValue: string;
  /** The exact value copied to the clipboard. */
  readonly value: string;
  /** Accessible description for the copy action. */
  readonly what: string;
  /** Optional external explorer destination. */
  readonly href?: string | undefined;
  /** Accessible name for the external explorer action. */
  readonly hrefLabel?: string | undefined;
  /** Optional visible label for the external explorer action. */
  readonly linkText?: string | undefined;
}

/**
 * A copyable crypto value with an optional external explorer action.
 *
 * The visible value remains constrained while the copy action keeps the full value accessible.
 * Consumers should omit `href` when linking the value would disclose private settlement data.
 */
export function CryptoValueAction({
  displayValue,
  value,
  what,
  href,
  hrefLabel = `Open ${what} in Arc explorer`,
  linkText,
}: CryptoValueActionProps) {
  return (
    <span className="flex min-w-0 max-w-full flex-wrap items-center gap-xs">
      <CopyValueAction displayValue={displayValue} value={value} what={what} />
      {href === undefined ? null : (
        <a
          aria-label={`${hrefLabel} (opens external site)`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-low hover:underline"
          href={href}
          rel="noreferrer"
          target="_blank"
          title={hrefLabel}
        >
          {linkText === undefined ? null : <span>{linkText}</span>}
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      )}
    </span>
  );
}
