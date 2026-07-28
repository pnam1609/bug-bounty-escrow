import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResearcherReportSummary } from '@bug-bounty-escrow/shared';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

interface SummaryRow {
  readonly all_reports: string | number;
  readonly needs_information: string | number;
  readonly under_review: string | number;
  readonly rewards_paid: string;
}

type SummaryCounts = Pick<
  ResearcherReportSummary,
  'allReports' | 'needsInformation' | 'rewardsPaid' | 'underReview'
>;

function count(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('The database returned an invalid report count');
  }

  return parsed;
}

function money(value: string): string {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('The database returned an invalid paid reward total');
  }

  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(6, '0')}`;
}

@Injectable()
export class ReportSummaryRepository {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  public async summarizeForResearcher(researcherId: string): Promise<SummaryCounts> {
    const { data, error } = await this.supabase.rpc('researcher_report_summary', {
      actor_id: researcherId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    const row = (data as SummaryRow[] | null)?.[0];

    if (row === undefined) {
      throw new Error('The database did not return a report summary');
    }

    return {
      allReports: count(row.all_reports),
      needsInformation: count(row.needs_information),
      underReview: count(row.under_review),
      rewardsPaid: money(row.rewards_paid),
    };
  }
}
