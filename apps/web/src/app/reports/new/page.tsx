'use client';

/*
 * `/reports/new?programId=:id` — the researcher Submit Bug composer.
 *
 * The route itself only guards and routes: SR-12 wrong role and SR-13 session expiry come from
 * `RoleGuard` (which redirects to `/login` with a safe internal `returnTo`), SR-14 is the missing
 * `programId` case below, and everything from SR-00 onwards belongs to the composer.
 */

import { Button } from '@bug-bounty-escrow/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { RoleGuard } from '@/components/role-guard';
import { ErrorState, LoadingState } from '@/components/states';
import { ComposerFrame, ComposerStatusCard } from '@/components/submit-bug/composer-frame';
import {
  MISSING_PROGRAM_TITLE,
  SUBMIT_WRONG_ROLE_DESCRIPTION,
  SUBMIT_WRONG_ROLE_TITLE,
} from '@/components/submit-bug/recovery-actions';
import { SubmitBugComposer } from '@/components/submit-bug/submit-bug-composer';

/** SR-14 — the composer cannot invent a program, so it asks for one instead of guessing. */
function MissingProgram() {
  return (
    <ComposerFrame
      breadcrumbs={[{ href: '/programs', label: 'Programs' }, { label: 'Submit report' }]}
    >
      <ComposerStatusCard>
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full border border-medium bg-surface-raised"
        >
          <CircleAlert className="size-6 [color:var(--color-medium)]" />
        </span>
        <div className="flex flex-col gap-sm">
          <h1 className="text-h2 text-text">{MISSING_PROGRAM_TITLE}</h1>
          <p className="text-body-sm text-text-muted">
            A private report is always submitted to one active program, so the composer needs to
            know which scope and impacts apply.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/programs">Browse programs</Link>
        </Button>
      </ComposerStatusCard>
    </ComposerFrame>
  );
}

function NewReportContent() {
  const programId = useSearchParams().get('programId');

  if (programId === null || programId.trim() === '') return <MissingProgram />;

  // Keying on the program remounts the composer when `?programId=` changes: the route stays the
  // same, so without this the step, the file and — worse — the previous program's local draft
  // would carry over and be autosaved under the new program's key.
  return <SubmitBugComposer key={programId} programId={programId} />;
}

export default function NewReportPage() {
  return (
    <RoleGuard
      allow={['researcher']}
      fallback={{
        forbidden: (
          <ErrorState
            action={
              <Button asChild>
                <Link href="/programs">Browse programs</Link>
              </Button>
            }
            message={SUBMIT_WRONG_ROLE_DESCRIPTION}
            title={SUBMIT_WRONG_ROLE_TITLE}
          />
        ),
      }}
    >
      <Suspense fallback={<LoadingState label="Loading program and eligible scopes…" />}>
        <NewReportContent />
      </Suspense>
    </RoleGuard>
  );
}
