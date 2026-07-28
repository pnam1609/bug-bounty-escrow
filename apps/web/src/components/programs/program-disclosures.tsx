'use client';

import { publicDisclosureListResponseSchema } from '@bug-bounty-escrow/shared';
import { Button, Card, CardHeader, CardTitle, SeverityBadge } from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';

import { formatAbsoluteDate } from './program-format';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/*
 * `PG-05 · Disclosures` — the public "known issues" feed.
 *
 * This reads `GET /api/programs/:id/disclosures`, which serves owner-authored public text only:
 * the original report, its author and every private field stay out of the projection entirely.
 * The panel therefore never has to decide what is safe to show — nothing unsafe arrives.
 */

const DISCLOSURE_PAGE_SIZE = 20;

const DECISION_LABELS = {
  publish_summary: 'Sanitized summary',
  publish_full: 'Full disclosure',
} as const;

export function DisclosuresPanel({ programId }: { readonly programId: string }) {
  const query = useQuery({
    queryKey: queryKeys.programDisclosures(programId),
    queryFn: () =>
      apiRequest(
        `/api/programs/${encodeURIComponent(programId)}/disclosures?page=1&limit=${DISCLOSURE_PAGE_SIZE}`,
        publicDisclosureListResponseSchema,
      ),
  });

  const disclosures = query.data?.data ?? [];
  const summaryCount = disclosures.filter(
    (entry) => entry.decision === 'publish_summary',
  ).length;
  const fullCount = disclosures.length - summaryCount;

  return (
    <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_346px]">
      <div className="flex min-w-0 flex-col gap-xl">
        <div className="flex flex-col gap-md">
          <h2 className="text-h2 text-text">Public known issues</h2>
          <p className="text-body-sm text-text-muted">
            Only owner-approved public snapshots are shown here.
          </p>
        </div>

        {query.isPending ? (
          <p className="text-body-sm text-text-muted">Loading disclosures…</p>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-md" role="alert">
            <p className="text-body-sm text-text">Disclosures could not be loaded.</p>
            <Button onClick={() => void query.refetch()} variant="secondary">
              Try again
            </Button>
          </div>
        ) : disclosures.length === 0 ? (
          <p className="text-body-sm text-text-muted">
            No public disclosures yet. After the program ends the owner may keep each resolved
            report private, publish a summary, or publish a full disclosure.
          </p>
        ) : (
          <ul className="flex flex-col gap-md">
            {disclosures.map((disclosure) => (
              <li key={disclosure.id}>
                <Card padding="sm" variant="subtle">
                  <div className="flex flex-wrap items-center gap-sm">
                    <SeverityBadge severity={disclosure.severity} />
                    <span className="rounded-full border border-border px-md py-xs text-label-sm uppercase text-text-muted">
                      {DECISION_LABELS[disclosure.decision]}
                    </span>
                  </div>
                  <h3 className="text-h3 text-text">{disclosure.title}</h3>
                  <p className="text-label-md text-text-muted">
                    Published {formatAbsoluteDate(disclosure.publishedAt)}
                  </p>
                  <p className="whitespace-pre-line text-body-sm text-text">
                    {disclosure.summary}
                  </p>
                  {disclosure.content === undefined ? null : (
                    <details className="flex flex-col gap-sm">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-body-sm text-escrow">
                        Read the full disclosure
                      </summary>
                      <p className="whitespace-pre-line text-body-sm text-text-muted">
                        {disclosure.content}
                      </p>
                    </details>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Disclosure summary</CardTitle>
        </CardHeader>
        <p className="text-label-md text-text-muted">Owner-approved public records.</p>
        <p className="text-h3 text-text">
          {disclosures.length} published
        </p>
        <p className="text-body-sm text-text-muted">
          {summaryCount} {summaryCount === 1 ? 'summary' : 'summaries'} · {fullCount} full{' '}
          {fullCount === 1 ? 'disclosure' : 'disclosures'}
        </p>
      </Card>
    </div>
  );
}
