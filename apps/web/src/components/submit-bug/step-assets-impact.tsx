'use client';

/*
 * SR-01 / SR-01V — Assets & Impact.
 *
 * Figma `143:26` supplies the visuals: search field, radio-card asset list, checkbox impact rows
 * carrying "Severity · guidance", the "View impact definitions" link, and the "Impact not listed?"
 * block behind a separator.
 *
 * The flow doc overrides Figma on substance: impacts are relational rows filtered by the affected
 * scope's asset type (no free-text impact), custom impacts are a repeatable list gated on
 * `allowCustomImpact`, and Figma's "I selected the correct asset…" checkbox is dropped — the only
 * confirmation in this flow lives on Review.
 */

import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CheckboxField,
  Field,
  Input,
  RadioGroup,
  RadioGroupCard,
  Separator,
  SeverityBadge,
} from '@bug-bounty-escrow/ui';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import {
  ASSET_TYPE_LABELS,
  CUSTOM_IMPACTS_DISABLED_MESSAGE,
  customImpactErrorKey,
  describeScope,
  STALE_IMPACTS_MESSAGE,
  type FieldErrors,
  type ProgramImpact,
  type ProgramScope,
  type ReportDraft,
} from './submit-bug-model';

export interface StepAssetsImpactProps {
  readonly allowCustomImpact: boolean;
  readonly draft: ReportDraft;
  readonly errors: FieldErrors;
  readonly impacts: readonly ProgramImpact[];
  readonly onAddCustomImpact: () => void;
  readonly onChangeCustomImpact: (index: number, value: string) => void;
  readonly onRemoveCustomImpact: (index: number) => void;
  /** Drops selected ids the catalog stopped offering. See `staleImpactCount`. */
  readonly onRemoveStaleImpacts: () => void;
  readonly onSelectScope: (scopeId: string) => void;
  readonly onToggleImpact: (impactId: string, checked: boolean) => void;
  readonly programSlug: string;
  readonly scope: ProgramScope | undefined;
  readonly scopes: readonly ProgramScope[];
  /**
   * How many selected impacts the current catalog no longer offers. Non-zero only when the owner
   * edited the program under this draft, and never rendered as a checkbox — hence the explicit
   * remove action.
   */
  readonly staleImpactCount: number;
}

