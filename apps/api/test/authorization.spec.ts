import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_TOKEN_FIXTURES } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationGuard,
  isLocalDemoIdentityWaiverActive,
} from '../src/auth/authentication.guard.js';
import { RolesGuard } from '../src/auth/roles.guard.js';

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('authentication and authorization guards', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['not-a-timestamp', false],
    ['2026-08-07T23:59:00+07:00', false],
    ['2026-02-30T00:00:00Z', false],
    ['2026-08-07T16:59:00z', false],
    ['2026-08-07T16:59:00.1Z', false],
    ['2026-08-07T16:59:00.0000Z', false],
    ['2026-08-07T16:59:00.000Z', false],
    ['2026-08-07T16:59:00.001Z', true],
  ])('evaluates the local-demo waiver %s with a deterministic clock', (allowedUntil, expected) => {
    const waiverConfig =
      allowedUntil === undefined ? {} : { LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: allowedUntil };
    expect(
      isLocalDemoIdentityWaiverActive(waiverConfig, Date.parse('2026-08-07T16:59:00.000Z')),
    ).toBe(expected);
  });

  it.each([
    undefined,
    `Bearer ${AUTH_TOKEN_FIXTURES.expired}`,
    `Bearer ${AUTH_TOKEN_FIXTURES.malformed}`,
    'Basic abc',
    'Bearer token with spaces',
  ])('rejects missing, expired or malformed authorization: %s', async (authorization) => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error('invalid'),
        }),
      },
    };
    const guard = new AuthenticationGuard(
      reflector as unknown as Reflector,
      client as never,
      { findProfile: vi.fn() } as never,
      { NODE_ENV: 'test' },
    );
    await expect(guard.canActivate(context({ headers: { authorization } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('derives the role from the profile rather than forged token metadata', async () => {
    const request = {
      headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` },
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '10000000-0000-4000-8000-000000000001',
                email: 'user@example.test',
                user_metadata: { role: 'owner' },
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile: vi.fn().mockResolvedValue({ role: 'researcher' }) } as never,
      { NODE_ENV: 'test' },
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('principal.role', 'researcher');
  });

  it.each([
    {
      id: '30000000-0000-4000-8000-000000000001',
      email: 'changed-address@example.test',
    },
    {
      id: '10000000-0000-4000-8000-000000000099',
      email: 'unexpected@local.demo',
    },
  ])('rejects local demo identities in production before loading their profile', async (user) => {
    const findProfile = vi.fn();
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: user.id,
                email: user.email,
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile } as never,
      { NODE_ENV: 'production' },
    );

    await expect(
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findProfile).not.toHaveBeenCalled();
  });

  it('rejects a deterministic demo UUID in production even when Auth omits its email', async () => {
    const findProfile = vi.fn();
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '30000000-0000-4000-8000-000000000001',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile } as never,
      { NODE_ENV: 'production' },
    );

    await expect(
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findProfile).not.toHaveBeenCalled();
  });

  it('temporarily permits a production demo identity while the waiver is unexpired', async () => {
    const request = {
      headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` },
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '30000000-0000-4000-8000-000000000001',
                email: 'owner@local.demo',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile: vi.fn().mockResolvedValue({ role: 'owner' }) } as never,
      {
        NODE_ENV: 'production',
        LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: new Date(Date.now() + 60_000).toISOString(),
      },
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('principal.role', 'owner');
  });

  it('rejects an unexpected @local.demo identity while the exact-ID waiver is active', async () => {
    const findProfile = vi.fn();
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '10000000-0000-4000-8000-000000000099',
                email: 'unexpected@local.demo',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile } as never,
      {
        NODE_ENV: 'production',
        LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: new Date(Date.now() + 60_000).toISOString(),
      },
    );

    await expect(
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findProfile).not.toHaveBeenCalled();
  });

  it('rejects an exact demo identity when the waiver is expired', async () => {
    const findProfile = vi.fn();
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '30000000-0000-4000-8000-000000000001',
                email: 'owner@local.demo',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile } as never,
      {
        NODE_ENV: 'production',
        LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: '2000-01-01T00:00:00Z',
      },
    );

    await expect(
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findProfile).not.toHaveBeenCalled();
  });

  it('rejects an unsupported phone-only Auth identity without querying its profile', async () => {
    const findProfile = vi.fn();
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '10000000-0000-4000-8000-000000000099',
                phone: '+15555550100',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile } as never,
      { NODE_ENV: 'production' },
    );

    await expect(
      guard.canActivate(
        context({ headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findProfile).not.toHaveBeenCalled();
  });

  it('keeps local demo identities available outside production', async () => {
    const request = {
      headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` },
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '30000000-0000-4000-8000-000000000001',
                email: 'owner@local.demo',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile: vi.fn().mockResolvedValue({ role: 'owner' }) } as never,
      { NODE_ENV: 'development' },
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('principal.role', 'owner');
  });

  it('does not reject an unrelated UUID that only shares the seed prefix', async () => {
    const request = {
      headers: { authorization: `Bearer ${AUTH_TOKEN_FIXTURES.valid}` },
    };
    const guard = new AuthenticationGuard(
      { getAllAndOverride: vi.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '30000000-0000-4000-8000-000000000099',
                email: 'legitimate@example.test',
              },
            },
            error: null,
          }),
        },
      } as never,
      { findProfile: vi.fn().mockResolvedValue({ role: 'researcher' }) } as never,
      { NODE_ENV: 'production' },
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
  });

  it('rejects a principal outside required roles', () => {
    const guard = new RolesGuard({
      getAllAndOverride: vi.fn().mockReturnValue(['owner']),
    } as unknown as Reflector);
    expect(() =>
      guard.canActivate(
        context({
          principal: {
            userId: '10000000-0000-4000-8000-000000000002',
            role: 'researcher',
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
