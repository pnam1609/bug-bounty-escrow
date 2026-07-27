'use client';

import { CheckboxField, Input, RadioGroup, RadioGroupItemField } from '@bug-bounty-escrow/ui';
import { Search } from 'lucide-react';
import { useId, useState } from 'react';

import type { FilterOption } from './program-filters';

/*
 * The two option lists behind every filter surface. The desktop popover (BT-03) and the mobile
 * bottom sheet (BT-10) render exactly these, so a filter can never behave differently depending
 * on which one the user opened.
 *
 * Both are controlled and hold no state of their own beyond the values-search box: the caller
 * owns a draft and decides when it is committed, which is what makes "apply once" possible on
 * mobile.
 */

export interface OptionCheckListProps<TValue extends string> {
  readonly legend: string;
  readonly options: readonly FilterOption<TValue>[];
  /** Shows a values-search box above the list. Worth it once a list passes a handful of rows. */
  readonly searchLabel?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly selected: readonly TValue[];
  readonly onChange: (next: readonly TValue[]) => void;
}

export function OptionCheckList<TValue extends string>({
  legend,
  options,
  searchLabel,
  searchPlaceholder,
  selected,
  onChange,
}: OptionCheckListProps<TValue>) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const visible =
    normalized === ''
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(normalized));

  function toggle(value: TValue, checked: boolean) {
    const next = new Set(selected);

    if (checked) {
      next.add(value);
    } else {
      next.delete(value);
    }

    // Emit in the catalog's own order so the URL is stable however the boxes were ticked.
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-sm">
      <legend className="mb-sm text-label-md uppercase text-text-muted">{legend}</legend>
      {searchLabel === undefined ? null : (
        <div className="flex flex-col gap-sm">
          <label className="text-label-md text-text" htmlFor={searchId}>
            {searchLabel}
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-md top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              id={searchId}
              className="pl-2xl"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder ?? 'Search values'}
              type="search"
              value={query}
            />
          </div>
        </div>
      )}
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-sm text-body-sm text-text-muted">No matching options</p>
        ) : (
          visible.map((option) => (
            <CheckboxField
              key={option.value}
              checked={selected.includes(option.value)}
              label={option.label}
              onCheckedChange={(checked) => toggle(option.value, checked === true)}
            />
          ))
        )}
      </div>
    </fieldset>
  );
}

/**
 * Radix compares radio values by string identity, so "unset" needs a token of its own rather
 * than an empty string — an empty value would read as "nothing is selected" and leave the group
 * with no checked row at all.
 */
const ANY_VALUE = '__any__';

export interface OptionRadioListProps {
  readonly legend: string;
  /** Copy for the leading "no preference" row, e.g. `Any reward`. */
  readonly anyLabel: string;
  readonly options: readonly FilterOption<string>[];
  readonly value: string | null;
  readonly onChange: (next: string | null) => void;
}

export function OptionRadioList({
  anyLabel,
  legend,
  options,
  value,
  onChange,
}: OptionRadioListProps) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-sm">
      <legend className="mb-sm text-label-md uppercase text-text-muted">{legend}</legend>
      <RadioGroup
        aria-label={legend}
        onValueChange={(next) => onChange(next === ANY_VALUE ? null : next)}
        value={value ?? ANY_VALUE}
      >
        <RadioGroupItemField label={anyLabel} value={ANY_VALUE} />
        {options.map((option) => (
          <RadioGroupItemField key={option.value} label={option.label} value={option.value} />
        ))}
      </RadioGroup>
    </fieldset>
  );
}
