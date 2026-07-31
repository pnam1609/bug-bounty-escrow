import {
  reportDetailSchema,
  type ReportDetail,
  type ReportResponse,
} from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { NeedsInformationAlert } from '@/components/reports/needs-information-alert';
import { ReportContent } from '@/components/reports/report-content';
import {
  ReportAiReviewCard,
  ReportAiReviewStatusBadge,
} from '@/components/reports/report-ai-review-card';
import { ReviewEvidence } from '@/components/reports/review-evidence';
import {
  InformationRequestCallout,
  REPORT_NOT_FOUND_DESCRIPTION,
  REPORT_NOT_FOUND_TITLE,
  SUBMITTED_SUCCESS_DESCRIPTION,
  SUBMITTED_SUCCESS_TITLE,
} from '@/components/reports/report-detail-view';
import {
  reportDetailHref,
  reportListHref,
  safeReportListReturnTo,
} from '@/components/reports/report-detail-model';
import {
  finishResubmittedReport,
  RESUBMIT_REPORT_BODY,
  resubmitReportPath,
} from '@/components/reports/resubmit-report-action';

const report: ReportDetail = reportDetailSchema.parse({
  id: '10000000-0000-4000-8000-000000000010',
  programId: '10000000-0000-4000-8000-000000000020',
  programName: 'Aegis Protocol',
  programSlug: 'aegis',
  researcherId: '10000000-0000-4000-8000-000000000001',
  affectedScopeId: '10000000-0000-4000-8000-000000000030',
  affectedScope: {
    id: '10000000-0000-4000-8000-000000000030',
    assetType: 'smart_contract',
    name: 'Aegis Vault',
    contractAddress: '0x1111111111111111111111111111111111111111',
  },
  title: 'Reward accounting can freeze',
  description: 'A cross-chain retry can freeze reward accounting.',
  reproductionSteps: '1. Retry the message.\n2. Observe the frozen balance.',
  proposedSeverity: 'critical',
  status: 'needs_information',
  submittedAt: '2026-07-26T10:00:00.000Z',
  updatedAt: '2026-07-26T12:00:00.000Z',
  createdAt: '2026-07-26T10:00:00.000Z',
  severityMismatchAcknowledged: false,
  impacts: [
    {
      id: '10000000-0000-4000-8000-000000000040',
      source: 'program',
      programImpactId: '10000000-0000-4000-8000-000000000041',
      title: 'Permanent freezing of user funds',
      severity: 'critical',
      assetType: 'smart_contract',
    },
    {
      id: '10000000-0000-4000-8000-000000000042',
      source: 'custom',
      title: 'Reward accounting remains locked',
      assetType: 'smart_contract',
    },
  ],
  attachments: [
    {
      id: '10000000-0000-4000-8000-000000000050',
      filename: 'proof.txt',
      mimeType: 'text/plain',
      sizeBytes: 120,
      createdAt: '2026-07-26T10:01:00.000Z',
    },
  ],
  capabilities: { canEdit: true, canResubmit: true },
  latestInformationRequest: {
    message: 'Include the exact block number and failing transaction.',
    requestedAt: '2026-07-26T12:00:00.000Z',
  },
  contentHash: '0xhash',
});

