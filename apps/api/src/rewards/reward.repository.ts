import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  payoutWalletSchema,
  researcherRewardSummarySchema,
  type PayoutWallet,
  type ResearcherRewardListQuery,
  type ResearcherRewardSummary,
  type UpdatePayoutWalletRequest,
} from '@bug-bounty-escrow/shared';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

interface RewardRpcRow {
  readonly report_id: string | null;
  readonly program_id: string | null;
  readonly program_name: string | null;
  readonly report_title: string | null;
  readonly final_severity: string | null;
  readonly reward_status: string | null;
  readonly approved_reward: string | null;
  readonly submitted_at: string | null;
  readonly reward_approved_at: string | null;
  readonly payment_chain_id: string | null;
  readonly payment_token_address: string | null;
  readonly payment_transaction_hash: string | null;
  readonly payment_status: string | null;
  readonly payment_confirmations: number | null;
  readonly payment_confirmed_at: string | null;
  readonly paid_at: string | null;
  readonly total_count: number | string;
}

interface PayoutWalletRpcRow {
  readonly wallet_address: string | null;
  readonly wallet_updated_at: string | null;
  readonly has_active_rewards: boolean;
}

type RewardDataRow = RewardRpcRow & {
  readonly report_id: string;
  readonly program_id: string;
  readonly program_name: string;
  readonly report_title: string;
  readonly final_severity: string;
  readonly reward_status: string;
  readonly approved_reward: string;
  readonly submitted_at: string;
  readonly reward_approved_at: string;
};

function safeCount(value: number | string): number {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('The database returned an invalid reward count');
  }

  return count;
}

function mapReward(row: RewardDataRow): ResearcherRewardSummary {
  const payment =
    row.payment_transaction_hash === null
      ? {}
      : {
          payment: {
            chainId: row.payment_chain_id,
            tokenAddress: row.payment_token_address,
            transactionHash: row.payment_transaction_hash,
            status: row.payment_status,
            ...(row.payment_confirmations === null
              ? {}
              : { confirmations: row.payment_confirmations }),
            ...(row.payment_confirmed_at === null ? {} : { confirmedAt: row.payment_confirmed_at }),
          },
        };

  return researcherRewardSummarySchema.parse({
    reportId: row.report_id,
    programId: row.program_id,
    programName: row.program_name,
    reportTitle: row.report_title,
    finalSeverity: row.final_severity,
    status: row.reward_status,
    approvedReward: row.approved_reward,
    submittedAt: row.submitted_at,
    rewardApprovedAt: row.reward_approved_at,
    ...payment,
    ...(row.paid_at === null ? {} : { paidAt: row.paid_at }),
  });
}

function maskWalletAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function mapPayoutWallet(row: PayoutWalletRpcRow): PayoutWallet {
  const address = row.wallet_address?.toLowerCase();

  return payoutWalletSchema.parse({
    ...(address === undefined
      ? {}
      : {
          address,
          maskedAddress: maskWalletAddress(address),
          updatedAt: row.wallet_updated_at,
        }),
    network: 'Arc',
    token: 'USDC',
    hasActiveRewards: row.has_active_rewards,
    canUpdate: row.has_active_rewards,
    changeConfirmationRequired: address !== undefined && row.has_active_rewards,
  });
}

@Injectable()
export class RewardRepository {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient) {}

  public async listForResearcher(
    researcherId: string,
    query: ResearcherRewardListQuery,
  ): Promise<{ rewards: ResearcherRewardSummary[]; total: number }> {
    const { data, error } = await this.supabase.rpc('researcher_rewards', {
      actor_id: researcherId,
      requested_status: query.status ?? null,
      page_size: query.limit,
      page_offset: (query.page - 1) * query.limit,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    const rows = (data ?? []) as RewardRpcRow[];

    return {
      rewards: rows.filter((row): row is RewardDataRow => row.report_id !== null).map(mapReward),
      total: rows[0] === undefined ? 0 : safeCount(rows[0].total_count),
    };
  }

  public async getPayoutWallet(researcherId: string): Promise<PayoutWallet> {
    const { data, error } = await this.supabase.rpc('researcher_payout_wallet', {
      actor_id: researcherId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    const row = (data as PayoutWalletRpcRow[] | null)?.[0];
    if (row === undefined) {
      throw new Error('The database returned no payout-wallet projection');
    }

    return mapPayoutWallet(row);
  }

  public async updatePayoutWallet(
    researcherId: string,
    input: UpdatePayoutWalletRequest,
  ): Promise<PayoutWallet> {
    const { data, error } = await this.supabase.rpc('set_researcher_payout_wallet', {
      actor_id: researcherId,
      new_wallet_address: input.address,
      confirm_active_reward_change: input.confirmActiveRewardChange ?? false,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    const row = (data as PayoutWalletRpcRow[] | null)?.[0];
    if (row === undefined) {
      throw new Error('The database returned no saved payout wallet');
    }

    return mapPayoutWallet(row);
  }
}
