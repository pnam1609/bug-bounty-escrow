'use client';

import type { ReportAiReview } from '@bug-bounty-escrow/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Callout,
  SeverityBadge,
} from '@bug-bounty-escrow/ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { formatTimestamp, SEVERITY_LABELS } from './report-format';

type AiReviewAudience = 'researcher' | 'reviewer';

export interface ReportAiReviewCardProps {
  /** The server projection is intentionally optional during an API rollout. */
  readonly review: ReportAiReview | undefined;
  readonly audience: AiReviewAudience;
  /** Current immutable report projection used to fail closed on stale AI results. */
  readonly currentContentHash?: string;
  readonly currentSubmissionRevision?: number;
}

const STATUS_COPY: Readonly<
  Record<ReportAiReview['status'], { label: string; description: string }>
> = Object.freeze({
  processing: {
    label: 'Processing',
    description: 'AI review is queued for this program. You can leave this page and return later.',
  },
  ready: {
    label: 'Ready',
    description: 'A structured advisory result is available for the current report revision.',
  },
  unavailable: {
    label: 'Unavailable',
    description:
      'AI review is temporarily unavailable. Your report was submitted and human review can continue.',
  },
  superseded: {
    label: 'Superseded',
    description: 'This advisory belongs to an older report revision and is not shown.',
  },
});

const STATUS_MARKER_CLASSES: Readonly<Record<ReportAiReview['status'], string>> = Object.freeze({
  processing: 'border-low bg-transparent text-low',
  ready: 'border-escrow bg-transparent text-escrow',
  unavailable: 'border-medium bg-transparent text-medium',
  superseded: 'border-border bg-transparent text-text-muted',
});

function StatusMarker({ status }: { readonly status: ReportAiReview['status'] }) {
  return (
    <span
      className={`inline-flex items-center gap-xs rounded-full border px-md py-xs text-label-sm ${STATUS_MARKER_CLASSES[status]}`}
    >
      <span aria-hidden="true" className="size-sm shrink-0 rounded-full bg-current" />
      {STATUS_COPY[status].label}
    </span>
  );
}

export function resolveAiReviewStatus(
  review: ReportAiReview | undefined,
  currentContentHash: string | undefined,
  currentSubmissionRevision: number | undefined,
): ReportAiReview['status'] {
  const safeReview = isKnownReview(review) ? review : undefined;
  if (
    safeReview !== undefined &&
    isSupersededReview(safeReview, currentContentHash, currentSubmissionRevision)
  ) {
    return 'superseded';
  }
  if (
    safeReview !== undefined &&
    (safeReview.status === 'processing' ||
      safeReview.status === 'superseded' ||
      hasCurrentRevision(safeReview, currentContentHash, currentSubmissionRevision))
  ) {
    return safeReview.status;
  }
  return 'unavailable';
}

export function ReportAiReviewStatusBadge({
  currentContentHash,
  currentSubmissionRevision,
  review,
}: Pick<ReportAiReviewCardProps, 'review' | 'currentContentHash' | 'currentSubmissionRevision'>) {
  const status = resolveAiReviewStatus(review, currentContentHash, currentSubmissionRevision);
  return (
    <span
      aria-label={`AI review · ${STATUS_COPY[status].label}`}
      className={`inline-flex items-center gap-xs rounded-full border bg-transparent px-md py-xs text-label-sm ${STATUS_MARKER_CLASSES[status]}`}
    >
      <span aria-hidden="true" className="size-sm shrink-0 rounded-full bg-current" />
      {`AI review · ${STATUS_COPY[status].label}`}
    </span>
  );
}

function hasCurrentRevision(
  review: ReportAiReview,
  currentContentHash: string | undefined,
  currentSubmissionRevision: number | undefined,
): boolean {
  // The API projection is already revision-safe. The detail endpoint exposes the current hash;
  // when a current revision is also present, enforce both tuple members client-side.
  if (currentContentHash === undefined && currentSubmissionRevision === undefined) {
    return review.status === 'ready';
  }
  if (currentContentHash === undefined) return false;
  return (
    review.status === 'ready' &&
    review.sourceContentHash !== undefined &&
    review.sourceContentHash === currentContentHash &&
    review.submissionRevision !== undefined &&
    (currentSubmissionRevision === undefined ||
      review.submissionRevision === currentSubmissionRevision)
  );
}

