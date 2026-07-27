'use client';

import {
  Callout,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

import {
  ASSET_TYPE_LABELS,
  CALCULATION_TYPE_LABELS,
  describeTier,
  inScopeAssetTypes,
  SEVERITY_LABELS,
  type ProgramDraft,
} from './program-draft';
import { GuidancePanel } from './owner-workspace';
import { FormCard, InlineAction, StepActions, StepLayout } from './wizard-parts';

function ReviewSection({
  children,
  onEdit,
  title,
}: {
  readonly children: ReactNode;
  readonly onEdit: () => void;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-lg">
      <div className="flex flex-wrap items-center gap-md">
        <h3 className="text-h3 text-text">{title}</h3>
        <InlineAction onClick={onEdit}>{`Edit ${title.toLowerCase()}`}</InlineAction>
      </div>
      {children}
    </section>
  );
}

/**
 * CP-04 — the payload preview.
 *
 * There is deliberately no pending state here: CP-05 replaces the whole screen while the draft
 * saves, so a `Creating draft…` label on this button could never be reached and would only give
 * the copy two homes to drift apart in.
 */
export interface StepReviewProps {
  readonly draft: ProgramDraft;
  readonly onBack: () => void;
  readonly onEdit: (step: number) => void;
  readonly onSubmit: () => void;
  /** `Create draft` when creating, `Save changes` when editing an existing draft. */
  readonly submitLabel: string;
}

export function StepReview({ draft, onBack, onEdit, onSubmit, submitLabel }: StepReviewProps) {
  const assetTypes = inScopeAssetTypes(draft);
  const inScope = draft.scopes.filter((scope) => scope.isInScope).length;
  const outOfScope = draft.scopes.length - inScope;
  const enabledImpacts = draft.impacts.filter((impact) => impact.enabled);
  /*
   * `tierPayload` drops every tier whose asset type left the scope list, so the review table has to
   * drop them too. Showing a row the create call will not send is the one thing this step exists to
   * prevent — the owner would approve a reward that never reaches the server.
   */
  const submittedTiers = draft.rewardTiers.filter((tier) => assetTypes.includes(tier.assetType));

  return (
    <StepLayout
      aside={
        <GuidancePanel eyebrow="Ready to save" title="Draft configuration complete">
          <ul className="flex flex-col gap-xs">
            <li>✓ Program details</li>
            <li>✓ Scope</li>
            <li>✓ Impact catalog</li>
            <li>✓ Reward tiers</li>
            <li>✓ Program rules</li>
            <li>○ Escrow not deployed</li>
            <li>○ Funding 0 USDC</li>
          </ul>
        </GuidancePanel>
      }
    >
      <FormCard title="Review your program">
        {/* CP-04 status callout. Title and body concatenate to the flow document sentence exactly,
            trailing full stop included. */}
        <Callout title="This creates a private draft." variant="info">
          It will not be visible to researchers until escrow is deployed, funded and the program is
          published.
        </Callout>

        <ReviewSection onEdit={() => onEdit(0)} title="Program details">
          <p className="text-body-sm text-text">
            {`${draft.name} · ${draft.slug} · ${draft.shortSummary}`}
          </p>
          <p className="text-label-md text-text-muted">
            {[
              draft.logoFile === null ? 'No logo' : draft.logoFile.name,
              draft.websiteUrl,
              `${draft.tags.length} ${draft.tags.length === 1 ? 'tag' : 'tags'}`,
              `${draft.resources.length} ${draft.resources.length === 1 ? 'resource' : 'resources'}`,
              draft.deadline === '' ? 'Open-ended' : `Deadline ${draft.deadline}`,
            ].join(' · ')}
          </p>
          <p className="line-clamp-3 text-body-sm text-text-muted">{draft.description}</p>
        </ReviewSection>

        <ReviewSection onEdit={() => onEdit(1)} title="Scope">
          <p className="text-body-sm text-text">
            {`${inScope} in scope · ${outOfScope} out of scope`}
          </p>
          <ul className="flex flex-col gap-xs text-label-md text-text-muted">
            {draft.scopes.map((scope) => (
              <li key={scope.rowId}>
                {`${ASSET_TYPE_LABELS[scope.assetType]} · ${scope.assetName} · ${
                  scope.isInScope ? 'In scope' : 'Out of scope'
                }`}
              </li>
            ))}
          </ul>
        </ReviewSection>

        <ReviewSection onEdit={() => onEdit(2)} title="Impacts">
          <p className="text-body-sm text-text">
            {assetTypes
              .map(
                (assetType) =>
                  `${
                    enabledImpacts.filter((impact) => impact.assetType === assetType).length
                  } ${ASSET_TYPE_LABELS[assetType].toLowerCase()} impacts`,
              )
              .join(' · ')}
          </p>
          <p className="text-label-md text-text-muted">
            {draft.rules.allowCustomImpact
              ? 'Custom impact proposals allowed'
              : 'Custom impact proposals not allowed'}
          </p>
          <div className="flex flex-wrap gap-sm">
            {assetTypes.map((assetType) =>
              [
                ...new Set(
                  enabledImpacts
                    .filter((impact) => impact.assetType === assetType)
                    .map((impact) => impact.severity),
                ),
              ].map((severity) => (
                <SeverityBadge
                  key={`${assetType}-${severity}`}
                  label={`${ASSET_TYPE_LABELS[assetType]} · ${SEVERITY_LABELS[severity]}`}
                  severity={severity}
                />
              )),
            )}
          </div>
        </ReviewSection>

        <ReviewSection onEdit={() => onEdit(3)} title="Reward tiers">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset type</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Calculation</TableHead>
                <TableHead>Reward</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submittedTiers.map((tier) => (
                <TableRow key={tier.rowId}>
                  <TableCell>{ASSET_TYPE_LABELS[tier.assetType]}</TableCell>
                  <TableCell>
                    <SeverityBadge severity={tier.severity} />
                  </TableCell>
                  <TableCell>{CALCULATION_TYPE_LABELS[tier.calculationType]}</TableCell>
                  <TableCell>{describeTier(tier)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-label-md text-text-muted">
            Arc testnet · USDC · percentage rewards are priced by the reviewer and capped.
          </p>
        </ReviewSection>

        <ReviewSection onEdit={() => onEdit(4)} title="Rules">
          <p className="text-body-sm text-text">
            {`Proof of concept ${draft.rules.pocPolicy} · platform prohibited activities + ${
              draft.rules.prohibitedActivities.length
            } custom ${draft.rules.prohibitedActivities.length === 1 ? 'rule' : 'rules'}`}
          </p>
          <p className="line-clamp-2 text-label-md text-text-muted">{draft.rules.rewardPolicy}</p>
          <p className="text-label-md text-text-muted">
            No KYC · disclosure is decided only after the program ends.
          </p>
        </ReviewSection>

        {/* Sixth summary section. It carries no Edit link because no wizard step owns it: these
            three actions all need the program id the draft does not have yet. */}
        <section className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-lg">
          <h3 className="text-h3 text-text">Next after creating the draft</h3>
          <ol className="flex flex-col gap-xs text-body-sm text-text">
            <li>1 Deploy escrow</li>
            <li>2 Fund USDC</li>
            <li>3 Publish when ready</li>
          </ol>
        </section>

        <StepActions
          onPrimary={onSubmit}
          onSecondary={onBack}
          primaryLabel={submitLabel}
          secondaryLabel="Back"
        />
      </FormCard>
    </StepLayout>
  );
}
