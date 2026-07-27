'use client';

/*
 * SR-04 — Review.
 *
 * Figma `148:33`: stacked summary panels each with an Edit link, a "What happens next" panel and
 * one confirmation checkbox above the action row.
 *
 * Flow doc overrides: the impacts panel labels researcher-proposed rows explicitly, shows the
 * highest selected impact alongside the proposed severity, and surfaces the mismatch
 * acknowledgement when one was recorded. No KYC, no wallet field, no public-disclosure opt-in.
 */

import type { Severity } from '@bug-bounty-escrow/shared';
import {
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CheckboxField,
  Separator,
  SeverityBadge,
} from '@bug-bounty-escrow/ui';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  ASSET_TYPE_LABELS,
  formatBytes,
  hasSeverityMismatch,
  SEVERITY_DISCLAIMER,
  type ProgramScope,
  type ReportDraft,
  type StepIndex,
} from './submit-bug-model';

export const REVIEW_PRIVACY_NOTICE =
  "Submitting shares this report with the program's authorized owner and reviewers. It will not be public by default.";

export const REVIEW_CONFIRMATION =
  'I confirm this report is accurate to the best of my knowledge and contains no secrets unrelated to this disclosure.';

export const REVIEW_NEXT_STEPS = Object.freeze([
  'The report enters review with the status Submitted.',
  'A reviewer may request more information before deciding.',
  'Final severity and reward are decided by authorized humans, not by this form.',
  'The report stays private. It can only become a public Known Issue after the program ends and the owner makes an explicit disclosure decision.',
] as const);

