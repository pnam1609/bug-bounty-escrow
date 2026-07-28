import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTERS,
  SEARCH_MAX_LENGTH,
  STATUS_VALUES,
  countAppliedFilters,
  describeAppliedFilters,
  readProgramFilters,
  statusSelectionForControls,
  toApiSearchParams,
  toUrlSearchParams,
} from '@/components/programs/program-filters';

describe('public program filter URL state', () => {
  it('presents both public statuses as selected while keeping the default URL clean', () => {
    const filters = readProgramFilters(new URLSearchParams());

    expect(filters.status).toEqual([]);
    expect(statusSelectionForControls(filters.status)).toEqual(STATUS_VALUES);
    expect(toUrlSearchParams(filters).toString()).toBe('');
    expect(countAppliedFilters(filters)).toBe(0);
  });

  it('round-trips every advanced filter and restarts API pagination from the requested page', () => {
    const filters = {
      ...EMPTY_FILTERS,
      search: 'Aegis & Orbit',
      sort: 'totalPaid' as const,
      sortDirection: 'desc' as const,
      status: ['ended'] as const,
      assetType: ['smart_contract', 'api'] as const,
      severity: ['critical'] as const,
      minMaxReward: '50000',
      closing: '30d' as const,
      funded: true,
    };
    const url = toUrlSearchParams(filters);

    expect(readProgramFilters(url)).toEqual(filters);
    expect(toApiSearchParams(filters, 1).get('page')).toBe('1');
    expect(toApiSearchParams(filters, 1).get('limit')).toBe('12');
    expect(url.get('search')).toBe('Aegis & Orbit');
  });

  it('falls back safely for unknown query values and caps search at the API limit', () => {
    const params = new URLSearchParams({
      search: 'x'.repeat(SEARCH_MAX_LENGTH + 20),
      status: 'paused',
      assetType: 'wallet',
      severity: 'urgent',
      minMaxReward: '99999',
      closing: 'tomorrow',
      funded: 'yes',
      sort: 'reward',
      sortDirection: 'sideways',
    });
    const filters = readProgramFilters(params);

    expect(filters).toEqual({
      ...EMPTY_FILTERS,
      search: 'x'.repeat(SEARCH_MAX_LENGTH),
    });
  });

  it('creates removable chips with accessible-label-ready product copy', () => {
    const filters = {
      ...EMPTY_FILTERS,
      assetType: ['smart_contract'] as const,
      severity: ['critical'] as const,
      minMaxReward: '50000',
    };
    const chips = describeAppliedFilters(filters);

    expect(chips.map((chip) => chip.label)).toEqual(['Smart contract', 'Critical', '50K+ USDC']);
    expect(chips[0]?.remove(filters).assetType).toEqual([]);
    expect(countAppliedFilters(filters)).toBe(3);
  });
});
