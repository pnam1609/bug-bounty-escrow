import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ReportFilterSkeleton,
  ReportListPageSkeleton,
  ReportListSkeleton,
} from '@/components/reports/report-states';

describe('MR-09 stable loading geometry', () => {
  it('keeps the seven-column table contract without fake report values', () => {
    const html = renderToStaticMarkup(createElement(ReportListSkeleton, { rows: 3 }));

    expect(html).toContain('aria-label="Loading reports"');
    expect(html.match(/<th(?:\s|>)/gu)).toHaveLength(7);
    expect(html).toContain('>Report</th>');
    expect(html).toContain('>Program</th>');
    expect(html).toContain('>Severity</th>');
    expect(html).toContain('>Status</th>');
    expect(html).toContain('>Reward</th>');
    expect(html).toContain('>Updated</th>');
    expect(html).toContain('>Action</th>');
    expect(html).not.toMatch(/Critical|Needs information|Paid|0 USDC/gu);
  });

  it('keeps all three visible filter labels while controls settle', () => {
    const html = renderToStaticMarkup(createElement(ReportFilterSkeleton));

    expect(html).toContain('aria-label="Loading report filters"');
    expect(html).toContain('>Program</span>');
    expect(html).toContain('>Status</span>');
    expect(html).toContain('>Severity</span>');
    expect(html).toContain('Reset filters');
  });

  it('keeps heading, metrics, filters and table in the Suspense fallback', () => {
    const html = renderToStaticMarkup(createElement(ReportListPageSkeleton));

    expect(html).toContain('<h1');
    expect(html).toContain('My reports');
    expect(html).toContain('aria-label="Loading report summary"');
    expect(html).toContain('aria-label="Loading report filters"');
    expect(html).toContain('aria-label="Loading reports"');
  });
});
