import { reportSummarySchema } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReportIdCopy } from '@/components/reports/copy-value';
import {
  reportReferenceAriaLabel,
  shortReportId,
} from '@/components/reports/report-format';
import { ReportTable } from '@/components/reports/report-table';

const REPORT_ID = '10000000-0000-4000-8000-000000000010';

describe('MR-03 report reference', () => {
  it('uses the UUID prefix only as the visible presentation', () => {
    expect(shortReportId(REPORT_ID)).toBe('10000000');
    expect(reportReferenceAriaLabel(REPORT_ID)).toBe(`Full report ID ${REPORT_ID}`);
    expect(shortReportId(REPORT_ID)).not.toMatch(/^BBE-/u);
  });

  it('exposes and copies the canonical full UUID', () => {
    const markup = renderToStaticMarkup(createElement(ReportIdCopy, { id: REPORT_ID }));

    expect(markup).toContain('>10000000<');
    expect(markup).toContain(`aria-label="Full report ID ${REPORT_ID}"`);
    expect(markup).toContain('<span>Copy</span><span class="sr-only"> the full report id</span>');
    expect(markup).not.toContain('BBE-');
  });

  it('puts the accessible short UUID in the report list without inventing a BBE code', () => {
    const report = reportSummarySchema.parse({
      id: REPORT_ID,
      programId: '10000000-0000-4000-8000-000000000020',
      programName: 'Aegis Protocol',
      programSlug: 'aegis',
      researcherId: '10000000-0000-4000-8000-000000000001',
      affectedScopeId: '10000000-0000-4000-8000-000000000030',
      title: 'Reward accounting can freeze',
      proposedSeverity: 'critical',
      status: 'submitted',
      updatedAt: '2026-07-26T12:00:00.000Z',
    });
    const markup = renderToStaticMarkup(
      createElement(ReportTable, {
        actionLabel: 'View report',
        caption: 'My reports',
        hrefFor: () => `/reports/${REPORT_ID}`,
        reports: [report],
      }),
    );

    expect(markup).toContain(`aria-label="Full report ID ${REPORT_ID}"`);
    expect(markup).toContain('>10000000<span aria-hidden="true">…</span>');
    expect(markup).not.toContain('BBE-');
  });
});
