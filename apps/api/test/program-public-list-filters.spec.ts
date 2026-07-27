import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { programListQuerySchema } from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgramController } from '../src/programs/program.controller.js';
import { ProgramRepository } from '../src/programs/program.repository.js';
import { ProgramService } from '../src/programs/program.service.js';
import { createOpenApiDocument } from '../src/openapi/openapi-snapshot.js';

interface Builder {
  eq: ReturnType<typeof vi.fn>;
  gt: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  ilike: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  overlaps: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
}

function repositoryHarness() {
  const builder = {} as Builder;

  for (const method of [
    'eq',
    'gt',
    'gte',
    'ilike',
    'in',
    'is',
    'lte',
    'not',
    'order',
    'overlaps',
  ] as const) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  builder.range = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });

  const client = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(builder),
    }),
  } as unknown as SupabaseClient;

  return { builder, repository: new ProgramRepository(client) };
}

describe('public program repository filters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('combines lifecycle, search, asset, severity, bounty, funded, closing and sort filters', async () => {
    const { builder, repository } = repositoryHarness();
    const query = programListQuerySchema.parse({
      page: '2',
      limit: '10',
      status: 'active',
      search: 'Vault_100%',
      assetType: 'smart_contract,website,api,mobile',
      severity: 'critical,high,medium,low,informational',
      minMaxReward: '10000.500000',
      closing: '7d',
      funded: 'true',
      sort: 'maxBounty',
      sortDirection: 'asc',
    });

    await repository.listPublic(query);

    expect(builder.not).toHaveBeenCalledWith('public_status', 'is', null);
    expect(builder.in).toHaveBeenCalledWith('status', ['active']);
    expect(builder.ilike).toHaveBeenCalledWith('name', '%Vault\\_100\\%%');
    expect(builder.overlaps).toHaveBeenCalledWith('in_scope_asset_types', [
      'smart_contract',
      'website',
      'api',
      'mobile',
    ]);
    expect(builder.overlaps).toHaveBeenCalledWith('reward_severities', [
      'critical',
      'high',
      'medium',
      'low',
      'informational',
    ]);
    expect(builder.gte).toHaveBeenCalledWith('max_bounty', '10000.500000');
    expect(builder.gt).toHaveBeenCalledWith('available_pool', 0);
    expect(builder.not).toHaveBeenCalledWith('deadline', 'is', null);
    expect(builder.gte).toHaveBeenCalledWith('deadline', '2026-07-27T10:00:00.000Z');
    expect(builder.lte).toHaveBeenCalledWith('deadline', '2026-08-03T10:00:00.000Z');
    expect(builder.order.mock.calls).toEqual([
      ['public_status', { ascending: true }],
      ['max_bounty', { ascending: true }],
      ['id'],
    ]);
    expect(builder.range).toHaveBeenCalledWith(10, 19);
  });

  it.each([
    ['ongoing', 'is', null],
    ['30d', 'lte', '2026-08-26T10:00:00.000Z'],
  ] as const)(
    'maps closing=%s to the documented deadline predicate',
    async (closing, method, value) => {
      const { builder, repository } = repositoryHarness();

      await repository.listPublic(programListQuerySchema.parse({ closing }));

      expect(builder[method]).toHaveBeenCalledWith('deadline', value);
      if (closing === '30d') {
        expect(builder.gte).toHaveBeenCalledWith('deadline', '2026-07-27T10:00:00.000Z');
      }
    },
  );

  it('leaves funded=false as the default unfiltered pool view', async () => {
    const { builder, repository } = repositoryHarness();

    await repository.listPublic(programListQuerySchema.parse({ funded: 'false' }));

    expect(builder.gt).not.toHaveBeenCalled();
  });

  it('keeps active before ended when no lifecycle filter is selected', async () => {
    const { builder, repository } = repositoryHarness();

    await repository.listPublic(programListQuerySchema.parse({}));

    expect(builder.in).not.toHaveBeenCalled();
    expect(builder.order.mock.calls[0]).toEqual(['public_status', { ascending: true }]);
  });

  it('maps the public ended status to only expired and closed programs', async () => {
    const { builder, repository } = repositoryHarness();

    await repository.listPublic(programListQuerySchema.parse({ status: 'ended' }));

    expect(builder.in).toHaveBeenCalledWith('status', ['expired', 'closed']);
  });

  it('sorts only visible total-paid values and makes private rows deterministic and last', async () => {
    const { builder, repository } = repositoryHarness();

    await repository.listPublic(
      programListQuerySchema.parse({ sort: 'totalPaid', sortDirection: 'desc' }),
    );

    expect(builder.order.mock.calls).toEqual([
      ['public_status', { ascending: true }],
      ['public_paid_pool', { ascending: false, nullsFirst: false }],
      ['id'],
    ]);
    expect(builder.order).not.toHaveBeenCalledWith('paid_pool', expect.anything());
  });

  it('supports ascending max-bounty and descending total-paid independently', async () => {
    const maxBounty = repositoryHarness();
    const totalPaid = repositoryHarness();

    await maxBounty.repository.listPublic(
      programListQuerySchema.parse({ sort: 'maxBounty', sortDirection: 'asc' }),
    );
    await totalPaid.repository.listPublic(
      programListQuerySchema.parse({ sort: 'totalPaid', sortDirection: 'desc' }),
    );

    expect(maxBounty.builder.order).toHaveBeenCalledWith('max_bounty', { ascending: true });
    expect(totalPaid.builder.order).toHaveBeenCalledWith('public_paid_pool', {
      ascending: false,
      nullsFirst: false,
    });
  });
});

