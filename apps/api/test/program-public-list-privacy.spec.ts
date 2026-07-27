import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { programListResponseSchema } from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgramController } from '../src/programs/program.controller.js';
import {
  PROGRAM_SUMMARY_PROJECTION,
  type ProgramSummaryRow,
} from '../src/programs/program.mapper.js';
import { ProgramRepository } from '../src/programs/program.repository.js';
import { ProgramService } from '../src/programs/program.service.js';

const PRIVATE_PAID_AMOUNT = '987654.321099';

function programRow(
  overrides: Partial<ProgramSummaryRow> & Pick<ProgramSummaryRow, 'id' | 'name'>,
): ProgramSummaryRow {
  const { id, name, ...remainingOverrides } = overrides;

  return {
    id,
    owner_id: '10000000-0000-4000-8000-000000000001',
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    short_summary: `${name} summary`,
    status: 'active',
    public_status: 'active',
    logo_storage_path: null,
    total_pool: '2000000.000000',
    reserved_pool: '1000.000000',
    paid_pool: '68500.250000',
    available_pool: '1930499.750000',
    paid_report_count: 4,
    total_paid_visibility: 'public',
    max_bounty: '250000.000000',
    in_scope_asset_types: ['smart_contract'],
    reward_severities: ['critical', 'high'],
    deadline: null,
    published_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    program_tags: [{ label: 'DeFi' }],
    ...remainingOverrides,
  };
}

describe('public program list total-paid privacy', () => {
  let app: INestApplication;
  let select: ReturnType<typeof vi.fn>;
  let range: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const rows: ProgramSummaryRow[] = [
      programRow({
        id: '20000000-0000-4000-8000-000000000001',
        name: 'Public payouts',
      }),
      programRow({
        id: '20000000-0000-4000-8000-000000000002',
        name: 'Private payouts',
        paid_pool: PRIVATE_PAID_AMOUNT,
        paid_report_count: 17,
        total_paid_visibility: 'private',
      }),
    ];

    range = vi.fn().mockResolvedValue({ data: rows, error: null, count: rows.length });
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};

    for (const method of [
      'eq',
      'gt',
      'gte',
      'lte',
      'in',
      'is',
      'not',
      'ilike',
      'overlaps',
      'order',
    ]) {
      builder[method] = vi.fn().mockReturnValue(builder);
    }

    builder['range'] = range;
    select = vi.fn().mockReturnValue(builder);

    const client = {
      from: vi.fn().mockReturnValue({ select }),
    } as unknown as SupabaseClient;
    const repository = new ProgramRepository(client);
    const module = await Test.createTestingModule({
      controllers: [ProgramController],
      providers: [ProgramService, { provide: ProgramRepository, useValue: repository }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns public totals and replaces private totals with null before serialization', async () => {
    const response = await request(app.getHttpServer()).get('/api/programs').expect(200);

    expect(programListResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        name: 'Public payouts',
        totalPaid: '68500.250000',
        totalPaidVisibility: 'public',
        paidReportCount: 4,
      }),
      expect.objectContaining({
        name: 'Private payouts',
        totalPaid: null,
        totalPaidVisibility: 'private',
        paidReportCount: null,
      }),
    ]);

    // This checks the actual HTTP payload, not only the parsed object. The private value must not
    // survive under another key, nested metadata, debug output, or an accidental DTO spread.
    expect(response.text).not.toContain(PRIVATE_PAID_AMOUNT);
  });

  it('reads the paid value only at the server repository boundary', async () => {
    await request(app.getHttpServer()).get('/api/programs').expect(200);

    expect(select).toHaveBeenCalledWith(PROGRAM_SUMMARY_PROJECTION, { count: 'exact' });
    expect(PROGRAM_SUMMARY_PROJECTION).toContain('paid_pool');
    expect(PROGRAM_SUMMARY_PROJECTION).toContain('total_paid_visibility');
    expect(range).toHaveBeenCalledWith(0, 19);
  });
});
