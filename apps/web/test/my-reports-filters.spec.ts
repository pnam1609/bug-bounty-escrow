import { reportProgramFilterOptionsResponseSchema } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  REPORT_PROGRAM_FILTER_OPTIONS_PATH,
  ReportFilterBar,
  reportFilterNavigation,
  reportFilterState,
  reportPageNavigation,
  reportResetNavigation,
  toReportQueryKey,
  toReportSearchParams,
  type ReportFilterControls,
} from '@/components/reports/report-filters';

const PROGRAM_ID = '10000000-0000-4000-8000-000000000020';

function controls(overrides: Partial<ReportFilterControls> = {}): ReportFilterControls {
  return {
    filters: {},
    isFiltered: false,
    page: 1,
    clearAll: vi.fn(() => false),
    setPage: vi.fn(() => false),
    setProgram: vi.fn(() => false),
    setSeverity: vi.fn(() => false),
    setStatus: vi.fn(() => false),
    ...overrides,
  };
}

describe('MR-06 filter bar contract', () => {
  it('renders exactly three visible Select labels and an always-present Reset action', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportFilterBar, {
        controls: controls(),
        programOptions: [{ id: PROGRAM_ID, name: 'Aegis Protocol', slug: 'aegis-protocol' }],
      }),
    );

    expect(markup).toContain('>Program</label>');
    expect(markup).toContain('>Status</label>');
    expect(markup).toContain('>Severity</label>');
    expect(markup).toContain('>Reset filters</button>');
    expect(markup).not.toContain('Search');
    expect(markup).not.toContain('<input');
  });

  it('uses the MR-02 response contract and endpoint rather than current-page rows', () => {
    expect(REPORT_PROGRAM_FILTER_OPTIONS_PATH).toBe('/api/reports/filter-options/programs');
    expect(
      reportProgramFilterOptionsResponseSchema.parse({
        success: true,
        data: [
          {
            id: PROGRAM_ID,
            name: 'Aegis Protocol',
            slug: 'aegis-protocol',
            reportCount: 47,
          },
        ],
      }).data,
    ).toEqual([
      {
        id: PROGRAM_ID,
        name: 'Aegis Protocol',
        slug: 'aegis-protocol',
        reportCount: 47,
      },
    ]);
  });
});

describe('MR-06 URL synchronization and schema safety', () => {
  it('round-trips valid single-value filters and falls back on invalid query values', () => {
    const valid = reportFilterState(
      new URLSearchParams(`programId=${PROGRAM_ID}&status=needs_information&severity=high&page=4`),
    );
    expect(valid).toEqual({
      filters: {
        programId: PROGRAM_ID,
        status: 'needs_information',
        severity: 'high',
      },
      page: 4,
    });

    expect(
      reportFilterState(
        new URLSearchParams(
          'programId=not-a-uuid&status=submitted,triaged&severity=unknown&page=0',
        ),
      ),
    ).toEqual({
      filters: {
        programId: undefined,
        status: undefined,
        severity: undefined,
      },
      page: 1,
    });
  });

  it('resets page on a filter change while preserving every other active filter', () => {
    const current = new URLSearchParams(`programId=${PROGRAM_ID}&status=submitted&page=3`);

    expect(reportFilterNavigation('/reports', current, 'severity', 'critical')).toBe(
      `/reports?programId=${PROGRAM_ID}&status=submitted&severity=critical`,
    );
    expect(
      reportFilterNavigation(
        '/reports',
        new URLSearchParams('status=submitted'),
        'status',
        'submitted',
      ),
    ).toBeNull();
    expect(
      reportFilterNavigation(
        '/reports',
        new URLSearchParams('status=submitted&page=3'),
        'status',
        'submitted',
      ),
    ).toBe('/reports?status=submitted');
  });

  it('rejects empty/out-of-schema values before navigation and never builds multi-status', () => {
    const current = new URLSearchParams();

    expect(reportFilterNavigation('/reports', current, 'programId', '')).toBeNull();
    expect(reportFilterNavigation('/reports', current, 'programId', 'other-program')).toBeNull();
    expect(reportFilterNavigation('/reports', current, 'status', 'submitted,triaged')).toBeNull();
    expect(reportFilterNavigation('/reports', current, 'severity', 'severe')).toBeNull();
  });

  it('keeps filters during pagination, guards same-page navigation and resets to defaults once', () => {
    const current = new URLSearchParams(
      `programId=${PROGRAM_ID}&status=paid&severity=critical&page=2`,
    );

    expect(reportPageNavigation('/reports', current, 3)).toBe(
      `/reports?programId=${PROGRAM_ID}&status=paid&severity=critical&page=3`,
    );
    expect(reportPageNavigation('/reports', current, 2)).toBeNull();
    expect(reportPageNavigation('/reports', current, 0)).toBeNull();
    expect(reportResetNavigation('/reports', current)).toBe('/reports');
    expect(reportResetNavigation('/reports', new URLSearchParams())).toBeNull();
  });

  it('sends only canonical API keys and includes program in the page/query cache boundary', () => {
    const filters = {
      programId: PROGRAM_ID,
      status: 'paid' as const,
      severity: 'critical' as const,
    };

    expect(toReportSearchParams(filters, 2, 20)).toBe(
      `page=2&limit=20&programId=${PROGRAM_ID}&status=paid&severity=critical`,
    );
    expect(toReportQueryKey(filters, 'mine', 2)).toEqual({
      scope: 'mine',
      programId: PROGRAM_ID,
      status: 'paid',
      severity: 'critical',
      page: 2,
    });
  });
});
