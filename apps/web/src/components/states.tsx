import { Button } from '@bug-bounty-escrow/ui';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

/*
 * The full-page message states shared by the route guard (ACCESS-01 and its loading half) and the
 * odd Suspense fallback. Shaped after `programs/bounty-states.tsx`: one centred column, a
 * `text-h3` lead line, a muted supporting sentence and at most one action row; an error block
 * carries `role="alert"` plus the error border rather than red text alone. Copy stays generic —
 * nothing here ever prints a response body, an error code or the resource behind the route.
 */

export function LoadingState({ label = 'Loading…' }: { readonly label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-md px-xl py-3xl text-center"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-6 text-text-muted motion-safe:animate-spin"
      />
      <p className="text-body-sm text-text-muted">{label}</p>
    </div>
  );
}

export function EmptyState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-md px-xl py-2xl text-center">
      <h2 className="text-h3 text-text">{title}</h2>
      <p className="text-body-sm text-text-muted">{detail}</p>
    </section>
  );
}

export function ErrorState({
  action,
  message = 'Something went wrong.',
  retry,
  title,
}: {
  /** A single pre-built action, e.g. the forbidden state's role-landing link. */
  readonly action?: ReactNode;
  readonly message?: string;
  readonly retry?: () => void;
  readonly title?: string;
}) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-xl py-3xl">
      <section
        role="alert"
        className="flex w-full max-w-md flex-col items-center gap-md rounded-md border border-error bg-surface-raised px-xl py-2xl text-center"
      >
        {title === undefined ? null : <p className="text-h3 text-text">{title}</p>}
        <p className={title === undefined ? 'text-h3 text-text' : 'text-body-sm text-text-muted'}>
          {message}
        </p>
        {retry === undefined ? null : <Button onClick={retry}>Try again</Button>}
        {action}
      </section>
    </div>
  );
}

export function ConfirmButton({
  children,
  confirmMessage,
  disabled,
  onConfirm,
}: {
  readonly children: ReactNode;
  readonly confirmMessage: string;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
}) {
  return (
    <Button
      variant="secondary"
      disabled={disabled}
      onClick={() => {
        if (window.confirm(confirmMessage)) onConfirm();
      }}
    >
      {children}
    </Button>
  );
}
