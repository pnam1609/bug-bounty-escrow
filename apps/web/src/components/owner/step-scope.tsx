'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  Label,
  RadioGroup,
  RadioGroupItemField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@bug-bounty-escrow/ui';
import type { AuthorableAssetType } from '@bug-bounty-escrow/shared';
import { Ellipsis, Plus } from 'lucide-react';
import { useState } from 'react';

import {
  ASSET_TYPE_LABELS,
  ASSET_TYPE_TAB_LABELS,
  AUTHORABLE_ASSET_TYPES,
  fieldId,
  nextRowId,
  shortenAddress,
  validateScopeRow,
  type FieldErrors,
  type ProgramDraft,
  type ScopeRow,
} from './program-draft';
import { GuidancePanel } from './owner-workspace';
import { FormCard, InlineAction, StepActions, StepLayout, ValidationSummary } from './wizard-parts';

const MAX_SCOPES = 50;

function ScopeStatusBadge({ inScope }: { readonly inScope: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-sm rounded-full border bg-surface-raised px-md py-xs text-label-sm font-semibold uppercase ${
        inScope ? 'border-escrow' : 'border-border'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-sm rounded-full ${inScope ? 'bg-escrow' : 'bg-text-muted'}`}
      />
      <span className={inScope ? 'text-escrow' : 'text-text-muted'}>
        {inScope ? 'In scope' : 'Out of scope'}
      </span>
    </span>
  );
}

function emptyScopeRow(assetType: AuthorableAssetType): ScopeRow {
  return {
    rowId: nextRowId('scope'),
    assetType,
    assetName: '',
    assetUrl: '',
    contractAddress: '',
    isInScope: true,
    description: '',
  };
}

export interface StepScopeProps {
  readonly draft: ProgramDraft;
  readonly errors: FieldErrors;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly update: (patch: Partial<ProgramDraft>) => void;
}

export function StepScope({ draft, errors, onBack, onContinue, update }: StepScopeProps) {
  const [tab, setTab] = useState<AuthorableAssetType>('smart_contract');
  /** `null` when the editor is closed; otherwise the row being created or edited. */
  const [editing, setEditing] = useState<ScopeRow | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [rowErrors, setRowErrors] = useState<FieldErrors>({});

  const inScopeCount = draft.scopes.filter((scope) => scope.isInScope).length;
  const outOfScopeCount = draft.scopes.length - inScopeCount;
  const hasErrors = Object.keys(errors).length > 0;

  function openCreate() {
    setEditing(emptyScopeRow(tab));
    setIsNew(true);
    setRowErrors({});
  }

  function openEdit(row: ScopeRow) {
    setEditing(row);
    setIsNew(false);
    setRowErrors({});
  }

  function saveRow() {
    if (editing === null) return;

    const validation = validateScopeRow(editing);
    if (Object.keys(validation).length > 0) {
      // CP-02V: the dialog stays open while the error belongs to the item being edited.
      setRowErrors(validation);
      return;
    }

    if (isNew) {
      if (draft.scopes.length >= MAX_SCOPES) {
        setRowErrors({ assetName: 'A program can contain up to 50 scope items.' });
        return;
      }
      update({ scopes: [...draft.scopes, editing] });
    } else {
      update({
        scopes: draft.scopes.map((scope) => (scope.rowId === editing.rowId ? editing : scope)),
      });
    }

    setTab(editing.assetType);
    setEditing(null);
  }

  function renderList(assetType: AuthorableAssetType) {
    const rows = draft.scopes.filter((scope) => scope.assetType === assetType);

    if (rows.length === 0) {
      return (
        <p className="rounded-md border border-dashed border-border bg-surface-raised p-xl text-body-sm text-text-muted">
          Add at least one asset researchers can assess.
        </p>
      );
    }

    return (
      <ul className="flex flex-col gap-lg">
        {rows.map((scope) => {
          const rowError = errors[`scopes.${scope.rowId}`];

          return (
            <li
              className="flex flex-col gap-sm rounded-lg border border-border bg-surface-raised p-lg"
              id={fieldId(`scopes.${scope.rowId}`)}
              key={scope.rowId}
              tabIndex={-1}
            >
              <ScopeStatusBadge inScope={scope.isInScope} />
              <p className="text-h3 text-text">{scope.assetName}</p>
              {scope.assetUrl === '' && scope.contractAddress === '' ? null : (
                <p className="truncate text-body-sm text-primary">
                  {scope.contractAddress === ''
                    ? scope.assetUrl
                    : shortenAddress(scope.contractAddress)}
                </p>
              )}
              {scope.description === '' ? null : (
                <p className="line-clamp-2 text-body-sm text-text-muted">{scope.description}</p>
              )}
              {rowError === undefined ? null : (
                <p className="text-label-sm text-error" role="alert">
                  {rowError}
                </p>
              )}
              <div className="flex items-center gap-md">
                <InlineAction onClick={() => openEdit(scope)}>Edit</InlineAction>
                {/* CP-02: `Edit` sits on the card; `Remove` lives behind the overflow menu. */}
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-text-muted transition-colors hover:bg-ambient hover:text-text motion-reduce:transition-none">
                    <Ellipsis aria-hidden="true" className="size-4" />
                    <span className="sr-only">{`More actions for ${scope.assetName}`}</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onSelect={() =>
                        update({
                          scopes: draft.scopes.filter((entry) => entry.rowId !== scope.rowId),
                        })
                      }
                      variant="destructive"
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <StepLayout
      aside={
        <GuidancePanel eyebrow="Clear boundaries" title="Make scope unambiguous">
          <p>
            Use a separate item for each website and contract, and mark anything researchers must
            leave alone as out of scope.
          </p>
          <ul className="flex flex-col gap-xs">
            <li>Up to 50 items</li>
            <li>URL must be valid</li>
            <li>EVM addresses are validated</li>
          </ul>
        </GuidancePanel>
      }
    >
      {hasErrors ? <ValidationSummary detail={errors['scopes']} /> : null}

      <FormCard
        title={`${draft.scopes.length} ${draft.scopes.length === 1 ? 'scope item' : 'scope items'}`}
      >
        <p className="text-body-sm text-text-muted" id={fieldId('scopes')} tabIndex={-1}>
          {`${inScopeCount} in scope · ${outOfScopeCount} out of scope`}
        </p>

        <Tabs onValueChange={(value) => setTab(value as AuthorableAssetType)} value={tab}>
          <TabsList aria-label="Filter scope by asset type">
            {AUTHORABLE_ASSET_TYPES.map((assetType) => (
              <TabsTrigger key={assetType} value={assetType}>
                {ASSET_TYPE_TAB_LABELS[assetType]}
              </TabsTrigger>
            ))}
          </TabsList>
          {AUTHORABLE_ASSET_TYPES.map((assetType) => (
            <TabsContent key={assetType} value={assetType}>
              {renderList(assetType)}
            </TabsContent>
          ))}
        </Tabs>

        <Button
          className="w-fit"
          disabled={draft.scopes.length >= MAX_SCOPES}
          onClick={openCreate}
          variant="secondary"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add scope
        </Button>

        <StepActions
          onPrimary={onContinue}
          onSecondary={onBack}
          primaryLabel="Continue to impacts"
          secondaryLabel="Back"
        />
      </FormCard>

      {/* CP-02A — 640px scope editor. Client draft only; it never calls the create API. */}
      <Dialog
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        open={editing !== null}
      >
        <DialogContent size="md">
          {editing === null ? null : (
            <>
              <DialogHeader>
                <DialogTitle>{isNew ? 'Add scope item' : 'Edit scope item'}</DialogTitle>
                <DialogDescription>
                  Add an asset and clearly mark whether researchers may test it.
                </DialogDescription>
              </DialogHeader>

              <Field htmlFor={fieldId('scope.assetType')} label="Asset type" required>
                <Select
                  onValueChange={(value) =>
                    setEditing({ ...editing, assetType: value as AuthorableAssetType })
                  }
                  value={editing.assetType}
                >
                  <SelectTrigger id={fieldId('scope.assetType')} size="lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Both types are always offered, whatever tab is active behind the dialog. */}
                    {AUTHORABLE_ASSET_TYPES.map((assetType) => (
                      <SelectItem key={assetType} value={assetType}>
                        {ASSET_TYPE_LABELS[assetType]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                error={rowErrors['assetName']}
                htmlFor={fieldId('scope.assetName')}
                label="Asset name"
                required
              >
                <Input
                  id={fieldId('scope.assetName')}
                  maxLength={200}
                  onChange={(event) => setEditing({ ...editing, assetName: event.target.value })}
                  placeholder="Aegis Core Contract"
                  size="lg"
                  value={editing.assetName}
                />
              </Field>

              <Field
                error={rowErrors['assetUrl']}
                helperText="Optional. The page or repository researchers should start from."
                htmlFor={fieldId('scope.assetUrl')}
                label="Asset URL"
              >
                <Input
                  id={fieldId('scope.assetUrl')}
                  onChange={(event) => setEditing({ ...editing, assetUrl: event.target.value })}
                  placeholder="https://app.aegis.xyz"
                  size="lg"
                  value={editing.assetUrl}
                />
              </Field>

              <Field
                error={rowErrors['contractAddress']}
                helperText={
                  editing.assetType === 'smart_contract'
                    ? 'Recommended for a contract asset. Checksummed EVM address.'
                    : 'Optional.'
                }
                htmlFor={fieldId('scope.contractAddress')}
                label="Contract address"
              >
                <Input
                  id={fieldId('scope.contractAddress')}
                  onChange={(event) =>
                    setEditing({ ...editing, contractAddress: event.target.value })
                  }
                  placeholder="0x0000000000000000000000000000000000000000"
                  size="lg"
                  value={editing.contractAddress}
                />
              </Field>

              <div className="flex flex-col gap-sm">
                <Label>Scope status</Label>
                <RadioGroup
                  aria-label="Scope status"
                  className="grid-cols-2"
                  onValueChange={(value) => setEditing({ ...editing, isInScope: value === 'in' })}
                  value={editing.isInScope ? 'in' : 'out'}
                >
                  <RadioGroupItemField label="In scope" value="in" />
                  <RadioGroupItemField label="Out of scope" value="out" />
                </RadioGroup>
              </div>

              <Field
                error={rowErrors['description']}
                htmlFor={fieldId('scope.description')}
                label="Description"
              >
                <Textarea
                  id={fieldId('scope.description')}
                  maxLength={2_000}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                  placeholder="Primary protocol contracts deployed on Arc."
                  rows={3}
                  value={editing.description}
                />
              </Field>

              <DialogFooter>
                <Button onClick={() => setEditing(null)} size="lg" variant="secondary">
                  Cancel
                </Button>
                <Button onClick={saveRow} size="lg">
                  {isNew ? 'Add scope' : 'Save changes'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </StepLayout>
  );
}
