'use client';

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityBadge,
  SwitchField,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@bug-bounty-escrow/ui';
import type { AuthorableAssetType, Severity } from '@bug-bounty-escrow/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import {
  ASSET_TYPE_LABELS,
  ASSET_TYPE_TAB_LABELS,
  assetTypeForErrorKey,
  fieldId,
  inScopeAssetTypes,
  nextRowId,
  normalizeImpactTitle,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  type FieldErrors,
  type ImpactRow,
  type ProgramDraft,
} from './program-draft';
import { GuidancePanel } from './owner-workspace';
import {
  DeleteRowButton,
  FormCard,
  InlineAction,
  StepActions,
  StepLayout,
  ValidationSummary,
} from './wizard-parts';

/*
 * CP-02I coverage summary. Both halves — the enabled count in the card title and this line —
 * describe the ACTIVE asset type only; a program-wide count beside a per-tab severity list would
 * read as if the tab already had impacts it does not have.
 */
function coverageLine(rows: readonly ImpactRow[], assetType: AuthorableAssetType): string {
  const covered = SEVERITY_ORDER.filter((severity) =>
    rows.some((impact) => impact.enabled && impact.severity === severity),
  ).map((severity) => SEVERITY_LABELS[severity]);

  if (covered.length === 0) {
    return `${ASSET_TYPE_TAB_LABELS[assetType]} · No severity covered yet`;
  }

  const last = covered.at(-1) ?? '';
  const list = covered.length === 1 ? last : `${covered.slice(0, -1).join(', ')} and ${last}`;

  return `${ASSET_TYPE_TAB_LABELS[assetType]} · Covers ${list} severity`;
}

/**
 * Dialog state. `ImpactRow.severity` is a real `Severity`, but §3 gives severity no default the way
 * it gives `Enabled` one, so a new custom impact opens with nothing chosen — otherwise a silent
 * `medium` would be saved on the owner's behalf and CP-02IV's "Choose the severity associated with
 * this impact." could never fire.
 */
interface ImpactFormRow extends Omit<ImpactRow, 'severity'> {
  readonly severity: Severity | '';
}

export interface StepImpactsProps {
  /** Owned by the wizard shell so a failed submit can open the tab holding the first failure. */
  readonly activeTab: AuthorableAssetType | null;
  readonly draft: ProgramDraft;
  readonly errors: FieldErrors;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onTabChange: (assetType: AuthorableAssetType) => void;
  readonly update: (patch: Partial<ProgramDraft>) => void;
}

