import { Button } from '@bug-bounty-escrow/ui';
import { ChevronDown, LoaderCircle } from 'lucide-react';

export interface BountyInfiniteStatusProps {
  readonly hasNextPage: boolean;
  readonly hasPrograms: boolean;
  readonly isLoadMoreError: boolean;
  readonly isLoadingMore: boolean;
  readonly onRetry: () => void;
}

/** Stable, inline sentinel content: loaded rows are never replaced by a load-more state. */
export function BountyInfiniteStatus({
  hasNextPage,
  hasPrograms,
  isLoadMoreError,
  isLoadingMore,
  onRetry,
}: BountyInfiniteStatusProps) {
  if (isLoadMoreError) {
    return (
      <div className="flex flex-wrap items-center gap-md text-body-sm text-text" role="alert">
        <span>{"Couldn't load more"}</span>
        <Button disabled={isLoadingMore} onClick={onRetry} variant="secondary">
          Try again
        </Button>
      </div>
    );
  }

  if (isLoadingMore) {
    return (
      <p
        aria-live="polite"
        className="flex items-center gap-sm text-body-sm text-text-muted"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        Loading more bounties…
      </p>
    );
  }

  if (hasNextPage) {
    return (
      <p className="flex items-center gap-sm text-body-sm text-text-muted">
        <ChevronDown aria-hidden="true" className="size-4" />
        Scroll to load more bounties
      </p>
    );
  }

  return hasPrograms ? (
    <p className="text-body-sm text-text-muted">{"You've reached the end"}</p>
  ) : null;
}

/** Initial load only: no fake values, and no mandatory animation. */
export function BountyFilterSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-lg">
      <div className="flex flex-col gap-lg md:flex-row md:items-end md:justify-between">
        <div className="order-2 flex flex-wrap gap-md md:order-1">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              className="h-11 w-32 rounded-full bg-surface-raised motion-safe:animate-pulse"
              key={index}
            />
          ))}
        </div>
        <div className="order-1 flex flex-col gap-sm md:order-2 md:w-96">
          <span className="h-4 w-32 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-11 w-full rounded-md bg-surface-raised motion-safe:animate-pulse" />
        </div>
      </div>
      <span className="h-4 w-64 max-w-full rounded-sm bg-surface-raised motion-safe:animate-pulse" />
    </div>
  );
}

export function BountyHeadingMetaSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-wrap items-center justify-between gap-md"
    >
      <span className="h-6 w-48 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
      <span className="h-4 w-40 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
    </div>
  );
}
