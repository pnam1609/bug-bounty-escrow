import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  AUTH_TOKEN_FIXTURES,
  reportProgramFilterOptionsResponseSchema,
} from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
import { RolesGuard } from '../src/auth/roles.guard.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import type { AppLogger } from '../src/logging/app-logger.service.js';
import { ReportController } from '../src/reports/report.controller.js';
import { ReportRepository } from '../src/reports/report.repository.js';
import { ReportService } from '../src/reports/report.service.js';

const RESEARCHER_ID = '10000000-0000-4000-8000-000000000001';
const FIRST_PROGRAM_ID = '20000000-0000-4000-8000-000000000001';
const SECOND_PROGRAM_ID = '20000000-0000-4000-8000-000000000002';

describe('MR-02 report program filter options HTTP contract', () => {
  let app: INestApplication;
  let role: 'owner' | 'researcher';
  const rpc = vi.fn();
  const logger = { errorEvent: vi.fn(), warnEvent: vi.fn() };

  beforeEach(async () => {
    role = 'researcher';
    rpc.mockResolvedValue({ data: [], error: null });

    const reflector = new Reflector();
    const authenticationGuard = new AuthenticationGuard(
      reflector,
      {
        auth: {
          getUser: vi.fn().mockImplementation((token: string) =>
            Promise.resolve(
              token === AUTH_TOKEN_FIXTURES.valid
                ? {
                    data: {
                      user: {
                        id: RESEARCHER_ID,
                        email: 'researcher@example.test',
                      },
                    },
                    error: null,
                  }
                : { data: { user: null }, error: { message: 'Invalid token' } },
            ),
          ),
        },
      } as never,
      {
        findProfile: vi.fn().mockImplementation(() => Promise.resolve({ role })),
      } as never,
    );
    const repository = new ReportRepository({ rpc } as never);
    const module = await Test.createTestingModule({
      controllers: [ReportController],
      providers: [ReportService, { provide: ReportRepository, useValue: repository }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalGuards(authenticationGuard, new RolesGuard(reflector));
    app.useGlobalFilters(new ApiExceptionFilter(logger as unknown as AppLogger));
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  function endpoint(): request.Test {
    return request(app.getHttpServer())
      .get('/api/reports/filter-options/programs')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`);
  }

  it('returns distinct options for every represented program with full-dataset counts', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: FIRST_PROGRAM_ID,
          name: 'Aegis Protocol',
          slug: 'aegis-protocol',
          report_count: 3,
        },
        {
          id: SECOND_PROGRAM_ID,
          name: 'Zenith Vault',
          slug: 'zenith-vault',
          report_count: '1',
        },
      ],
      error: null,
    });

    const response = await endpoint().expect(200);

    expect(reportProgramFilterOptionsResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toEqual({
      success: true,
      data: [
        {
          id: FIRST_PROGRAM_ID,
          name: 'Aegis Protocol',
          slug: 'aegis-protocol',
          reportCount: 3,
        },
        {
          id: SECOND_PROGRAM_ID,
          name: 'Zenith Vault',
          slug: 'zenith-vault',
          reportCount: 1,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith('researcher_report_program_filter_options', {
      actor_id: RESEARCHER_ID,
    });
  });

  it('ignores a caller-supplied researcher id and keeps the session principal as the actor', async () => {
    const response = await endpoint()
      .query({ researcherId: '10000000-0000-4000-8000-000000000099' })
      .expect(200);

    expect(response.body).toEqual({ success: true, data: [] });
    expect(rpc).toHaveBeenCalledWith('researcher_report_program_filter_options', {
      actor_id: RESEARCHER_ID,
    });
  });

  it('always derives the researcher from the session, never from a query override', async () => {
    await request(app.getHttpServer())
      .get(
        `/api/reports/filter-options/programs?researcherId=90000000-0000-4000-8000-000000000009`,
      )
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .expect(200);

    expect(rpc).toHaveBeenCalledWith('researcher_report_program_filter_options', {
      actor_id: RESEARCHER_ID,
    });
  });

  it('returns an empty array when the researcher has never submitted a report', async () => {
    const response = await endpoint().expect(200);

    expect(response.body).toEqual({ success: true, data: [] });
    expect(rpc).toHaveBeenCalledWith('researcher_report_program_filter_options', {
      actor_id: RESEARCHER_ID,
    });
  });

  it('rejects anonymous and wrong-role access before reading any report option', async () => {
    const anonymous = await request(app.getHttpServer())
      .get('/api/reports/filter-options/programs')
      .expect(401);

    expect(anonymous.body.error.code).toBe('unauthorized');
    expect(rpc).not.toHaveBeenCalled();

    role = 'owner';
    const owner = await endpoint().expect(403);

    expect(owner.body.error.code).toBe('forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });
});
