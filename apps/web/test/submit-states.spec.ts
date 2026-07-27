import type { ReportResponse } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SuccessBanner } from '@/components/reports/report-detail-view';
import { REPORT_TIMELINE } from '@/components/reports/report-format';
import { ReportTimeline } from '@/components/reports/report-timeline';
import { finishSubmittedReport } from '@/components/submit-bug/submission-finish';
import { SubmissionProgress } from '@/components/submit-bug/submission-progress';

function renderProgress(
  props: Parameters<typeof SubmissionProgress>[0],
): string {
  return renderToStaticMarkup(createElement(SubmissionProgress, props));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SR-10 submitting and uploading states', () => {
  it('renders the exact submitting copy and the three required progress phases', () => {
    const markup = renderProgress({
      attachmentDetail: 'No attachment selected',
      creating: 'active',
      uploading: 'skipped',
      opening: 'upcoming',
    });

    expect(markup).toContain('Submitting your private report…');
    expect(markup).toContain('We’re creating the report securely. Keep this tab open.');
    expect(markup).toContain('Creating report');
    expect(markup).toMatch(/data-state="active"[^>]*>[\s\S]*?Creating report/);
    expect(markup).toMatch(/data-state="skipped"[^>]*>[\s\S]*?Uploading attachment/);
    expect(markup).toMatch(/data-state="upcoming"[^>]*>[\s\S]*?Opening report/);
  });

  it('renders the exact uploading heading, filename and indeterminate progress only', () => {
    const markup = renderProgress({
      attachmentDetail: 'poc-aegis-retry.md · 4.8 MB',
      creating: 'complete',
      uploading: 'active',
      opening: 'upcoming',
    });

    expect(markup).toContain('Report submitted. Uploading private attachment…');
    expect(markup).toContain('poc-aegis-retry.md · 4.8 MB');
    expect(markup).toMatch(/data-state="complete"[^>]*>[\s\S]*?Creating report/);
    expect(markup).toMatch(/data-state="active"[^>]*>[\s\S]*?Uploading attachment/);
    expect(markup).toMatch(/data-state="upcoming"[^>]*>[\s\S]*?Opening report/);
    expect(markup).not.toMatch(/\d+%/);
  });

  it('replaces the composer with non-interactive progress, so it cannot resubmit', () => {
    const markup = renderProgress({
      attachmentDetail: 'proof.pdf · 20.0 KB',
      creating: 'complete',
      uploading: 'active',
      opening: 'upcoming',
    });

    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('Submit private report');
    expect(markup).not.toContain('AI is validating your report');
  });
});

describe('SR-10 successful completion lifecycle', () => {
  it('clears, caches and invalidates before replacing the route', async () => {
    const events: string[] = [];
    const report = {
      success: true,
      data: { id: 'report-42' },
    } as ReportResponse;

    vi.stubGlobal('window', {
      localStorage: {
        removeItem: (key: string) => events.push(`clear:${key}`),
      },
    });

    await finishSubmittedReport({
      programId: 'program-a',
      queryClient: {
        setQueryData: (key, value) => {
          expect(key).toEqual(['report', 'report-42']);
          expect(value).toBe(report);
          events.push('cache');
        },
        invalidateQueries: async ({ queryKey }) => {
          expect(queryKey).toEqual(['reports']);
          events.push('invalidate');
        },
      },
      report,
      router: {
        replace: (href) => events.push(`replace:${href}`),
      },
    });

    expect(events).toEqual([
      'clear:offchain-report-draft:program-a',
      'cache',
      'invalidate',
      'replace:/reports/report-42',
    ]);
  });
});

describe('SR-10 submitted report surface', () => {
  it('renders the exact private success banner', () => {
    const markup = renderToStaticMarkup(createElement(SuccessBanner));
    const readableMarkup = markup.replaceAll('&#x27;', "'");

    expect(markup).toContain('Report submitted privately');
    expect(readableMarkup).toContain(
      "The program's authorized reviewers can now review your disclosure.",
    );
  });

  it('renders all five timeline stages with Submitted complete and current', () => {
    const markup = renderToStaticMarkup(
      createElement(ReportTimeline, { status: 'submitted' }),
    );

    for (const stage of REPORT_TIMELINE) {
      expect(markup).toContain(stage.label);
    }
    expect(markup).toMatch(
      /aria-current="step"[^>]*data-state="complete"[^>]*>[\s\S]*?Submitted/,
    );
    expect(markup).toMatch(/data-state="next"[^>]*>[\s\S]*?Triage/);
  });
});
