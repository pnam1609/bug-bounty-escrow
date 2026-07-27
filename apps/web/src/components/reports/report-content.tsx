'use client';

import { type ReportDetail, signedDownloadResponseSchema } from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  Separator,
  SeverityBadge,
} from '@bug-bounty-escrow/ui';
import { Download, ExternalLink } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { describeReportError, formatBytes, formatTimestamp } from './report-format';
import { ASSET_TYPE_LABELS } from '@/components/programs/program-format';
import { apiRequest } from '@/lib/api-client';

/*
 * No Figma source — the private report body, shared by the researcher detail screen and the
 * reviewer screen so the two can never disagree about what a report says.
 *
 * Everything below is private disclosure content. It is only ever mounted inside a route guarded
 * to the report's researcher or to an owner/reviewer; nothing here is reachable from a public
 * surface, and the standing notice at the top says so in words.
 *
 * Panel rhythm follows `components/submit-bug/step-review.tsx`: a titled section on the raised
 * surface, a definition list inside it, and researcher-authored text kept in `whitespace-pre-wrap`
 * so a reviewer reads exactly what was written.
 */

function Section({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <section className="flex flex-col gap-md rounded-md border border-border bg-surface-raised p-lg">
      <h3 className="text-label-lg font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div className="grid gap-xs sm:grid-cols-3 sm:gap-md">
      <dt className="text-label-sm uppercase text-text-muted">{label}</dt>
      <dd className="min-w-0 text-body-sm text-text sm:col-span-2">{children}</dd>
    </div>
  );
}

/**
 * The signed URL is short-lived and confidential: it is held in a local const for the length of
 * one navigation and never written to state, storage, a log or an `href` attribute.
 */
