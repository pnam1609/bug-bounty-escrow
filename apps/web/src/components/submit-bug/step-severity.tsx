'use client';

/*
 * SR-02 / SR-02V — Severity.
 *
 * Figma `144:28` gives the layout: a small "selected asset / impacts" summary card with an
 * "Edit assets & impacts" link, the severity radio cards, and a reviewer-decision callout.
 *
 * The flow doc overrides Figma on the acknowledgement: Figma shows a permanent "I understand my
 * proposed severity is not the final decision" checkbox, but the contract only records
 * `severityMismatchAcknowledged`. So the checkbox appears *only* when the proposal differs from
 * the highest selected impact severity, it names both values, and it blocks Continue until it is
 * ticked. The disclaimer that the reviewer decides is always-on copy, not a checkbox.
 *
 * Because the checkbox is the only way to clear the acknowledgement, it must never outlive the
 * mismatch it describes — `commitDraftChange` in the model drops it whenever either value moves,
 * so the step can render the current pair without inheriting an answer to an older question.
 *
 * Nothing here ever writes the researcher's selection: the warning names both values and asks, it
 * never raises the proposal to the suggestion, and the reviewer still decides the final severity.
 */

import { SEVERITIES, type Severity } from '@bug-bounty-escrow/shared';
import {
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckboxField,
  RadioGroup,
  RadioGroupCard,
  SeverityBadge,
  SEVERITY_LABELS,
} from '@bug-bounty-escrow/ui';
import { Pencil } from 'lucide-react';

import {
  ASSET_TYPE_LABELS,
  hasSeverityMismatch,
  SEVERITY_DISCLAIMER,
  SEVERITY_GUIDANCE,
  severityMismatchMessage,
  STEP_HEADINGS,
  STEP_SUBTITLES,
  type FieldErrors,
  type ProgramScope,
  type ReportDraft,
} from './submit-bug-model';

export interface StepSeverityProps {
  readonly customImpactCount: number;
  readonly draft: ReportDraft;
  readonly errors: FieldErrors;
  readonly onAcknowledgeMismatch: (acknowledged: boolean) => void;
  readonly onEditAssets: () => void;
  readonly onSelectSeverity: (severity: Severity) => void;
  readonly scope: ProgramScope | undefined;
  readonly selectedImpactTitles: readonly string[];
  readonly suggestedSeverity: Severity | undefined;
}

export function StepSeverity({
  customImpactCount,
  draft,
  errors,
  onAcknowledgeMismatch,
  onEditAssets,
  onSelectSeverity,
  scope,
  selectedImpactTitles,
  suggestedSeverity,
}: StepSeverityProps) {
  const mismatch = hasSeverityMismatch(draft.proposedSeverity, suggestedSeverity);
  const totalImpacts = selectedImpactTitles.length + customImpactCount;

  return (
    <div className="flex flex-col gap-2xl">
      {/* Selected-impact context is never hidden behind the severity choice. */}
      <Card padding="md" variant="subtle">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="flex min-w-0 flex-col gap-xs">
            <p className="text-label-lg font-semibold text-text">
              {scope?.assetName ?? 'No asset selected'}
            </p>
            <p className="text-body-sm text-text-muted">
              {scope === undefined
                ? 'Choose an asset in step 1'
                : ASSET_TYPE_LABELS[scope.assetType]}{' '}
              · {totalImpacts} selected {totalImpacts === 1 ? 'impact' : 'impacts'}
            </p>
            <p className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
              Highest selected impact:
              {suggestedSeverity === undefined ? (
                <span className="text-text">
                  none — your custom impacts carry no program-defined severity
                </span>
              ) : (
                <SeverityBadge severity={suggestedSeverity} />
              )}
            </p>
          </div>
          <button
            className="inline-flex min-h-11 items-center gap-sm rounded-sm px-sm text-body-sm text-primary hover:underline"
            onClick={onEditAssets}
            type="button"
          >
            <Pencil aria-hidden="true" className="size-4 shrink-0" />
            Edit assets &amp; impacts
          </button>
        </div>
      </Card>

      <Card padding="lg" className="gap-2xl">
        {/*
         * SR-02 heading and supporting copy come from the step model, which the composer subtitle
         * also renders: the severity is an independent field, so the copy that frames it as an
         * assessment rather than a decision must read identically in both places.
         */}
        <CardHeader>
          <CardTitle>{STEP_HEADINGS[1]}</CardTitle>
          <CardDescription>{STEP_SUBTITLES[1]}</CardDescription>
        </CardHeader>

        <fieldset className="flex flex-col gap-sm">
          <legend className="mb-sm text-label-md text-text">
            Proposed severity
            <span aria-hidden="true" className="ms-xs text-error">
              *
            </span>
            <span className="sr-only">(required)</span>
          </legend>
          {/* No default selection, per flow doc §8 SR-02. */}
          <RadioGroup
            aria-describedby={
              errors['proposedSeverity'] === undefined ? undefined : 'proposedSeverity-error'
            }
            aria-invalid={errors['proposedSeverity'] === undefined ? undefined : true}
            aria-label="Proposed severity"
            className="gap-md sm:grid-cols-2"
            id="proposedSeverity"
            onValueChange={(value) => onSelectSeverity(value as Severity)}
            value={draft.proposedSeverity}
          >
            {SEVERITIES.map((severity) => (
              <RadioGroupCard
                description={SEVERITY_GUIDANCE[severity]}
                key={severity}
                title={<SeverityBadge severity={severity} />}
                value={severity}
              />
            ))}
          </RadioGroup>
          {errors['proposedSeverity'] === undefined ? null : (
            <p className="text-label-sm text-error" id="proposedSeverity-error" role="alert">
              {errors['proposedSeverity']}
            </p>
          )}
        </fieldset>

        <Callout title="Reviewer decision">{SEVERITY_DISCLAIMER}</Callout>

        {/* Mismatch never rewrites either value: it names both and asks for an explicit signal. */}
        {mismatch && suggestedSeverity !== undefined && draft.proposedSeverity !== '' ? (
          <Callout title="Your severity differs from the selected impacts" variant="warning">
            <div className="flex flex-col gap-md" id="severityMismatchAcknowledged">
              <p>{severityMismatchMessage(draft.proposedSeverity, suggestedSeverity)}</p>
              <div className="flex flex-wrap items-center gap-md">
                <SeverityBadge
                  severity={suggestedSeverity}
                  label={`Impacts suggest ${SEVERITY_LABELS[suggestedSeverity]}`}
                />
                <SeverityBadge
                  severity={draft.proposedSeverity}
                  label={`You propose ${SEVERITY_LABELS[draft.proposedSeverity]}`}
                />
              </div>
              <CheckboxField
                checked={draft.severityMismatchAcknowledged}
                error={errors['severityMismatchAcknowledged']}
                label="I reviewed the mismatch and want to continue with my proposed severity."
                onCheckedChange={(checked) => onAcknowledgeMismatch(checked === true)}
              />
            </div>
          </Callout>
        ) : null}
      </Card>
    </div>
  );
}
