import { reportDetailSchema, type ReportDetail } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReportContent } from '@/components/reports/report-content';
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
    const enabled = renderToStaticMarkup(createElement(InformationRequestCallout, { report }));
    const disabled = renderToStaticMarkup(
      createElement(InformationRequestCallout, {
        report: { ...report, capabilities: { canEdit: false, canResubmit: false } },
      }),
    );

    expect(enabled).toContain('Latest reviewer request');
    expect(enabled).toContain('Include the exact block number and failing transaction.');
    expect(enabled).toContain('Edit and resubmit');
    expect(disabled).not.toContain('Edit and resubmit');
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
