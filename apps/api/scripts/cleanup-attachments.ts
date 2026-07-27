import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';

import {
  AttachmentCleanupService,
  type AttachmentCleanupGateway,
  type StoredObject,
} from '../src/storage/attachment-cleanup.service.js';

interface CleanupEnvironment {
  readonly dryRun: boolean;
  readonly expireHours: number;
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
}

export function parseCleanupEnvironment(environment: NodeJS.ProcessEnv): CleanupEnvironment {
  const runtime = environment['NODE_ENV'];
  const execute = environment['ATTACHMENT_CLEANUP_EXECUTE'] === 'true';
  const confirmation = environment['ATTACHMENT_CLEANUP_CONFIRM'] === 'DELETE_ORPHAN_ATTACHMENTS';
  const expireHours = Number(environment['ATTACHMENT_CLEANUP_EXPIRE_HOURS'] ?? '24');
  const supabaseUrl = environment['SUPABASE_URL'];
  const serviceRoleKey = environment['SUPABASE_SERVICE_ROLE_KEY'];

  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  if (!Number.isInteger(expireHours) || expireHours < 1) {
    throw new Error('ATTACHMENT_CLEANUP_EXPIRE_HOURS must be a positive integer');
  }
  if (execute && runtime === 'production') {
    throw new Error('Attachment cleanup mutation is disabled in production');
  }
  if (execute && !confirmation) {
    throw new Error('Mutation requires ATTACHMENT_CLEANUP_CONFIRM=DELETE_ORPHAN_ATTACHMENTS');
  }

  return {
    dryRun: !execute,
    expireHours,
    supabaseUrl,
    serviceRoleKey,
  };
}

class SupabaseAttachmentCleanupGateway implements AttachmentCleanupGateway {
  public constructor(private readonly client: SupabaseClient) {}

  public async listStoredObjects(bucket: string): Promise<readonly StoredObject[]> {
    const { data, error } = await this.client
      .schema('storage')
      .from('objects')
      .select('name,created_at')
      .eq('bucket_id', bucket);

    if (error !== null) {
      throw new Error('Unable to list attachment objects');
    }

    return (data ?? []).map((row) => ({
      name: row.name as string,
      createdAt: row.created_at as string,
    }));
  }

  public async listReferencedPaths(bucket: string): Promise<readonly string[]> {
    const { data, error } = await this.client
      .from('report_attachments')
      .select('storage_path')
      .eq('storage_bucket', bucket);

    if (error !== null) {
      throw new Error('Unable to list attachment references');
    }

    return (data ?? []).map((row) => row.storage_path as string);
  }

  public async removeObjects(bucket: string, names: readonly string[]): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([...names]);

    if (error !== null) {
      throw new Error('Unable to remove orphan attachment objects');
    }
  }
}

export async function runCleanup(environment: NodeJS.ProcessEnv): Promise<void> {
  const config = parseCleanupEnvironment(environment);
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const service = new AttachmentCleanupService(new SupabaseAttachmentCleanupGateway(client));
  const result = await service.run({
    dryRun: config.dryRun,
    expireBefore: new Date(Date.now() - config.expireHours * 60 * 60 * 1_000),
  });

  process.stdout.write(
    `${JSON.stringify({
      mode: result.dryRun ? 'dry-run' : 'execute',
      inspected: result.inspected,
      candidates: result.candidates.length,
      deleted: result.deleted,
    })}\n`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCleanup(process.env);
}
