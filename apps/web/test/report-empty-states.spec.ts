import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  getActiveReportFilterChips,
  ReportAccountEmptyState,
  ReportFilteredEmptyState,
  resolveReportEmptyState,
} from '@/components/reports/report-empty-states';

const PROGRAM_ID = '10000000-0000-4000-8000-000000000020';

describe('MR-08 report empty-state semantics', () => {
  it('uses authoritative metadata total plus filter state, not the current page row count', () => {
    expect(resolveReportEmptyState(0, false)).toBe('account');
    expect(resolveReportEmptyState(0, true)).toBe('filtered');
    expect(resolveReportEmptyState(12, false)).toBeNull();
    expect(resolveReportEmptyState(12, true)).toBeNull();
    expect(resolveReportEmptyState(undefined, false)).toBeNull();
  });

  it('builds readable chips for every active filter without exposing an unresolved program UUID', () => {
    expect(
      getActiveReportFilterChips(
        {
          programId: PROGRAM_ID,
          status: 'needs_information',
          severity: 'critical',
        },
        [{ id: PROGRAM_ID, name: 'Aegis Protocol', slug: 'aegis-protocol' }],
      ),
    ).toEqual([
      { id: 'program', label: 'Program: Aegis Protocol' },
      { id: 'status', label: 'Status: Needs information' },
      { id: 'severity', label: 'Severity: Critical' },
    ]);

    const fallback = getActiveReportFilterChips({ programId: PROGRAM_ID }, []);
    expect(fallback).toEqual([{ id: 'program', label: 'Program: Selected program' }]);
    expect(fallback[0]?.label).not.toContain(PROGRAM_ID);
  });
});

describe('MR-08 account empty', () => {
  it('renders the report onboarding, programs CTA, privacy contract and decorative illustration', () => {
    const html = renderToStaticMarkup(
      createElement(ReportAccountEmptyState, { onBrowsePrograms: vi.fn() }),
    );

    expect(html).toContain('<h2');
    expect(html).toContain('No reports yet');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('Browse programs');
    expect(html).toContain('Choose a program');
    expect(html).toContain('Submit a private report');
    expect(html).toContain('Track review and reward');
    expect(html).toContain(
      'Report content remains participant-only unless a separate disclosure decision is published.',
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html.toLowerCase()).not.toMatch(/\bkyc\b|wallet setup|payout form/u);
  });
});

describe('MR-08 filtered empty', () => {
  it('renders active chips and clear action without onboarding or a no-submission inference', () => {
    const html = renderToStaticMarkup(
      createElement(ReportFilteredEmptyState, {
        chips: [
          { id: 'status', label: 'Status: Paid' },
          { id: 'severity', label: 'Severity: High' },
        ],
        onClearFilters: vi.fn(),
      }),
    );

    expect(html).toContain('<h2');
    expect(html).toContain('No reports match these filters');
    expect(html).toContain('aria-label="Active filters"');
    expect(html).toContain('Status: Paid');
    expect(html).toContain('Severity: High');
    expect(html).toContain('Clear filters');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('Choose a program');
    expect(html).not.toContain('Submit a private report');
    expect(html).not.toContain('Track review and reward');
    expect(html).not.toContain('No reports yet');
  });
});
