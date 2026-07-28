import { Button, Card } from '@bug-bounty-escrow/ui';
import { Coins, LoaderCircle } from 'lucide-react';
import Link from 'next/link';

export function RewardListSkeleton({
  label = 'Loading your reward activity…',
}: {
  readonly label?: string;
}) {
  return (
    <section aria-busy="true" aria-live="polite" className="flex flex-col gap-xl" role="status">
      <div className="flex items-center gap-md text-body-sm text-text-muted">
        <LoaderCircle aria-hidden="true" className="size-xl motion-safe:animate-spin" />
        <p>{label}</p>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-md">
        {Array.from({ length: 4 }, (_, index) => (
          <Card className="h-32 motion-safe:animate-pulse" key={index} />
        ))}
      </div>
    </section>
  );
}

export function RewardEmptyState() {
  return (
    <Card className="items-center text-center" padding="lg">
      <span
        aria-hidden="true"
        className="inline-flex rounded-full border border-border-brand bg-surface-raised p-xl text-text"
      >
        <Coins className="size-xl" />
      </span>
      <div className="flex max-w-2xl flex-col items-center gap-sm">
        <h2 className="text-h2 text-text">No reward activity yet</h2>
        <p className="text-body-sm text-text-muted">
          Validated reports will appear here after an authorized reviewer approves a reward.
        </p>
      </div>
      <div className="flex w-full flex-col gap-md sm:w-auto sm:flex-row">
        <Button asChild className="w-full sm:w-auto">
          <Link href="/reports">View my reports</Link>
        </Button>
        <Button asChild className="w-full sm:w-auto" variant="secondary">
          <Link href="/programs">Browse programs</Link>
        </Button>
      </div>
    </Card>
  );
}

export function RewardFilteredEmptyState({ onClear }: { readonly onClear: () => void }) {
  return (
    <Card className="items-center text-center" padding="lg">
      <div className="flex max-w-xl flex-col items-center gap-sm">
        <h2 className="text-h2 text-text">No rewards match this status</h2>
        <p className="text-body-sm text-text-muted">
          Choose another settlement status or show all reward activity.
        </p>
      </div>
      <Button onClick={onClear} variant="secondary">
        Show all rewards
      </Button>
    </Card>
  );
}

export function RewardLoadError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <section
      className="mx-auto flex max-w-xl flex-col items-center gap-md rounded-lg border border-error bg-surface-raised p-2xl text-center"
      role="alert"
    >
      <h2 className="text-h3 text-text">We couldn't load your rewards</h2>
      <p className="text-body-sm text-text-muted">
        Your reports and settlement records have not changed. Try loading them again.
      </p>
      <Button onClick={onRetry}>Retry</Button>
    </section>
  );
}
