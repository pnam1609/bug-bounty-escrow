import type {
  PaginationMetadata,
  ResearcherRewardPayment,
  ResearcherRewardSummary,
} from '@bug-bounty-escrow/shared';
import {
  Button,
  SeverityBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type StatusBadgeVariant,
} from '@bug-bounty-escrow/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';

import {
  rewardExplorerHref,
  rewardPaginationLabel,
  shortTransactionHash,
} from './reward-dashboard-model';
import { CopyButton } from '@/components/reports/copy-value';
import { formatTimestamp, formatUsdc } from '@/components/reports/report-format';

const REWARD_STATUS_TONES = Object.freeze({
  reward_approved: 'neutral',
  payment_pending: 'usdc',
  paid: 'success',
} as const satisfies Readonly<Record<ResearcherRewardSummary['status'], StatusBadgeVariant>>);

const PAYMENT_STATUS_LABELS = Object.freeze({
  pending: 'Transaction pending',
  confirmed: 'Transaction confirmed',
  failed: 'Transaction failed',
} as const satisfies Readonly<Record<ResearcherRewardPayment['status'], string>>);

const PAYMENT_STATUS_CLASSES = Object.freeze({
  pending: 'text-usdc',
  confirmed: 'text-success',
  failed: 'text-error',
} as const satisfies Readonly<Record<ResearcherRewardPayment['status'], string>>);

function RewardTime({ iso, label }: { readonly iso: string; readonly label: string }) {
  const formatted = formatTimestamp(iso);
  return (
    <time aria-label={`${label} ${formatted}`} dateTime={iso} title={formatted}>
      <span className="text-label-sm text-text-muted">{label}</span>
      <span className="block text-body-sm text-text">{formatted}</span>
    </time>
  );
}

function PaymentEvidence({
  expectedChainId,
  explorerBaseUrl,
  payment,
}: {
  readonly expectedChainId: string;
  readonly explorerBaseUrl: string;
  readonly payment: ResearcherRewardPayment | undefined;
}) {
  if (payment === undefined) {
    return <p className="text-body-sm text-text-muted">No transaction evidence yet.</p>;
  }

  const explorerHref = rewardExplorerHref(payment, explorerBaseUrl, expectedChainId);

  return (
    <div className="flex min-w-0 flex-col gap-sm">
      <p className={`text-label-md ${PAYMENT_STATUS_CLASSES[payment.status]}`}>
        {PAYMENT_STATUS_LABELS[payment.status]}
      </p>
      <div className="flex flex-wrap items-center gap-xs">
        <code
          aria-label={`Full transaction hash ${payment.transactionHash}`}
          className="font-mono text-label-md text-text"
          title={payment.transactionHash}
        >
          {shortTransactionHash(payment.transactionHash)}
        </code>
        <CopyButton value={payment.transactionHash} what="transaction hash" />
      </div>
      {payment.confirmations === undefined ? null : (
        <p className="text-label-sm text-text-muted">
          {`${String(payment.confirmations)} confirmation${payment.confirmations === 1 ? '' : 's'}`}
        </p>
      )}
      {explorerHref === null ? (
        <p className="text-label-sm text-text-muted">
          Explorer unavailable for chain {payment.chainId}.
        </p>
      ) : (
        <a
          className="inline-flex min-h-11 w-fit items-center gap-xs rounded-sm text-label-md text-low hover:underline"
          href={explorerHref}
          rel="noreferrer"
          target="_blank"
        >
          View on Arc explorer (opens external site)
          <ExternalLink aria-hidden="true" className="size-lg" />
        </a>
      )}
    </div>
  );
}

function RewardBadges({ reward }: { readonly reward: ResearcherRewardSummary }) {
  return (
    <div className="flex flex-wrap gap-sm">
      <SeverityBadge severity={reward.finalSeverity} />
      <StatusBadge status={reward.status} variant={REWARD_STATUS_TONES[reward.status]} />
    </div>
  );
}

