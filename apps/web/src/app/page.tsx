import type { ReactNode } from 'react';

import { LandingFeaturedPrograms } from '@/components/landing/featured-programs';
import { LandingFinalCta } from '@/components/landing/final-cta';
import { LandingHero } from '@/components/landing/hero';
import { LandingHowEscrowWorks } from '@/components/landing/how-escrow-works';
import { LandingFooter, LandingHeader } from '@/components/landing/site-chrome';
import { LandingTrustMetrics } from '@/components/landing/trust-metrics';
import { LandingWhyBountyEscrow } from '@/components/landing/why-bounty-escrow';

/*
 * Public landing page — Figma "Layout / Landing / Desktop" (node 55:3), 1440x3176.
 *
 * Static and server-rendered end to end: no section fetches, and nothing here is a client
 * component of its own. The interactive pieces it does use (Button, the app-shell chrome) carry
 * their own `'use client'` inside the library.
 *
 * The 1440px cap and the min-height column mirror `WorkspaceShell`, so the marketing page and the
 * app frame agree on where the page edge is.
 */
export default function HomePage(): ReactNode {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col bg-background">
      <LandingHeader />
      <main className="flex-1">
        <LandingHero />
        <LandingTrustMetrics />
        <LandingFeaturedPrograms />
        <LandingHowEscrowWorks />
        <LandingWhyBountyEscrow />
        <LandingFinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
