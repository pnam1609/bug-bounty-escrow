'use client';

import type { Severity } from '@bug-bounty-escrow/shared';
import {
  Button,
  CheckboxField,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
} from '@bug-bounty-escrow/ui';
import { useState, type ReactNode } from 'react';

import { OptionCheckList, OptionRadioList } from './filter-fields';
import {
  CLOSING_ANY_LABEL,
  CLOSING_OPTIONS,
  SEVERITY_OPTIONS,
  type ClosingFilter,
  type FilterOption,
} from './program-filters';

/*
 * Desktop filter popovers — `BT-03 · Filter popover`.
 *
 * Each toolbar button opens a panel anchored underneath itself holding a values list, a primary
 * `Apply`, a selected count and `Clear selected`. Selections are a draft until `Apply`, so the
 * table is not re-queried on every checkbox and the user can back out with `Escape`.
 *
 * Sort is deliberately absent from every panel: ordering is owned by the sortable column headers
 * alone (§6).
 */

interface FilterPopoverShellProps {
  readonly children: ReactNode;
  readonly label: string;
  /** Drawn on the trigger as `Asset type · 2` and announced as part of its accessible name. */
  readonly appliedCount: number;
  readonly draftCount: number;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

function FilterPopoverShell({
  appliedCount,
  children,
  draftCount,
  label,
  onApply,
  onClear,
  onOpenChange,
  open,
}: FilterPopoverShellProps) {
  return (
    <Popover modal onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={
            appliedCount === 0 ? `${label} filter` : `${label} filter, ${appliedCount} selected`
          }
          variant="secondary"
        >
          {appliedCount === 0 ? label : `${label} · ${appliedCount}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="flex flex-col gap-lg">
          <div className="flex items-baseline justify-between gap-md">
            <p className="text-label-lg font-semibold text-text">{label}</p>
            <p className="text-label-md text-text-muted">
              {draftCount === 0 ? 'None selected' : `${draftCount} selected`}
            </p>
          </div>
          {children}
          <Separator />
          <div className="flex flex-col gap-md">
            <Button className="w-full" onClick={onApply}>
              Apply
            </Button>
            <div className="flex items-center justify-between gap-md">
              <p className="text-label-md text-text-muted">Selected: {draftCount}</p>
              <Button onClick={onClear} variant="ghost">
                Clear selected
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface MultiFilterPopoverProps<TValue extends string> {
  /** Defaults such as Active + Ended stay checked without being presented as applied filters. */
  readonly appliedCount?: number | undefined;
  readonly label: string;
  readonly options: readonly FilterOption<TValue>[];
  readonly searchLabel?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly selected: readonly TValue[];
  readonly onApply: (next: readonly TValue[]) => void;
}

export function MultiFilterPopover<TValue extends string>({
  appliedCount,
  label,
  options,
  searchLabel,
  searchPlaceholder,
  selected,
  onApply,
}: MultiFilterPopoverProps<TValue>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly TValue[]>(selected);
  const triggerCount = appliedCount ?? selected.length;

  return (
    <FilterPopoverShell
      appliedCount={triggerCount}
      draftCount={draft.length}
      label={label}
      onApply={() => {
        onApply(draft);
        setOpen(false);
      }}
      onClear={() => setDraft([])}
      onOpenChange={(nextOpen) => {
        // Re-seed from the applied state each time the panel opens, so an abandoned draft never
        // leaks into the next visit.
        if (nextOpen) {
          setDraft(selected);
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <OptionCheckList
        legend={label}
        onChange={setDraft}
        options={options}
        searchLabel={searchLabel}
        searchPlaceholder={searchPlaceholder}
        selected={draft}
      />
    </FilterPopoverShell>
  );
}

export interface SingleFilterPopoverProps {
  readonly label: string;
  readonly anyLabel: string;
  readonly options: readonly FilterOption<string>[];
  readonly value: string | null;
  readonly onApply: (next: string | null) => void;
}

export function SingleFilterPopover({
  anyLabel,
  label,
  options,
  value,
  onApply,
}: SingleFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);

  return (
    <FilterPopoverShell
      appliedCount={value === null ? 0 : 1}
      draftCount={draft === null ? 0 : 1}
      label={label}
      onApply={() => {
        onApply(draft);
        setOpen(false);
      }}
      onClear={() => setDraft(null)}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraft(value);
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <OptionRadioList
        anyLabel={anyLabel}
        legend={label}
        onChange={setDraft}
        options={options}
        value={draft}
      />
    </FilterPopoverShell>
  );
}

/** The three secondary filters that do not earn a toolbar button of their own (§6). */
export interface MoreFilters {
  readonly severity: readonly Severity[];
  readonly closing: ClosingFilter | null;
  readonly funded: boolean;
}

export interface MoreFiltersPopoverProps {
  readonly value: MoreFilters;
  readonly onApply: (next: MoreFilters) => void;
}

export function MoreFiltersPopover({ value, onApply }: MoreFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MoreFilters>(value);

  const countOf = (filters: MoreFilters): number =>
    filters.severity.length + (filters.closing === null ? 0 : 1) + (filters.funded ? 1 : 0);

  return (
    <FilterPopoverShell
      appliedCount={countOf(value)}
      draftCount={countOf(draft)}
      label="More filters"
      onApply={() => {
        onApply(draft);
        setOpen(false);
      }}
      onClear={() => setDraft({ severity: [], closing: null, funded: false })}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraft(value);
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <div className="flex flex-col gap-lg">
        <OptionCheckList
          legend="Severity"
          onChange={(severity) => setDraft((current) => ({ ...current, severity }))}
          options={SEVERITY_OPTIONS}
          searchLabel="Search values"
          searchPlaceholder="Search severities"
          selected={draft.severity}
        />
        <OptionRadioList
          anyLabel={CLOSING_ANY_LABEL}
          legend="Deadline"
          onChange={(closing) =>
            setDraft((current) => ({
              ...current,
              closing: (closing as ClosingFilter | null) ?? null,
            }))
          }
          options={CLOSING_OPTIONS}
          value={draft.closing}
        />
        <fieldset className="flex flex-col gap-sm">
          <legend className="mb-sm text-label-md uppercase text-text-muted">Reward pool</legend>
          <CheckboxField
            checked={draft.funded}
            description="Only programs whose escrow still holds a payable balance."
            label="Funded pool only"
            onCheckedChange={(checked) =>
              setDraft((current) => ({ ...current, funded: checked === true }))
            }
          />
        </fieldset>
      </div>
    </FilterPopoverShell>
  );
}
