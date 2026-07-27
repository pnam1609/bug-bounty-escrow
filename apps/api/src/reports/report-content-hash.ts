import { createHash } from 'node:crypto';

/**
 * Canonical form of everything a researcher asserted in a report.
 *
 * The hash is the integrity anchor that may be referenced on-chain, so it covers the structured
 * impact selection as well as the prose — hashing only the text would let the claimed impacts
 * change without changing the digest. It also covers the severity-mismatch acknowledgement,
 * because that is part of the submitted assertion rather than a UI detail. Arrays are sorted so
 * an equivalent submission always hashes the same regardless of the order the client sent.
 */
export interface HashableReportContent {
  readonly affectedScopeId: string;
  readonly title: string;
  readonly description: string;
  readonly reproductionSteps?: string | undefined;
  readonly secretGistUrl?: string | undefined;
  readonly proposedSeverity: string;
  readonly severityMismatchAcknowledged: boolean;
  readonly programImpactIds: readonly string[];
  readonly customImpacts: readonly string[];
}

export function reportContentHash(content: HashableReportContent): string {
  const canonical = JSON.stringify({
    affectedScopeId: content.affectedScopeId,
    title: content.title,
    description: content.description,
    reproductionSteps: content.reproductionSteps ?? null,
    secretGistUrl: content.secretGistUrl ?? null,
    proposedSeverity: content.proposedSeverity,
    severityMismatchAcknowledged: content.severityMismatchAcknowledged,
    programImpactIds: [...content.programImpactIds].sort(),
    customImpacts: [...content.customImpacts].map((value) => value.trim()).sort(),
  });

  return `0x${createHash('sha256').update(canonical).digest('hex')}`;
}
