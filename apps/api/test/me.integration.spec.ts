import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AUTH_TOKEN_FIXTURES } from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService } from '../src/auth/auth.service.js';
import { MeController } from '../src/auth/me.controller.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import { DatabaseError } from '../src/database/database-error.js';
import type { AppLogger } from '../src/logging/app-logger.service.js';

describe('current-user HTTP integration', () => {
  let app: INestApplication;
  const userId = '10000000-0000-4000-8000-000000000001';
  const email = 'researcher@example.test';
  const researcherRow = {
    id: userId,
    role: 'researcher' as const,
    display_name: 'Researcher',
    wallet_address: null,
    avatar_url: null,
    onboarding_completed_at: '2026-07-25T00:00:00.000Z',
  };
  const onboardedOwnerRow = {
    ...researcherRow,
    role: 'owner' as const,
    display_name: 'Ada Lovelace',
    onboarding_completed_at: '2026-07-27T00:00:00.000Z',
  };
  // The real AuthService runs against this mock so the tests cover the full HTTP surface:
  // guard -> Zod pipe -> service -> exception filter. Only the RPC boundary is simulated.
  const repository = {
    findProfile: vi.fn(),
    completeOnboarding: vi.fn(),
    updateProfile: vi.fn(),
  };
  // The filter is the only component here that logs, so these spies are what "never log the
  // access token" (ACC-01 AC 6) is asserted against.
  const logger = { errorEvent: vi.fn(), warnEvent: vi.fn() };

  beforeEach(async () => {
    repository.findProfile.mockResolvedValue(researcherRow);
    repository.completeOnboarding.mockResolvedValue(undefined);
    repository.updateProfile.mockResolvedValue(undefined);
    const guard = new AuthenticationGuard(
      new Reflector(),
      {
        auth: {
          // Token-aware so an expired or malformed bearer takes the same path a real Supabase
          // rejection would, instead of being accepted because the mock ignores its argument.
          getUser: vi.fn().mockImplementation((token: string) =>
            Promise.resolve(
              token === AUTH_TOKEN_FIXTURES.valid
                ? { data: { user: { id: userId, email } }, error: null }
                : {
                    data: { user: null },
                    error: { message: 'invalid claim: missing sub claim' },
                  },
            ),
          ),
        },
      } as never,
      {
        findProfile: vi.fn().mockResolvedValue({ role: 'researcher' }),
      } as never,
      { NODE_ENV: 'test' },
    );
    const module = await Test.createTestingModule({
      controllers: [MeController],
      providers: [AuthService, { provide: AuthRepository, useValue: repository }],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalGuards(guard);
    app.useGlobalFilters(new ApiExceptionFilter(logger as unknown as AppLogger));
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns stable 401 without a verified principal', async () => {
    const response = await request(app.getHttpServer()).get('/api/me').expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    expect(repository.findProfile).not.toHaveBeenCalled();
  });

  it('returns only the safe current-user projection', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      data: {
        id: userId,
        email,
        role: 'researcher',
        displayName: 'Researcher',
        onboardingComplete: true,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('access_token');
  });

  it('rejects onboarding without authentication before touching the profile', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .send({ role: 'researcher', displayName: 'Anonymous' })
      .expect(401);

    expect(response.body.error.code).toBe('unauthorized');
    expect(repository.completeOnboarding).not.toHaveBeenCalled();
  });

  it('rejects reviewer self-assignment with a generic validation error', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .send({ role: 'reviewer', displayName: 'Forged reviewer' })
      .expect(400);

    expect(repository.completeOnboarding).not.toHaveBeenCalled();
    expect(response.body.error.code).toBe('validation_error');
    // The error must not teach the caller which values would have been accepted (§6.8).
    expect(JSON.stringify(response.body)).not.toContain('owner');
    expect(JSON.stringify(response.body)).not.toContain('researcher');
  });

  it('completes first-time onboarding and returns the fresh profile', async () => {
    repository.findProfile.mockResolvedValue(onboardedOwnerRow);

    const response = await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .send({ role: 'owner', displayName: '  Ada Lovelace  ' })
      .expect(200);

    // The RPC receives the already-trimmed name, consistent with the shared contract (ONB-04).
    expect(repository.completeOnboarding).toHaveBeenCalledWith(userId, {
      role: 'owner',
      displayName: 'Ada Lovelace',
    });
    expect(response.body).toEqual({
      success: true,
      data: {
        id: userId,
        email,
        role: 'owner',
        displayName: 'Ada Lovelace',
        onboardingComplete: true,
      },
    });
  });

  it('treats a same-data retry as an idempotent 200 with the stored profile', async () => {
    repository.findProfile.mockResolvedValue(onboardedOwnerRow);
    const submit = (): request.Test =>
      request(app.getHttpServer())
        .patch('/api/me/onboarding')
        .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
        .send({ role: 'owner', displayName: 'Ada Lovelace' });

    const first = await submit().expect(200);
    // The RPC short-circuits a same-data retry, so the second call succeeds identically.
    const retry = await submit().expect(200);

    expect(retry.body).toEqual(first.body);
    expect(retry.body.data.onboardingComplete).toBe(true);
    expect(repository.completeOnboarding).toHaveBeenCalledTimes(2);
  });

  it('surfaces a completed-onboarding conflict with its machine-readable code', async () => {
    // What normalizeDatabaseError produces when the RPC raises 23505 with
    // detail = onboarding_already_completed.
    repository.completeOnboarding.mockRejectedValue(
      new DatabaseError({
        code: 'unique_violation',
        databaseCode: '23505',
        message: 'onboarding_already_completed',
        reason: 'onboarding_already_completed',
      }),
    );

    const response = await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .send({ role: 'owner', displayName: 'Someone Else' })
      .expect(409);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('onboarding_already_completed');
    // The stored profile is never overwritten on this branch.
    expect(repository.findProfile).not.toHaveBeenCalled();
  });

  it('trims the display name before validating its length', async () => {
    const maximumName = 'a'.repeat(120);
    repository.findProfile.mockResolvedValue({
      ...onboardedOwnerRow,
      display_name: maximumName,
    });

    // 124 raw characters that trim down to the 120-character maximum must pass.
    await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .send({ role: 'owner', displayName: `  ${maximumName}  ` })
      .expect(200);

    expect(repository.completeOnboarding).toHaveBeenCalledWith(userId, {
      role: 'owner',
      displayName: maximumName,
    });

    // One character over the trimmed maximum, and whitespace-only names, are rejected.
    await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .send({ role: 'owner', displayName: 'a'.repeat(121) })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/me/onboarding')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`)
      .send({ role: 'owner', displayName: '   ' })
      .expect(400);

    expect(repository.completeOnboarding).toHaveBeenCalledTimes(1);
  });

  // ACC-01: account settings. `displayName` is the whole editable surface, so every test below
  // exists to prove the endpoint cannot be talked into writing anything else, and that each row
  // of the flow doc's error table (§10) is reachable with the status the client branches on.
  describe('PATCH /api/me', () => {
    const patch = (): request.Test =>
      request(app.getHttpServer())
        .patch('/api/me')
        .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`);

    it('rejects a profile update without a session before touching the profile', async () => {
      const missing = await request(app.getHttpServer())
        .patch('/api/me')
        .send({ displayName: 'Anonymous' })
        .expect(401);

      expect(missing.body.error.code).toBe('unauthorized');

      // An expired or malformed bearer is the same ACC-06 state, not a 400 or a 500.
      for (const token of [AUTH_TOKEN_FIXTURES.expired, AUTH_TOKEN_FIXTURES.malformed]) {
        const rejected = await request(app.getHttpServer())
          .patch('/api/me')
          .set('Authorization', `Bearer ${token}`)
          .send({ displayName: 'Anonymous' })
          .expect(401);

        expect(rejected.body.error.code).toBe('unauthorized');
      }

      expect(repository.updateProfile).not.toHaveBeenCalled();
    });

    it('rejects every field other than displayName instead of silently ignoring it', async () => {
      // Zod strips unknown keys by default, which would return a cheerful 200 while quietly
      // dropping the forged field. `.strict()` is what turns each of these into a 400.
      const forgedPayloads = [
        { displayName: 'Mallory', role: 'owner' },
        { displayName: 'Mallory', role: 'reviewer' },
        { displayName: 'Mallory', email: 'attacker@example.test' },
        { displayName: 'Mallory', walletAddress: `0x${'a'.repeat(40)}` },
        { displayName: 'Mallory', onboardingComplete: false },
        { displayName: 'Mallory', onboarding_completed_at: null },
        { displayName: 'Mallory', id: '10000000-0000-4000-8000-000000000002' },
        { displayName: 'Mallory', avatarUrl: 'https://example.test/a.png' },
      ];

      for (const payload of forgedPayloads) {
        const response = await patch().send(payload).expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('validation_error');
        // Zod reports an unrecognized key against the object itself, so the pipe's path falls back
        // to the argument name; the message is what identifies the rejection as mass-assignment.
        expect(response.body.error.details.fields).toContainEqual({
          path: 'body',
          message: 'Unknown field',
        });
      }

      // Rejected before the RPC runs, so no partial write and no audit row for a refused request.
      expect(repository.updateProfile).not.toHaveBeenCalled();
      expect(repository.completeOnboarding).not.toHaveBeenCalled();
    });

    it('writes only the display name of the authenticated subject', async () => {
      repository.findProfile.mockResolvedValue({
        ...researcherRow,
        display_name: 'Renamed Researcher',
      });

      const response = await patch().send({ displayName: '  Renamed Researcher  ' }).expect(200);

      // One argument pair, one key: the subject comes from the verified JWT and never from the
      // body, and the audited RPC (profile.display_name_changed) is the only write path used.
      expect(repository.updateProfile).toHaveBeenCalledTimes(1);
      expect(repository.updateProfile).toHaveBeenCalledWith(userId, {
        displayName: 'Renamed Researcher',
      });
      expect(Object.keys(repository.updateProfile.mock.calls[0]?.[1] ?? {})).toEqual([
        'displayName',
      ]);

      // AC 5: the response is the stored profile, so role and onboarding state are read back from
      // the row rather than echoed from the request.
      expect(response.body).toEqual({
        success: true,
        data: {
          id: userId,
          email,
          role: 'researcher',
          displayName: 'Renamed Researcher',
          onboardingComplete: true,
        },
      });
    });

    it('trims the display name before validating its 1-120 character range', async () => {
      const maximumName = 'a'.repeat(120);
      repository.findProfile.mockResolvedValue({ ...researcherRow, display_name: maximumName });

      // 124 raw characters that trim down to the 120-character maximum must pass, trimmed.
      await patch()
        .send({ displayName: `  ${maximumName}  ` })
        .expect(200);
      expect(repository.updateProfile).toHaveBeenCalledWith(userId, { displayName: maximumName });

      for (const displayName of ['a'.repeat(121), '   ', '\t\n ', '', 42, null, undefined]) {
        const response = await patch().send({ displayName }).expect(400);

        expect(response.body.error.code).toBe('validation_error');
      }

      expect(repository.updateProfile).toHaveBeenCalledTimes(1);
    });

    it('maps a forbidden profile write to 403 with its machine-readable code', async () => {
      repository.updateProfile.mockRejectedValue(
        new DatabaseError({
          code: 'forbidden',
          databaseCode: '42501',
          message: 'profile_not_accessible',
          reason: 'profile_not_accessible',
        }),
      );

      const response = await patch().send({ displayName: 'Renamed' }).expect(403);

      expect(response.body.error.code).toBe('profile_not_accessible');
      expect(repository.findProfile).not.toHaveBeenCalled();
    });

    it('maps a missing profile to 404 on both sides of the write', async () => {
      // The RPC itself raises P0002 when the row is gone before the update.
      repository.updateProfile.mockRejectedValue(
        new DatabaseError({
          code: 'not_found',
          databaseCode: 'P0002',
          message: 'profile_not_found',
          reason: 'profile_not_found',
        }),
      );

      const raised = await patch().send({ displayName: 'Renamed' }).expect(404);

      expect(raised.body.error.code).toBe('profile_not_found');

      // And the row can still disappear between the write and the read-back. Same condition, so
      // the client must see the same code rather than a conflict.
      repository.updateProfile.mockResolvedValue(undefined);
      repository.findProfile.mockResolvedValue(null);

      const raced = await patch().send({ displayName: 'Renamed' }).expect(404);

      expect(raced.body.error.code).toBe('profile_not_found');
    });

    it('maps a conflicting profile write to 409 with its machine-readable code', async () => {
      repository.updateProfile.mockRejectedValue(
        new DatabaseError({
          code: 'business_rule_violation',
          databaseCode: '22023',
          message: 'display_name_invalid',
          reason: 'display_name_invalid',
        }),
      );

      const response = await patch().send({ displayName: 'Renamed' }).expect(409);

      // The reason survives the trip: the service must not catch the DatabaseError and re-throw a
      // bare Nest exception, which would collapse this into a generic `conflict`.
      expect(response.body.error.code).toBe('display_name_invalid');
      expect(repository.findProfile).not.toHaveBeenCalled();
    });

    it('maps an unexpected database failure to 5xx without leaking its detail', async () => {
      repository.updateProfile.mockRejectedValue(
        new DatabaseError({
          code: 'unknown',
          message: 'connection to server at "db" failed: password authentication failed',
        }),
      );

      const response = await patch().send({ displayName: 'Renamed' }).expect(500);

      expect(response.body.error.code).toBe('internal_server_error');
      expect(response.body.error.message).toBe('Internal server error');
      expect(JSON.stringify(response.body)).not.toContain('password');
    });

    it('never logs or echoes the access token', async () => {
      await patch().send({ displayName: 'Renamed Researcher' }).expect(200);

      repository.updateProfile.mockRejectedValue(
        new DatabaseError({ code: 'unknown', message: 'boom' }),
      );

      const failed = await patch().send({ displayName: 'Renamed Researcher' }).expect(500);

      const logged = JSON.stringify([
        ...logger.warnEvent.mock.calls,
        ...logger.errorEvent.mock.calls,
      ]);

      expect(logger.errorEvent).toHaveBeenCalled();
      expect(logged).not.toContain(AUTH_TOKEN_FIXTURES.valid);
      expect(logged).not.toContain('Bearer');
      expect(logged).not.toContain('authorization');
      expect(JSON.stringify(failed.body)).not.toContain(AUTH_TOKEN_FIXTURES.valid);
    });
  });
});
