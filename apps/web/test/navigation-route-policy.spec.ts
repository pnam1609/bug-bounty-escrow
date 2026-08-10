import { describe, expect, it } from 'vitest';

import { canRoleEnter, guardedRolesFor } from '../src/components/auth/use-auth-redirect';

/**
 * The header account menu is role-driven, so its destinations must agree with the guarded route
 * groups. This matrix keeps a menu refactor from accidentally offering a route that the same role
 * can never enter (or from dropping the shared account settings route from a role's shell).
 */
describe('role navigation route policy', () => {
  it('keeps owner and researcher destinations disjoint', () => {
    expect(canRoleEnter('owner', '/owner/programs')).toBe(true);
    expect(canRoleEnter('owner', '/review')).toBe(true);
    expect(canRoleEnter('owner', '/reports')).toBe(false);
    expect(canRoleEnter('owner', '/rewards')).toBe(false);

    expect(canRoleEnter('researcher', '/programs')).toBe(true);
    expect(canRoleEnter('researcher', '/reports')).toBe(true);
    expect(canRoleEnter('researcher', '/rewards')).toBe(true);
    expect(canRoleEnter('researcher', '/owner/programs')).toBe(false);
    expect(canRoleEnter('researcher', '/review')).toBe(false);
  });

  it('keeps reviewer access limited to review surfaces', () => {
    expect(canRoleEnter('reviewer', '/review')).toBe(true);
    expect(canRoleEnter('reviewer', '/review/abc')).toBe(true);
    expect(canRoleEnter('reviewer', '/owner/programs')).toBe(false);
    expect(canRoleEnter('reviewer', '/reports')).toBe(false);
    expect(canRoleEnter('reviewer', '/rewards')).toBe(false);
  });

  it('treats account settings and public programs as shared destinations', () => {
    for (const role of ['owner', 'researcher', 'reviewer'] as const) {
      expect(canRoleEnter(role, '/account/settings')).toBe(true);
      expect(canRoleEnter(role, '/programs')).toBe(true);
    }
    expect(guardedRolesFor('/account/settings')).toBeNull();
    expect(guardedRolesFor('/programs')).toBeNull();
  });

  it('matches guarded prefixes only at path boundaries', () => {
    expect(guardedRolesFor('/owner/programs/123')).toEqual(['owner']);
    expect(guardedRolesFor('/ownerish')).toBeNull();
    expect(guardedRolesFor('/reports?status=paid')).toEqual(['researcher']);
    expect(guardedRolesFor('/review/123?tab=decision')).toEqual(['owner', 'reviewer']);
  });
});
