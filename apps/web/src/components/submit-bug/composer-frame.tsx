'use client';

/*
 * Page chrome for every Submit Bug state — the researcher header, the breadcrumb, the private
 * disclosure eyebrow, the stepper surface and the short in-app footer.
 *
 * Figma: SR-01 `143:26` for the desktop frame (header 80px, 1200px content column, 88px footer),
 * SR-02V `152:107` for the breadcrumb / eyebrow / title stack and the "saved locally" line.
 * Researcher screens carry no workspace sidebar, so `WorkspaceShell` is used without one.
 */

import {
  Stepper,
  SiteFooter,
  WorkspaceShell,
} from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { ResearcherHeader } from '@/components/programs/researcher-shell';

import { STEP_COUNT, SUBMIT_BUG_STEPS, type StepIndex } from './submit-bug-model';

function ShortFooter() {
  return (
    <SiteFooter
      variant="short"
      copyright="© 2026 BountyEscrow · Arc Testnet"
      legal={
        <Fragment>
          <Link href="/" className="text-label-sm text-text-muted hover:text-text">
            Privacy
          </Link>
          <Link href="/" className="text-label-sm text-text-muted hover:text-text">
            Terms
          </Link>
        </Fragment>
      }
    />
  );
}

export interface ComposerBreadcrumb {
  readonly href?: string;
  readonly label: string;
  /**
   * SR-00 — the program crumb is a skeleton until the program resolves, so the breadcrumb never
   * shows a name belonging to a previously viewed program.
   */
  readonly pending?: boolean;
}

export interface ComposerFrameProps {
  readonly breadcrumbs: readonly ComposerBreadcrumb[];
  readonly children: ReactNode;
}

/** Shell + breadcrumb only. Used by the terminal states (submitting, recovery, closed). */
export function ComposerFrame({ breadcrumbs, children }: ComposerFrameProps) {
  return (
    <WorkspaceShell header={<ResearcherHeader />} footer={<ShortFooter />}>
      <nav aria-label="Breadcrumb" className="mb-xl">
        <ol className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
          {breadcrumbs.map((crumb, index) => (
            <li key={crumb.label} className="flex items-center gap-sm">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.pending === true ? (
                <span
                  className="h-4 w-32 animate-pulse rounded-sm bg-surface-raised motion-reduce:animate-none"
                  role="presentation"
                />
              ) : crumb.href === undefined ? (
                <span aria-current="page" className="text-text">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="inline-flex min-h-11 items-center rounded-sm hover:text-text"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {children}
    </WorkspaceShell>
  );
}

export interface ComposerHeadingProps {
  /** Announced next to the title so autosave is never implied to be a server draft. */
  readonly savedLocally: boolean;
  readonly subtitle: string;
}

/**
 * Eyebrow → title → supporting copy, with the local-autosave signal on the right. The copy is
 * deliberate: the draft is browser-only because the API has no draft report state.
 */
export function ComposerHeading({ savedLocally, subtitle }: ComposerHeadingProps) {
  return (
    <div className="flex flex-col gap-lg md:flex-row md:items-start md:justify-between md:gap-2xl">
      <div className="flex flex-col gap-sm">
        <span className="inline-flex w-fit items-center rounded-full border border-escrow bg-surface-raised px-md py-xs text-label-sm uppercase text-escrow">
          Private disclosure
        </span>
        <h1 className="text-h1 text-text">Submit a vulnerability report</h1>
        <p className="max-w-2xl text-body-sm text-text-muted">{subtitle}</p>
      </div>
      <p
        className="flex shrink-0 items-center gap-sm text-label-sm text-text-muted"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={`size-sm shrink-0 rounded-full ${savedLocally ? 'bg-escrow' : 'bg-text-disabled'}`}
        />
        {savedLocally ? 'Saved in this browser' : 'Nothing saved yet'}
      </p>
    </div>
  );
}

export interface ComposerStepperProps {
  readonly currentStep: StepIndex;
}

/**
 * Desktop draws the four-node stepper inside its own raised surface, 32px below the subtitle and
 * 32px above the content card. Mobile drops to "Step N of 4" plus a progress bar, per flow doc §5.
 */
export function ComposerStepper({ currentStep }: ComposerStepperProps) {
  const step = SUBMIT_BUG_STEPS[currentStep];
  const progressLabel = `Step ${String(currentStep + 1)} of ${String(STEP_COUNT)}`;

  return (
    <div className="mt-2xl mb-2xl">
      <div className="hidden rounded-lg border border-border bg-surface p-xl md:block">
        <Stepper
          aria-label="Submit report progress"
          currentStep={currentStep}
          steps={SUBMIT_BUG_STEPS}
        />
      </div>
      <div className="flex flex-col gap-sm rounded-lg border border-border bg-surface p-lg md:hidden">
        <p className="flex items-baseline justify-between gap-md">
          <span className="text-label-md text-text-muted">{progressLabel}</span>
          <span className="text-label-lg font-semibold text-text">{step?.label}</span>
        </p>
        <div
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={1}
          aria-valuemax={STEP_COUNT}
          aria-valuenow={currentStep + 1}
          className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
        >
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${String(((currentStep + 1) / STEP_COUNT) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Two-column composer body: the 850px form card beside the 320px context rail on desktop, stacked
 * below `lg`. The rail is sticky on desktop and collapses above the form on small screens.
 */
export function ComposerColumns({
  children,
  rail,
}: {
  readonly children: ReactNode;
  readonly rail: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2xl lg:grid-cols-3 lg:items-start">
      {/* Rail first in the DOM so the collapsed program summary sits above the form on mobile;
          `order` puts it back on the right at `lg`. */}
      <div className="min-w-0 lg:sticky lg:top-2xl lg:order-2">{rail}</div>
      <div className="min-w-0 lg:order-1 lg:col-span-2">{children}</div>
    </div>
  );
}

/**
 * The action row. It stays in document flow and sits 32px below the last field — the spacing
 * contract in CONVENTIONS.md forbids overlaying the form with a floating bar.
 */
export function ComposerActions({
  primary,
  secondary,
}: {
  readonly primary: ReactNode;
  readonly secondary: ReactNode;
}) {
  return (
    <div className="mt-2xl flex flex-col-reverse gap-md sm:flex-row sm:items-center sm:justify-between">
      {secondary}
      {primary}
    </div>
  );
}

/** Centred single-column card used by SR-05, SR-06, SR-09 and SR-11. */
export function ComposerStatusCard({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-xl rounded-lg border border-border bg-surface p-2xl text-center">
      {children}
    </div>
  );
}
