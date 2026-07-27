import { Controller, Get, Inject, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import {
  attachmentUploadRequestSchema,
  commentListQuerySchema,
  createCommentRequestSchema,
  reportAttachmentParamsSchema,
  reportIdParamsSchema,
  type AttachmentUploadRequest,
  type CommentListResponse,
  type CreateCommentRequest,
  type CreateCommentResponse,
  type ProgramIdParams,
  type RequestPrincipal,
  type SignedDownloadResponse,
  type SignedUploadResponse,
} from '@bug-bounty-escrow/shared';

import { ZodBody, ZodParam, ZodQuery } from '../openapi/zod-openapi.js';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { ReportRepository } from './report.repository.js';

const SIGNED_URL_TTL_SECONDS = 60;

function expiryTimestamp(): string {
  return new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
}

@Controller('reports/:id')
export class CollaborationController {
  public constructor(@Inject(ReportRepository) private readonly repository: ReportRepository) {}

  @Post('attachments/upload-url')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async uploadUrl(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(attachmentUploadRequestSchema)
    input: AttachmentUploadRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<SignedUploadResponse> {
    const data = await this.repository.createUploadUrl(
      this.requirePrincipal(principal),
      params.id,
      input,
    );

    return {
      success: true,
      data: { ...data, expiresAt: expiryTimestamp() },
    };
  }

  /**
   * Called after the client PUTs to the signed URL. Until this lands the attachment row stays
   * `pending` and is not listed on the report, so a failed upload never shows a phantom file.
   */
  @Post('attachments/:attachmentId/complete')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async completeUpload(
    @ZodParam(reportAttachmentParamsSchema)
    params: { id: string; attachmentId: string },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<{ success: true; data: { attachmentId: string } }> {
    await this.repository.completeUpload(
      this.requirePrincipal(principal),
      params.id,
      params.attachmentId,
    );

    return { success: true, data: { attachmentId: params.attachmentId } };
  }

  @Get('attachments/:attachmentId/download-url')
  public async downloadUrl(
    @ZodParam(reportAttachmentParamsSchema)
    params: { id: string; attachmentId: string },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<SignedDownloadResponse> {
    const downloadUrl = await this.repository.createDownloadUrl(
      this.requirePrincipal(principal),
      params.id,
      params.attachmentId,
    );

    if (downloadUrl === null) {
      throw new NotFoundException();
    }

    return {
      success: true,
      data: { downloadUrl, expiresAt: expiryTimestamp() },
    };
  }

  @Get('comments')
  public async comments(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodQuery(commentListQuerySchema)
    query: { page: number; limit: number },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<CommentListResponse> {
    const result = await this.repository.listComments(
      this.requirePrincipal(principal),
      params.id,
      query.page,
      query.limit,
    );

    if (result === null) {
      throw new NotFoundException();
    }

    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.limit);

    return {
      success: true,
      data: result.comments,
      metadata: {
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  @Post('comments')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  public async addComment(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(createCommentRequestSchema)
    input: CreateCommentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<CreateCommentResponse> {
    return {
      success: true,
      data: {
        id: await this.repository.addComment(
          this.requirePrincipal(principal),
          params.id,
          input.body,
        ),
      },
    };
  }

  private requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }
    return principal;
  }
}
