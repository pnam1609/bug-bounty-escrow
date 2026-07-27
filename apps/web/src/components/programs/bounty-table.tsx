'use client';

import type { ProgramSummary } from '@bug-bounty-escrow/shared';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type TableSortDirection,
} from '@bug-bounty-escrow/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  describeDeadline,
  formatMoney,
  formatTotalPaid,
  programMonogram,
} from './program-format';
import type { ProgramSort, ProgramSortDirection } from './program-filters';

/*
 * Desktop bounty table — `Bounty Table Row` (Figma `117:5`) rendered through the shared shadcn
 * `Table` family. Five columns exactly: Program, Max bounty, Total paid, Deadline, Action (§7).
 *
 * The row is one link, not a clickable container full of nested controls: `View bounty` carries
 * an `after:` overlay that stretches across the positioned row, so the whole 80px band is the hit
 * target while the accessibility tree still sees a single, named link.
 *
 * There is no Status column. Ended programs say so in Deadline, which is also the only place the
 * lifecycle needs to be read from (§7).
 */

/** Suggested desktop widths from §7. They relax below `xl`, keeping the 16px gutter minimum. */
const COLUMN_WIDTHS = {
  program: 'w-96 min-w-60',
  maxBounty: 'w-56 min-w-36',
  totalPaid: 'w-64 min-w-36',
  deadline: 'w-56 min-w-36',
  action: 'w-52 min-w-36',
} as const;

const SORTABLE_COLUMNS = [
  { key: 'name', label: 'Program', className: `${COLUMN_WIDTHS.program} normal-case` },
  {
    key: 'maxBounty',
    label: 'Max bounty',
    className: `${COLUMN_WIDTHS.maxBounty} normal-case`,
  },
  {
    key: 'totalPaid',
    label: 'Total paid',
    className: `${COLUMN_WIDTHS.totalPaid} normal-case`,
  },
  { key: 'deadline', label: 'Deadline', className: `${COLUMN_WIDTHS.deadline} normal-case` },
] as const satisfies readonly { key: ProgramSort; label: string; className: string }[];

const ARIA_SORT: Readonly<Record<ProgramSortDirection, TableSortDirection>> = Object.freeze({
  asc: 'ascending',
  desc: 'descending',
});

export interface BountyTableSortState {
  readonly sort: ProgramSort;
  readonly direction: ProgramSortDirection | null;
}

export interface BountyTableProps {
  readonly caption: string;
  readonly programs: readonly ProgramSummary[];
  readonly sortState: BountyTableSortState;
  readonly onSort: (column: ProgramSort) => void;
  /** Replaces the body with a single full-width cell — skeleton, empty or error. */
  readonly bodyOverride?: ReactNode;
}

export function BountyTable({
  bodyOverride,
  caption,
  onSort,
  programs,
  sortState,
}: BountyTableProps) {
  return (
    <Table containerClassName="rounded-lg">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-surface-raised">
          {SORTABLE_COLUMNS.map((column) => (
            <TableHead
              className={column.className}
              key={column.key}
              onSort={() => onSort(column.key)}
              sortDirection={
                sortState.sort === column.key && sortState.direction !== null
                  ? ARIA_SORT[sortState.direction]
                  : null
              }
              sortable
            >
              {column.label}
            </TableHead>
          ))}
          <TableHead className={COLUMN_WIDTHS.action}>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bodyOverride === undefined ? (
          programs.map((program) => <BountyTableRow key={program.id} program={program} />)
        ) : (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={5}>{bodyOverride}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function BountyTableRow({ program }: { readonly program: ProgramSummary }) {
  const maxBounty = formatMoney(program.maxBounty, 'maximum bounty');
  const publicTotalPaid = program.totalPaidVisibility === 'public' ? program.totalPaid : null;
  const totalPaid = formatTotalPaid(publicTotalPaid);
  const deadline = describeDeadline(program);

  return (
    <TableRow className="relative h-20 has-[a:focus-visible]:bg-surface-raised">
      <TableCell className={COLUMN_WIDTHS.program}>
        <span className="flex items-center gap-md">
          {program.logoUrl === undefined ? (
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-h3 text-primary-contrast"
            >
              {programMonogram(program.name)}
            </span>
          ) : (
            // The URL is public program data from the API. An empty alt avoids repeating the
            // adjacent program name; the fixed box preserves the Figma row geometry.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="size-10 shrink-0 rounded-md object-cover"
              height={40}
              src={program.logoUrl}
              width={40}
            />
          )}
          <span className="min-w-0 truncate text-label-lg text-text">{program.name}</span>
        </span>
      </TableCell>
      <TableCell className={COLUMN_WIDTHS.maxBounty}>
        <span className="text-label-lg text-text">
          <span aria-hidden="true">{maxBounty.text}</span>
          <span className="sr-only">{maxBounty.label}</span>
        </span>
      </TableCell>
      <TableCell className={COLUMN_WIDTHS.totalPaid}>
        <span
          className={
            publicTotalPaid === null ? 'text-label-lg text-text-muted' : 'text-label-lg text-text'
          }
        >
          <span aria-hidden="true">{totalPaid.text}</span>
          <span className="sr-only">{totalPaid.label}</span>
        </span>
      </TableCell>
      <TableCell className={COLUMN_WIDTHS.deadline}>
        <span aria-hidden="true" className="flex flex-col gap-xs">
          <span
            className={deadline.ended ? 'text-label-lg text-text-muted' : 'text-label-lg text-text'}
          >
            {deadline.primary}
          </span>
          <span className="text-label-sm text-text-muted">{deadline.secondary}</span>
        </span>
        <span className="sr-only">{deadline.label}</span>
      </TableCell>
      <TableCell className={`${COLUMN_WIDTHS.action} text-right`}>
        {/* The `after:` overlay is what makes the row clickable; it stays inside this one link so
            the row never contains a second interactive element. */}
        <Link
          className="inline-flex min-h-11 items-center justify-end gap-sm rounded-sm text-label-lg text-escrow after:absolute after:inset-0 after:rounded-sm after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
          href={`/programs/${program.id}`}
        >
          View bounty
          <span className="sr-only"> for {program.name}</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </TableCell>
    </TableRow>
  );
}

/** Initial load only. No fake figures — grey bars in the real column geometry (§9). */
export function BountyTableSkeletonBody({ rows = 6 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex h-20 items-center gap-md" key={index}>
          <span className="size-10 shrink-0 rounded-md bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-4 w-48 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="ml-auto h-4 w-24 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-4 w-24 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-4 w-24 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
