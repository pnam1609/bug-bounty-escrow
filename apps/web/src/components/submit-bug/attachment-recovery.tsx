'use client';

/*
 * SR-09 — Attachment recovery. Figma `153:109`, matched closely: a mint "report was submitted"
 * banner, the failure heading, the failed-file row tagged UPLOAD FAILED, and three actions in
 * priority order.
 *
 * This is a partial success, not a failure: the report already exists as `submitted`. So there is
 * no "Submit private report" here, retry re-sends the *same* attachment id, and nothing on this
 * screen can create a duplicate report.
 */

import { Button } from '@bug-bounty-escrow/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';

import { ComposerStatusCard } from './composer-frame';
import { formatBytes } from './submit-bug-model';

export interface AttachmentRecoveryProps {
  readonly file: File;
  readonly onContinueWithout: () => void;
  readonly onOpenReport: () => void;
  readonly onRetry: () => void;
  readonly reportId: string;
  readonly retrying: boolean;
}

export function AttachmentRecovery({
  file,
  onContinueWithout,
  onOpenReport,
  onRetry,
  reportId,
  retrying,
}: AttachmentRecoveryProps) {
  return (
    <ComposerStatusCard>
      <div
        className="flex w-full items-start gap-md rounded-md border border-escrow bg-surface-raised p-lg text-start"
        role="status"
      >
        <CircleCheck aria-hidden="true" className="mt-xs size-5 shrink-0 [color:var(--color-escrow)]" />
        <div className="flex min-w-0 flex-col gap-xs">
          <p className="text-label-lg font-semibold text-text">
            Your report was submitted, but the attachment did not finish uploading.
          </p>
          <p className="break-all text-body-sm text-text-muted">
            Report ID {reportId}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-sm">
        <h1 className="text-h2 text-text">The attachment did not finish uploading</h1>
        <p className="text-body-sm text-text-muted">
          Your report is safe. Retry only the file upload, or continue without it.
        </p>
      </div>

      <div className="flex w-full items-center gap-md rounded-md border border-medium bg-surface-raised p-lg text-start">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0 [color:var(--color-medium)]" />
        <span className="flex min-w-0 flex-1 flex-col gap-xs">
          <span className="truncate text-label-lg text-text">{file.name}</span>
          <span className="text-label-sm text-text-muted">
            {formatBytes(file.size)} · upload failed before storage confirmation
          </span>
        </span>
        <span className="shrink-0 text-label-sm font-semibold uppercase [color:var(--color-medium)]">
          Upload failed
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-md">
        <Button loading={retrying} loadingLabel="Retrying the attachment upload" onClick={onRetry}>
          Retry attachment
        </Button>
        <Button disabled={retrying} onClick={onContinueWithout} variant="secondary">
          Continue without attachment
        </Button>
        <Button disabled={retrying} onClick={onOpenReport} variant="ghost">
          Open submitted report
        </Button>
      </div>

      <p className="text-label-sm text-text-muted">
        Do not resubmit the report. You can attach proof again from this recovery step.
      </p>
    </ComposerStatusCard>
  );
}
