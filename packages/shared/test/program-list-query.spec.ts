import { describe, expect, it } from 'vitest';

import { programListQuerySchema } from '../src/index';

describe('public program list query contract', () => {
  it('accepts every advanced filter and sortable field', () => {
    expect(
      programListQuerySchema.parse({
        page: '2',
        limit: '50',
        search: 'vault',
        status: 'active,ended',
        assetType: ['smart_contract', 'website', 'api', 'mobile'],
        severity: 'critical,high,medium,low,informational',
        minMaxReward: '10000.500000',
        closing: '30d',
        funded: 'true',
        sort: 'totalPaid',
        sortDirection: 'asc',
      }),
    ).toEqual({
      page: 2,
      limit: 50,
      search: 'vault',
      status: ['active', 'ended'],
      assetType: ['smart_contract', 'website', 'api', 'mobile'],
      severity: ['critical', 'high', 'medium', 'low', 'informational'],
      minMaxReward: '10000.500000',
      closing: '30d',
      funded: true,
      sort: 'totalPaid',
      sortDirection: 'asc',
    });
  });

  it('accepts explicit false without accidentally enabling funded-only', () => {
    expect(programListQuerySchema.parse({ funded: 'false' }).funded).toBe(false);
    expect(programListQuerySchema.parse({ funded: '0' }).funded).toBe(false);
  });

  it('falls back safely for invalid user-editable query values', () => {
    expect(
      programListQuerySchema.parse({
        page: '-1',
        limit: '100000',
        search: 'x'.repeat(121),
        status: 'paused',
        assetType: 'wallet',
        severity: 'urgent',
        minMaxReward: '-1',
        closing: 'tomorrow',
        funded: 'sometimes',
        sort: 'reward',
        sortDirection: 'sideways',
      }),
    ).toEqual({
      page: 1,
      limit: 20,
      sort: 'newest',
    });
  });

  it('drops an invalid mixed enum filter instead of partially applying it', () => {
    const query = programListQuerySchema.parse({
      assetType: 'website,wallet',
      severity: ['critical', 'urgent'],
    });

    expect(query.assetType).toBeUndefined();
    expect(query.severity).toBeUndefined();
  });

  it('keeps unknown query names forbidden even though known values are tolerant', () => {
    expect(programListQuerySchema.safeParse({ ownerOnly: 'true' }).success).toBe(false);
  });
});
