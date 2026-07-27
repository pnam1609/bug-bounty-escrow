import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { programStatusesForPublicStatus } from '@bug-bounty-escrow/domain';
import type {
  CreateProgramRequest,
  DeployEscrowRequest,
  EscrowTransaction,
  FundProgramRequest,
  LogoUploadRequest,
  OwnerProgramListQuery,
  Program,
  ProgramListQuery,
  ProgramReviewer,
  ProgramSummary,
  RequestPrincipal,
  UpdateProgramRequest,
} from '@bug-bounty-escrow/shared';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';
import {
  PROGRAM_LOGO_BUCKET,
  buildLogoStoragePath,
  publicLogoUrl,
} from './program-logo.js';
import {
  PROGRAM_DETAIL_PROJECTION,
  PROGRAM_SUMMARY_PROJECTION,
  mapProgramDetail,
  mapProgramSummary,
  type ProgramDetailRow,
  type ProgramSummaryRow,
} from './program.mapper.js';

/**
 * PostgREST parses `%`, `_`, `,`, `(` and `)` inside a filter value, so raw user input would both
 * act as a wildcard and be able to distort the filter grammar. Escaping keeps a search literal.
 */
function escapeLikePattern(value: string): string {
  return value.replaceAll(/[\\%_,().*]/g, (character) => `\\${character}`);
}

interface ListResult<T> {
  readonly programs: T[];
  readonly total: number;
}

/**
 * The public list applies many optional filters to one builder. Without generated Supabase
 * database types, chaining that many calls makes the inferred PostgREST type explode
 * ("Type instantiation is excessively deep"). This structural view keeps the call sites
 * type-checked while staying flat.
 */
interface FilterBuilder {
  eq: (column: string, value: unknown) => FilterBuilder;
  gt: (column: string, value: unknown) => FilterBuilder;
  gte: (column: string, value: unknown) => FilterBuilder;
  lte: (column: string, value: unknown) => FilterBuilder;
  in: (column: string, values: readonly unknown[]) => FilterBuilder;
  is: (column: string, value: null) => FilterBuilder;
  not: (column: string, operator: string, value: unknown) => FilterBuilder;
  ilike: (column: string, pattern: string) => FilterBuilder;
  overlaps: (column: string, values: readonly string[]) => FilterBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) => FilterBuilder;
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: unknown; count: number | null }>;
}

@Injectable()
export class ProgramRepository {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  /**
   * Public bounty table. Only programs with a non-null `public_status` are reachable here, so a
   * draft, awaiting-funding or paused program can never leak through a crafted query.
   */
  public async listPublic(query: ProgramListQuery): Promise<ListResult<ProgramSummary>> {
    let request = this.client
      .from('programs')
      .select(PROGRAM_SUMMARY_PROJECTION, { count: 'exact' }) as unknown as FilterBuilder;

    request = request.not('public_status', 'is', null);

    if (query.status !== undefined && query.status.length < 2) {
      const [publicStatus] = query.status;

      if (publicStatus !== undefined) {
        request = request.in('status', [...programStatusesForPublicStatus(publicStatus)]);
      }
    }

    if (query.search !== undefined && query.search.length > 0) {
      request = request.ilike('name', `%${escapeLikePattern(query.search)}%`);
    }

    if (query.assetType !== undefined) {
      request = request.overlaps('in_scope_asset_types', query.assetType);
    }

    if (query.severity !== undefined) {
      request = request.overlaps('reward_severities', query.severity);
    }

    if (query.minMaxReward !== undefined) {
      request = request.gte('max_bounty', query.minMaxReward);
    }

    if (query.funded === true) {
      request = request.gt('available_pool', 0);
    }

    if (query.closing === 'ongoing') {
      request = request.is('deadline', null);
    } else if (query.closing !== undefined) {
      const days = query.closing === '7d' ? 7 : 30;
      const now = new Date();
      const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

      request = request.not('deadline', 'is', null);
      request = request.gte('deadline', now.toISOString());
      request = request.lte('deadline', horizon);
    }

    // Active programs always precede ended ones; the chosen column only orders within that.
    request = request.order('public_status', { ascending: true });

    const ascending = query.sortDirection === undefined ? undefined : query.sortDirection === 'asc';

    if (query.sort === 'name') {
      request = request.order('name', { ascending: ascending ?? true });
    } else if (query.sort === 'deadline') {
      request = request.order('deadline', { ascending: ascending ?? true, nullsFirst: false });
    } else if (query.sort === 'maxBounty') {
      request = request.order('max_bounty', { ascending: ascending ?? false });
    } else if (query.sort === 'totalPaid') {
      // The generated key is null whenever visibility is private. `nullsFirst: false` therefore
      // keeps every private program last, and the final `id` order below is their deterministic
      // tie-break — the hidden paid_pool never influences observable ordering.
      request = request.order('public_paid_pool', {
        ascending: ascending ?? false,
        nullsFirst: false,
      });
    } else {
      request = request.order('created_at', { ascending: ascending ?? false });
    }

    request = request.order('id');

    const from = (query.page - 1) * query.limit;
    const { data, error, count } = await request.range(from, from + query.limit - 1);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return {
      programs: (data as unknown as ProgramSummaryRow[]).map((row) =>
        mapProgramSummary(row, { revealTotalPaid: false, resolveLogoUrl: this.resolveLogoUrl }),
      ),
      total: count ?? 0,
    };
  }

