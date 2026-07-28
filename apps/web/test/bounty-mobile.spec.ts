import type { ProgramSummary } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BountyTable } from '@/components/programs/bounty-table';
import { BountyVerticalList, BountyVerticalRow } from '@/components/programs/bounty-vertical-list';
import {
  clearMobileFilterDraft,
  mobileFilterPreviewParams,
  mobileFilterShowLabel,
} from '@/components/programs/filter-sheet';
import { EMPTY_FILTERS, countAdvancedFilters } from '@/components/programs/program-filters';

function program(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Public summary',
    status: 'active',
    publicStatus: 'active',
    tags: ['DeFi'],
    totalPool: '300000.000000',
    reservedPool: '1000.000000',
    remainingPool: '230500.000000',
    totalPaid: '68500.000000',
    totalPaidVisibility: 'public',
    paidReportCount: 5,
    maxBounty: '250000.000000',
    inScopeAssetTypes: ['smart_contract'],
    rewardSeverities: ['critical'],
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('BT-08 mobile vertical bounty rows', () => {
  it('uses a semantic list and dl blocks instead of squeezing a table horizontally', () => {
    const html = renderToStaticMarkup(
      createElement(BountyVerticalList, {
        programs: [program(), program({ id: '20000000-0000-4000-8000-000000000002' })],
      }),
    );

    expect(html).toContain('<ul');
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html.match(/<dl/g)).toHaveLength(2);
    expect(html).not.toContain('<table');
    expect(html).not.toMatch(/overflow-x|overflow-auto/);
  });

  it('shares desktop formatting, protects private totals and exposes a full-width action', () => {
    const privateAmount = '987654.321099';
    const html = renderToStaticMarkup(
      createElement(BountyVerticalRow, {
        program: program({
          logoUrl: 'https://cdn.example.test/aegis.png',
          totalPaid: privateAmount,
          totalPaidVisibility: 'private',
        }),
      }),
    );

    expect(html).toContain('Max bounty');
    expect(html).toContain('250K USDC');
    expect(html).toContain('Total paid');
    expect(html).toContain('Private');
    expect(html).toContain('Total paid is private');
    expect(html).not.toContain(privateAmount);
    expect(html).toContain('Deadline');
    expect(html).toContain('Ongoing');
    expect(html).toContain('src="https://cdn.example.test/aegis.png"');
    expect(html).toMatch(/<a class="[^"]*w-full[^"]*"/);
    expect(html).toContain('View bounty');
  });

  it('keeps desktop cells at token spacing for compact tablet widths', () => {
    const html = renderToStaticMarkup(
      createElement(BountyTable, {
        caption: 'Public bounty programs',
        onSort: () => undefined,
        programs: [program()],
        sortState: { sort: 'newest', direction: null },
      }),
    );

    expect(html.match(/px-xl/g)?.length).toBeGreaterThanOrEqual(10);
    expect(html).toContain('w-96 min-w-60');
    expect(html).toContain('w-64 min-w-36');
  });
});

describe('BT-08 staged mobile filters', () => {
  it('counts advanced filters without treating the separate search field as a badge item', () => {
    const filters = {
      ...EMPTY_FILTERS,
      search: 'Aegis',
      assetType: ['smart_contract'] as const,
      severity: ['critical'] as const,
      minMaxReward: '50000',
    };

    expect(countAdvancedFilters(filters)).toBe(3);
  });

  it('previews page one only and formats the sticky primary action count', () => {
    const params = mobileFilterPreviewParams({
      ...EMPTY_FILTERS,
      assetType: ['smart_contract'] as const,
    });

    expect(params.get('assetType')).toBe('smart_contract');
    expect(params.get('page')).toBe('1');
    expect(params.get('limit')).toBe('1');
    expect(mobileFilterShowLabel(undefined)).toBe('Show bounties');
    expect(mobileFilterShowLabel(1)).toBe('Show 1 bounty');
    expect(mobileFilterShowLabel(24)).toBe('Show 24 bounties');
  });

  it('clears only the staged draft until the footer apply action commits it', () => {
    const applied = {
      ...EMPTY_FILTERS,
      search: 'Aegis',
      assetType: ['smart_contract'] as const,
      funded: true,
    };
    const clearedDraft = clearMobileFilterDraft(applied);

    expect(clearedDraft).toEqual(EMPTY_FILTERS);
    expect(applied).toMatchObject({
      search: 'Aegis',
      assetType: ['smart_contract'],
      funded: true,
    });
  });
});
