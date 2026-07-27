'use client';

import { Button } from '@bug-bounty-escrow/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';

import { withReturnTo } from '../auth/use-auth-redirect';
import { ComposerStatusCard } from './composer-frame';
import { composerReturnTo } from './recovery-actions';

export function SessionExpired({ programId }: { readonly programId: string }) {
  const returnTo = composerReturnTo(programId);

  return (
    <ComposerStatusCard>
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full border border-error bg-surface-raised"
      >
        <CircleAlert className="size-6 text-error" />
      </span>
      <div className="flex flex-col gap-sm">
        <h1 className="text-h2 text-text">Your session expired before the report was submitted.</h1>
        <p className="text-body-sm text-text-muted">
          Sign in again to continue with the draft saved in this browser.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href={withReturnTo('/login', returnTo)}>Sign in again</Link>
      </Button>
    </ComposerStatusCard>
  );
}
