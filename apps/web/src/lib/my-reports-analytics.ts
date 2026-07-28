import type { ReportStatus, Severity } from '@bug-bounty-escrow/shared';

export const MY_REPORTS_ANALYTICS_EVENT = 'bbe:analytics';

export const MY_REPORTS_EVENT_NAMES = Object.freeze([
  'my_reports_viewed',
  'my_reports_filter_changed',
  'my_reports_page_changed',
  'my_reports_row_opened',
  'my_reports_browse_programs_clicked',
  'my_reports_retry_clicked',
] as const);

export type MyReportsEventName = (typeof MY_REPORTS_EVENT_NAMES)[number];

type ReportStatusGroup =
  'draft' | 'under_review' | 'action_required' | 'closed' | 'decision' | 'settlement' | 'completed';

export type MyReportsAnalyticsEvent =
  | {
      readonly name: 'my_reports_viewed';
      readonly properties: { readonly page: number; readonly resultCount: number };
    }
  | {
      readonly name: 'my_reports_filter_changed';
      readonly properties: {
        readonly filter: 'all' | 'program' | 'severity' | 'status';
        readonly value: ReportStatus | Severity | null;
      };
    }
  | {
      readonly name: 'my_reports_page_changed';
      readonly properties: { readonly page: number; readonly resultCount: number };
    }
  | {
      readonly name: 'my_reports_row_opened';
      readonly properties: {
        readonly severity: Severity;
        readonly statusGroup: ReportStatusGroup;
      };
    }
  | {
      readonly name: 'my_reports_browse_programs_clicked';
      readonly properties: Record<string, never>;
    }
  | {
      readonly name: 'my_reports_retry_clicked';
      readonly properties: { readonly page: number };
    };

const STATUS_GROUPS: Readonly<Record<ReportStatus, ReportStatusGroup>> = Object.freeze({
  draft: 'draft',
  submitted: 'under_review',
  triaged: 'under_review',
  needs_information: 'action_required',
  rejected: 'closed',
  duplicate: 'closed',
  validated: 'decision',
  reward_approved: 'settlement',
  payment_pending: 'settlement',
  paid: 'completed',
});

export function myReportsRowOpenedEvent(input: {
  readonly finalSeverity?: Severity | undefined;
  readonly proposedSeverity: Severity;
  readonly status: ReportStatus;
}): MyReportsAnalyticsEvent {
  return {
    name: 'my_reports_row_opened',
    properties: {
      severity: input.finalSeverity ?? input.proposedSeverity,
      statusGroup: STATUS_GROUPS[input.status],
    },
  };
}

export function trackMyReportsEvent(event: MyReportsAnalyticsEvent): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent(MY_REPORTS_ANALYTICS_EVENT, { detail: event }));
}
