import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppNotification } from '@bug-bounty-escrow/shared';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

/**
 * The database rejects notification metadata containing report content or credentials, so values
 * are safe to pass through. Non-string values are stringified to keep the wire type predictable.
 */
function safeMetadata(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
  );
}

@Injectable()
export class NotificationRepository {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  public async list(
    recipientId: string,
    page: number,
    limit: number,
    unreadOnly: boolean,
  ): Promise<{ notifications: AppNotification[]; total: number; unreadCount: number }> {
    let request = this.client
      .from('notifications')
      .select('id,type,metadata,read_at,created_at', { count: 'exact' })
      .eq('recipient_id', recipientId);

    if (unreadOnly) {
      request = request.is('read_at', null);
    }

    const from = (page - 1) * limit;
    const [listResult, unreadResult] = await Promise.all([
      request
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + limit - 1),
      this.client
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', recipientId)
        .is('read_at', null),
    ]);

    if (listResult.error !== null) {
      throw normalizeDatabaseError(listResult.error);
    }

    if (unreadResult.error !== null) {
      throw normalizeDatabaseError(unreadResult.error);
    }

    return {
      notifications: (listResult.data ?? []).map((row) => {
        const readAt = row.read_at as string | null;

        return {
          id: row.id as string,
          type: row.type as AppNotification['type'],
          metadata: safeMetadata(row.metadata),
          ...(readAt === null ? {} : { readAt }),
          createdAt: row.created_at as string,
        };
      }),
      total: listResult.count ?? 0,
      unreadCount: unreadResult.count ?? 0,
    };
  }

  public async markRead(recipientId: string, notificationIds?: string[]): Promise<number> {
    const { data, error } = await this.client.rpc('mark_notifications_read_atomic', {
      actor_id: recipientId,
      notification_ids: notificationIds ?? null,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return Number(data ?? 0);
  }
}
