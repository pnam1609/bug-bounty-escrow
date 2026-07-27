'use client';

import { programListResponseSchema } from '@bug-bounty-escrow/shared';
import {
  Button,
  CheckboxField,
  Separator,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { OptionCheckList, OptionRadioList } from './filter-fields';
import {
  ASSET_TYPE_OPTIONS,
  CLOSING_ANY_LABEL,
  CLOSING_OPTIONS,
  REWARD_ANY_LABEL,
  REWARD_OPTIONS,
  SEVERITY_OPTIONS,
  STATUS_OPTIONS,
  countAppliedFilters,
  toQueryKeyFilters,
  toUrlSearchParams,
  type ClosingFilter,
  type ProgramFilterState,
} from './program-filters';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/*
 * `BT-10 · Mobile filters`.
 *
 * Below the table breakpoint every filter lives in one bottom sheet with a sticky footer. Nothing
 * is applied while the user ticks boxes — the table updates once, from `Show … bounties` (§6).
 *
 * That primary label has to name a real number, so the sheet asks the API for a count of the
 * draft selection (one row, metadata only) while it is open. Until that answers, the button says
 * `Show bounties` rather than quoting the previous filter's total back at the user.
 */

export interface ProgramFilterSheetProps {
  readonly filters: ProgramFilterState;
  readonly onApply: (next: ProgramFilterState) => void;
}

export function ProgramFilterSheet({ filters, onApply }: ProgramFilterSheetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProgramFilterState>(filters);
  const appliedCount = countAppliedFilters(filters);
  const draftCount = countAppliedFilters(draft);

  const previewParams = toUrlSearchParams(draft);
  previewParams.set('page', '1');
  previewParams.set('limit', '1');

  const preview = useQuery({
    queryKey: queryKeys.programs({ ...toQueryKeyFilters(draft), preview: true }),
    queryFn: () => apiRequest(`/api/programs?${previewParams}`, programListResponseSchema),
    enabled: open,
    staleTime: 30_000,
  });

  const matchCount = preview.data?.metadata.totalItems;
  const showLabel =
    matchCount === undefined
      ? 'Show bounties'
      : `Show ${matchCount} ${matchCount === 1 ? 'bounty' : 'bounties'}`;

  function update(patch: Partial<ProgramFilterState>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <Sheet
      onOpenChange={(nextOpen) => {
        // Opening always re-seeds from what is actually applied; closing without applying
        // therefore discards the draft rather than half-committing it.
        if (nextOpen) {
          setDraft(filters);
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <SheetTrigger asChild>
        <Button className="w-full" size="lg" variant="secondary">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filters
          {appliedCount === 0 ? null : (
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-sm py-xs text-label-sm font-semibold text-primary-contrast">
              {appliedCount}
            </span>
          )}
          <span className="sr-only">
            {appliedCount === 0 ? 'No filters applied' : `${appliedCount} filters applied`}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        {/* `pr-14` keeps the active-count clear of the absolutely positioned close button. */}
        <SheetHeader className="flex-row items-center justify-between gap-md pr-14">
          <SheetTitle>Filters</SheetTitle>
          <p className="text-label-md text-escrow">
            {draftCount === 0 ? 'None active' : `${draftCount} active`}
          </p>
        </SheetHeader>
        <SheetBody>
          <OptionCheckList
            legend="Status"
            onChange={(status) => update({ status })}
            options={STATUS_OPTIONS}
            selected={draft.status}
          />
          <Separator />
          <OptionCheckList
            legend="Asset type"
            onChange={(assetType) => update({ assetType })}
            options={ASSET_TYPE_OPTIONS}
            selected={draft.assetType}
          />
          <Separator />
          <OptionCheckList
            legend="Severity"
            onChange={(severity) => update({ severity })}
            options={SEVERITY_OPTIONS}
            selected={draft.severity}
          />
          <Separator />
          <OptionRadioList
            anyLabel={REWARD_ANY_LABEL}
            legend="Reward"
            onChange={(minMaxReward) => update({ minMaxReward })}
            options={REWARD_OPTIONS}
            value={draft.minMaxReward}
          />
          <Separator />
          <OptionRadioList
            anyLabel={CLOSING_ANY_LABEL}
            legend="Closing"
            onChange={(closing) => update({ closing: (closing as ClosingFilter | null) ?? null })}
            options={CLOSING_OPTIONS}
            value={draft.closing}
          />
          <Separator />
          <CheckboxField
            checked={draft.funded}
            label="Funded pool only"
            onCheckedChange={(checked) => update({ funded: checked === true })}
          />
        </SheetBody>
        <SheetFooter className="flex-row items-center justify-between gap-md sm:justify-between">
          <Button
            className="flex-1"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                search: '',
                status: [],
                assetType: [],
                severity: [],
                minMaxReward: null,
                closing: null,
                funded: false,
              }))
            }
            variant="secondary"
          >
            Clear all
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onApply(draft);
              setOpen(false);
            }}
          >
            {showLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
