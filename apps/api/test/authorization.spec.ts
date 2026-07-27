import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_TOKEN_FIXTURES } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
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
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toHaveProperty('principal.role', 'researcher');
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
