import type { PaginationMetadata } from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';

export function reportPaginationLabel(metadata: PaginationMetadata): string {
  if (metadata.totalItems === 0) return 'Showing 0 of 0 reports';

  const first = (metadata.page - 1) * metadata.limit + 1;
  const last = Math.min(metadata.page * metadata.limit, metadata.totalItems);
  return `Showing ${String(first)}–${String(last)} of ${String(metadata.totalItems)} reports`;
}

export function ReportPagination({
  disabled = false,
  metadata,
  onPageChange,
}: {
  readonly disabled?: boolean;
  readonly metadata: PaginationMetadata;
  readonly onPageChange: (page: number) => void;
}) {
  return (
    <nav
      aria-label="Report pages"
      className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between"
    >
      <p aria-live="polite" className="text-body-sm text-text-muted">
        {reportPaginationLabel(metadata)}
      </p>
      <div className="flex items-center gap-sm">
        <Button
          disabled={disabled || !metadata.hasPreviousPage}
          onClick={() => onPageChange(metadata.page - 1)}
          variant="secondary"
        >
          Previous
        </Button>
        <span className="min-w-11 text-center text-label-md text-text">
          <span className="sr-only">Page </span>
          {metadata.page}
          <span className="sr-only"> of {metadata.totalPages}</span>
        </span>
        <Button
          disabled={disabled || !metadata.hasNextPage}
          onClick={() => onPageChange(metadata.page + 1)}
          variant="secondary"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
