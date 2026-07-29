import {
  ARC_TESTNET_USDC_ADDRESS,
  fundingConfirmationArtifactResponseSchema,
  type FundingConfirmationArtifact,
} from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  FundingConfirmationEvidence,
  formatFundingConfirmationTimestamp,
} from '@/components/owner/program-funding-views';

const confirmationArtifact = {
  fundingIntentId: '31000000-0000-4000-8000-000000000002',
  programId: '31000000-0000-4000-8000-000000000001',
  routeMode: 'unified_balance',
  escrowAddress: '0x1111111111111111111111111111111111111111',
  artifactVersion: '1.1.0',
  artifactChecksum: `0x${'a'.repeat(64)}`,
  tokenAddress: ARC_TESTNET_USDC_ADDRESS,
  tokenDecimals: 6,
  destinationTransactionHash: `0x${'b'.repeat(64)}`,
  destinationLogIndex: 7,
  destinationBlockNumber: '123456',
  destinationBlockHash: `0x${'c'.repeat(64)}`,
  syncTransactionHash: `0x${'d'.repeat(64)}`,
  syncLogIndex: 3,
  syncBlockNumber: '123459',
  syncBlockHash: `0x${'e'.repeat(64)}`,
  grossAmount: '125.5',
  estimatedFeeReserve: '0.75',
  netReceivedAmount: '124.75',
  preTotalFundedAmount: '25',
  requiredTotalFundedAmount: '149.75',
  postTotalFundedAmount: '149.75',
  accounting: {
    totalPool: '149.75',
    totalPaid: '20',
    totalWithdrawn: '5',
    approvedOutstanding: '10',
    availablePool: '114.75',
  },
  reconciledAt: '2026-07-29T08:30:00.000Z',
} satisfies FundingConfirmationArtifact;

describe('CP-13 immutable funding confirmation', () => {
  it('hydrates the persisted latest-confirmation API response after reload', () => {
    const response = fundingConfirmationArtifactResponseSchema.parse({
      success: true,
      data: confirmationArtifact,
    });

    expect(response.data).toEqual(confirmationArtifact);
    expect(response.data.programId).toBe('31000000-0000-4000-8000-000000000001');
    expect(response.data.postTotalFundedAmount).toBe(
      response.data.requiredTotalFundedAmount,
    );
  });

  it('renders the API artifact without wallet or mutable local funding state', () => {
    const artifact = fundingConfirmationArtifactResponseSchema.parse({
      success: true,
      data: confirmationArtifact,
    }).data;
    const html = renderToStaticMarkup(
      createElement(FundingConfirmationEvidence, { artifact }),
    );

    expect(html).toContain(
      `data-funding-confirmation="${artifact.fundingIntentId}"`,
    );
    expect(html).toContain('Canonical funding confirmation');
    expect(html).toContain('Unified Balance');
    expect(html).toContain('Artifact version');
    expect(html).toContain('1.1.0');
    expect(html).toContain('Destination evidence');
    expect(html).toContain('Funding sync transaction');
    expect(html).toContain('Provider + gas reserve');
    expect(html).toContain('Actual Arc net received');
    expect(html).toContain('Required lifetime funded');
    expect(html).toContain('Verified lifetime funded');
    expect(html).toContain('Approved outstanding');
    expect(html).toContain('Available pool');
    expect(html).toContain('Reconciled at (UTC)');
    expect(html).toContain('2026-07-29T08:30:00.000Z');
  });

  it('formats the reconciliation timestamp deterministically for SSR and hydration', () => {
    expect(formatFundingConfirmationTimestamp('2026-07-29T08:30:00+07:00')).toBe(
      '2026-07-29T01:30:00.000Z',
    );
    expect(formatFundingConfirmationTimestamp('not-a-date')).toBe('Unknown timestamp');
  });
});