describe('GET /api/programs query contract', () => {
  let app: INestApplication;
  let listPublic: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listPublic = vi.fn().mockImplementation((query) => ({
      success: true,
      data: [],
      metadata: {
        page: query.page,
        limit: query.limit,
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: query.page > 1,
      },
    }));

    const module = await Test.createTestingModule({
      controllers: [ProgramController],
      providers: [{ provide: ProgramService, useValue: { listPublic } }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('passes the full validated filter/search/sort combination through HTTP to the service', async () => {
    await request(app.getHttpServer())
      .get('/api/programs')
      .query({
        page: '3',
        limit: '12',
        search: 'Aegis',
        status: 'active,ended',
        assetType: ['smart_contract', 'api'],
        severity: 'critical,informational',
        minMaxReward: '25000.50',
        closing: '30d',
        funded: 'true',
        sort: 'totalPaid',
        sortDirection: 'asc',
      })
      .expect(200);

    expect(listPublic).toHaveBeenCalledWith({
      page: 3,
      limit: 12,
      search: 'Aegis',
      status: ['active', 'ended'],
      assetType: ['smart_contract', 'api'],
      severity: ['critical', 'informational'],
      minMaxReward: '25000.50',
      closing: '30d',
      funded: true,
      sort: 'totalPaid',
      sortDirection: 'asc',
    });
  });

  it('falls back safely for every invalid known query value and still returns 200', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/programs')
      .query({
        page: 'zero',
        limit: '1000',
        search: 'x'.repeat(121),
        status: 'draft',
        assetType: 'desktop',
        severity: 'urgent',
        minMaxReward: '-1',
        closing: 'tomorrow',
        funded: 'yes',
        sort: 'highest',
        sortDirection: 'sideways',
      })
      .expect(200);

    expect(response.body.metadata).toMatchObject({ page: 1, limit: 20 });
    expect(listPublic).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      sort: 'newest',
    });
  });
});

describe('GET /programs OpenAPI query contract', () => {
  it('documents every advanced filter and sortable field from the shared Zod schema', async () => {
    const document = await createOpenApiDocument();
    const parameters = document.paths['/programs']?.get?.parameters;
    const byName = Object.fromEntries(
      (parameters ?? [])
        .filter((parameter) => 'name' in parameter)
        .map((parameter) => [parameter.name, parameter]),
    ) as Record<string, { schema?: { enum?: string[]; items?: { enum?: string[] } } }>;

    expect(byName['assetType']?.schema?.items?.enum).toEqual([
      'smart_contract',
      'website',
      'api',
      'mobile',
    ]);
    expect(byName['severity']?.schema?.items?.enum).toEqual([
      'critical',
      'high',
      'medium',
      'low',
      'informational',
    ]);
    expect(byName['closing']?.schema?.enum).toEqual(['7d', '30d', 'ongoing']);
    expect(byName['sort']?.schema?.enum).toEqual([
      'newest',
      'deadline',
      'name',
      'maxBounty',
      'totalPaid',
    ]);
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining([
        'page',
        'limit',
        'search',
        'status',
        'assetType',
        'severity',
        'minMaxReward',
        'closing',
        'funded',
        'sort',
        'sortDirection',
      ]),
    );
  });
});
