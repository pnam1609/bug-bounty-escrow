import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  auth: {
    loading: false,
    session: null as object | null,
  },
  user: {
    data: undefined as
      | {
          displayName: string;
          role: 'researcher';
        }
      | undefined,
  },
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => hookState.auth,
}));

vi.mock('@/hooks/use-current-user', () => ({
  useCurrentUser: () => hookState.user,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/programs',
}));

vi.mock('@/components/account/logout-action', () => ({
  LogoutMenuItem: () => createElement('span', null, 'Log out'),
}));

import {
  RESEARCHER_ACCOUNT_MENU_ITEMS,
  RESEARCHER_CONTENT_WIDTHS,
  RESEARCHER_LOGOUT_LABEL,
  ResearcherHeader,
} from '@/components/programs/researcher-shell';
import { ComposerFrame } from '@/components/submit-bug/composer-frame';

describe('researcher header', () => {
  beforeEach(() => {
    hookState.auth.loading = false;
    hookState.auth.session = null;
    hookState.user.data = undefined;
  });

  it('shows only the public authentication actions to an anonymous visitor', () => {
    const html = renderToStaticMarkup(createElement(ResearcherHeader));

    expect(html).toContain('BountyEscrow');
    expect(html).toContain('href="/login"');
    expect(html).toContain('>Sign in<');
    expect(html).toContain('href="/register"');
    expect(html).toContain('>Create account<');
    expect(html).not.toContain('Open account menu');
    expect(html.toLowerCase()).not.toContain('wallet');
  });

  it('uses the avatar and name as one Radix menu trigger for an authenticated researcher', () => {
    hookState.auth.session = {};
    hookState.user.data = { displayName: 'John Delph', role: 'researcher' };

    const html = renderToStaticMarkup(createElement(ResearcherHeader));

    expect(html).toContain('JD');
    expect(html).toContain('John Delph');
    expect(html).toContain('Open account menu');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('researcher');
    expect(html).not.toContain('>Sign in<');
    expect(html).not.toContain('>Create account<');
    expect(html).not.toContain('href="/logout"');
    expect(html.toLowerCase()).not.toContain('wallet');
  });

  it('declares the exact navigation destinations and keeps logout outside that link list', () => {
    expect(RESEARCHER_ACCOUNT_MENU_ITEMS).toEqual([
      { href: '/programs', label: 'Browse programs', disabled: false },
      { href: '/reports', label: 'My reports', disabled: false },
      { href: '/rewards', label: 'Rewards · Future', disabled: true },
      { href: '/account/settings', label: 'Account settings', disabled: false },
    ]);
    expect(RESEARCHER_LOGOUT_LABEL).toBe('Log out');
    expect(RESEARCHER_ACCOUNT_MENU_ITEMS.map((item) => item.href)).not.toContain('/logout');
  });

  it('uses only standard width utilities in the shared full-width and detail shells', () => {
    expect(RESEARCHER_CONTENT_WIDTHS).toEqual({
      table: 'max-w-7xl',
      detail: 'max-w-6xl',
    });
    expect(JSON.stringify(RESEARCHER_CONTENT_WIDTHS)).not.toMatch(/\[[^\]]*(px|rem|#)/);
  });
});

describe('submit bug shell reuse', () => {
  it('uses the shared account-menu header without fixed researcher navigation tabs', () => {
    hookState.auth.session = {};
    hookState.user.data = { displayName: 'John Delph', role: 'researcher' };

    const html = renderToStaticMarkup(
      createElement(ComposerFrame, {
        breadcrumbs: [{ href: '/programs', label: 'Programs' }, { label: 'Submit report' }],
        children: createElement('p', null, 'Composer content'),
      }),
    );

    expect(html).toContain('BountyEscrow');
    expect(html).toContain('Open account menu');
    expect(html).not.toContain('aria-label="Researcher"');
    expect(html).not.toContain('href="/logout"');
    expect(html.toLowerCase()).not.toContain('wallet');
  });
});
