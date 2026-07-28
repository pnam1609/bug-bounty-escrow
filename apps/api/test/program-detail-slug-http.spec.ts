import { type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OwnerProgramController,
  ProgramController,
} from '../src/programs/program.controller.js';
import { ProgramService } from '../src/programs/program.service.js';

describe('program detail route identifiers', () => {
  let app: INestApplication;
  let getBySlug: ReturnType<typeof vi.fn>;
  let getOwned: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getBySlug = vi.fn(async (slug: string) => {
      if (slug !== 'aegis-protocol') throw new NotFoundException();
      return { id: '31000000-0000-4000-8000-000000000001', slug };
    });
    getOwned = vi.fn();

    const module = await Test.createTestingModule({
      controllers: [ProgramController, OwnerProgramController],
      providers: [
        {
          provide: ProgramService,
          useValue: {
            getOwned,
            getBySlug,
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('looks up the public detail by canonical slug', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/programs/aegis-protocol')
      .expect(200);

    expect(response.body.data).toEqual({
      id: '31000000-0000-4000-8000-000000000001',
      slug: 'aegis-protocol',
    });
    expect(getBySlug).toHaveBeenCalledWith('aegis-protocol', undefined);
    expect(getOwned).not.toHaveBeenCalled();
  });

  it('does not fall back to a program id on the public detail route', async () => {
    await request(app.getHttpServer())
      .get('/api/programs/31000000-0000-4000-8000-000000000001')
      .expect(404);

    expect(getBySlug).toHaveBeenCalledWith(
      '31000000-0000-4000-8000-000000000001',
      undefined,
    );
    expect(getOwned).not.toHaveBeenCalled();
  });

  it('rejects a non-canonical slug instead of trimming it', async () => {
    await request(app.getHttpServer()).get('/api/programs/%20aegis-protocol').expect(400);
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('keeps the owner id lookup protected', async () => {
    await request(app.getHttpServer())
      .get('/api/owner/programs/31000000-0000-4000-8000-000000000001')
      .expect(401);
    expect(getOwned).not.toHaveBeenCalled();
  });
});
