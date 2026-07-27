'use client';

import { Button } from '@bug-bounty-escrow/ui';
import { X } from 'lucide-react';

import type { AppliedFilterChip, ProgramFilterState } from './program-filters';

/*
 * Applied-filter row — the reusable `Filter Chip` (Figma `119:5`) plus `Clear all`.
 *
 * The whole chip is the remove control rather than a small × nested inside a decorative pill:
 * one target, one accessible name ("Remove Smart contract filter"), and the 44px floor is met
 * without inflating the row.
 */

export interface FilterChipsProps {
  readonly chips: readonly AppliedFilterChip[];
  readonly filters: ProgramFilterState;
  readonly onChange: (next: ProgramFilterState) => void;
  readonly onClearAll: () => void;
}

export function FilterChips({ chips, filters, onChange, onClearAll }: FilterChipsProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap items-center gap-sm">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button
            aria-label={`Remove ${chip.label} filter`}
            className="inline-flex min-h-11 max-w-full items-center gap-sm rounded-full border border-border-brand bg-surface-raised px-lg text-label-md text-text transition-colors hover:bg-ambient motion-reduce:transition-none"
            onClick={() => onChange(chip.remove(filters))}
            type="button"
          >
            <span className="truncate">{chip.label}</span>
            <X aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
          </button>
        </li>
      ))}
      <li>
        <Button onClick={onClearAll} variant="ghost">
          Clear all
        </Button>
      </li>
    </ul>
  );
}
