import type { ProgramSummary } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BountyTable, type BountyTableSortState } from '@/components/programs/bounty-table';
import { DiscoveryHero } from '@/components/programs/bounty-table-view';
import { EMPTY_FILTERS, toggleProgramSort } from '@/components/programs/program-filters';
import {
  describeDeadline,
  formatMoney,
  formatTotalPaid,
} from '@/components/programs/program-format';

function program(overrides: Partial<ProgramSummary> = {}): ProgramSummary {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'This summary must not appear in the table row.',
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
    rewardSeverities: ['critical', 'high'],
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('desktop bounty table', () => {
  it('renders the exact public discovery copy and only the approved trust claims', () => {
    const html = renderToStaticMarkup(createElement(DiscoveryHero));

    expect(html).toContain('<h1');
    expect(html).toContain('Find your next bounty');
    expect(html).toContain(
      'Compare transparent reward pools, verified scope and USDC payouts before you start researching.',
    );
    expect(html).toContain('Escrow balance visible');
    expect(html).toContain('Private reports by default');
    expect(html).not.toContain('Active programs only');
    expect(html.toLowerCase()).not.toContain('guaranteed payout');
  });

  it('uses a semantic five-column table with four sortable header buttons', () => {
    const sortState: BountyTableSortState = { sort: 'name', direction: 'asc' };
    const html = renderToStaticMarkup(
      createElement(BountyTable, {
        caption: 'Public bounty programs, active programs first',
        onSort: vi.fn(),
        programs: [program()],
        sortState,
      }),
    );

    expect(html).toContain('<table');
    expect(html).toMatch(
      /<caption[^>]*class="[^"]*sr-only[^"]*"[^>]*>Public bounty programs, active programs first<\/caption>/,
    );
    expect(html.match(/scope="col"/g)).toHaveLength(5);
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html.match(/aria-sort="ascending"/g)).toHaveLength(1);
    expect(html.match(/aria-sort="none"/g)).toHaveLength(3);
    expect(html).toContain('Program');
    expect(html).toContain('Max bounty');
    expect(html).toContain('Total paid');
    expect(html).toContain('Deadline');
    expect(html).not.toContain('>Status<');
  });

  it('renders one stretched detail link, a public logo, and no summary or status badge', () => {
    const html = renderToStaticMarkup(
      createElement(BountyTable, {
        caption: 'Public bounty programs',
        onSort: vi.fn(),
        programs: [
          program({
            logoUrl: 'https://cdn.example.test/aegis.png',
          }),
        ],
        sortState: { sort: 'newest', direction: null },
      }),
    );
    const body = html.match(/<tbody[^>]*>([\s\S]*)<\/tbody>/)?.[1] ?? '';

    expect(body.match(/<a /g)).toHaveLength(1);
    expect(body).not.toContain('<button');
    expect(body).toContain('href="/programs/20000000-0000-4000-8000-000000000001"');
    expect(body).toContain('<img alt=""');
    expect(body).toContain('src="https://cdn.example.test/aegis.png"');
    expect(body).toContain('Aegis Protocol');
    expect(body).not.toContain('This summary must not appear in the table row.');
    expect(body).not.toContain('>active<');
    expect(body).toContain('focus-visible:after:ring-2');
  });

  it('never displays a stored value whose visibility is private', () => {
    const privateAmount = '987654.321099';
    const html = renderToStaticMarkup(
      createElement(BountyTable, {
        caption: 'Public bounty programs',
        onSort: vi.fn(),
        programs: [
          program({
            totalPaid: privateAmount,
            totalPaidVisibility: 'private',
          }),
        ],
        sortState: { sort: 'newest', direction: null },
      }),
    );

    expect(html).toContain('Private');
    expect(html).toContain('Total paid is private');
    expect(html).not.toContain(privateAmount);
  });

  it('starts each sortable column ascending, then toggles the active column descending', () => {
    const firstClick = toggleProgramSort(EMPTY_FILTERS, 'name');
    const secondClick = toggleProgramSort(firstClick, 'name');
    const switchedColumn = toggleProgramSort(secondClick, 'maxBounty');

    expect(firstClick).toMatchObject({ sort: 'name', sortDirection: 'asc' });
    expect(secondClick).toMatchObject({ sort: 'name', sortDirection: 'desc' });
    expect(switchedColumn).toMatchObject({ sort: 'maxBounty', sortDirection: 'asc' });
  });
});

describe('bounty table formatting', () => {
  it('formats USDC compactly while preserving the exact accessible amount', () => {
    expect(formatMoney('250000.125000', 'maximum bounty')).toEqual({
      text: '250K USDC',
      label: '250,000.13 USDC maximum bounty',
    });
    expect(formatTotalPaid(null)).toEqual({
      text: 'Private',
      label: 'Total paid is private',
    });
  });

  it('describes ongoing, active deadlines and ended deadlines without health colouring', () => {
    const now = new Date('2026-07-26T12:00:00.000Z').getTime();

    expect(describeDeadline({ publicStatus: 'active' }, now)).toEqual({
      primary: 'Ongoing',
      secondary: 'No fixed deadline',
      label: 'Ongoing, no fixed deadline',
      ended: false,
    });
    expect(
      describeDeadline({ publicStatus: 'active', deadline: '2026-08-07T12:00:00.000Z' }, now),
    ).toMatchObject({
      primary: '12 days',
      secondary: 'Aug 7, 2026',
    });
    expect(
      describeDeadline({ publicStatus: 'ended', deadline: '2026-07-12T00:00:00.000Z' }, now),
    ).toEqual({
      primary: 'Ended',
      secondary: 'Jul 12, 2026',
      label: 'Ended on Jul 12, 2026',
      ended: true,
    });
  });
});