function RewardTimeline({ reward }: { readonly reward: ResearcherRewardSummary }) {
  return (
    <div className="flex flex-col gap-sm">
      <RewardTime iso={reward.submittedAt} label="Submitted" />
      <RewardTime iso={reward.rewardApprovedAt} label="Approved" />
      {reward.status === 'paid' && reward.paidAt !== undefined ? (
        <RewardTime iso={reward.paidAt} label="Paid" />
      ) : null}
    </div>
  );
}

function RewardCard({ expectedChainId, explorerBaseUrl, reportHref, reward }: RewardRowProps) {
  return (
    <li>
      <article className="flex flex-col gap-lg rounded-lg border border-border bg-surface p-xl">
        <header className="flex flex-col gap-xs">
          <p className="text-label-md text-text-muted">{reward.programName}</p>
          <h2 className="text-h3 text-text">{reward.reportTitle}</h2>
        </header>
        <RewardBadges reward={reward} />
        <dl className="grid gap-md">
          <div>
            <dt className="text-label-sm text-text-muted">Approved reward</dt>
            <dd className="text-h3 text-text">{formatUsdc(reward.approvedReward)}</dd>
          </div>
          <div>
            <dt className="sr-only">Reward dates</dt>
            <dd>
              <RewardTimeline reward={reward} />
            </dd>
          </div>
          <div>
            <dt className="text-label-sm text-text-muted">Transaction evidence</dt>
            <dd>
              <PaymentEvidence
                expectedChainId={expectedChainId}
                explorerBaseUrl={explorerBaseUrl}
                payment={reward.payment}
              />
            </dd>
          </div>
        </dl>
        <Button asChild className="w-full" variant="secondary">
          <Link href={reportHref}>Open report</Link>
        </Button>
      </article>
    </li>
  );
}

interface RewardRowProps {
  readonly expectedChainId: string;
  readonly explorerBaseUrl: string;
  readonly reportHref: string;
  readonly reward: ResearcherRewardSummary;
}

export function RewardList({
  expectedChainId,
  explorerBaseUrl,
  reportHrefFor,
  rewards,
}: {
  readonly expectedChainId: string;
  readonly explorerBaseUrl: string;
  readonly reportHrefFor: (reward: ResearcherRewardSummary) => string;
  readonly rewards: readonly ResearcherRewardSummary[];
}) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableCaption>
            Researcher-owned rewards. Ordered by payment pending, reward approved, then paid; newest
            first within each status.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Program and report</TableHead>
              <TableHead>Severity and status</TableHead>
              <TableHead>Approved reward</TableHead>
              <TableHead>Timeline</TableHead>
              <TableHead>Transaction evidence</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rewards.map((reward) => (
              <TableRow key={reward.reportId}>
                <TableCell className="min-w-64">
                  <p className="text-label-md text-text-muted">{reward.programName}</p>
                  <p className="line-clamp-2 text-label-lg font-semibold text-text">
                    {reward.reportTitle}
                  </p>
                </TableCell>
                <TableCell className="min-w-48">
                  <RewardBadges reward={reward} />
                </TableCell>
                <TableCell className="min-w-40 text-h3 text-text">
                  {formatUsdc(reward.approvedReward)}
                </TableCell>
                <TableCell className="min-w-52">
                  <RewardTimeline reward={reward} />
                </TableCell>
                <TableCell className="min-w-72">
                  <PaymentEvidence
                    expectedChainId={expectedChainId}
                    explorerBaseUrl={explorerBaseUrl}
                    payment={reward.payment}
                  />
                </TableCell>
                <TableCell>
                  <Button asChild variant="ghost">
                    <Link href={reportHrefFor(reward)}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul aria-label="Reward activity" className="flex flex-col gap-md md:hidden">
        {rewards.map((reward) => (
          <RewardCard
            expectedChainId={expectedChainId}
            explorerBaseUrl={explorerBaseUrl}
            key={reward.reportId}
            reportHref={reportHrefFor(reward)}
            reward={reward}
          />
        ))}
      </ul>
    </>
  );
}

export function RewardPagination({
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
      aria-label="Reward pages"
      className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between"
    >
      <p aria-live="polite" className="text-body-sm text-text-muted">
        {rewardPaginationLabel(metadata)}
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
