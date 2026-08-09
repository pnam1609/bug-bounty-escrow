import type { ProgramSummary } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      data: [
        {
          id: '20000000-0000-4000-8000-000000000001',
          name: 'Aegis Protocol',
          slug: 'aegis-protocol',
          shortSummary: 'Public summary',
          status: 'active',
          publicStatus: null,
          tags: [],
          totalPool: '10.000000',
          reservedPool: '0.000000',
          remainingPool: '10.000000',
          totalPaid: '0.000000',
          totalPaidVisibility: 'private',
          paidReportCount: 0,
          maxBounty: '100.000000',
          inScopeAssetTypes: ['smart_contract'],
          rewardSeverities: ['critical'],
          updatedAt: '2026-08-09T00:00:00.000Z',
          deadline: '2026-08-09T00:00:00.000Z',
        } satisfies ProgramSummary,
      ],
    },
    isError: false,
    isLoading: false,
    refetch: () => undefined,
  }),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ session: { access_token: 'test-token' } }),
}));

import { formatOwnerDeadline, OwnerProgramList } from '@/components/owner/owner-program-list';

describe('owner programs deadline presentation', () => {
  it('keeps the date-only value on one line and preserves the ongoing fallback', () => {
    expect(formatOwnerDeadline('2026-08-09T00:00:00.000Z')).toBe('2026-08-09');
    expect(formatOwnerDeadline(undefined)).toBe('Ongoing');

    const markup = renderToStaticMarkup(createElement(OwnerProgramList));
    expect(markup).toMatch(
      /<th[^>]*class="[^"]*w-40[^"]*min-w-\[10rem\][^"]*whitespace-nowrap[^"]*">Deadline<\/th>/,
    );
    expect(markup).toMatch(
      /<td[^>]*class="[^"]*w-40[^"]*min-w-\[10rem\][^"]*whitespace-nowrap[^"]*">2026-08-09<\/td>/,
    );
  });
});
