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
          role: 'owner' | 'researcher' | 'reviewer';
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
import { LandingHeader } from '@/components/landing/site-chrome';
import { AuthLayout } from '@/components/auth/auth-layout';
import { OnboardingShell } from '@/components/onboarding/onboarding-shell';
import { OwnerWorkspace } from '@/components/owner/owner-workspace';
import { ReviewShell } from '@/components/reports/review-shell';
import { ComposerFrame } from '@/components/submit-bug/composer-frame';

describe('landing header', () => {
  beforeEach(() => {
    hookState.auth.loading = false;
    hookState.auth.session = null;
    hookState.user.data = undefined;
  });

  it('keeps the four canonical marketing destinations and anonymous CTAs on the landing only', () => {
    const html = renderToStaticMarkup(createElement(LandingHeader));

    expect(html).toContain('href="/programs"');
    expect(html).toContain('>Programs<');
    expect(html).toContain('href="/#how-escrow-works"');
    expect(html).toContain('>How it works<');
    expect(html).toContain('href="/#live-escrow"');
    expect(html).toContain('>Escrow<');
    expect(html).toContain('href="/#why-bountyescrow"');
    expect(html).toContain('>Security<');
    expect(html).toContain('href="/login"');
    expect(html).toContain('>Sign in<');
    expect(html).toContain('>Launch app<');
  });

  it('does not flash Sign in while the persisted session is still being restored', () => {
    hookState.auth.loading = true;

    const html = renderToStaticMarkup(createElement(LandingHeader));

    expect(html).toContain('Loading account');
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('>Sign in<');
  });

  it('replaces anonymous CTAs with the role-aware workspace and account actions after sign-in', () => {
    hookState.auth.session = {};
    hookState.user.data = { displayName: 'Demo Owner', role: 'owner' };

    const html = renderToStaticMarkup(createElement(LandingHeader));

    expect(html).toContain('href="/owner/programs"');
    expect(html).toContain('>Open workspace<');
    expect(html).toContain('Open account menu');
    expect(html).toContain('Demo Owner');
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('>Sign in<');
    expect(html).not.toContain('>Launch app<');
  });
});

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
    expect(html).not.toContain('>How it works<');
    expect(html).not.toContain('>Escrow<');
    expect(html).not.toContain('>Security<');
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
    expect(html).not.toContain('>How it works<');
    expect(html).not.toContain('>Escrow<');
    expect(html).not.toContain('>Security<');
    expect(html.toLowerCase()).not.toContain('wallet');
  });

  it('declares the exact navigation destinations and keeps logout outside that link list', () => {
    expect(RESEARCHER_ACCOUNT_MENU_ITEMS).toEqual([
      { href: '/programs', label: 'Browse programs', disabled: false },
      { href: '/reports', label: 'My reports', disabled: false },
      { href: '/rewards', label: 'Rewards', disabled: false },
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

describe('route shell header boundaries', () => {
  beforeEach(() => {
    hookState.auth.loading = false;
    hookState.auth.session = {};
    hookState.user.data = { displayName: 'Demo Owner', role: 'owner' };
  });

  it('keeps auth and onboarding pages free of both marketing and authenticated app headers', () => {
    const authHtml = renderToStaticMarkup(
      createElement(AuthLayout, {
        aside: createElement('p', null, 'Trust proof'),
        children: createElement('p', null, 'Sign-in form'),
        eyebrow: 'WELCOME BACK',
        footnote: createElement('p', null, 'Operational'),
        headline: 'Funded security starts here.',
        lede: 'Sign in securely.',
      }),
    );
    const onboardingHtml = renderToStaticMarkup(
      createElement(OnboardingShell, {
        currentStep: 0,
        children: createElement('p', null, 'Onboarding content'),
      }),
    );

    for (const html of [authHtml, onboardingHtml]) {
      expect(html).not.toContain('aria-label="Primary"');
      expect(html).not.toContain('>How it works<');
      expect(html).not.toContain('>Escrow<');
      expect(html).not.toContain('>Security<');
      expect(html).not.toContain('>Sign in<');
    }
  });

  it('keeps owner and review routes on their workspace navigation without marketing links', () => {
    const ownerHtml = renderToStaticMarkup(
      createElement(OwnerWorkspace, null, createElement('p', null, 'Owner content')),
    );
    const reviewHtml = renderToStaticMarkup(
      createElement(ReviewShell, null, createElement('p', null, 'Review content')),
    );

    expect(ownerHtml).toContain('aria-label="Owner workspace"');
    expect(reviewHtml).toContain('aria-label="Review workspace"');
    for (const html of [ownerHtml, reviewHtml]) {
      expect(html).not.toContain('>How it works<');
      expect(html).not.toContain('>Escrow<');
      expect(html).not.toContain('>Security<');
      expect(html).not.toContain('>Sign in<');
    }
  });
});