describe('SR-12 report detail', () => {
  it('renders a non-clickable, transparent AI status badge outside the review box', () => {
    const statuses = [
      renderToStaticMarkup(
        createElement(ReportAiReviewStatusBadge, { review: { status: 'processing' } }),
      ),
      renderToStaticMarkup(
        createElement(ReportAiReviewStatusBadge, {
          currentContentHash: '0xhash',
          currentSubmissionRevision: 1,
          review: {
            status: 'ready',
            sourceContentHash: '0xhash',
            submissionRevision: 1,
          },
        }),
      ),
      renderToStaticMarkup(createElement(ReportAiReviewStatusBadge, { review: undefined })),
      renderToStaticMarkup(
        createElement(ReportAiReviewStatusBadge, {
          currentContentHash: '0xnew',
          currentSubmissionRevision: 2,
          review: {
            status: 'ready',
            sourceContentHash: '0xold',
            submissionRevision: 1,
          },
        }),
      ),
    ];

    expect(statuses[0]).toContain('AI review · Processing');
    expect(statuses[1]).toContain('AI review · Ready');
    expect(statuses[2]).toContain('AI review · Unavailable');
    expect(statuses[3]).toContain('AI review · Superseded');
    for (const markup of statuses) {
      expect(markup).toContain('bg-transparent');
      expect(markup).toContain('rounded-full border');
      expect(markup).not.toContain('<button');
      expect(markup).not.toContain('<a ');
      expect(markup).not.toMatch(/View AI review|Generate|Retry/);
    }
  });

  it('renders private review evidence without hiding duplicate context or payment proof', () => {
    const markup = renderToStaticMarkup(
      createElement(ReviewEvidence, {
        report: {
          latestInformationRequest: {
            message: 'Please include the failing transaction.',
            requestedAt: '2026-07-26T12:00:00.000Z',
            authorRole: 'reviewer',
          },
          reviewEvents: [
            {
              id: '10000000-0000-4000-8000-000000000060',
              actorRole: 'reviewer',
              action: 'mark_duplicate',
              fromStatus: 'triaged',
              toStatus: 'duplicate',
              reason: 'Same underlying issue.',
              occurredAt: '2026-07-26T13:00:00.000Z',
              duplicateTarget: {
                reportId: '10000000-0000-4000-8000-000000000061',
                sameProgram: true,
                title: 'Original finding',
                status: 'validated',
              },
            },
            {
              id: '10000000-0000-4000-8000-000000000062',
              actorRole: 'researcher',
              action: 'resubmit',
              fromStatus: 'needs_information',
              toStatus: 'submitted',
              occurredAt: '2026-07-26T13:30:00.000Z',
            },
          ],
          paidSettlementProof: {
            transactionHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            chainId: '1234',
            tokenAddress: '0x1111111111111111111111111111111111111111',
            recipientAddressMasked: '0xbbbb…bbbb',
            amount: '2500',
            blockNumber: '42',
            blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            rewardEventLogIndex: 1,
            transferLogIndex: 2,
            exactEventVerified: true,
            canonicalTransferVerified: true,
            accountingApplied: true,
            verifiedAt: '2026-07-26T14:00:00.000Z',
          },
        },
      }),
    );

    expect(markup).toContain('Review history');
    expect(markup).toContain('Assigned reviewer');
    expect(markup).toContain('Researcher');
    expect(markup).toContain('Resubmit');
    expect(markup).toContain('Original report in this program');
    expect(markup).toContain('Original finding');
    expect(markup).toContain('Reward payment verified');
    expect(markup).toContain('Exact RewardPaid event verified');
    expect(markup).toContain('Canonical USDC Transfer verified');
    expect(markup).toContain('reviewer');
    expect(markup).not.toContain('View AI review');
  });

  it('keeps AI duplicate candidates private to authorized reviewers', () => {
    const review = {
      status: 'ready' as const,
      submissionRevision: 1,
      sourceContentHash: '0xhash',
      summary: 'The report describes an access-control issue.',
      duplicateAssessment: 'likely' as const,
      duplicateConfidence: 0.94,
      duplicateCandidates: [
        {
          candidateReportId: '10000000-0000-4000-8000-000000000099',
          assessment: 'likely' as const,
          reason: 'The affected function and outcome match.',
          confidence: 0.94,
        },
      ],
    };
    const candidateId = '10000000-0000-4000-8000-000000000099';

    const researcherMarkup = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'researcher',
        currentContentHash: '0xhash',
        currentSubmissionRevision: 1,
        review,
      }),
    );
    const reviewerMarkup = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'reviewer',
        currentContentHash: '0xhash',
        currentSubmissionRevision: 1,
        review,
      }),
    );

    expect(researcherMarkup).toContain('A prior report may describe the same issue.');
    expect(researcherMarkup).not.toContain(candidateId);
    expect(reviewerMarkup).toContain(candidateId);
    expect(reviewerMarkup).toContain('Authorized duplicate candidates');
  });

  it('renders safe Processing and Unavailable states when the API has no AI projection', () => {
    const processing = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'researcher',
        review: { status: 'processing' },
      }),
    );
    const unavailable = renderToStaticMarkup(
      createElement(ReportAiReviewCard, { audience: 'researcher', review: undefined }),
    );

    expect(processing).toContain('Processing');
    expect(processing).toContain('AI review is queued for this program');
    expect(unavailable).toContain('Unavailable');
    expect(unavailable).toContain('Human review and report actions are still available.');
  });

  it('uses transparent semantic outline badges for every persisted AI state', () => {
    const states = (['processing', 'unavailable', 'superseded'] as const).map((status) =>
      renderToStaticMarkup(
        createElement(ReportAiReviewCard, { audience: 'reviewer', review: { status } }),
      ),
    );
    expect(states[0]).toContain('Processing');
    expect(states[1]).toContain('Unavailable');
    expect(states[2]).toContain('Superseded');
    for (const markup of states) {
      expect(markup).toContain('bg-transparent');
      expect(markup).toContain('rounded-full border');
    }
  });

  it('marks stale results Superseded and fails closed for unauthorized or invalid results', () => {
    const stale = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'reviewer',
        currentContentHash: '0xnew',
        currentSubmissionRevision: 2,
        review: {
          status: 'ready',
          sourceContentHash: '0xold',
          submissionRevision: 1,
          summary: 'stale result',
        },
      }),
    );
    const unauthorized = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'reviewer',
        currentContentHash: '0xnew',
        currentSubmissionRevision: 2,
        review: undefined,
      }),
    );
    const invalid = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'reviewer',
        currentContentHash: '0xnew',
        currentSubmissionRevision: 2,
        review: { status: 'corrupt' } as never,
      }),
    );
    expect(stale).toContain('Superseded');
    expect(stale).not.toContain('stale result');
    expect(unauthorized).toContain('Unavailable');
    expect(invalid).toContain('Unavailable');
  });

  it('accepts a hash-matched result when the API omits current revision metadata', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'reviewer',
        currentContentHash: '0xhash',
        review: {
          status: 'ready',
          sourceContentHash: '0xhash',
          submissionRevision: 7,
          summary: 'current result',
        },
      }),
    );
    expect(markup).toContain('current result');
    expect(markup).not.toContain('Unavailable');
  });

  it('keeps AI advisory and human decision controls separate', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportAiReviewCard, {
        audience: 'reviewer',
        currentContentHash: '0xhash',
        currentSubmissionRevision: 1,
        review: {
          status: 'ready',
          sourceContentHash: '0xhash',
          submissionRevision: 1,
          suggestedSeverity: 'high',
        },
      }),
    );
    expect(markup).toContain('Advisory · High');
    expect(markup).toContain('bg-transparent');
    expect(markup).not.toMatch(
      /Generate|Regenerate|Retry|View AI review|Validate|Request information|Reject|Duplicate|Approve reward|Payout/,
    );
  });

  it('pins the submitted-success and private-content copy', () => {
    expect(SUBMITTED_SUCCESS_TITLE).toBe('Report submitted privately');
    expect(SUBMITTED_SUCCESS_DESCRIPTION).toBe(
      "The program's authorized reviewers can now review your disclosure.",
    );
    expect(REPORT_NOT_FOUND_TITLE).toBe('Report not found');
    expect(REPORT_NOT_FOUND_DESCRIPTION).toBe(
      'The report may no longer exist or may not be available to this account.',
    );

    const markup = renderToStaticMarkup(createElement(ReportContent, { report, token: undefined }));
    expect(markup).toContain('Private disclosure');
    expect(markup).toContain('Aegis Vault');
    expect(markup).toContain('Smart contract');
    expect(markup).toContain('Permanent freezing of user funds');
    expect(markup).toContain('Reward accounting remains locked');
    expect(markup).toContain('Researcher proposed');
    expect(markup).toContain('proof.txt');
    expect(markup).not.toContain('downloadUrl');
  });

  it('highlights the latest reviewer request and obeys the server resubmit capability', () => {
    const action = createElement('span', null, 'Resubmit report');
    const enabled = renderToStaticMarkup(
      createElement(InformationRequestCallout, { action, report }),
    );
    const disabled = renderToStaticMarkup(
      createElement(InformationRequestCallout, {
        action,
        report: { ...report, capabilities: { canEdit: false, canResubmit: false } },
      }),
    );

    expect(enabled).toContain('Latest reviewer request');
    expect(enabled).toContain('Include the exact block number and failing transaction.');
    expect(enabled).toContain('Resubmit report');
    expect(disabled).not.toContain('Resubmit report');
  });

  it('renders a quiet action-required notice only for the exact needs-information filtered state', () => {
    const markup = renderToStaticMarkup(
      createElement(NeedsInformationAlert, {
        reports: [report],
        status: 'needs_information',
      }),
    );

    expect(markup).toContain('role="note"');
    expect(markup).toContain('Action required');
    expect(markup).toContain(
      'The program team needs more information before it can continue reviewing these reports.',
    );
    expect(markup).not.toContain('aria-live');
    expect(markup).not.toContain('Include the exact block number and failing transaction.');
    expect(
      renderToStaticMarkup(
        createElement(NeedsInformationAlert, {
          reports: [report],
          status: 'submitted',
        }),
      ),
    ).toBe('');
  });

  it('uses the exact resubmit contract, refreshes report lists and replaces the detail cache', async () => {
    expect(resubmitReportPath(report.id)).toBe(`/api/reports/${report.id}`);
    expect(RESUBMIT_REPORT_BODY).toEqual({ resubmit: true });

    const response = {
      success: true,
      data: { ...report, status: 'submitted' },
    } satisfies ReportResponse;
    const events: string[] = [];
    const invalidateQueries = vi.fn(async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      events.push(`invalidate:${queryKey.join('/')}`);
    });
    const setQueryData = vi.fn((queryKey: readonly unknown[], value: ReportResponse) => {
      expect(value.data.status).toBe('submitted');
      events.push(`cache:${queryKey.join('/')}`);
    });

    await finishResubmittedReport(
      { invalidateQueries, setQueryData },
      report.researcherId,
      response,
    );

    expect(events).toEqual([
      `cache:private/${report.researcherId}/report/${report.id}`,
      `invalidate:private/${report.researcherId}/reports`,
    ]);
  });

  it('round-trips filtered My Reports links and rejects unsafe return destinations', () => {
    const filtered = reportListHref({ severity: 'critical', status: 'needs_information' });
    expect(filtered).toBe('/reports?status=needs_information&severity=critical');
    expect(reportDetailHref(report.id, filtered)).toBe(
      '/reports/10000000-0000-4000-8000-000000000010?returnTo=%2Freports%3Fstatus%3Dneeds_information%26severity%3Dcritical',
    );
    expect(safeReportListReturnTo(filtered)).toBe(filtered);
    expect(safeReportListReturnTo('https://evil.example/reports')).toBe('/reports');
    expect(safeReportListReturnTo('//evil.example/reports')).toBe('/reports');
    expect(safeReportListReturnTo('/reports/private-id')).toBe('/reports');
  });
});
