'use client';

import {
  Button,
  Callout,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bug-bounty-escrow/ui';
import type { AuthorableAssetType, Severity } from '@bug-bounty-escrow/shared';
import { Plus } from 'lucide-react';

import {
  ASSET_TYPE_LABELS,
  ASSET_TYPE_TAB_LABELS,
  assetTypeForErrorKey,
  CALCULATION_TYPE_LABELS,
  createTierRow,
  fieldId,
  inScopeAssetTypes,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  type CalculationType,
  type FieldErrors,
  type ProgramDraft,
  type TierRow,
} from './program-draft';
import { GuidancePanel } from './owner-workspace';
import {
  AffixedField,
  DeleteRowButton,
  FormCard,
  StepActions,
  StepLayout,
  ValidationSummary,
} from './wizard-parts';

const CALCULATION_TYPES: readonly CalculationType[] = ['range', 'flat', 'percentage'];

/*
 * CP-03 coverage summary. Like CP-02I's, every half of it — the count in the card title and this
 * line — describes the ACTIVE tab only: a program-wide count beside one tab's severity list would
 * read as if that asset type were already priced.
 *
 * The sentence is a derived summary, so it walks the canonical severity order; the rows themselves
 * stay in the order the owner entered them.
 */
function coverageLine(rows: readonly TierRow[], assetType: AuthorableAssetType): string {
  const covered = SEVERITY_ORDER.filter((severity) =>
    rows.some((tier) => tier.severity === severity),
  ).map((severity) => SEVERITY_LABELS[severity]);

  if (covered.length === 0) {
    return `${ASSET_TYPE_TAB_LABELS[assetType]} · No severity priced yet`;
  }

  const last = covered.at(-1) ?? '';
  const list = covered.length === 1 ? last : `${covered.slice(0, -1).join(', ')} and ${last}`;

  return `${ASSET_TYPE_TAB_LABELS[assetType]} · Rewards set for ${list} severity`;
}

/** Amount control with a fixed unit suffix. Network Arc and token USDC are platform-fixed. */
function SuffixedInput(props: {
  readonly error?: string | undefined;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly suffix: string;
  readonly value: string;
}) {
  return (
    <AffixedField
      className="min-w-40 flex-1"
      error={props.error}
      id={props.id}
      inputMode="decimal"
      label={props.label}
      onChange={props.onChange}
      placeholder={props.placeholder}
      suffix={props.suffix}
      value={props.value}
    />
  );
}

export interface StepRewardsProps {
  /** Owned by the wizard shell so a failed submit can open the tab holding the first failure. */
  readonly activeTab: AuthorableAssetType | null;
  readonly draft: ProgramDraft;
  readonly errors: FieldErrors;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onTabChange: (assetType: AuthorableAssetType) => void;
  readonly update: (patch: Partial<ProgramDraft>) => void;
}

export function StepRewards({
  activeTab,
  draft,
  errors,
  onBack,
  onContinue,
  onTabChange,
  update,
}: StepRewardsProps) {
  const assetTypes = inScopeAssetTypes(draft);

  const active =
    activeTab !== null && assetTypes.includes(activeTab)
      ? activeTab
      : (assetTypes[0] ?? 'smart_contract');
  const activeRows = draft.rewardTiers.filter((tier) => tier.assetType === active);
  const hasErrors = Object.keys(errors).length > 0;

  /*
   * CP-03V: the tab strip is the only place a failing panel can announce itself, because Radix
   * unmounts the inactive `TabsContent`. The marker answers for EVERY error key inside the tab —
   * the asset-type key and every row key — through the same routing rule the shell uses to jump
   * to the failing tab, so the two can never disagree.
   */
  const errorTabs = new Set(
    Object.keys(errors)
      .map((key) => assetTypeForErrorKey(draft, key))
      .filter((assetType): assetType is AuthorableAssetType => assetType !== null),
  );

  function patchTier(rowId: string, patch: Partial<TierRow>) {
    update({
      rewardTiers: draft.rewardTiers.map((tier) =>
        tier.rowId === rowId ? { ...tier, ...patch } : tier,
      ),
    });
  }

  function renderTier(tier: TierRow) {
    const severityId = fieldId(`rewardTiers.${tier.rowId}.severity`);
    const severityError = errors[`rewardTiers.${tier.rowId}.severity`];

    return (
      <li
        className="flex flex-col gap-md rounded-md border border-border bg-surface-raised p-lg"
        key={tier.rowId}
      >
        <div className="flex flex-wrap items-start gap-md">
          <Field className="w-44" error={severityError} htmlFor={severityId} label="Severity">
            <Select
              onValueChange={(value) => patchTier(tier.rowId, { severity: value as Severity })}
              value={tier.severity}
            >
              {/* `Field` injects its aria wiring into its child, and that child is the Radix
                  Select root, which drops unknown props — so the trigger states its own validity
                  and points at the message `Field` rendered. */}
              <SelectTrigger
                aria-describedby={severityError === undefined ? undefined : `${severityId}-message`}
                aria-invalid={severityError === undefined ? undefined : true}
                id={severityId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_ORDER.map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {/* Dot and label centred with an 8px gap, per the flow document. */}
                    <SeverityDot severity={severity} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            className="w-52"
            htmlFor={fieldId(`rewardTiers.${tier.rowId}.type`)}
            label="Calculation type"
          >
            <Select
              onValueChange={(value) =>
                patchTier(tier.rowId, { calculationType: value as CalculationType })
              }
              value={tier.calculationType}
            >
              <SelectTrigger id={fieldId(`rewardTiers.${tier.rowId}.type`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALCULATION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CALCULATION_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {tier.calculationType === 'range' ? (
            <>
              <SuffixedInput
                error={errors[`rewardTiers.${tier.rowId}.minReward`]}
                id={fieldId(`rewardTiers.${tier.rowId}.minReward`)}
                label="Minimum reward"
                onChange={(value) => patchTier(tier.rowId, { minReward: value })}
                placeholder="10000"
                suffix="USDC"
                value={tier.minReward}
              />
              <SuffixedInput
                error={errors[`rewardTiers.${tier.rowId}.maxReward`]}
                id={fieldId(`rewardTiers.${tier.rowId}.maxReward`)}
                label="Maximum reward"
                onChange={(value) => patchTier(tier.rowId, { maxReward: value })}
                placeholder="50000"
                suffix="USDC"
                value={tier.maxReward}
              />
            </>
          ) : null}

          {tier.calculationType === 'flat' ? (
            <SuffixedInput
              error={errors[`rewardTiers.${tier.rowId}.flatAmount`]}
              id={fieldId(`rewardTiers.${tier.rowId}.flatAmount`)}
              label="Flat amount"
              onChange={(value) => patchTier(tier.rowId, { flatAmount: value })}
              placeholder="25000"
              suffix="USDC"
              value={tier.flatAmount}
            />
          ) : null}

          {tier.calculationType === 'percentage' ? (
            <>
              <SuffixedInput
                error={errors[`rewardTiers.${tier.rowId}.percentage`]}
                id={fieldId(`rewardTiers.${tier.rowId}.percentage`)}
                label="Percentage"
                onChange={(value) => patchTier(tier.rowId, { percentage: value })}
                placeholder="10"
                suffix="%"
                value={tier.percentage}
              />
              <SuffixedInput
                error={errors[`rewardTiers.${tier.rowId}.maxRewardCap`]}
                id={fieldId(`rewardTiers.${tier.rowId}.maxRewardCap`)}
                label="Maximum reward cap"
                onChange={(value) => patchTier(tier.rowId, { maxRewardCap: value })}
                placeholder="250000"
                suffix="USDC"
                value={tier.maxRewardCap}
              />
            </>
          ) : null}

          {/* CP-03: a `trash-2` icon button, never a `Remove` text action. The name is screen
              reader only, so it carries the row's severity to tell the rows apart. */}
          <DeleteRowButton
            className="self-end"
            label={`Delete ${SEVERITY_LABELS[tier.severity]} reward tier`}
            onClick={() =>
              update({
                rewardTiers: draft.rewardTiers.filter((entry) => entry.rowId !== tier.rowId),
              })
            }
          />
        </div>

        <Field htmlFor={fieldId(`rewardTiers.${tier.rowId}.note`)} label="Calculation note">
          <Input
            id={fieldId(`rewardTiers.${tier.rowId}.note`)}
            maxLength={2_000}
            onChange={(event) => patchTier(tier.rowId, { calculationNote: event.target.value })}
            placeholder="10% of directly affected funds, capped at 250,000 USDC"
            value={tier.calculationNote}
          />
        </Field>
      </li>
    );
  }

  function renderTiers(assetType: AuthorableAssetType) {
    const rows = draft.rewardTiers.filter((tier) => tier.assetType === assetType);
    const groupError = errors[`rewardTiers.${assetType}`];

    return (
      <div className="flex flex-col gap-md">
        {groupError === undefined ? null : (
          <p
            className="text-label-sm text-error"
            id={fieldId(`rewardTiers.${assetType}`)}
            role="alert"
            tabIndex={-1}
          >
            {groupError}
          </p>
        )}

        {rows.length > 0 ? (
          <ul className="flex flex-col gap-md">{rows.map(renderTier)}</ul>
        ) : groupError === undefined ? (
          // The empty state carries CP-03V's per-asset-type sentence, so once a failed submit has
          // raised it as a real error above, the placeholder would only say it a second time.
          <p className="rounded-md border border-dashed border-border bg-surface-raised p-xl text-body-sm text-text-muted">
            Add at least one reward tier for this asset type.
          </p>
        ) : null}

        <Button
          className="w-fit"
          onClick={() =>
            update({
              rewardTiers: [...draft.rewardTiers, createTierRow(assetType, draft.rewardTiers)],
            })
          }
          variant="secondary"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add reward tier
        </Button>
      </div>
    );
  }

  return (
    <StepLayout
      aside={
        <GuidancePanel eyebrow="Reward rules" title="Clear, unique ranges">
          <ul className="flex flex-col gap-xs">
            <li>One row per severity, per asset type</li>
            <li>Maximum must be at or above minimum</li>
            <li>Amounts are USDC on Arc</li>
          </ul>
          <p className="text-label-sm uppercase text-text-muted">Current draft pool</p>
          <p className="text-h2 text-text">0 USDC</p>
        </GuidancePanel>
      }
    >
      {hasErrors ? <ValidationSummary detail={errors['rewardTiers']} /> : null}

      <FormCard
        description={coverageLine(activeRows, active)}
        title={`${activeRows.length} ${ASSET_TYPE_LABELS[active].toLowerCase()} reward ${
          activeRows.length === 1 ? 'tier' : 'tiers'
        }`}
      >
        {assetTypes.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-border bg-surface-raised p-xl text-body-sm text-text-muted"
            id={fieldId('rewardTiers')}
            tabIndex={-1}
          >
            Add at least one in-scope asset before setting reward tiers.
          </p>
        ) : (
          <Tabs onValueChange={(value) => onTabChange(value as AuthorableAssetType)} value={active}>
            <TabsList aria-label="Reward tiers by asset type">
              {assetTypes.map((assetType) => (
                <TabsTrigger
                  error={errorTabs.has(assetType)}
                  errorLabel={`${ASSET_TYPE_TAB_LABELS[assetType]} has validation errors`}
                  key={assetType}
                  value={assetType}
                >
                  {ASSET_TYPE_TAB_LABELS[assetType]}
                </TabsTrigger>
              ))}
            </TabsList>
            {assetTypes.map((assetType) => (
              <TabsContent key={assetType} value={assetType}>
                {renderTiers(assetType)}
              </TabsContent>
            ))}
          </Tabs>
        )}

        <Callout title="Percentage rewards" variant="info">
          The reviewer records the verified affected amount at approval; the platform computes rate
          × basis and applies the cap.
        </Callout>

        <Callout variant="warning">
          These ranges describe intended rewards. Researchers will only see the program after escrow
          is funded and the program is published.
        </Callout>

        <StepActions
          onPrimary={onContinue}
          onSecondary={onBack}
          primaryLabel="Continue to rules"
          secondaryLabel="Back"
        />
      </FormCard>
    </StepLayout>
  );
}