  /** Owner workspace listing: every status, restricted to programs the owner owns. */
  public async listOwned(
    ownerId: string,
    query: OwnerProgramListQuery,
  ): Promise<ListResult<ProgramSummary>> {
    let request = this.client
      .from('programs')
      .select(PROGRAM_SUMMARY_PROJECTION, { count: 'exact' }) as unknown as FilterBuilder;

    request = request.eq('owner_id', ownerId);

    if (query.status !== undefined) {
      request = request.eq('status', query.status);
    }

    if (query.search !== undefined && query.search.length > 0) {
      request = request.ilike('name', `%${escapeLikePattern(query.search)}%`);
    }

    if (query.sort === 'name') {
      request = request.order('name').order('id');
    } else if (query.sort === 'deadline') {
      request = request.order('deadline', { nullsFirst: false }).order('id');
    } else {
      request = request.order('created_at', { ascending: false }).order('id');
    }

    const from = (query.page - 1) * query.limit;
    const { data, error, count } = await request.range(from, from + query.limit - 1);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return {
      programs: (data as unknown as ProgramSummaryRow[]).map((row) =>
        mapProgramSummary(row, { revealTotalPaid: true, resolveLogoUrl: this.resolveLogoUrl }),
      ),
      total: count ?? 0,
    };
  }

  public async findAccessible(id: string, principal?: RequestPrincipal): Promise<Program | null> {
    const { data, error } = await this.client
      .from('programs')
      .select(PROGRAM_DETAIL_PROJECTION)
      .eq('id', id)
      .maybeSingle();

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    const row = data as unknown as ProgramDetailRow | null;

    if (row === null) {
      return null;
    }

    const isOwner = row.owner_id === principal?.userId;
    const isReviewer = isOwner ? false : await this.isAssignedReviewer(id, principal);

    if (row.public_status === null && !isOwner && !isReviewer) {
      // Do not distinguish "not found" from "not permitted".
      return null;
    }

    return mapProgramDetail(row, {
      revealTotalPaid: isOwner || isReviewer,
      resolveLogoUrl: this.resolveLogoUrl,
      medianResolutionSeconds: await this.medianResolutionSeconds(id),
    });
  }

