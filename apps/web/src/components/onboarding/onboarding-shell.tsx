import { Card, SiteFooter, SiteFooterLink } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import type { ReactNode, Ref } from 'react';

import { SUPPORT_HREF } from './role-options';

/*
 * Chrome for every ONB-* desktop frame.
 *
 * Figma lays the 1440px frame out as: ambient progress rail 0→360, content area 360→1440, and a
 * short footer below the 900px fold. Those two widths and the 720px card are layout structure
 * rather than spacing, so — exactly as `WorkspaceShell` does for its 240/1200/1440 rail — they are
 * the only raw pixel values here. Everything else is a spacing/type/colour token.
 *
 * The rail stacks above the content below `lg` so the flow still works at tablet width (§11).
 */

/** Rail width, node 79:181. */
const RAIL_WIDTH = 'lg:w-[360px]';
/** Card column width, node 79:232. */
const CARD_WIDTH = 'max-w-[720px]';

export const ONBOARDING_STEPS = Object.freeze([
  Object.freeze({ id: 'account-type', label: 'Account type' }),
  Object.freeze({ id: 'profile', label: 'Profile details' }),
  Object.freeze({ id: 'confirm', label: 'Confirm' }),
]);

/**
 * Violet brand lockup used by the onboarding rail (79:183) and the forbidden state (82:414).
 *
 * `SiteBrand` hard-codes the mint escrow tile it is drawn with on in-app chrome and exposes no way
 * to reach the tile, so these two frames compose the mark locally instead of overriding it.
 */
export function BrandLockup() {
  return (
    <span className="inline-flex items-center gap-md">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-label-md [color:var(--color-primary-contrast)]"
      >
        BB
      </span>
      <span className="text-h3 text-text">BountyEscrow</span>
    </span>
  );
}

/**
 * The short footer every authentication, onboarding and in-app screen carries — the selection rule
 * documented on Figma's Footer / Desktop component (165:159).
 */
export function ShortFooter() {
  return (
    <SiteFooter
      variant="short"
      width="frame"
      copyright="© 2026 BountyEscrow · Arc Testnet"
      legal={
        <>
          <SiteFooterLink asChild>
            <Link href="/privacy">Privacy</Link>
          </SiteFooterLink>
          <SiteFooterLink asChild>
            <Link href="/terms">Terms</Link>
          </SiteFooterLink>
        </>
      }
      status={
        <p className="text-label-sm font-semibold uppercase text-escrow">
          <span aria-hidden="true">●</span> Arc testnet operational
        </p>
      }
    />
  );
}

type StepState = 'completed' | 'current' | 'upcoming';

/** Announced beside each label so progress never rests on the violet fill alone. */
const STEP_STATE_LABELS: Readonly<Record<StepState, string>> = Object.freeze({
  completed: 'Completed',
  current: 'Current step',
  upcoming: 'Upcoming',
});

function ProgressRail({ currentStep }: { readonly currentStep: number }) {
  return (
    <aside
      className={`flex w-full shrink-0 flex-col gap-3xl bg-ambient px-2xl py-2xl ${RAIL_WIDTH}`}
    >
      <BrandLockup />

      <div className="flex flex-1 flex-col justify-center gap-2xl">
        <div className="flex flex-col gap-md">
          <p className="text-label-md font-semibold uppercase text-primary">First-time setup</p>
          {/* A `<p>`, not an `<h2>`: the rail precedes the card `<h1>` in the DOM and this is an
              orientation statement rather than a section heading. */}
          <p className="text-h2 text-text">Set up the workspace that fits how you participate.</p>
        </div>

        <ol aria-label="Onboarding progress" className="flex flex-col gap-xl">
          {ONBOARDING_STEPS.map((step, index) => {
            const state: StepState =
              index < currentStep ? 'completed' : index === currentStep ? 'current' : 'upcoming';

            return (
              <li
                key={step.id}
                aria-current={state === 'current' ? 'step' : undefined}
                data-state={state}
                className="flex items-center gap-lg"
              >
                <span
                  aria-hidden="true"
                  className={`flex size-2xl shrink-0 items-center justify-center rounded-full text-label-md font-semibold ${
                    state === 'upcoming'
                      ? 'bg-surface-raised text-text-muted'
                      : 'bg-primary [color:var(--color-primary-contrast)]'
                  }`}
                >
                  {index + 1}
                </span>
                <span
                  className={
                    state === 'current'
                      ? 'text-body-sm font-semibold text-text'
                      : 'text-body-sm text-text-muted'
                  }
                >
                  {step.label}
                </span>
                <span className="sr-only">{STEP_STATE_LABELS[state]}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-md">
        <p className="text-body-sm text-text-muted">
          Reviewer access is assigned through a trusted workflow and cannot be selected here.
        </p>
        <p className="text-label-sm font-semibold uppercase text-escrow">
          <span aria-hidden="true">●</span> Arc testnet operational
        </p>
      </div>
    </aside>
  );
}

export function OnboardingShell({
  children,
  currentStep,
}: {
  readonly children: ReactNode;
  /** Zero-based index into `ONBOARDING_STEPS`. */
  readonly currentStep: number;
}) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col bg-background">
      <div className="flex flex-1 flex-col lg:flex-row">
        <ProgressRail currentStep={currentStep} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex justify-end px-2xl">
            <p className="inline-flex items-center gap-sm text-body-sm text-text-muted">
              Need help?
              <Link
                href={SUPPORT_HREF}
                className="inline-flex min-h-11 items-center rounded-sm text-text underline-offset-4 hover:underline"
              >
                Contact support
              </Link>
            </p>
          </div>

          <div className="flex flex-1 justify-center px-xl pb-3xl">
            <div className={`w-full ${CARD_WIDTH}`}>{children}</div>
          </div>
        </div>
      </div>

      <ShortFooter />
    </div>
  );
}

export function OnboardingCard({
  actions,
  children,
  eyebrow,
  headingRef,
  subtitle,
  title,
}: {
  /** Action row. Stays in document flow — the spacing contract forbids overlaying the content. */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly eyebrow?: string | undefined;
  /** Lets the flow move focus to the heading when the card swaps to an error state. */
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
  readonly subtitle?: ReactNode;
  readonly title: string;
}) {
  return (
    <Card padding="lg" className="gap-2xl">
      <div className="flex flex-col gap-md">
        {eyebrow === undefined ? null : (
          <p className="text-label-md font-semibold uppercase text-primary">{eyebrow}</p>
        )}
        <h1 ref={headingRef} tabIndex={-1} className="text-h1 text-text">
          {title}
        </h1>
        {subtitle === undefined ? null : <p className="text-body text-text-muted">{subtitle}</p>}
      </div>

      {children}

      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center justify-end gap-md">{actions}</div>
      )}
    </Card>
  );
}

/**
 * Small labelled surface used for the reviewer notice, the validation rule and the retained-data
 * panels. `Card variant="subtle"` is the same recipe one radius step up; this keeps the 10px
 * radius Figma draws on these inline notes.
 */
export function OnboardingNote({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={`flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-lg ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
