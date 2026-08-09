import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  payoutWalletSchema,
  researcherPayoutWalletSchema,
  researcherRewardSummarySchema,
  type PayoutWallet,
  type ResearcherRewardListQuery,
  type ResearcherRewardSummary,
  type ResearcherPayoutWallet,
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

export interface ResearcherPayoutWalletRow {
  readonly id: string;
  readonly researcher_id: string;
  readonly chain_id: number | string;
  readonly address: string;
  readonly label: string | null;
  readonly status: 'unverified' | 'verified' | 'revoked';
  readonly verification_method: string | null;
  readonly verification_message_hash: string | null;
  readonly verified_at: string | null;
  readonly revoked_at: string | null;
  readonly source: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ResearcherWalletChallengeRow {
  readonly id: string;
  readonly researcher_id: string;
  readonly address: string;
  readonly chain_id: number | string;
  readonly domain: string;
  readonly uri: string;
  readonly purpose: string;
  readonly nonce: string;
  readonly message: string;
  readonly message_hash: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly invalidated_at: string | null;
  readonly created_at: string;
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

function mapResearcherPayoutWallet(row: ResearcherPayoutWalletRow): ResearcherPayoutWallet {
  if (
    row.status !== 'verified' ||
    row.verification_method !== 'eip191_personal_sign' ||
    row.verified_at === null ||
    row.revoked_at !== null ||
    Number(row.chain_id) !== 5_042_002
  ) {
    throw new Error('The database returned a payout wallet without valid verification evidence');
  }

  const address = row.address.toLowerCase();
  return researcherPayoutWalletSchema.parse({
    id: row.id,
    ...(row.label === null ? {} : { label: row.label }),
    address,
    maskedAddress: maskWalletAddress(address),
    walletType: 'evm',
    network: 'Arc Testnet',
    chainId: 5_042_002,
    verificationMethod: 'eip191_personal_sign',
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
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

  public async listVerifiedPayoutWallets(researcherId: string): Promise<ResearcherPayoutWallet[]> {
    const { data, error } = await this.supabase
      .from('researcher_payout_wallets')
      .select(
        'id,researcher_id,chain_id,address,label,status,verification_method,verification_message_hash,verified_at,revoked_at,source,created_at,updated_at',
      )
      .eq('researcher_id', researcherId)
      .eq('status', 'verified')
      .is('revoked_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error !== null) throw normalizeDatabaseError(error);
    return ((data ?? []) as ResearcherPayoutWalletRow[]).map(mapResearcherPayoutWallet);
  }

  public async createPayoutWalletChallenge(input: {
    challengeId: string;
    researcherId: string;
    address: string;
    domain: string;
    uri: string;
    purpose: string;
    nonce: string;
    message: string;
    messageHash: string;
    issuedAt: string;
    expiresAt: string;
  }): Promise<string> {
    const { data, error } = await this.supabase.rpc(
      'create_researcher_wallet_verification_challenge_atomic',
      {
        target_challenge_id: input.challengeId,
        actor_id: input.researcherId,
        target_address: input.address.toLowerCase(),
        target_domain: input.domain,
        target_uri: input.uri,
        target_purpose: input.purpose,
        challenge_nonce: input.nonce,
        challenge_message: input.message,
        challenge_message_hash: input.messageHash.toLowerCase(),
        issued_at: input.issuedAt,
        expires_at: input.expiresAt,
      },
    );

    if (error !== null) throw normalizeDatabaseError(error);
    if (typeof data !== 'string') throw new Error('The database returned no wallet challenge ID');
    return data;
  }

  public async findPayoutWalletChallenge(
    challengeId: string,
  ): Promise<ResearcherWalletChallengeRow | null> {
    const { data, error } = await this.supabase
      .from('researcher_wallet_verification_challenges')
      .select(
        'id,researcher_id,address,chain_id,domain,uri,purpose,nonce,message,message_hash,issued_at,expires_at,consumed_at,invalidated_at,created_at',
      )
      .eq('id', challengeId)
      .maybeSingle();

    if (error !== null) throw normalizeDatabaseError(error);
    return data as ResearcherWalletChallengeRow | null;
  }

  public async completePayoutWalletVerification(input: {
    researcherId: string;
    challengeId: string;
    verifiedAddress: string;
    verifiedMessageHash: string;
    label?: string;
  }): Promise<string> {
    const { data, error } = await this.supabase.rpc(
      'complete_researcher_wallet_verification_atomic',
      {
        actor_id: input.researcherId,
        target_challenge_id: input.challengeId,
        verified_address: input.verifiedAddress.toLowerCase(),
        verified_message_hash: input.verifiedMessageHash.toLowerCase(),
        wallet_label: input.label ?? null,
      },
    );

    if (error !== null) throw normalizeDatabaseError(error);
    if (typeof data !== 'string') throw new Error('The database returned no verified wallet ID');
    return data;
  }

  public async findVerifiedPayoutWallet(
    researcherId: string,
    walletId: string,
  ): Promise<ResearcherPayoutWallet | null> {
    const { data, error } = await this.supabase
      .from('researcher_payout_wallets')
      .select(
        'id,researcher_id,chain_id,address,label,status,verification_method,verification_message_hash,verified_at,revoked_at,source,created_at,updated_at',
      )
      .eq('id', walletId)
      .eq('researcher_id', researcherId)
      .eq('status', 'verified')
      .is('revoked_at', null)
      .maybeSingle();

    if (error !== null) throw normalizeDatabaseError(error);
    if (data === null) return null;
    return mapResearcherPayoutWallet(data as ResearcherPayoutWalletRow);
  }

  public async findVerifiedPayoutWalletByAddress(
    researcherId: string,
    address: string,
  ): Promise<ResearcherPayoutWallet | null> {
    const { data, error } = await this.supabase
      .from('researcher_payout_wallets')
      .select(
        'id,researcher_id,chain_id,address,label,status,verification_method,verification_message_hash,verified_at,revoked_at,source,created_at,updated_at',
      )
      .eq('researcher_id', researcherId)
      .eq('chain_id', 5_042_002)
      .eq('address', address.toLowerCase())
      .eq('status', 'verified')
      .is('revoked_at', null)
      .maybeSingle();

    if (error !== null) throw normalizeDatabaseError(error);
    if (data === null) return null;
    return mapResearcherPayoutWallet(data as ResearcherPayoutWalletRow);
  }
}