function SummarySection({
  children,
  editLabel,
  onEdit,
  title,
}: {
  readonly children: ReactNode;
  readonly editLabel: string;
  readonly onEdit: () => void;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-md rounded-md border border-border bg-surface-raised p-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <h3 className="text-label-lg font-semibold text-text">{title}</h3>
        <button
          aria-label={`${editLabel}: ${title}`}
          className="inline-flex min-h-11 items-center gap-sm rounded-sm px-sm text-body-sm text-primary hover:underline"
          onClick={onEdit}
          type="button"
        >
          <Pencil aria-hidden="true" className="size-4 shrink-0" />
          {editLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-xs sm:flex-row sm:gap-md">
      <dt className="text-label-sm text-text-muted uppercase sm:basis-1/3">{label}</dt>
      <dd className="min-w-0 text-body-sm text-text sm:flex-1">{children}</dd>
    </div>
  );
}

export interface StepReviewProps {
  readonly confirmed: boolean;
  readonly confirmError: string | undefined;
  readonly draft: ReportDraft;
  readonly file: File | null;
  readonly onConfirm: (confirmed: boolean) => void;
  readonly onEditStep: (step: StepIndex) => void;
  readonly programName: string;
  readonly scope: ProgramScope | undefined;
  readonly selectedImpactTitles: readonly string[];
  readonly suggestedSeverity: Severity | undefined;
}

export function StepReview({
  confirmed,
  confirmError,
  draft,
  file,
  onConfirm,
  onEditStep,
  programName,
  scope,
  selectedImpactTitles,
  suggestedSeverity,
}: StepReviewProps) {
  const customImpacts = draft.customImpacts.map((entry) => entry.trim()).filter(Boolean);
  const mismatch = hasSeverityMismatch(draft.proposedSeverity, suggestedSeverity);

  return (
    <Card padding="lg" className="gap-2xl">
      <CardHeader>
        <h2 className="text-h3">Review your private report</h2>
        <CardDescription>
          Nothing has been sent yet. Submitting is the first and only request this composer makes.
        </CardDescription>
      </CardHeader>

      <Callout variant="warning">{REVIEW_PRIVACY_NOTICE}</Callout>

      <SummarySection editLabel="Edit" onEdit={() => onEditStep(0)} title="Program and scope">
        <dl className="flex flex-col gap-md">
          <SummaryRow label="Program">{programName}</SummaryRow>
          <SummaryRow label="Affected asset">
            {scope === undefined ? 'Not selected' : scope.assetName}
          </SummaryRow>
          <SummaryRow label="Asset type">
            {scope === undefined ? '—' : ASSET_TYPE_LABELS[scope.assetType]}
          </SummaryRow>
        </dl>
      </SummarySection>

      <SummarySection editLabel="Edit impacts" onEdit={() => onEditStep(0)} title="Impacts and severity">
        <dl className="flex flex-col gap-md">
          <SummaryRow label="Program impacts">
            {selectedImpactTitles.length === 0 ? (
              <span className="text-text-muted">None selected</span>
            ) : (
              <ul className="flex list-disc flex-col gap-xs ps-lg">
                {selectedImpactTitles.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            )}
          </SummaryRow>
          {customImpacts.length === 0 ? null : (
            <SummaryRow label="Custom impacts">
              <ul className="flex flex-col gap-sm">
                {customImpacts.map((entry) => (
                  <li className="flex flex-wrap items-center gap-sm" key={entry}>
                    <span>{entry}</span>
                    <span className="inline-flex items-center rounded-full border border-border bg-surface px-md py-xs text-label-sm uppercase text-text-muted">
                      Researcher proposed
                    </span>
                  </li>
                ))}
              </ul>
            </SummaryRow>
          )}
          <SummaryRow label="Highest selected impact">
            {suggestedSeverity === undefined ? (
              <span className="text-text-muted">
                No program-defined severity — custom impacts only
              </span>
            ) : (
              <SeverityBadge severity={suggestedSeverity} />
            )}
          </SummaryRow>
          <SummaryRow label="Proposed severity">
            {draft.proposedSeverity === '' ? (
              <span className="text-text-muted">Not selected</span>
            ) : (
              <span className="flex flex-wrap items-center gap-sm">
                <SeverityBadge severity={draft.proposedSeverity} />
                <span className="text-label-sm text-text-muted">{SEVERITY_DISCLAIMER}</span>
              </span>
            )}
          </SummaryRow>
          {mismatch ? (
            <SummaryRow label="Mismatch">
              {draft.severityMismatchAcknowledged
                ? 'Acknowledged — you chose to continue with your own proposal.'
                : 'Not acknowledged yet. Go back to Severity to confirm.'}
            </SummaryRow>
          ) : null}
        </dl>
        <button
          aria-label="Edit severity: Impacts and severity"
          className="inline-flex min-h-11 w-fit items-center gap-sm rounded-sm text-body-sm text-primary hover:underline"
          onClick={() => onEditStep(1)}
          type="button"
        >
          <Pencil aria-hidden="true" className="size-4 shrink-0" />
          Edit severity
        </button>
      </SummarySection>

      <SummarySection editLabel="Edit" onEdit={() => onEditStep(2)} title="Vulnerability report">
        <dl className="flex flex-col gap-md">
          <SummaryRow label="Title">{draft.title.trim()}</SummaryRow>
          <SummaryRow label="Description">
            <p className="line-clamp-4 whitespace-pre-wrap break-words">{draft.description.trim()}</p>
          </SummaryRow>
          <SummaryRow label="PoC / reproduction">
            {draft.reproductionSteps.trim() === '' ? (
              <span className="text-text-muted">Not provided</span>
            ) : (
              <p className="line-clamp-4 whitespace-pre-wrap break-words font-mono text-label-md">
                {draft.reproductionSteps.trim()}
              </p>
            )}
          </SummaryRow>
          {draft.secretGistUrl.trim() === '' ? null : (
            <SummaryRow label="Secret Gist">
              <span className="break-all">{draft.secretGistUrl.trim()}</span>
            </SummaryRow>
          )}
          <SummaryRow label="Attachment">
            {file === null ? (
              <span className="text-text-muted">No attachment</span>
            ) : (
              `${file.name} · ${formatBytes(file.size)} · uploads after the report is created`
            )}
          </SummaryRow>
        </dl>
      </SummarySection>

      <section className="flex flex-col gap-md rounded-md border border-border bg-surface-raised p-lg">
        <h3 className="text-label-lg font-semibold text-text">What happens next</h3>
        <ol className="flex list-decimal flex-col gap-xs ps-lg text-body-sm text-text-muted">
          {REVIEW_NEXT_STEPS.map((nextStep) => (
            <li key={nextStep}>{nextStep}</li>
          ))}
        </ol>
      </section>

      <Separator />

      <CheckboxField
        checked={confirmed}
        className="rounded-md border border-border bg-surface-raised px-lg py-xs"
        error={confirmError}
        id="confirmed"
        label={REVIEW_CONFIRMATION}
        onCheckedChange={(checked) => onConfirm(checked === true)}
      />
    </Card>
  );
}