export function StepAssetsImpact({
  allowCustomImpact,
  draft,
  errors,
  impacts,
  onAddCustomImpact,
  onChangeCustomImpact,
  onRemoveCustomImpact,
  onRemoveStaleImpacts,
  onSelectScope,
  onToggleImpact,
  programSlug,
  scope,
  scopes,
  staleImpactCount,
}: StepAssetsImpactProps) {
  const [search, setSearch] = useState('');

  const visibleScopes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return scopes;

    return scopes.filter((candidate) =>
      [
        candidate.assetName,
        candidate.assetUrl ?? '',
        candidate.contractAddress ?? '',
        ASSET_TYPE_LABELS[candidate.assetType],
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [scopes, search]);

  const hasStaleImpacts = staleImpactCount > 0;
  /**
   * The stale notice below states the same sentence verbatim and carries the action that clears it,
   * so the field-level line would only repeat itself.
   */
  const impactsError = hasStaleImpacts ? undefined : errors['programImpactIds'];

  return (
    <Card padding="lg" className="gap-2xl">
      <CardHeader>
        <CardTitle>Choose the affected asset and impact</CardTitle>
        <CardDescription>
          Select the in-scope asset where you found the vulnerability, then choose every program
          impact that applies.
        </CardDescription>
      </CardHeader>

      <Field
        label="Search assets"
        helperText="Filters the list below. It never changes your selection."
      >
        <Input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, address, or URL"
          type="search"
          value={search}
        />
      </Field>

      <fieldset className="flex flex-col gap-sm">
        <legend className="mb-sm text-label-md text-text">
          Affected asset
          <span aria-hidden="true" className="ms-xs text-error">
            *
          </span>
          <span className="sr-only">(required)</span>
        </legend>
        <p className="text-body-sm text-text-muted">
          Only assets currently in scope can be selected.
        </p>
        {/* No pre-selection: the flow doc forbids defaulting to the first scope so a researcher
            can never submit an asset they did not read. */}
        <RadioGroup
          aria-invalid={errors['affectedScopeId'] === undefined ? undefined : true}
          aria-describedby={
            errors['affectedScopeId'] === undefined ? undefined : 'affectedScopeId-error'
          }
          aria-label="Affected asset"
          className="gap-md"
          id="affectedScopeId"
          onValueChange={onSelectScope}
          value={draft.affectedScopeId}
        >
          {visibleScopes.length === 0 ? (
            <p className="rounded-md border border-border bg-surface-raised p-lg text-body-sm text-text-muted">
              No in-scope asset matches that search.
            </p>
          ) : (
            visibleScopes.map((candidate) => (
              <RadioGroupCard
                description={describeScope(candidate)}
                key={candidate.id}
                title={candidate.assetName}
                value={candidate.id}
              >
                {candidate.description === undefined ? null : (
                  <span className="text-label-sm text-text-muted">{candidate.description}</span>
                )}
              </RadioGroupCard>
            ))
          )}
        </RadioGroup>
        {errors['affectedScopeId'] === undefined ? null : (
          <p className="text-label-sm text-error" id="affectedScopeId-error" role="alert">
            {errors['affectedScopeId']}
          </p>
        )}
      </fieldset>

      <Separator />

      <fieldset
        aria-describedby={
          impactsError === undefined && !hasStaleImpacts ? undefined : 'programImpactIds-error'
        }
        className="flex flex-col gap-sm"
        id="programImpactIds"
      >
        <legend className="mb-sm text-label-md text-text">
          {scope === undefined
            ? 'Impacts in scope'
            : `Impacts in scope — ${ASSET_TYPE_LABELS[scope.assetType]}`}
        </legend>
        <p className="text-body-sm text-text-muted">
          Impacts are filtered by the selected asset type. Select every impact that applies.
        </p>

        {/* SR-01V. A disabled or retyped impact stops being rendered, so without this the only
            selection the researcher cannot see is also the only one they cannot clear — and the
            payload would keep a hidden stale id. It sits first so the failed-Continue focus jump
            lands on the action that resolves it. */}
        {hasStaleImpacts ? (
          <Callout variant="danger" title="Some selected impacts no longer apply">
            <div className="flex flex-col items-start gap-md">
              <p id="programImpactIds-error">{STALE_IMPACTS_MESSAGE}</p>
              <Button onClick={onRemoveStaleImpacts} variant="secondary">
                {staleImpactCount === 1
                  ? 'Remove the impact that no longer applies'
                  : `Remove the ${String(staleImpactCount)} impacts that no longer apply`}
              </Button>
            </div>
          </Callout>
        ) : null}

        {scope === undefined ? (
          <p className="rounded-md border border-border bg-surface-raised p-lg text-body-sm text-text-muted">
            Choose an affected asset to see the impacts you can report.
          </p>
        ) : impacts.length === 0 ? (
          <p className="rounded-md border border-border bg-surface-raised p-lg text-body-sm text-text-muted">
            This program has not published impacts for this asset type. Choose another in-scope
            asset, or review the program scope before reporting.
          </p>
        ) : (
          <ul className="flex flex-col gap-md">
            {impacts.map((impact) => (
              <li
                className="rounded-md border border-border bg-surface-raised px-lg py-md"
                key={impact.id}
              >
                <CheckboxField
                  checked={draft.programImpactIds.includes(impact.id)}
                  label={
                    <span className="flex flex-col gap-xs py-sm">
                      <span className="text-label-lg text-text">{impact.title}</span>
                      <span className="flex flex-wrap items-center gap-sm">
                        <SeverityBadge severity={impact.severity} />
                        {impact.description === undefined ? null : (
                          <span className="text-body-sm text-text-muted">{impact.description}</span>
                        )}
                      </span>
                    </span>
                  }
                  name="programImpactIds"
                  onCheckedChange={(checked) => onToggleImpact(impact.id, checked === true)}
                  value={impact.id}
                />
              </li>
            ))}
          </ul>
        )}
        {impactsError === undefined ? null : (
          <p className="text-label-sm text-error" id="programImpactIds-error" role="alert">
            {impactsError}
          </p>
        )}
      </fieldset>

      <Link
        className="inline-flex min-h-11 w-fit items-center gap-sm rounded-sm text-body-sm text-primary hover:underline"
        href={`/programs/${programSlug}#scope`}
      >
        View impact definitions
        <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      </Link>

      <Separator />

      {/* The custom-impact block only exists when the published program allows it. When it does
          not, the copy points back at the program scope instead of offering a bypass. */}
      {allowCustomImpact ? (
        <section
          aria-labelledby="custom-impact-heading"
          className="flex flex-col gap-lg"
          id="customImpacts"
        >
          <div className="flex flex-col gap-xs">
            <h3 className="text-h3 text-text" id="custom-impact-heading">
              Impact not listed?
            </h3>
            <p className="text-body-sm text-text-muted">
              Describe it yourself. A custom impact is labelled{' '}
              <span className="text-text">Researcher proposed</span> and carries no program-defined
              severity — it is still subject to scope review.
            </p>
          </div>

          {/* Each row carries its own error key as the DOM id, so the blur check and the
              post-Continue focus jump resolve to one custom impact, not the whole section. */}
          {draft.customImpacts.map((entry, index) => (
            <div
              className="flex items-start gap-md"
              id={customImpactErrorKey(index)}
              key={`custom-impact-${String(index)}`}
            >
              <Field
                className="flex-1"
                counter={`${String(entry.trim().length)} / 300`}
                error={errors[customImpactErrorKey(index)]}
                helperText="Researcher proposed · describe the end effect and affected users"
                label={`Custom impact ${String(index + 1)}`}
              >
                <Input
                  maxLength={300}
                  onChange={(event) => onChangeCustomImpact(index, event.target.value)}
                  placeholder="Describe the end effect and affected users"
                  value={entry}
                />
              </Field>
              {/* `mt-xl` is the label line plus the 8px label→control gap, so the 44px target
                  lines up with the input rather than the field group. */}
              <Button
                aria-label={`Remove custom impact ${String(index + 1)}`}
                className="mt-xl"
                onClick={() => onRemoveCustomImpact(index)}
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}

          <Button className="w-fit" onClick={onAddCustomImpact} variant="secondary">
            <Plus aria-hidden="true" className="size-4" />
            Add custom impact
          </Button>
        </section>
      ) : (
        <section className="flex flex-col gap-lg" id="customImpacts">
          <Callout title="This program does not accept custom impacts">
            Every reportable impact is published in the program scope. If nothing there matches what
            you found, review the scope before submitting.
          </Callout>

          {/* A draft written while the program still allowed custom impacts keeps them after the
              owner turns the setting off. The editor stays gone — that would be the bypass this
              step must not offer — but the saved text is readable and removable, which is the only
              way past the message blocking Continue. */}
          {draft.customImpacts.length === 0 ? null : (
            <Callout variant="danger" title="Custom impacts saved in this draft">
              <div className="flex flex-col gap-md">
                <p id="customImpacts-error">{CUSTOM_IMPACTS_DISABLED_MESSAGE}</p>
                <ul className="flex flex-col gap-sm">
                  {draft.customImpacts.map((entry, index) => (
                    <li
                      className="flex items-start justify-between gap-md"
                      key={`retired-custom-impact-${String(index)}`}
                    >
                      <span className="min-w-0 flex-1 break-words text-body-sm text-text">
                        {entry.trim() === '' ? 'Empty custom impact' : entry}
                      </span>
                      <Button
                        aria-label={`Remove custom impact ${String(index + 1)}`}
                        onClick={() => onRemoveCustomImpact(index)}
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </Callout>
          )}
        </section>
      )}
    </Card>
  );
}
