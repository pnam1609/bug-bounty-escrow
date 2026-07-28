'use client';

/*
 * Sticky program context rail — Figma SR-01 `143:26` "Submission context" and SR-02V `152:107`
 * "Selected program context". Program context and the private-disclosure notice stay visible on
 * desktop at every step (flow doc §4.2); on small screens the rail collapses into a disclosure.
 */

import type { Program, Severity } from '@bug-bounty-escrow/shared';
import { Separator, SeverityBadge, StatusBadge } from '@bug-bounty-escrow/ui';
import { ExternalLink, Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ASSET_TYPE_LABELS, SEVERITY_DISCLAIMER, type ProgramScope } from './submit-bug-model';

function RailRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-xs">
      <dt className="text-label-sm text-text-muted uppercase">{label}</dt>
      <dd className="text-body-sm text-text">{children}</dd>
    </div>
  );
}

export interface ContextRailProps {
  readonly attachmentName: string | null;
  readonly impactCount: number;
  readonly program: Program;
  readonly proposedSeverity: Severity | '';
  readonly scope: ProgramScope | undefined;
  readonly suggestedSeverity: Severity | undefined;
}

function RailBody({
  attachmentName,
  impactCount,
  program,
  proposedSeverity,
  scope,
  suggestedSeverity,
}: ContextRailProps) {
  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-sm">
        <StatusBadge kind="program" status={program.status} className="w-fit" />
        <p className="text-h3 text-text">{program.name}</p>
        <p className="text-label-sm text-text-muted">Selected program context</p>
      </div>

      <Separator />

      <dl className="flex flex-col gap-lg">
        <RailRow label="Selected asset">
          {scope === undefined ? (
            <span className="text-text-muted">Not chosen yet</span>
          ) : (
            <>
              {scope.assetName}
              <span className="block text-label-sm text-text-muted">
                {ASSET_TYPE_LABELS[scope.assetType]}
              </span>
            </>
          )}
        </RailRow>
        <RailRow label="Selected impacts">
          {impactCount === 0 ? (
            <span className="text-text-muted">None selected</span>
          ) : (
            <span className="flex flex-wrap items-center gap-sm">
              {impactCount} selected
              {suggestedSeverity === undefined ? null : (
                <SeverityBadge severity={suggestedSeverity} label={`Highest ${suggestedSeverity}`} />
              )}
            </span>
          )}
        </RailRow>
        <RailRow label="Proposed severity">
          {proposedSeverity === '' ? (
            <span className="text-text-muted">Not chosen yet</span>
          ) : (
            <SeverityBadge severity={proposedSeverity} />
          )}
        </RailRow>
        <RailRow label="Proof of concept">
          {program.rules.pocPolicy === 'required' ? 'Required by this program' : 'Optional'}
        </RailRow>
        <RailRow label="Attachment">
          {attachmentName === null ? (
            <span className="text-text-muted">No attachment</span>
          ) : (
            <>
              1 file · uploads after the report is created
              <span className="block break-all text-label-sm text-text-muted">{attachmentName}</span>
            </>
          )}
        </RailRow>
      </dl>

      <Separator />

      <p className="flex items-start gap-sm rounded-md border border-escrow bg-surface p-md text-label-sm text-text">
        <Lock aria-hidden="true" className="mt-px size-4 shrink-0 [color:var(--color-escrow)]" />
        <span>
          Only the program&rsquo;s authorized reviewers can read this report. {SEVERITY_DISCLAIMER}
        </span>
      </p>

      <Link
        href={`/programs/${program.slug}`}
        className="inline-flex min-h-11 items-center gap-sm rounded-sm text-body-sm text-primary hover:underline"
      >
        Review full program scope
        <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </div>
  );
}

/** Desktop rail + mobile collapsible, from one set of props. */
export function ContextRail(props: ContextRailProps) {
  return (
    <>
      <aside
        aria-label="Submission context"
        className="hidden rounded-lg border border-border bg-surface-raised p-xl lg:block"
      >
        <RailBody {...props} />
      </aside>
      <details className="group rounded-lg border border-border bg-surface-raised lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-md rounded-lg p-lg text-label-lg font-semibold text-text">
          Submission context
          <span aria-hidden="true" className="text-text-muted group-open:hidden">
            Show
          </span>
          <span aria-hidden="true" className="hidden text-text-muted group-open:inline">
            Hide
          </span>
        </summary>
        <div className="px-lg pb-lg">
          <RailBody {...props} />
        </div>
      </details>
    </>
  );
}
