'use client';

import {
  reportResponseSchema,
  updateReportPayoutWalletRequestSchema,
  type ReportDetail,
} from '@bug-bounty-escrow/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@bug-bounty-escrow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck, Wallet } from 'lucide-react';
import { useId, useState } from 'react';

import { CopyButton } from './copy-value';
import { arcExplorerHref } from './crypto-value';
import { ResearcherWalletPicker } from '@/components/wallets/researcher-wallet-picker';
import { reportWalletUpdateError } from '@/components/wallets/researcher-wallet-model';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const BLOCKED_COPY = Object.freeze({
  wallet_required: 'Select a verified wallet before continuing.',
  report_closed: 'This report is closed, so its reward destination can no longer be changed.',
  program_ended: 'This program has ended, so the report’s reward destination is locked.',
  settlement_started:
    'Reward settlement has started. The locked destination cannot be changed from this report.',
});

export interface ReportRewardWalletProps {
  readonly principalId: string;
  readonly report: ReportDetail;
  readonly token: string | undefined;
}

export function ReportRewardWallet({ principalId, report, token }: ReportRewardWalletProps) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(report.payoutWallet?.walletId ?? '');
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const capability = report.payoutWalletCapability;
  const canEdit = capability?.canEdit === true;
  const blockedReason = capability?.blockedReason;
  const version = report.payoutWalletSelectionVersion;
  const wallet = report.payoutWallet;
  const mutation = useMutation({
    mutationFn: async () => {
      const body = updateReportPayoutWalletRequestSchema.parse({
        walletId: selectedId,
        expectedSelectionVersion: version,
      });
      return apiRequest(
        `/api/reports/${encodeURIComponent(report.id)}/payout-wallet`,
        reportResponseSchema,
        {
          method: 'PUT',
          token,
          body,
        },
      );
    },
    onSuccess: async (response) => {
      client.setQueryData(queryKeys.report(principalId, report.id), response);
      await client.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) });
      setError(null);
      setEditing(false);
    },
    onError: (cause) => setError(reportWalletUpdateError(cause)),
  });

  const blockedCopy =
    blockedReason === undefined
      ? 'The server has locked wallet editing for this report.'
      : BLOCKED_COPY[blockedReason];
  const settlementComplete = report.status === 'paid' && report.paidSettlementProof !== undefined;

  return (
    <Card className="gap-xl" padding="lg">
      <CardHeader>
        <div className="flex items-start gap-md">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-raised"
          >
            <Wallet className="size-xl text-text" />
          </span>
          <div className="flex flex-col gap-xs">
            <CardTitle>Reward wallet</CardTitle>
            <CardDescription>
              {settlementComplete
                ? 'The verified Arc Testnet wallet that received this report’s USDC reward. See Disclosure summary for the server-verified payout transaction.'
                : 'The verified Arc Testnet wallet selected for any eligible USDC reward on this report.'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      {wallet?.address !== undefined && wallet.maskedAddress !== undefined ? (
        <div className="flex flex-col gap-md rounded-md border border-border bg-surface-raised p-lg sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-xs">
            <p className="flex flex-wrap items-center gap-sm text-label-lg text-text">
              <span>{wallet.label ?? 'Verified wallet'}</span>
              <span className="inline-flex items-center gap-xs text-label-sm text-success">
                <ShieldCheck aria-hidden="true" className="size-4" />
                Verified
              </span>
            </p>
            <code className="font-mono text-body-sm text-text">{wallet.maskedAddress}</code>
            <p className="text-label-sm text-text-muted">EVM · Arc Testnet · USDC</p>
          </div>
          <div className="flex items-center gap-xs">
            <CopyButton value={wallet.address} what="reward wallet address" />
            {canEdit ? (
              <a
                aria-label="Open reward wallet address in Arc explorer (opens external site)"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-low hover:underline"
                href={arcExplorerHref(wallet.address, 'address')}
                rel="noreferrer"
                target="_blank"
                title="Open reward wallet address in Arc explorer"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-warning bg-surface-raised p-lg">
          <p className="text-label-lg text-text">Reward wallet required</p>
          <p className="mt-xs text-body-sm text-text-muted">
            Select a verified wallet before the program owner can approve a reward.
          </p>
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-xl">
          <ResearcherWalletPicker
            accessToken={token}
            onChange={setSelectedId}
            principalId={principalId}
            value={selectedId}
          />
          {error === null ? null : (
            <p className="text-body-sm text-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-md sm:flex-row sm:justify-end">
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                setEditing(false);
                setSelectedId(report.payoutWallet?.walletId ?? '');
                setError(null);
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={mutation.isPending || selectedId === '' || version === undefined}
              loading={mutation.isPending}
              loadingLabel="Updating wallet…"
              onClick={() => void mutation.mutate()}
              type="button"
            >
              Save wallet for this report
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-sm">
          <Button
            aria-describedby={!canEdit ? reasonId : undefined}
            disabled={!canEdit || version === undefined}
            onClick={() => {
              setSelectedId(report.payoutWallet?.walletId ?? '');
              setEditing(true);
            }}
            type="button"
            variant="secondary"
          >
            {wallet?.walletId === undefined ? 'Select reward wallet' : 'Change reward wallet'}
          </Button>
          {!canEdit || version === undefined ? (
            <p className="text-body-sm text-text-muted" id={reasonId}>
              {version === undefined
                ? 'Wallet editing is temporarily unavailable. Reload the report before trying again.'
                : blockedCopy}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}
