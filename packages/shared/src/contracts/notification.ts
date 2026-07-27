import { NOTIFICATION_TYPES } from '@bug-bounty-escrow/domain';
import { z } from 'zod';

import { paginationQuerySchema } from '../schemas/pagination.js';
import { isoDateTimeSchema, uuidSchema } from '../schemas/primitives.js';

export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);

export const notificationListQuerySchema = paginationQuerySchema
  .extend({ unreadOnly: z.enum(['true', 'false']).optional() })
  .strict();

/**
 * Notification metadata carries identifiers and routing hints only. The database rejects keys
 * that look like report content or credentials, so the client can never receive them here.
 */
export const notificationSchema = z
  .object({
    id: uuidSchema,
    type: notificationTypeSchema,
    metadata: z.record(z.string(), z.string()),
    readAt: isoDateTimeSchema.optional(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const notificationListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(notificationSchema),
    metadata: z
      .object({
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        totalItems: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
        hasNextPage: z.boolean(),
        hasPreviousPage: z.boolean(),
        unreadCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/** Omitting `notificationIds` marks every unread notification of the caller as read. */
export const markNotificationsReadRequestSchema = z
  .object({ notificationIds: z.array(uuidSchema).min(1).max(200).optional() })
  .strict();

export const markNotificationsReadResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ updated: z.number().int().nonnegative() }).strict(),
  })
  .strict();

export type NotificationListQuery = z.output<typeof notificationListQuerySchema>;
export type AppNotification = z.output<typeof notificationSchema>;
export type NotificationListResponse = z.output<typeof notificationListResponseSchema>;
export type MarkNotificationsReadRequest = z.output<typeof markNotificationsReadRequestSchema>;
export type MarkNotificationsReadResponse = z.output<typeof markNotificationsReadResponseSchema>;
