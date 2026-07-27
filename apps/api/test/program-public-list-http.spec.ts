import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgramController } from '../src/programs/program.controller.js';
import { ProgramRepository } from '../src/programs/program.repository.js';
import { ProgramService } from '../src/programs/program.service.js';

describe('GET /api/programs advanced query contract', () => {
  let app: INestApplication;
  let listPublic: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listPublic = vi.fn().mockResolvedValue({ programs: [], total: 0 });
    const module = await Test.createTestingModule({
      controllers: [ProgramController],
      providers: [ProgramService, { provide: ProgramRepository, useValue: { listPublic } }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('passes every validated filter and sort field through the thin controller/service', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/programs')
      .query({
        page: '2',
        limit: '10',
        search: 'vault',
        status: 'active,ended',
        assetType: 'smart_contract,website,api,mobile',
        severity: 'critical,high,medium,low,informational',
        minMaxReward: '10000',
        closing: 'ongoing',
        funded: 'true',
        sort: 'maxBounty',
        sortDirection: 'asc',
      })
      .expect(200);

    expect(response.body.metadata).toEqual({
      page: 2,
      limit: 10,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(listPublic).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      search: 'vault',
      status: ['active', 'ended'],
      assetType: ['smart_contract', 'website', 'api', 'mobile'],
      severity: ['critical', 'high', 'medium', 'low', 'informational'],
      minMaxReward: '10000',
      closing: 'ongoing',
      funded: true,
      sort: 'maxBounty',
      sortDirection: 'asc',
    });
  });

  it('falls invalid known values back to the safe default public view instead of 400/500', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/programs')
      .query({
        page: 'zero',
        limit: '100000',
        search: 'x'.repeat(121),
        status: 'paused',
        assetType: 'wallet',
        severity: 'urgent',
        minMaxReward: '-100',
        closing: 'soon',
        funded: 'yes',
        sort: 'secretPayout',
        sortDirection: 'sideways',
      });

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    expect(listPublic).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      sort: 'newest',
    });
  });

  it('still rejects unknown query names rather than silently widening the API', async () => {
    await request(app.getHttpServer())
      .get('/api/programs')
      .query({ ownerOnly: 'true' })
      .expect(400);

    expect(listPublic).not.toHaveBeenCalled();
  });
});
