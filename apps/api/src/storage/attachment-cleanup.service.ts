export const REPORT_ATTACHMENTS_BUCKET = 'report-attachments';

export interface StoredObject {
  readonly name: string;
  readonly createdAt: string;
}

export interface AttachmentCleanupGateway {
  listStoredObjects(bucket: string): Promise<readonly StoredObject[]>;
  listReferencedPaths(bucket: string): Promise<readonly string[]>;
  removeObjects(bucket: string, names: readonly string[]): Promise<void>;
}

export interface AttachmentCleanupOptions {
  readonly dryRun: boolean;
  readonly expireBefore: Date;
}

export interface AttachmentCleanupResult {
  readonly dryRun: boolean;
  readonly inspected: number;
  readonly referenced: number;
  readonly candidates: readonly string[];
  readonly deleted: number;
}

export class AttachmentCleanupService {
  public constructor(private readonly gateway: AttachmentCleanupGateway) {}

  public async run(options: AttachmentCleanupOptions): Promise<AttachmentCleanupResult> {
    const [objects, referencedPaths] = await Promise.all([
      this.gateway.listStoredObjects(REPORT_ATTACHMENTS_BUCKET),
      this.gateway.listReferencedPaths(REPORT_ATTACHMENTS_BUCKET),
    ]);
    const referenced = new Set(referencedPaths);
    const candidates = objects
      .filter(
        (object) =>
          !referenced.has(object.name) &&
          new Date(object.createdAt).getTime() < options.expireBefore.getTime(),
      )
      .map((object) => object.name)
      .sort();

    if (!options.dryRun && candidates.length > 0) {
      await this.gateway.removeObjects(REPORT_ATTACHMENTS_BUCKET, candidates);
    }

    return {
      dryRun: options.dryRun,
      inspected: objects.length,
      referenced: referenced.size,
      candidates,
      deleted: options.dryRun ? 0 : candidates.length,
    };
  }
}
