import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type {
  PayoutWalletResponse,
  RequestPrincipal,
  ResearcherRewardListQuery,
  ResearcherRewardListResponse,
  UpdatePayoutWalletRequest,
  UpdatePayoutWalletResponse,
} from '@bug-bounty-escrow/shared';

import { RewardRepository } from './reward.repository.js';

function paginationMetadata(page: number, limit: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

@Injectable()
export class RewardService {
  public constructor(@Inject(RewardRepository) private readonly repository: RewardRepository) {}

  public async list(
    principal: RequestPrincipal,
    query: ResearcherRewardListQuery,
  ): Promise<ResearcherRewardListResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    const { rewards, total } = await this.repository.listForResearcher(principal.userId, query);

    return {
      success: true,
      data: rewards,
      metadata: paginationMetadata(query.page, query.limit, total),
    };
  }

  public async getPayoutWallet(principal: RequestPrincipal): Promise<PayoutWalletResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    return {
      success: true,
      data: await this.repository.getPayoutWallet(principal.userId),
    };
  }

  public async updatePayoutWallet(
    principal: RequestPrincipal,
    input: UpdatePayoutWalletRequest,
  ): Promise<UpdatePayoutWalletResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    return {
      success: true,
      data: await this.repository.updatePayoutWallet(principal.userId, input),
    };
  }
}
