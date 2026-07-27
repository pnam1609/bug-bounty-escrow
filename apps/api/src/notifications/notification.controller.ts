import { Controller, Get, Inject, Post, UnauthorizedException } from '@nestjs/common';
import {
  markNotificationsReadRequestSchema,
  notificationListQuerySchema,
  type MarkNotificationsReadRequest,
  type MarkNotificationsReadResponse,
  type NotificationListQuery,
  type NotificationListResponse,
  type RequestPrincipal,
} from '@bug-bounty-escrow/shared';

import { ZodBody, ZodQuery } from '../openapi/zod-openapi.js';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { NotificationRepository } from './notification.repository.js';

@Controller('me/notifications')
export class NotificationController {
  public constructor(
    @Inject(NotificationRepository) private readonly repository: NotificationRepository,
  ) {}

  @Get()
  public async list(
    @ZodQuery(notificationListQuerySchema)
    query: NotificationListQuery,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<NotificationListResponse> {
    const actor = this.requirePrincipal(principal);
    const result = await this.repository.list(
      actor.userId,
      query.page,
      query.limit,
      query.unreadOnly === 'true',
    );
    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.limit);

    return {
      success: true,
      data: result.notifications,
      metadata: {
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
        unreadCount: result.unreadCount,
      },
    };
  }

  @Post('read')
  @RateLimit({ limit: 60, windowMs: 60_000 })
  public async markRead(
    @ZodBody(markNotificationsReadRequestSchema)
    input: MarkNotificationsReadRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<MarkNotificationsReadResponse> {
    const actor = this.requirePrincipal(principal);

    return {
      success: true,
      data: { updated: await this.repository.markRead(actor.userId, input.notificationIds) },
    };
  }

  private requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return principal;
  }
}