export function StepImpacts({
  activeTab,
  draft,
  errors,
  onBack,
  onContinue,
  onTabChange,
  update,
}: StepImpactsProps) {
  const assetTypes = inScopeAssetTypes(draft);
  const [editing, setEditing] = useState<ImpactFormRow | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [rowErrors, setRowErrors] = useState<FieldErrors>({});

  const active =
    activeTab !== null && assetTypes.includes(activeTab)
      ? activeTab
      : (assetTypes[0] ?? 'smart_contract');
  const activeRows = draft.impacts.filter((impact) => impact.assetType === active);
  const enabledCount = activeRows.filter((impact) => impact.enabled).length;
  const hasErrors = Object.keys(errors).length > 0;
  const severityError = rowErrors['severity'];
  const severityId = fieldId('impact.severity');

  /*
   * CP-02IV: "Tab có lỗi hiển thị error indicator ngoài label để lỗi không bị ẩn." Radix unmounts
   * the inactive panels, so a row-level error is invisible until its tab is opened — the marker has
   * to answer for every error key inside the tab, not just the asset-type-level one. It shares the
   * shell's routing rule so the marker and the failed-submit tab jump can never disagree.
   */
  const errorTabs = new Set(
    Object.keys(errors)
      .map((key) => assetTypeForErrorKey(draft, key))
      .filter((assetType): assetType is AuthorableAssetType => assetType !== null),
  );

  function openCustom(assetType: AuthorableAssetType) {
    setEditing({
      rowId: nextRowId('impact'),
      assetType,
      severity: '',
      title: '',
      description: '',
      enabled: true,
    });
    setIsNew(true);
    setRowErrors({});
  }

  function saveImpact() {
    if (editing === null) return;

    // Keys are inserted in dialog order — title, then severity — so the summary the owner reads
    // first belongs to the first field that failed.
    const validation: Record<string, string> = {};
    const title = editing.title.trim();
    const severity = editing.severity;

    if (title === '') {
      validation['title'] = 'Enter an impact title.';
    } else if (
      draft.impacts.some(
        (impact) =>
          impact.rowId !== editing.rowId &&
          impact.assetType === editing.assetType &&
          normalizeImpactTitle(impact.title) === normalizeImpactTitle(title),
      )
    ) {
      validation['title'] = 'This impact is already listed for this asset type.';
    }

    if (severity === '') {
      validation['severity'] = 'Choose the severity associated with this impact.';
    }

    if (severity === '' || Object.keys(validation).length > 0) {
      setRowErrors(validation);
      return;
    }

    // Stored trimmed: the schema trims before it measures 1–300 and before it normalises the title
    // for the `program + asset type` uniqueness check, so the row must hold what will be sent.
    const saved: ImpactRow = {
      ...editing,
      severity,
      title,
      description: editing.description.trim(),
    };

    update({
      impacts: isNew
        ? [...draft.impacts, saved]
        : draft.impacts.map((impact) => (impact.rowId === saved.rowId ? saved : impact)),
    });
    setEditing(null);
  }

  function renderRows(assetType: AuthorableAssetType) {
    const rows = draft.impacts.filter((impact) => impact.assetType === assetType);
    const groupError = errors[`impacts.${assetType}`];

    return (
      <div className="flex flex-col gap-md">
        {groupError === undefined ? null : (
          <p
            className="text-label-sm text-error"
            id={fieldId(`impacts.${assetType}`)}
            role="alert"
            tabIndex={-1}
          >
            {groupError}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface-raised p-xl text-body-sm text-text-muted">
            Add at least one impact for this asset type.
          </p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {rows.map((impact) => {
              const rowError = errors[`impacts.${impact.rowId}`];
              // The <li> keeps the plain field id because validation focuses the row. The
              // control needs a DISTINCT id: sharing one made `label htmlFor` resolve to the
              // <li>, which left every impact checkbox with no accessible name.
              const rowId = fieldId(`impacts.${impact.rowId}`);
              const checkboxId = `${rowId}-enabled`;

              return (
                <li
                  className="flex flex-col gap-sm rounded-md border border-border bg-surface-raised p-md"
                  id={rowId}
                  key={impact.rowId}
                  tabIndex={-1}
                >
                  <div className="flex flex-wrap items-center gap-md">
                    <span className="flex min-h-11 items-center">
                      <Checkbox
                        checked={impact.enabled}
                        id={checkboxId}
                        onCheckedChange={(checked) =>
                          update({
                            impacts: draft.impacts.map((entry) =>
                              entry.rowId === impact.rowId
                                ? { ...entry, enabled: checked === true }
                                : entry,
                            ),
                          })
                        }
                      />
                    </span>
                    <label
                      className="min-w-48 flex-1 cursor-pointer text-body-sm text-text"
                      htmlFor={checkboxId}
                    >
                      {impact.title}
                    </label>
                    {impact.description === '' ? null : (
                      <p className="hidden max-w-64 flex-1 line-clamp-2 text-label-md text-text-muted lg:block">
                        {impact.description}
                      </p>
                    )}
                    <SeverityBadge severity={impact.severity} />
                    <InlineAction
                      onClick={() => {
                        setEditing(impact);
                        setIsNew(false);
                        setRowErrors({});
                      }}
                    >
                      Edit
                    </InlineAction>
                    {impact.templateKey === undefined ? (
                      <DeleteRowButton
                        label={`Remove impact ${impact.title}`}
                        onClick={() =>
                          update({
                            impacts: draft.impacts.filter((entry) => entry.rowId !== impact.rowId),
                          })
                        }
                      />
                    ) : null}
                  </div>
                  {rowError === undefined ? null : (
                    <p className="text-label-sm text-error" role="alert">
                      {rowError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <Button className="w-fit" onClick={() => openCustom(assetType)} variant="secondary">
          <Plus aria-hidden="true" className="size-4" />
          Add custom impact
        </Button>
      </div>
    );
  }

  return (
    <StepLayout
      aside={
        <GuidancePanel eyebrow="Submit Bug preview" title="These become researcher options">
          <p>
            Every enabled impact appears in the Submit Bug form for the matching asset type.
            Templates are copied into your program, so changing the platform list later never
            changes a running program.
          </p>
          <ul className="flex flex-col gap-xs">
            <li>Each in-scope asset type needs one enabled impact</li>
            <li>Titles must be unique per asset type</li>
          </ul>
        </GuidancePanel>
      }
    >
      {hasErrors ? <ValidationSummary /> : null}

      <FormCard
        description={coverageLine(activeRows, active)}
        title={`${enabledCount} ${enabledCount === 1 ? 'impact' : 'impacts'} enabled`}
      >
        {assetTypes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-surface-raised p-xl text-body-sm text-text-muted">
            Add at least one in-scope asset before configuring impacts.
          </p>
        ) : (
          <Tabs onValueChange={(value) => onTabChange(value as AuthorableAssetType)} value={active}>
            <TabsList aria-label="Impacts by asset type">
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
                {renderRows(assetType)}
              </TabsContent>
            ))}
          </Tabs>
        )}

        <SwitchField
          checked={draft.rules.allowCustomImpact}
          controlPosition="end"
          description="Custom impacts still require reviewer approval."
          label="Allow researchers to propose a custom impact"
          onCheckedChange={(checked) =>
            update({ rules: { ...draft.rules, allowCustomImpact: checked } })
          }
        />

        <StepActions
          onPrimary={onContinue}
          onSecondary={onBack}
          primaryLabel="Continue to rewards"
          secondaryLabel="Back"
        />
      </FormCard>

      <Dialog
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        open={editing !== null}
      >
        <DialogContent size="sm">
          {editing === null ? null : (
            <>
              <DialogHeader>
                <DialogTitle>{isNew ? 'Add custom impact' : 'Edit impact'}</DialogTitle>
                <DialogDescription>
                  {`Shown to researchers reporting a ${ASSET_TYPE_LABELS[
                    editing.assetType
                  ].toLowerCase()} issue.`}
                </DialogDescription>
              </DialogHeader>

              <Field
                error={rowErrors['title']}
                htmlFor={fieldId('impact.title')}
                label="Impact title"
                required
              >
                <Input
                  id={fieldId('impact.title')}
                  maxLength={300}
                  onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                  placeholder="Direct theft of user funds"
                  size="lg"
                  value={editing.title}
                />
              </Field>

              <Field error={severityError} htmlFor={severityId} label="Severity" required>
                <Select
                  onValueChange={(value) => setEditing({ ...editing, severity: value as Severity })}
                  value={editing.severity}
                >
                  {/* `Field` injects its aria wiring into its child, and that child is the Radix
                      Select root, which drops unknown props — so the trigger states its own
                      validity and points at the message `Field` rendered. */}
                  <SelectTrigger
                    aria-describedby={
                      severityError === undefined ? undefined : `${severityId}-message`
                    }
                    aria-invalid={severityError === undefined ? undefined : true}
                    id={severityId}
                    size="lg"
                  >
                    <SelectValue placeholder="Choose a severity" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_ORDER.map((severity) => (
                      <SelectItem key={severity} value={severity}>
                        {SEVERITY_LABELS[severity]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field htmlFor={fieldId('impact.description')} label="Description">
                <Textarea
                  id={fieldId('impact.description')}
                  maxLength={2_000}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                  placeholder="What has to be demonstrated for this impact to count."
                  rows={3}
                  value={editing.description}
                />
              </Field>

              <DialogFooter>
                <Button onClick={() => setEditing(null)} size="lg" variant="secondary">
                  Cancel
                </Button>
                <Button onClick={saveImpact} size="lg">
                  {isNew ? 'Add impact' : 'Save changes'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </StepLayout>
  );
}
