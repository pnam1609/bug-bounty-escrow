import { describe, expect, it, vi } from 'vitest';

import {
  LOGOUT_DESTINATION,
  createLogoutController,
  type LogoutDependencies,
} from '../src/components/account/logout-action';
import { ACCOUNT_SETTINGS_COPY } from '../src/components/account/account-settings-model';

function dependencies(overrides: Partial<LogoutDependencies> = {}) {
  const auth = {
    getSession: vi.fn(async () => ({ access_token: 'still-signed-in' }) as unknown),
    signOut: vi.fn(async () => undefined),
    ...overrides.auth,
  };
  const queryCache = {
    clear: vi.fn(),
    ...overrides.queryCache,
  };
  const router = {
    replace: vi.fn(),
    ...overrides.router,
  };

  return { auth, queryCache, router };
}

describe('ACC-07 logout action', () => {
  it('confirms auth invalidation before clearing protected cache and replacing the route', async () => {
    const events: string[] = [];
    const deps = dependencies({
      auth: {
        getSession: vi.fn(async () => {
          events.push('auth.getSession');
          return null;
        }),
        signOut: vi.fn(async () => {
          events.push('auth.signOut');
        }),
      },
      queryCache: {
        clear: vi.fn(() => {
          events.push('queryCache.clear');
        }),
      },
      router: {
        replace: vi.fn((href: string) => {
          events.push(`router.replace:${href}`);
        }),
      },
    });

    const result = await createLogoutController(deps).run();

    expect(result).toBe('signed-out');
    expect(events).toEqual([
      'auth.signOut',
      'queryCache.clear',
      `router.replace:${LOGOUT_DESTINATION}`,
    ]);
    expect(deps.auth.getSession).not.toHaveBeenCalled();
    expect(deps.router.replace).toHaveBeenCalledWith('/login');
  });

  it('uses a synchronous pending lock to prevent a double action before UI can repaint', async () => {
    let confirmSignOut: (() => void) | undefined;
    const signOutConfirmation = new Promise<void>((resolve) => {
      confirmSignOut = resolve;
    });
    const deps = dependencies({
      auth: {
        getSession: vi.fn(async () => ({ access_token: 'still-signed-in' })),
        signOut: vi.fn(async () => signOutConfirmation),
      },
    });
    const controller = createLogoutController(deps);

    const first = controller.run();
    const second = controller.run();

    expect(controller.isPending()).toBe(true);
    await expect(second).resolves.toBe('ignored');
    expect(deps.auth.signOut).toHaveBeenCalledTimes(1);
    expect(deps.queryCache.clear).not.toHaveBeenCalled();
    expect(deps.router.replace).not.toHaveBeenCalled();

    confirmSignOut?.();
    await expect(first).resolves.toBe('signed-out');
    expect(controller.isPending()).toBe(false);
    expect(deps.queryCache.clear).toHaveBeenCalledTimes(1);
    expect(deps.router.replace).toHaveBeenCalledTimes(1);
  });
});

describe('ACC-08 logout recovery', () => {
  it('keeps the signed-in user, page and cache intact when provider logout fails', async () => {
    let providerFails = true;
    const deps = dependencies({
      auth: {
        getSession: vi.fn(async () => ({ access_token: 'still-signed-in' })),
        signOut: vi.fn(async () => {
          if (providerFails) throw new Error('provider unavailable');
        }),
      },
    });
    const controller = createLogoutController(deps);

    await expect(controller.run()).resolves.toBe('failed');

    expect(deps.auth.getSession).toHaveBeenCalledTimes(1);
    expect(deps.queryCache.clear).not.toHaveBeenCalled();
    expect(deps.router.replace).not.toHaveBeenCalled();
    expect(controller.isPending()).toBe(false);
    expect(ACCOUNT_SETTINGS_COPY.logOut).toBe('Log out');
    expect(ACCOUNT_SETTINGS_COPY.loggingOut).toBe('Logging out…');
    expect(ACCOUNT_SETTINGS_COPY.logOutError).toBe("We couldn't log you out. Try again.");

    providerFails = false;
    await expect(controller.run()).resolves.toBe('signed-out');
    expect(deps.queryCache.clear).toHaveBeenCalledTimes(1);
    expect(deps.router.replace).toHaveBeenCalledWith('/login');
  });

  it('follows the actual lost local session despite a provider error', async () => {
    const events: string[] = [];
    const deps = dependencies({
      auth: {
        getSession: vi.fn(async () => {
          events.push('auth.getSession:null');
          return null;
        }),
        signOut: vi.fn(async () => {
          events.push('auth.signOut:error');
          throw new Error('remote response failed after local invalidation');
        }),
      },
      queryCache: {
        clear: vi.fn(() => {
          events.push('queryCache.clear');
        }),
      },
      router: {
        replace: vi.fn((href: string) => {
          events.push(`router.replace:${href}`);
        }),
      },
    });

    await expect(createLogoutController(deps).run()).resolves.toBe('signed-out');
    expect(events).toEqual([
      'auth.signOut:error',
      'auth.getSession:null',
      'queryCache.clear',
      'router.replace:/login',
    ]);
  });

  it('does not clear or route when the provider cannot confirm the actual local session', async () => {
    const deps = dependencies({
      auth: {
        getSession: vi.fn(async () => {
          throw new Error('session read failed');
        }),
        signOut: vi.fn(async () => {
          throw new Error('sign out failed');
        }),
      },
    });

    await expect(createLogoutController(deps).run()).resolves.toBe('failed');
    expect(deps.queryCache.clear).not.toHaveBeenCalled();
    expect(deps.router.replace).not.toHaveBeenCalled();
  });
});