function isSupersededReview(
  review: ReportAiReview,
  currentContentHash: string | undefined,
  currentSubmissionRevision: number | undefined,
): boolean {
  if (review.status !== 'ready' || currentContentHash === undefined) return false;
  return (
    (review.sourceContentHash !== undefined && review.sourceContentHash !== currentContentHash) ||
    (currentSubmissionRevision !== undefined &&
      review.submissionRevision !== undefined &&
      review.submissionRevision !== currentSubmissionRevision)
  );
}

function isKnownReview(value: unknown): value is ReportAiReview {
  if (typeof value !== 'object' || value === null) return false;
  const status = (value as { status?: unknown }).status;
  return (
    status === 'processing' ||
    status === 'ready' ||
    status === 'unavailable' ||
    status === 'superseded'
  );
}

function percentage(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Math.round(value * 100)}%`;
}

function SafeResearcherDuplicateCopy({ assessment }: { readonly assessment: string | undefined }) {
  if (assessment !== 'possible' && assessment !== 'likely') return null;

  return (
    <Callout title="Possible duplicate" variant="warning">
      A prior report may describe the same issue. The program reviewer will make the final decision.
    </Callout>
  );
}

function ReviewerCandidates({ review }: { readonly review: ReportAiReview }) {
  const candidates = review.duplicateCandidates ?? [];
  if (candidates.length === 0) return null;

  return (
    <div className="flex flex-col gap-sm">
      <p className="text-label-md text-text">Authorized duplicate candidates</p>
      <ul className="flex flex-col gap-sm" aria-label="Authorized duplicate candidates">
        {candidates.map((candidate) => (
          <li
            className="flex flex-col gap-xs rounded-md border border-border bg-surface-raised p-md"
            key={candidate.candidateReportId}
          >
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <code className="break-all text-label-sm text-text">
                {candidate.candidateReportId}
              </code>
              <span className="text-label-sm text-medium">
                {candidate.assessment} · {percentage(candidate.confidence)}
              </span>
            </div>
            <p className="text-body-sm text-text-muted">{candidate.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyDetails({
  review,
  audience,
}: {
  readonly review: ReportAiReview;
  readonly audience: AiReviewAudience;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-md">
      <div className="grid gap-md sm:grid-cols-2">
        {review.summary === undefined ? null : (
          <div className="sm:col-span-2">
            <p className="text-label-sm text-text-muted">Summary</p>
            <p className="mt-xs whitespace-pre-wrap text-body-sm text-text">{review.summary}</p>
          </div>
        )}
        {review.completenessScore === undefined ? null : (
          <div>
            <p className="text-label-sm text-text-muted">Completeness</p>
            <p className="mt-xs text-body-sm text-text">{percentage(review.completenessScore)}</p>
          </div>
        )}
        {review.suggestedSeverity === undefined ? null : (
          <div>
            <p className="text-label-sm text-text-muted">Suggested severity</p>
            <SeverityBadge
              className="mt-xs bg-transparent"
              label={`Advisory · ${SEVERITY_LABELS[review.suggestedSeverity]}`}
              severity={review.suggestedSeverity}
            />
          </div>
        )}
        {review.scopeAssessment === undefined ? null : (
          <div>
            <p className="text-label-sm text-text-muted">Scope assessment</p>
            <p className="mt-xs text-body-sm text-text">
              {review.scopeAssessment.replace('_', ' ')}
            </p>
          </div>
        )}
        {review.confidence === undefined ? null : (
          <div>
            <p className="text-label-sm text-text-muted">Confidence</p>
            <p className="mt-xs text-body-sm text-text">{percentage(review.confidence)}</p>
          </div>
        )}
        {review.duplicateAssessment === undefined ? null : (
          <div>
            <p className="text-label-sm text-text-muted">Duplicate assessment</p>
            <p className="mt-xs text-body-sm text-text">
              {review.duplicateAssessment}
              {review.duplicateConfidence === undefined
                ? ''
                : ` · ${percentage(review.duplicateConfidence)}`}
            </p>
          </div>
        )}
      </div>

      {review.missingInformation === undefined || review.missingInformation.length === 0 ? null : (
        <div>
          <p className="text-label-sm text-text-muted">Missing information</p>
          <ul className="mt-xs list-disc pl-lg text-body-sm text-text">
            {review.missingInformation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {audience === 'reviewer' ? <ReviewerCandidates review={review} /> : null}

      <button
        className="inline-flex min-h-11 items-center gap-xs self-start rounded-sm text-label-md text-low hover:underline"
        onClick={() => setExpanded((current) => !current)}
        type="button"
        aria-expanded={expanded}
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-md transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
        {expanded ? 'Hide provenance' : 'View provenance'}
      </button>
      {expanded ? (
        <dl className="grid gap-sm rounded-md border border-border bg-surface-raised p-md text-body-sm sm:grid-cols-2">
          {review.provider === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Provider</dt>
              <dd className="break-all text-text">{review.provider}</dd>
            </div>
          )}
          {review.model === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Model</dt>
              <dd className="break-all text-text">{review.model}</dd>
            </div>
          )}
          {review.generatedAt === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Generated</dt>
              <dd className="text-text">{formatTimestamp(review.generatedAt)}</dd>
            </div>
          )}
          {review.persistedAt === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Persisted</dt>
              <dd className="text-text">{formatTimestamp(review.persistedAt)}</dd>
            </div>
          )}
          {review.submissionRevision === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Revision</dt>
              <dd className="text-text">{review.submissionRevision}</dd>
            </div>
          )}
          {review.sourceContentHash === undefined ? null : (
            <div>
              <dt className="text-label-sm text-text-muted">Source hash</dt>
              <dd className="break-all font-mono text-text">{review.sourceContentHash}</dd>
            </div>
          )}
        </dl>
      ) : null}
    </div>
  );
}

export function ReportAiReviewCard({
  review,
  audience,
  currentContentHash,
  currentSubmissionRevision,
}: ReportAiReviewCardProps) {
  const status = resolveAiReviewStatus(review, currentContentHash, currentSubmissionRevision);
  const safeReview = isKnownReview(review) ? review : undefined;
  const effectiveReview: ReportAiReview =
    status === 'superseded'
      ? { ...(safeReview ?? { status: 'unavailable' }), status: 'superseded' }
      : safeReview !== undefined &&
          (safeReview.status === 'processing' ||
            safeReview.status === 'superseded' ||
            hasCurrentRevision(safeReview, currentContentHash, currentSubmissionRevision))
        ? safeReview
        : { status: 'unavailable' };
  const copy = STATUS_COPY[effectiveReview.status];

  return (
    <Card aria-label="AI suggestion" className="gap-lg" padding="lg">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-md">
          <CardTitle>AI suggestion</CardTitle>
          <StatusMarker status={effectiveReview.status} />
        </div>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>

      {effectiveReview.status === 'ready' ? (
        <CardContent>
          <ReadyDetails audience={audience} review={effectiveReview} />
        </CardContent>
      ) : null}

      {effectiveReview.status === 'processing' ? (
        <p aria-live="polite" className="text-body-sm text-text-muted">
          This advisory will appear here when the persisted result is ready.
        </p>
      ) : null}

      {effectiveReview.status === 'unavailable' || effectiveReview.status === 'superseded' ? (
        <p className="text-body-sm text-text-muted">
          Human review and report actions are still available.
        </p>
      ) : null}

      {audience === 'researcher' && effectiveReview.status === 'ready' ? (
        <SafeResearcherDuplicateCopy assessment={effectiveReview.duplicateAssessment} />
      ) : null}
    </Card>
  );
}