function ReportAttachments({
  attachments,
  reportId,
  token,
}: {
  readonly attachments: ReportDetail['attachments'];
  readonly reportId: string;
  readonly token: string | undefined;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function open(attachmentId: string) {
    setError(null);
    setBusyId(attachmentId);

    try {
      const response = await apiRequest(
        `/api/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachmentId)}/download-url`,
        signedDownloadResponseSchema,
        { token },
      );
      window.location.assign(response.data.downloadUrl);
    } catch (cause) {
      setError(describeReportError(cause, 'That attachment could not be opened. Try again.'));
    } finally {
      setBusyId(null);
    }
  }

  if (attachments.length === 0) {
    return <p className="text-body-sm text-text-muted">No attachment was uploaded.</p>;
  }

  return (
    <div className="flex flex-col gap-md">
      <ul className="flex flex-col gap-sm">
        {attachments.map((attachment) => (
          <li
            className="flex flex-wrap items-center justify-between gap-md rounded-md border border-border bg-surface px-lg py-md"
            key={attachment.id}
          >
            <span className="flex min-w-0 flex-col gap-xs">
              <span className="truncate text-body-sm text-text">{attachment.filename}</span>
              <span className="text-label-sm text-text-muted">
                {`${attachment.mimeType} · ${formatBytes(attachment.sizeBytes)} · added ${formatTimestamp(attachment.createdAt)}`}
              </span>
            </span>
            <Button
              loading={busyId === attachment.id}
              loadingLabel="Preparing download"
              onClick={() => void open(attachment.id)}
              variant="secondary"
            >
              <Download aria-hidden="true" className="size-4" />
              Download
              <span className="sr-only">{` ${attachment.filename}`}</span>
            </Button>
          </li>
        ))}
      </ul>
      {error === null ? null : (
        <p className="text-body-sm text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface ReportContentProps {
  readonly report: ReportDetail;
  readonly token: string | undefined;
}

export function ReportContent({ report, token }: ReportContentProps) {
  const programImpacts = report.impacts.filter((impact) => impact.source === 'program');
  const customImpacts = report.impacts.filter((impact) => impact.source !== 'program');

  return (
    <Card className="gap-xl" id="report-content" padding="lg">
      <CardHeader>
        <CardTitle>Report content</CardTitle>
      </CardHeader>

      <Callout title="Private disclosure" variant="escrow">
        This content is visible to you and the program&rsquo;s authorized reviewers only. It never
        appears on a public page; a Known Issue can only be created by an explicit owner decision
        after the program ends.
      </Callout>

      <Section title="Affected scope">
        <dl className="flex flex-col gap-md">
          <Row label="Asset">{report.affectedScope.name}</Row>
          <Row label="Asset type">{ASSET_TYPE_LABELS[report.affectedScope.assetType]}</Row>
          {report.affectedScope.assetUrl === undefined ? null : (
            <Row label="URL">
              <span className="break-all">{report.affectedScope.assetUrl}</span>
            </Row>
          )}
          {report.affectedScope.contractAddress === undefined ? null : (
            <Row label="Contract">
              <span className="break-all font-mono text-label-md">
                {report.affectedScope.contractAddress}
              </span>
            </Row>
          )}
        </dl>
      </Section>

      <Section title="Vulnerability description">
        <p className="whitespace-pre-wrap break-words text-body-sm text-text">
          {report.description}
        </p>
      </Section>

      <Section title="Claimed impacts">
        <ul className="flex flex-col gap-sm">
          {programImpacts.map((impact) => (
            <li className="flex flex-wrap items-center gap-sm" key={impact.id}>
              <span className="text-body-sm text-text">{impact.title}</span>
              <span className="text-label-sm text-text-muted">
                {ASSET_TYPE_LABELS[impact.assetType]}
              </span>
              {impact.severity === undefined ? null : <SeverityBadge severity={impact.severity} />}
            </li>
          ))}
          {customImpacts.map((impact) => (
            <li className="flex flex-wrap items-center gap-sm" key={impact.id}>
              <span className="text-body-sm text-text">{impact.title}</span>
              <span className="text-label-sm text-text-muted">
                {ASSET_TYPE_LABELS[impact.assetType]}
              </span>
              {/* A custom impact carries no program-defined severity, and the label says so
                  rather than letting the row borrow authority it does not have. */}
              <span className="inline-flex items-center rounded-full border border-border bg-surface px-md py-xs text-label-sm uppercase text-text-muted">
                Researcher proposed
              </span>
            </li>
          ))}
          {report.impacts.length === 0 ? (
            <li className="text-body-sm text-text-muted">No impact was recorded.</li>
          ) : null}
        </ul>
      </Section>

      <Section title="Proof of concept">
        {report.reproductionSteps === undefined ? (
          <p className="text-body-sm text-text-muted">
            No reproduction steps were provided. This program did not require them.
          </p>
        ) : (
          <p className="whitespace-pre-wrap break-words font-mono text-label-md text-text">
            {report.reproductionSteps}
          </p>
        )}
        {report.secretGistUrl === undefined ? null : (
          <p className="flex flex-wrap items-center gap-sm">
            <span className="text-label-sm uppercase text-text-muted">Secret Gist</span>
            {/* Researcher-supplied URL: opened without a referrer and without window access. */}
            <a
              className="inline-flex min-h-11 items-center gap-xs break-all rounded-sm text-body-sm text-low hover:underline"
              href={report.secretGistUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {report.secretGistUrl}
              <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        )}
      </Section>

      <Section title="Private attachments">
        <ReportAttachments attachments={report.attachments} reportId={report.id} token={token} />
      </Section>

      <Separator />

      <dl className="flex flex-col gap-md">
        <Row label="Filed">{formatTimestamp(report.createdAt)}</Row>
        <Row label="Severity mismatch">
          {report.severityMismatchAcknowledged
            ? 'The researcher acknowledged that their proposal differs from the highest selected impact.'
            : 'None recorded.'}
        </Row>
        <Row label="Content hash">
          {/* The hash is what makes the submitted payload tamper-evident, so it is shown in full
              rather than truncated. */}
          <span className="break-all font-mono text-label-md">{report.contentHash}</span>
        </Row>
      </dl>
    </Card>
  );
}
