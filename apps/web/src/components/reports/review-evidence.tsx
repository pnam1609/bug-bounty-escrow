'use client';

import type {
  ReportDetail,
  ReportPaidSettlementProof,
  ReportReviewEvent,
} from '@bug-bounty-escrow/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Callout,
} from '@bug-bounty-escrow/ui';
import Link from 'next/link';

import { formatTimestamp, formatUsdc, shortReportId } from './report-format';

type EvidenceReport = Pick<
  ReportDetail,
  'reviewEvents' | 'latestInformationRequest' | 'paidSettlementProof'
>;

function readable(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function actorLabel(role: ReportReviewEvent['actorRole']): string {
  if (role === 'owner') return 'Program owner';
  if (role === 'reviewer') return 'Assigned reviewer';
  if (role === 'researcher') return 'Researcher';
  return 'System';
}

function ReviewEvent({ event }: { readonly event: ReportReviewEvent }) {
  const duplicate = event.duplicateTarget;

  return (
    <li className="relative flex gap-md pl-md">
      <span
        aria-hidden="true"
        className="absolute left-0 top-1 size-2 rounded-full bg-escrow ring-4 ring-surface"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-xs border-l border-border pb-lg pl-md last:pb-0">
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <p className="text-body-sm text-text">
            <span className="font-semibold">{actorLabel(event.actorRole)}</span>{' '}
            <span>{readable(event.action)}</span>
          </p>
          <time
            className="text-label-sm text-text-muted"
            dateTime={event.occurredAt}
            title={formatTimestamp(event.occurredAt)}
          >
            {formatTimestamp(event.occurredAt)}
          </time>
        </div>
        <p className="text-label-sm text-text-muted">
          {readable(event.fromStatus)} <span aria-hidden="true">→</span> {readable(event.toStatus)}
        </p>
        {event.reason === undefined || event.reason.trim() === '' ? null : (
          <p className="whitespace-pre-wrap text-body-sm text-text-muted">{event.reason}</p>
        )}
        {duplicate === undefined ? null : (
          <div className="mt-xs flex flex-col gap-xs rounded-md border border-border bg-surface-raised p-md">
            <p className="text-label-md text-text">Original report in this program</p>
            {duplicate.title === undefined ? null : (
              <p className="text-body-sm text-text">{duplicate.title}</p>
            )}
            <div className="flex flex-wrap items-center gap-sm text-label-sm text-text-muted">
              <code aria-label={`Full original report ID ${duplicate.reportId}`}>
                {shortReportId(duplicate.reportId)}…
              </code>
              {duplicate.status === undefined ? null : <span>{readable(duplicate.status)}</span>}
              <Link
                className="text-primary hover:underline"
                href={`/review/${encodeURIComponent(duplicate.reportId)}`}
              >
                Open original report
              </Link>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function ReviewHistory({ events }: { readonly events: readonly ReportReviewEvent[] }) {
  if (events.length === 0) return null;

  return (
    <Card aria-label="Review history" className="gap-lg" padding="lg">
      <CardHeader>
        <CardTitle>Review history</CardTitle>
        <CardDescription>Private decisions and requests, in chronological order.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol aria-label="Ordered review events" className="flex flex-col">
          {events.map((event) => (
            <ReviewEvent event={event} key={event.id} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function InformationRequest({ report }: { readonly report: EvidenceReport }) {
  const request = report.latestInformationRequest;
  if (request === undefined) return null;

  return (
    <Callout title="Latest information request" variant="warning">
      <div className="flex flex-col gap-xs">
        <p className="whitespace-pre-wrap">{request.message}</p>
        <p className="text-label-sm text-text-muted">
          {request.authorRole === undefined ? 'Program team' : actorLabel(request.authorRole)} ·{' '}
          {formatTimestamp(request.requestedAt)}
        </p>
      </div>
    </Callout>
  );
}

function PaidSettlementProof({ proof }: { readonly proof: ReportPaidSettlementProof }) {
  return (
    <Card aria-label="Verified reward payment" className="gap-lg" padding="lg">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-md">
          <CardTitle>Reward payment verified</CardTitle>
          <span className="inline-flex items-center rounded-full border border-escrow bg-transparent px-md py-xs text-label-sm text-escrow">
            Paid
          </span>
        </div>
        <CardDescription>
          The server verified the exact escrow event, canonical USDC transfer, and accounting entry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-md text-body-sm sm:grid-cols-2">
          <div>
            <dt className="text-label-sm text-text-muted">Amount</dt>
            <dd className="text-text">{formatUsdc(proof.amount)}</dd>
          </div>
          <div>
            <dt className="text-label-sm text-text-muted">Recipient</dt>
            <dd className="font-mono text-text">{proof.recipientAddressMasked}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-label-sm text-text-muted">Arc transaction</dt>
            <dd className="break-all font-mono text-text">{proof.transactionHash}</dd>
          </div>
          <div>
            <dt className="text-label-sm text-text-muted">Chain / token</dt>
            <dd className="text-text">
              {proof.chainId} · <span className="font-mono">{proof.tokenAddress}</span>
            </dd>
          </div>
          <div>
            <dt className="text-label-sm text-text-muted">Block</dt>
            <dd className="font-mono text-text">{proof.blockNumber}</dd>
          </div>
        </dl>
        <ul className="mt-lg flex flex-col gap-xs text-label-sm text-text-muted">
          <li>✓ Exact RewardPaid event verified (log {proof.rewardEventLogIndex})</li>
          <li>✓ Canonical USDC Transfer verified (log {proof.transferLogIndex})</li>
          <li>✓ Accounting applied · verified {formatTimestamp(proof.verifiedAt)}</li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function ReviewEvidence({ report }: { readonly report: EvidenceReport }) {
  const events = report.reviewEvents ?? [];
  const proof = report.paidSettlementProof;

  if (events.length === 0 && report.latestInformationRequest === undefined && proof === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-xl">
      <InformationRequest report={report} />
      <ReviewHistory events={events} />
      {proof === undefined ? null : <PaidSettlementProof proof={proof} />}
    </div>
  );
}
