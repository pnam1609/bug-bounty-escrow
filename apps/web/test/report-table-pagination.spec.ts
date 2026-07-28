import { reportSummarySchema } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { reportListHref } from '@/components/reports/report-detail-model';
import { toReportQueryKey, toReportSearchParams } from '@/components/reports/report-filters';
import { formatUsdc, REPORT_STATUS_OPTIONS } from '@/components/reports/report-format';
import { ReportPagination, reportPaginationLabel } from '@/components/reports/report-pagination';
import { ReportTable } from '@/components/reports/report-table';
import { MY_REPORTS_EVENT_NAMES, myReportsRowOpenedEvent } from '@/lib/my-reports-analytics';

const baseReport = reportSummarySchema.parse({
  id: '10000000-0000-4000-8000-000000000010',
  programId: '10000000-0000-4000-8000-000000000020',
  programName: 'Aegis Protocol',
  programSlug: 'aegis-protocol',
  researcherId: '10000000-0000-4000-8000-000000000001',
  affectedScopeId: '10000000-0000-4000-8000-000000000030',
  title:
    'Reward accounting can freeze after a cross-chain retry and this deliberately long title must clamp',
  proposedSeverity: 'critical',
  status: 'payment_pending',
  updatedAt: '2026-07-26T12:00:00.000Z',
});
const HIGH_PRECISION_REWARD = '9007199254740993.123456';

describe('MR-05 report table', () => {
  it('renders seven semantic columns without private report content', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportTable, {
        actionLabel: 'Open',
        caption: 'Private researcher reports',
        hrefFor: (report) => `/reports/${report.id}`,
        privacyDescription: 'Private to you',
        reports: [baseReport],
      }),
    );

    expect(markup.match(/<th(?:\s|>)/g)).toHaveLength(7);
    expect(markup).toContain('>Report</th>');
    expect(markup).toContain('>Program</th>');
    expect(markup).toContain('>Severity</th>');
    expect(markup).toContain('>Status</th>');
    expect(markup).toContain('>Reward</th>');
    expect(markup).toContain('>Updated</th>');
    expect(markup).toContain('>Action</th>');
    expect(markup).toContain('line-clamp-2');
    expect(markup).toContain('Aegis Protocol');
    expect(markup).not.toContain('description');
  });

  it('keeps severity provenance, pending tone, exact time and monetary precision accessible', () => {
    const finalReport = reportSummarySchema.parse({
      ...baseReport,
      approvedReward: HIGH_PRECISION_REWARD,
      finalSeverity: 'high',
    });
    const markup = renderToStaticMarkup(
      createElement(ReportTable, {
        actionLabel: 'Open',
        caption: 'Private researcher reports',
        hrefFor: (report) => `/reports/${report.id}`,
        reports: [finalReport],
      }),
    );

    expect(formatUsdc(HIGH_PRECISION_REWARD)).toBe('9,007,199,254,740,993.123456 USDC');
    expect(markup).toContain('aria-label="High, final severity"');
    expect(markup).toContain('data-status="payment_pending"');
    expect(markup).toContain('data-variant="usdc"');
    expect(markup).not.toContain('data-variant="success"');
    expect(markup).toContain('dateTime="2026-07-26T12:00:00.000Z"');
    expect(markup).toContain('aria-label="Updated ');
  });

  it('uses an em dash for an undecided reward and one focusable whole-row link', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportTable, {
        actionLabel: 'Open',
        caption: 'Private researcher reports',
        hrefFor: (report) => `/reports/${report.id}`,
        privacyDescription: 'Private to you',
        reports: [baseReport],
      }),
    );

    expect(markup).toContain('>—</span>');
    expect(markup).not.toContain('0 USDC');
    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain(`href="/reports/${baseReport.id}"`);
    expect(markup).toContain('focus-visible:after:ring-2');
  });

  it('uses the production submitted-time sorting caption', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportTable, {
        actionLabel: 'Open',
        caption: 'Private researcher reports',
        hrefFor: (report) => `/reports/${report.id}`,
        privacyDescription: 'Private to you',
        reports: [baseReport],
      }),
    );

    expect(markup).toContain('Private to you · Newest submitted first');
    expect(markup).not.toContain('updated first');
  });
});

describe('MR-05 server metadata pagination', () => {
  const metadata = {
    page: 1,
    limit: 20,
    totalItems: 126,
    totalPages: 7,
    hasNextPage: true,
    hasPreviousPage: false,
  };

  it('derives the range and disabled states from metadata', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportPagination, {
        metadata,
        onPageChange: () => undefined,
      }),
    );

    expect(reportPaginationLabel(metadata)).toBe('Showing 1–20 of 126 reports');
    expect(markup).toContain('Showing 1–20 of 126 reports');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Previous/u);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Next/u);
  });

  it('preserves filters and the selected page in API, cache and return URLs', () => {
    const filters = { severity: 'critical' as const, status: 'needs_information' as const };

    expect(toReportSearchParams(filters, 3, 20)).toBe(
      'page=3&limit=20&status=needs_information&severity=critical',
    );
    expect(toReportQueryKey(filters, 'mine', 3)).toEqual({
      scope: 'mine',
      programId: null,
      status: 'needs_information',
      severity: 'critical',
      page: 3,
    });
    expect(reportListHref(filters, 3)).toBe(
      '/reports?status=needs_information&severity=critical&page=3',
    );
  });
});

describe('MR-05 privacy-safe analytics', () => {
  it('has exactly the allowed event vocabulary and strips row identifiers/content', () => {
    expect(MY_REPORTS_EVENT_NAMES).toEqual([
      'my_reports_viewed',
      'my_reports_filter_changed',
      'my_reports_page_changed',
      'my_reports_row_opened',
      'my_reports_browse_programs_clicked',
      'my_reports_retry_clicked',
    ]);

    const privateReportInput = {
      ...baseReport,
      approvedReward: '50000',
      description: 'must never leave the report surface',
    };
    const event = myReportsRowOpenedEvent(privateReportInput);
    const serialized = JSON.stringify(event);

    expect(event).toEqual({
      name: 'my_reports_row_opened',
      properties: { severity: 'critical', statusGroup: 'settlement' },
    });
    expect(serialized).not.toContain(baseReport.id);
    expect(serialized).not.toContain(baseReport.title);
    expect(serialized).not.toContain('50000');
    expect(serialized).not.toContain('description');
  });

  it('keeps the exact ten-status contract available to the presentation layer', () => {
    expect(['draft', ...REPORT_STATUS_OPTIONS]).toEqual([
      'draft',
      'submitted',
      'triaged',
      'needs_information',
      'validated',
      'reward_approved',
      'payment_pending',
      'paid',
      'rejected',
      'duplicate',
    ]);
  });
});
