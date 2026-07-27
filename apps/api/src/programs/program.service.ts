import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AssignReviewerRequest,
  CreateProgramRequest,
  DeployEscrowRequest,
  EscrowTransaction,
  EscrowTransactionListResponse,
  FundProgramRequest,
  LogoUploadRequest,
  OwnerProgramListQuery,
  Program,
  ProgramListQuery,
  ProgramListResponse,
  ProgramReviewer,
  ProgramStatusChangeRequest,
  RequestPrincipal,
  SignedLogoUploadResponse,
  UpdateProgramRequest,
} from '@bug-bounty-escrow/shared';

import { ProgramRepository } from './program.repository.js';

const SIGNED_URL_TTL_SECONDS = 60;

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
export class ProgramService {
  public constructor(@Inject(ProgramRepository) private readonly repository: ProgramRepository) {}

  public async listPublic(query: ProgramListQuery): Promise<ProgramListResponse> {
    const { programs, total } = await this.repository.listPublic(query);

    return {
      success: true,
      data: programs,
      metadata: paginationMetadata(query.page, query.limit, total),
    };
  }

  public async listOwned(
    principal: RequestPrincipal,
    query: OwnerProgramListQuery,
  ): Promise<ProgramListResponse> {
    this.requireOwner(principal);

    const { programs, total } = await this.repository.listOwned(principal.userId, query);

    return {
      success: true,
      data: programs,
      metadata: paginationMetadata(query.page, query.limit, total),
    };
  }

  public async get(id: string, principal?: RequestPrincipal): Promise<Program> {
    const program = await this.repository.findAccessible(id, principal);

    if (program === null) {
      throw new NotFoundException();
    }

    return program;
  }

  public async create(principal: RequestPrincipal, input: CreateProgramRequest): Promise<Program> {
    this.requireOwner(principal);

    const id = await this.repository.create(principal.userId, input);

    return this.get(id, principal);
  }

  public async update(
    principal: RequestPrincipal,
    id: string,
    input: UpdateProgramRequest,
  ): Promise<Program> {
    this.requireOwner(principal);
    await this.repository.update(principal.userId, id, input);

    return this.get(id, principal);
  }

  public async deployEscrow(
    principal: RequestPrincipal,
    id: string,
    input: DeployEscrowRequest,
  ): Promise<Program> {
    this.requireOwner(principal);
    await this.repository.recordEscrowDeployment(principal.userId, id, input);

    return this.get(id, principal);
  }

  public async fund(
    principal: RequestPrincipal,
    id: string,
    input: FundProgramRequest,
  ): Promise<Program> {
    this.requireOwner(principal);
    await this.repository.fund(principal.userId, id, input);

    return this.get(id, principal);
  }

  public async publish(principal: RequestPrincipal, id: string): Promise<Program> {
    this.requireOwner(principal);
    await this.repository.publish(principal.userId, id);

    return this.get(id, principal);
  }

  public async changeStatus(
    principal: RequestPrincipal,
    id: string,
    input: ProgramStatusChangeRequest,
  ): Promise<Program> {
    this.requireOwner(principal);
    await this.repository.setStatus(principal.userId, id, input.status);

    return this.get(id, principal);
  }

  public async listReviewers(
    principal: RequestPrincipal,
    id: string,
  ): Promise<ProgramReviewer[]> {
    await this.requireReviewAccess(principal, id);

    return this.repository.listReviewers(id);
  }

  public async assignReviewer(
    principal: RequestPrincipal,
    id: string,
    input: AssignReviewerRequest,
  ): Promise<ProgramReviewer[]> {
    this.requireOwner(principal);
    await this.repository.assignReviewer(principal.userId, id, input.reviewerId);

    return this.repository.listReviewers(id);
  }

  public async removeReviewer(
    principal: RequestPrincipal,
    id: string,
    reviewerId: string,
  ): Promise<ProgramReviewer[]> {
    this.requireOwner(principal);
    await this.repository.removeReviewer(principal.userId, id, reviewerId);

    return this.repository.listReviewers(id);
  }

  public async createLogoUploadUrl(
    principal: RequestPrincipal,
    id: string,
    input: LogoUploadRequest,
  ): Promise<SignedLogoUploadResponse> {
    this.requireOwner(principal);

    if (!(await this.repository.isOwner(id, principal.userId))) {
      throw new NotFoundException();
    }

    const { storagePath, uploadUrl } = await this.repository.createLogoUploadUrl(id, input);

    return {
      success: true,
      data: {
        storagePath,
        uploadUrl,
        expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      },
    };
  }

  public async listTransactions(
    principal: RequestPrincipal,
    id: string,
    page: number,
    limit: number,
  ): Promise<EscrowTransactionListResponse> {
    await this.requireReviewAccess(principal, id);

    const { transactions, total } = await this.repository.listTransactions(id, page, limit);

    return {
      success: true,
      data: transactions,
      metadata: paginationMetadata(page, limit, total),
    };
  }

  public async getTransaction(
    principal: RequestPrincipal,
    hash: string,
  ): Promise<EscrowTransaction> {
    const transaction = await this.repository.findTransactionByHash(hash);

    if (transaction === null) {
      throw new NotFoundException();
    }

    // A transaction is only visible to the program side; researchers see their payout through
    // the report they own, not by probing hashes.
    await this.requireReviewAccess(principal, transaction.programId);

    return transaction;
  }

  private requireOwner(principal: RequestPrincipal): void {
    if (principal.role !== 'owner') {
      throw new ForbiddenException();
    }
  }

  private async requireReviewAccess(
    principal: RequestPrincipal,
    programId: string,
  ): Promise<void> {
    if (await this.repository.isOwner(programId, principal.userId)) {
      return;
    }

    if (await this.repository.isAssignedReviewer(programId, principal)) {
      return;
    }

    // Not found rather than forbidden: never confirm a program the caller may not review.
    throw new NotFoundException();
  }
}
