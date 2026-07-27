import { researcherReportSummarySchema } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ReportPageHeader,
  ReportSummaryMetrics,
  ReportSummarySkeleton,
} from '@/components/reports/report-summary';

const summary = researcherReportSummarySchema.parse({
  allReports: 17,
  needsInformation: 2,
  underReview: 5,
  rewardsPaid: '12500.500000',
  paymentToken: 'USDC',
  calculatedAt: '2026-07-27T10:00:00.000Z',
});

describe('MR-04 My reports shell and summary metrics', () => {
  it('renders the exact researcher heading hierarchy and only the specified primary journey', () => {
    const markup = renderToStaticMarkup(createElement(ReportPageHeader));

    expect(markup).toContain('Researcher workspace');
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('<h1');
    expect(markup).toContain('My reports</h1>');
    expect(markup).toContain('Track private submissions, reviewer decisions, and reward progress.');
    expect(markup).toContain('href="/programs"');
    expect(markup).toContain('Browse programs');
    expect(markup).not.toContain('Submit report');
  });

  it('renders all four whole-result-set metric definitions and formats USDC without fake values', () => {
    const markup = renderToStaticMarkup(createElement(ReportSummaryMetrics, { summary }));

    expect(markup).toContain('All reports');
    expect(markup).toContain('Needs information');
    expect(markup).toContain('Under review');
    expect(markup).toContain('Rewards paid · USDC');
    expect(markup).toContain('>17<');
    expect(markup).toContain('>2<');
    expect(markup).toContain('>5<');
    expect(markup).toContain('>12,500.5<');
  });

  it('announces a metric loading state without displaying placeholder numbers', () => {
    const markup = renderToStaticMarkup(createElement(ReportSummarySkeleton));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading report summary"');
    expect(markup).not.toContain('>0<');
  });
});