  public async create(ownerId: string, input: CreateProgramRequest): Promise<string> {
    const { data, error } = await this.client.rpc('create_program_atomic', {
      actor_id: ownerId,
      input,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data as string;
  }

  public async update(
    ownerId: string,
    programId: string,
    input: UpdateProgramRequest,
  ): Promise<void> {
    const { error } = await this.client.rpc('update_program_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
      input,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async recordEscrowDeployment(
    ownerId: string,
    programId: string,
    input: DeployEscrowRequest,
  ): Promise<void> {
    const { error } = await this.client.rpc('record_program_escrow_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
      target_chain_id: input.chainId,
      deployment_hash: input.transactionHash.toLowerCase(),
      deployed_contract_address: input.contractAddress.toLowerCase(),
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async fund(
    ownerId: string,
    programId: string,
    input: FundProgramRequest,
  ): Promise<void> {
    const { error } = await this.client.rpc('fund_program_escrow_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
      funding_amount: input.amount,
      funding_transaction_hash: input.transactionHash.toLowerCase(),
      funding_token_address: input.tokenAddress.toLowerCase(),
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async publish(ownerId: string, programId: string): Promise<void> {
    const { error } = await this.client.rpc('publish_program_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async setStatus(ownerId: string, programId: string, status: string): Promise<void> {
    const { error } = await this.client.rpc('set_program_status_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
      next_status: status,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async listReviewers(programId: string): Promise<ProgramReviewer[]> {
    const { data, error } = await this.client
      .from('program_reviewers')
      .select('reviewer_id,created_at,profiles!program_reviewers_reviewer_id_fkey(display_name)')
      .eq('program_id', programId)
      .order('created_at');

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return (data ?? []).map((row) => ({
      reviewerId: row.reviewer_id as string,
      displayName:
        (row.profiles as { display_name?: string } | null)?.display_name ?? 'Unknown reviewer',
      createdAt: row.created_at as string,
    }));
  }

  public async assignReviewer(
    ownerId: string,
    programId: string,
    reviewerId: string,
  ): Promise<void> {
    const { error } = await this.client.rpc('assign_program_reviewer_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
      target_reviewer_id: reviewerId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async removeReviewer(
    ownerId: string,
    programId: string,
    reviewerId: string,
  ): Promise<void> {
    const { error } = await this.client.rpc('remove_program_reviewer_atomic', {
      actor_id: ownerId,
      target_program_id: programId,
      target_reviewer_id: reviewerId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async createLogoUploadUrl(
    programId: string,
    input: LogoUploadRequest,
  ): Promise<{ storagePath: string; uploadUrl: string }> {
    const storagePath = buildLogoStoragePath(programId, input.filename);
    const { data, error } = await this.client.storage
      .from(PROGRAM_LOGO_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: true });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return { storagePath, uploadUrl: data.signedUrl };
  }

  /** Bound so it can be passed straight into the row mappers. */
  private readonly resolveLogoUrl = (storagePath: string | null): string | undefined =>
    publicLogoUrl(this.client, storagePath);

  public async listTransactions(
    programId: string,
    page: number,
    limit: number,
  ): Promise<{ transactions: EscrowTransaction[]; total: number }> {
    const from = (page - 1) * limit;
    const { data, error, count } = await this.client
      .from('escrow_transactions')
      .select(
        'id,program_id,report_id,chain_id,transaction_hash,transaction_type,status,amount,token_address,created_at,confirmed_at',
        { count: 'exact' },
      )
      .eq('program_id', programId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + limit - 1);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return {
      transactions: (data ?? []).map((row) => mapTransaction(row)),
      total: count ?? 0,
    };
  }

  public async findTransactionByHash(hash: string): Promise<EscrowTransaction | null> {
    const { data, error } = await this.client
      .from('escrow_transactions')
      .select(
        'id,program_id,report_id,chain_id,transaction_hash,transaction_type,status,amount,token_address,created_at,confirmed_at',
      )
      .eq('transaction_hash', hash.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data === null ? null : mapTransaction(data);
  }

  /** Programs the principal may act on as owner or assigned reviewer. */
  public async isAssignedReviewer(
    programId: string,
    principal?: RequestPrincipal,
  ): Promise<boolean> {
    if (principal === undefined || principal.role !== 'reviewer') {
      return false;
    }

    const { data, error } = await this.client
      .from('program_reviewers')
      .select('program_id')
      .eq('program_id', programId)
      .eq('reviewer_id', principal.userId)
      .maybeSingle();

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data !== null;
  }

  /** Derived on read: denormalizing it would mean touching the program on every transition. */
  private async medianResolutionSeconds(programId: string): Promise<number | null> {
    const { data, error } = await this.client.rpc('program_median_resolution_seconds', {
      target_program_id: programId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data === null ? null : Number(data);
  }

  public async isOwner(programId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('programs')
      .select('id')
      .eq('id', programId)
      .eq('owner_id', userId)
      .maybeSingle();

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data !== null;
  }
}

interface EscrowTransactionRow {
  readonly id: string;
  readonly program_id: string;
  readonly report_id: string | null;
  readonly chain_id: number | string;
  readonly transaction_hash: string;
  readonly transaction_type: EscrowTransaction['type'];
  readonly status: EscrowTransaction['status'];
  readonly amount: number | string;
  readonly token_address: string;
  readonly created_at: string;
  readonly confirmed_at: string | null;
}

function mapTransaction(row: unknown): EscrowTransaction {
  const typed = row as EscrowTransactionRow;

  return {
    id: typed.id,
    programId: typed.program_id,
    ...(typed.report_id === null ? {} : { reportId: typed.report_id }),
    chainId: Number(typed.chain_id),
    transactionHash: typed.transaction_hash,
    type: typed.transaction_type,
    status: typed.status,
    amount: typeof typed.amount === 'string' ? typed.amount : typed.amount.toFixed(6),
    tokenAddress: typed.token_address,
    createdAt: typed.created_at,
    ...(typed.confirmed_at === null ? {} : { confirmedAt: typed.confirmed_at }),
  };
}
