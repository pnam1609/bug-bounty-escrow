'use client';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from './class-names.js';

export const TABLE_SORT_DIRECTIONS = Object.freeze(['ascending', 'descending'] as const);
export type TableSortDirection = (typeof TABLE_SORT_DIRECTIONS)[number];

export interface TableProps extends ComponentPropsWithoutRef<'table'> {
  /** Styles the bordered container rather than the `<table>` itself. */
  containerClassName?: string;
}

/**
 * shadcn table shape on the BBE surface. The border, radius and clipping live on the container and
 * the horizontal overflow scrolls in a track inside it, so a wide table never drags the page body
 * sideways.
 */
export const Table = forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, containerClassName, ...tableProps },
  ref,
) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border bg-surface',
        containerClassName,
      )}
    >
      <div className="w-full overflow-x-auto">
        <table
          {...tableProps}
          ref={ref}
          className={cn('w-full caption-bottom border-collapse text-body-sm', className)}
        />
      </div>
    </div>
  );
});

export type TableHeaderProps = ComponentPropsWithoutRef<'thead'>;

/** Owns the muted header colour so `TableHead` is free to declare its type token. */
export const TableHeader = forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  function TableHeader({ className, ...headerProps }, ref) {
    return (
      <thead
        {...headerProps}
        ref={ref}
        className={cn(
          'bg-surface-raised text-text-muted [&_tr]:border-b [&_tr]:border-border',
          className,
        )}
      />
    );
  },
);

export type TableBodyProps = ComponentPropsWithoutRef<'tbody'>;

export const TableBody = forwardRef<HTMLTableSectionElement, TableBodyProps>(function TableBody(
  { className, ...bodyProps },
  ref,
) {
  return <tbody {...bodyProps} ref={ref} className={cn('[&_tr:last-child]:border-0', className)} />;
});

export type TableRowProps = ComponentPropsWithoutRef<'tr'>;

export const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { className, ...rowProps },
  ref,
) {
  return (
    <tr
      {...rowProps}
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-surface-raised data-[state=selected]:bg-surface-raised',
        className,
      )}
    />
  );
});

export interface TableHeadProps extends ComponentPropsWithoutRef<'th'> {
  /** Fired on click and on Enter/Space — the caller flips ascending ↔ descending. */
  onSort?: () => void;
  /** `null` or omitted means this column is not the active sort. */
  sortDirection?: TableSortDirection | null;
  sortable?: boolean;
}

/**
 * Header cell. When `sortable`, the whole cell becomes a keyboard-reachable button — a 48px target
 * — and the cell publishes `aria-sort`. The indicator is neutral until the column is active, then
 * an up or down arrow.
 */
export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  {
    'aria-sort': ariaSort,
    children,
    className,
    onSort,
    scope = 'col',
    sortDirection,
    sortable = false,
    ...headProps
  },
  ref,
) {
  const SortIcon =
    sortDirection === 'ascending'
      ? ArrowUp
      : sortDirection === 'descending'
        ? ArrowDown
        : ChevronsUpDown;

  return (
    <th
      {...headProps}
      ref={ref}
      scope={scope}
      aria-sort={sortable ? (sortDirection ?? 'none') : ariaSort}
      className={cn(
        'text-left align-middle text-label-md uppercase',
        sortable ? 'p-none' : 'px-xl py-lg',
        className,
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className="flex w-full items-center justify-between gap-sm px-xl py-lg text-left hover:text-text"
        >
          <span>{children}</span>
          <SortIcon
            aria-hidden="true"
            className={cn(
              'size-lg shrink-0',
              sortDirection === undefined || sortDirection === null
                ? 'text-text-disabled'
                : 'text-text',
            )}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
});

export type TableCellProps = ComponentPropsWithoutRef<'td'>;

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { className, ...cellProps },
  ref,
) {
  return <td {...cellProps} ref={ref} className={cn('px-xl py-lg align-middle', className)} />;
});

export type TableCaptionProps = ComponentPropsWithoutRef<'caption'>;

export const TableCaption = forwardRef<HTMLTableCaptionElement, TableCaptionProps>(
  function TableCaption({ className, ...captionProps }, ref) {
    return (
      <caption {...captionProps} ref={ref} className={cn('mt-lg text-text-muted', className)} />
    );
  },
);
