'use client';

import type { FundingConfirmationArtifact, Program } from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Separator,
  StatusBadge,
} from '@bug-bounty-escrow/ui';
import { CheckCircle2, Circle, LoaderCircle, Plus, Trash2, Wallet } from 'lucide-react';

import {
  FUNDING_NETWORK_IDS,
  FUNDING_NETWORKS,
  canStartDestinationOperation,
  deriveFundingRoute,
  fundingEstimatedNetAmount,
  fundingRecoveryAction,
  fundingRouteLabel,
  parseUsdcBaseUnits,
  type FundingDestinationResult,
  type FundingNetworkId,
  type FundingOperationPhase,
  type FundingSource,
  type ValidatedFundingSelection,
  type VerifiedFundingIntent,
} from './program-funding-flow';
import { fieldId, formatUsdc, shortenAddress } from './program-draft';
import { AffixedField, FormCard, SummaryRow } from './wizard-parts';
import { RainbowKitFundingButton } from './rainbowkit-funding-button';

export type SourceDepositStatus =
  | 'not_started'
  | 'submitting'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'replaceable'
  | 'top_up_required'
  | 'recovery_required';

export interface FundingAllocationsProps {
  readonly program: Program;
  readonly grossAmount: string;
  readonly sources: readonly FundingSource[];
  readonly errors: Readonly<Record<string, string>>;
  readonly walletAddress: string | undefined;
  readonly walletName: string | undefined;
  readonly walletPending: boolean;
  readonly walletError: string | undefined;
  readonly depositStatuses: Readonly<Record<string, SourceDepositStatus>>;
  readonly depositRequiredAmounts: Readonly<Record<string, string>>;
  readonly depositRecoveryHashes: Readonly<Record<string, string>>;
  readonly confirmedUnifiedBalance: string | undefined;
  readonly pendingUnifiedBalance: string | undefined;
  readonly estimatedFeeReserve: string | undefined;
  readonly transactionsEnabled: boolean;
  readonly canSubmit: boolean;
  readonly readinessChecked: boolean;
  readonly working: boolean;
  readonly onConnectWallet: () => void;
  readonly onDisconnectWallet?: () => void;
  readonly onGrossAmountChange: (value: string) => void;
  readonly onSourceChange: (rowId: string, patch: Partial<FundingSource>) => void;
  readonly onAddSource: () => void;
  readonly onRemoveSource: (rowId: string) => void;
  readonly onDepositSource: (source: FundingSource) => void;
  readonly onDepositRecoveryHashChange: (rowId: string, value: string) => void;
  readonly onRefreshUnifiedBalance: () => void;
  readonly onSubmit: () => void;
  readonly onCheckReadiness: () => void;
  readonly onLater: () => void;
}

export function FundingAllocations({
  confirmedUnifiedBalance,
  canSubmit,
  readinessChecked,
  depositRequiredAmounts,
  depositRecoveryHashes,
  depositStatuses,
  estimatedFeeReserve,
  errors,
  grossAmount,
  onAddSource,
  onConnectWallet,
  onDisconnectWallet,
  onDepositSource,
  onDepositRecoveryHashChange,
  onGrossAmountChange,
  onLater,
  onRefreshUnifiedBalance,
  onRemoveSource,
  onSourceChange,
  onSubmit,
  onCheckReadiness,
  pendingUnifiedBalance,
  program,
  sources,
  transactionsEnabled,
  working,
  walletAddress,
  walletError,
}: FundingAllocationsProps) {
  void onConnectWallet;
  void onDisconnectWallet;
  const routeMode = deriveFundingRoute(sources);
  const selectedNetworks = new Set(sources.map((source) => source.network));
  const isUnified = routeMode === 'unified_balance';
  const hasStartedUnifiedDeposit = sources.some(
    (source) => (depositStatuses[source.rowId] ?? 'not_started') !== 'not_started',
  );

  return (
    <div className="flex min-w-0 flex-col gap-xl">
      <FormCard
        description="Connect the owner wallet that will sign each funding operation."
        title="Funding wallet"
      >
        <div className="flex flex-col gap-lg rounded-md border border-border bg-surface-raised p-lg sm:flex-row sm:items-center sm:justify-between">
          <span className="flex min-w-0 items-center gap-md">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ambient text-primary">
              <Wallet aria-hidden="true" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-col gap-xs">
              <span className="text-label-sm font-semibold uppercase text-text-muted">
                Funding wallet
              </span>
              <span className="truncate text-body-sm text-text">
                RainbowKit manages the connected account and wallet permissions.
              </span>
            </span>
          </span>
          <RainbowKitFundingButton className="w-full sm:w-auto" />
        </div>
        {walletError === undefined ? null : (
          <Callout title="Wallet connection failed" variant="danger">
            {walletError}
          </Callout>
        )}
      </FormCard>

      <FormCard
        description="Choose exact testnet sources. The route is derived automatically."
        title="Funding sources"
      >
        <AffixedField
          error={errors['grossAmount']}
          helperText="Gross amount before route fees. Use no more than 6 decimal places."
          id={fieldId('fund.gross-amount')}
          inputMode="decimal"
          label="Gross funding amount"
          onChange={onGrossAmountChange}
          placeholder="185000"
          required
          size="lg"
          suffix="USDC"
          value={grossAmount}
        />

        <div className="flex flex-col gap-md">
          {sources.map((source, index) => {
            const network = FUNDING_NETWORKS[source.network];
            const status = depositStatuses[source.rowId] ?? 'not_started';
            const amountBaseUnits = parseUsdcBaseUnits(source.amount);
            const hasValidAmount = amountBaseUnits !== undefined && amountBaseUnits > 0n;
            const depositBlocked =
              status === 'submitting' ||
              status === 'pending' ||
              status === 'confirmed' ||
              status === 'recovery_required';
            return (
              <section
                aria-labelledby={`${fieldId(`fund.source.${source.rowId}`)}-heading`}
                className="flex flex-col gap-xl rounded-md border border-border bg-surface-raised p-lg"
                key={source.rowId}
              >
                <div className="flex items-start justify-between gap-md">
                  <div className="flex min-w-0 flex-col gap-xs">
                    <h3
                      className="text-label-lg font-semibold text-text"
                      id={`${fieldId(`fund.source.${source.rowId}`)}-heading`}
                    >
                      {`Source ${index + 1}`}
                    </h3>
                    <span className="text-label-sm text-text-muted">
                      Testnet USDC · gas in {network.gasToken}
                    </span>
                  </div>
                  {sources.length > 1 ? (
                    <Button
                      aria-label={`Remove source ${index + 1}`}
                      onClick={() => onRemoveSource(source.rowId)}
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-lg md:grid-cols-2">
                  <Field
                    error={errors[`sources.${source.rowId}.network`]}
                    htmlFor={fieldId(`fund.source.${source.rowId}.network`)}
                    label="Network"
                    required
                  >
                    <Select
                      onValueChange={(value) =>
                        onSourceChange(source.rowId, {
                          network: value as FundingNetworkId,
                        })
                      }
                      value={source.network}
                    >
                      <SelectTrigger
                        aria-invalid={
                          errors[`sources.${source.rowId}.network`] === undefined ? undefined : true
                        }
                        id={fieldId(`fund.source.${source.rowId}.network`)}
                        size="lg"
                      >
                        <NetworkIdentity network={source.network} />
                      </SelectTrigger>
                      <SelectContent>
                        {FUNDING_NETWORK_IDS.map((networkId) => (
                          <SelectItem
                            disabled={
                              networkId !== source.network && selectedNetworks.has(networkId)
                            }
                            key={networkId}
                            value={networkId}
                          >
                            <NetworkIdentity network={networkId} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <AffixedField
                    error={errors[`sources.${source.rowId}.amount`]}
                    helperText="Explicit allocation, maximum 6 decimals."
                    id={fieldId(`fund.source.${source.rowId}.amount`)}
                    inputMode="decimal"
                    label="Amount"
                    onChange={(value) => onSourceChange(source.rowId, { amount: value })}
                    placeholder="0.00"
                    required
                    size="lg"
                    suffix="USDC"
                    value={source.amount}
                  />
                </div>

                <div className="flex flex-col gap-md border-t border-border pt-lg sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex flex-col gap-xs">
                    <span className="text-label-sm font-semibold uppercase text-text-muted">
                      Source readiness
                    </span>
                    {isUnified ? (
                      <>
                        <StatusBadge
                          kind="program"
                          label={depositStatusLabel(status)}
                          status="draft"
                          variant={depositStatusVariant(status)}
                        />
                        {depositRequiredAmounts[source.rowId] === undefined ? null : (
                          <span className="text-label-md text-text-muted">
                            {status === 'top_up_required'
                              ? 'Exact server-required top-up: '
                              : 'Exact locked deposit: '}
                            {formatUsdc(depositRequiredAmounts[source.rowId]!)}
                          </span>
                        )}
                      </>
                    ) : (
                      <StatusBadge
                        kind="program"
                        label={`Balance and ${network.gasToken} checked before signing`}
                        status="draft"
                        variant="neutral"
                      />
                    )}
                  </span>
                  {isUnified ? (
                    <Button
                      disabled={
                        !transactionsEnabled ||
                        walletAddress === undefined ||
                        !hasValidAmount ||
                        depositBlocked
                      }
                      loading={status === 'submitting'}
                      onClick={() => onDepositSource(source)}
                      variant="secondary"
                    >
                      {status === 'pending'
                        ? 'Check deposit'
                        : status === 'failed'
                          ? 'Recover deposit'
                          : status === 'replaceable'
                            ? 'Replace reverted deposit'
                            : status === 'top_up_required'
                              ? 'Add required deposit'
                              : status === 'recovery_required'
                                ? 'Recover deposit'
                                : 'Add to Unified Balance'}
                    </Button>
                  ) : null}
                </div>
                {!isUnified || (status !== 'failed' && status !== 'recovery_required') ? null : (
                  <Field
                    htmlFor={fieldId(`fund.source.${source.rowId}.recovery-hash`)}
                    label="Original deposit transaction hash"
                  >
                    <Input
                      id={fieldId(`fund.source.${source.rowId}.recovery-hash`)}
                      onChange={(event) =>
                        onDepositRecoveryHashChange(source.rowId, event.currentTarget.value)
                      }
                      placeholder="0x…"
                      value={depositRecoveryHashes[source.rowId] ?? ''}
                    />
                  </Field>
                )}
              </section>
            );
          })}
        </div>

        {errors['sources'] === undefined ? null : (
          <p className="text-label-md text-error" role="alert">
            {errors['sources']}
          </p>
        )}
        {errors['sources.total'] === undefined ? null : (
          <p className="text-label-md text-error" role="alert">
            {errors['sources.total']}
          </p>
        )}

        <Button
          disabled={sources.length >= FUNDING_NETWORK_IDS.length}
          onClick={onAddSource}
          variant="secondary"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add source
        </Button>

        {isUnified ? (
          <div className="flex flex-col gap-md rounded-md border border-border bg-surface p-lg">
            <div className="flex flex-wrap items-start justify-between gap-md">
              <span className="flex flex-col gap-xs">
                <span className="text-label-sm font-semibold uppercase text-text-muted">
                  Unified Balance
                </span>
                <span className="text-body-sm text-text">
                  {`${confirmedUnifiedBalance ?? '—'} confirmed · ${pendingUnifiedBalance ?? '—'} pending USDC`}
                </span>
              </span>
              <Button
                disabled={walletAddress === undefined}
                onClick={onRefreshUnifiedBalance}
                variant="ghost"
              >
                Refresh balances
              </Button>
            </div>
            <p className="text-label-md text-text-muted">
              {hasStartedUnifiedDeposit
                ? 'Existing confirmed Unified Balance can satisfy selected allocations; pending deposits do not count. Continue one wallet prompt at a time.'
                : 'No deposit in this intent yet. Existing confirmed Unified Balance can satisfy selected allocations; pending deposits do not count. Add only missing sources, one wallet prompt at a time.'}
            </p>
            {transactionsEnabled ? null : (
              <p className="text-label-md text-warning">
                Deposits stay disabled until the server locks this plan in a verified funding
                intent.
              </p>
            )}
          </div>
        ) : null}

        <Callout title="Route is derived from your sources" variant="info">
          Arc-only uses Send, one source outside Arc uses Bridge, and two or more networks use
          Unified Balance. The reward pool is credited only after USDC is verified at this
          program&apos;s escrow on Arc.
        </Callout>

        <Separator />
        <div className="flex flex-col">
          <SummaryRow
            label="Funding route"
            value={routeMode === undefined ? 'Choose a source' : fundingRouteLabel(routeMode)}
          />
          <SummaryRow label="Gross amount" value={formatUsdc(grossAmount || '0')} />
          <SummaryRow
            label="Estimated fees"
            value={
              estimatedFeeReserve === undefined
                ? 'Refreshed before signing'
                : formatUsdc(estimatedFeeReserve)
            }
          />
          <SummaryRow label="Destination" value="Arc Testnet" />
          <SummaryRow
            label="Candidate escrow"
            value={
              program.escrowAddress === undefined
                ? 'Escrow not deployed'
                : shortenAddress(program.escrowAddress)
            }
          />
          <SummaryRow label="Recipient verification" value="Required before signing" />
        </div>

        <div className="mt-2xl grid grid-cols-1 gap-md pt-md sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={onLater} size="lg" variant="ghost">
            Do this later
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={working}
            loading={working}
            onClick={onCheckReadiness}
            size="lg"
            variant="secondary"
          >
            {readinessChecked ? 'Check readiness again' : 'Check readiness'}
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={!canSubmit}
            loading={working}
            onClick={onSubmit}
            size="lg"
          >
            Submit funding plan
          </Button>
        </div>
      </FormCard>
    </div>
  );
}

export interface FundingPendingProps {
  readonly walletAddress: string | undefined;
  readonly walletMatchesIntent: boolean;
  readonly intent: VerifiedFundingIntent;
  readonly selection: ValidatedFundingSelection;
  readonly phase: FundingOperationPhase;
  readonly working: boolean;
  readonly error: string | undefined;
  readonly result: FundingDestinationResult | undefined;
  readonly executionAvailable: boolean;
  readonly verifiedRecipient: string | undefined;
  readonly estimatedFeeReserve: string;
  readonly recoveryHash: string;
  readonly onBack: () => void;
  readonly onConnectWallet: () => void;
  readonly onDisconnectWallet?: () => void;
  readonly onContinue: () => void;
  readonly onRecoveryHashChange: (value: string) => void;
}

export function FundingPending({
  error,
  estimatedFeeReserve,
  executionAvailable,
  intent,
  onBack,
  onConnectWallet,
  onDisconnectWallet,
  onContinue,
  onRecoveryHashChange,
  phase,
  result,
  recoveryHash,
  selection,
  verifiedRecipient,
  walletAddress,
  walletMatchesIntent,
  working,
}: FundingPendingProps) {
  void onConnectWallet;
  void onDisconnectWallet;
  const operationSubmitted = !canStartDestinationOperation(phase);
  const recoveryAction = fundingRecoveryAction(phase);
  const progress = routeProgress(selection.routeMode, phase, intent.recovery?.steps ?? []);
  const destinationTransactionHash =
    intent.destinationTransactionHash ?? result?.destinationTransactionHash;
  const transferId = intent.transferId ?? intent.recovery?.transferId ?? result?.transferId;

  return (
    <div className="flex min-w-0 flex-col gap-xl">
      {error === undefined ? null : (
        <Callout title="Funding operation needs attention" variant="danger">
          {error}
        </Callout>
      )}
      {result === undefined ? null : (
        <Callout title="Destination transaction submitted" variant="warning">
          The Circle operation returned a destination transaction, but the reward pool is not yet
          credited. Server-side canonical Arc USDC receipt/event evidence, ExternalFundingSynced
          evidence, the required lifetime totalFunded threshold and database reconciliation are
          still required.
        </Callout>
      )}
      {walletAddress !== undefined && walletMatchesIntent ? null : (
        <Callout title="Reconnect the locked funding wallet" variant="warning">
          This operation is locked to {shortenAddress(intent.walletAddress)}. Reconnecting is an
          explicit action; this screen never opens a wallet prompt during hydration.
        </Callout>
      )}

      <FormCard
        description="Route and recipient are locked while this funding operation is active."
        title="Funding operation"
      >
        <div className="flex flex-col">
          <SummaryRow
            label="Locked wallet"
            value={
              walletAddress === undefined
                ? `${shortenAddress(intent.walletAddress)} · disconnected`
                : walletMatchesIntent
                  ? shortenAddress(walletAddress)
                  : `${shortenAddress(walletAddress)} · wrong account`
            }
          />
          <SummaryRow label="Route" value={fundingRouteLabel(selection.routeMode)} />
          <SummaryRow label="Gross amount" value={formatUsdc(selection.grossAmount)} />
          <SummaryRow label="Estimated fee reserve" value={formatUsdc(estimatedFeeReserve)} />
          <SummaryRow
            label="Estimated net received"
            value={formatUsdc(
              fundingEstimatedNetAmount(selection.grossAmount, estimatedFeeReserve),
            )}
          />
          {selection.sources.map((source) => (
            <SummaryRow
              key={source.rowId}
              label={
                <span className="inline-flex items-center gap-sm">
                  <NetworkIdentity network={source.network} />
                  <span className="sr-only">source</span>
                </span>
              }
              value={`${formatUsdc(source.amount)} allocation`}
            />
          ))}
          <SummaryRow label="Destination" value="Arc Testnet" />
          <SummaryRow
            label="Verified escrow"
            value={
              verifiedRecipient === undefined
                ? 'Awaiting server-verified intent'
                : shortenAddress(verifiedRecipient)
            }
          />
          {destinationTransactionHash === undefined ? null : (
            <SummaryRow
              label="Destination transaction"
              value={shortenAddress(destinationTransactionHash)}
            />
          )}
          {transferId === undefined ? null : (
            <SummaryRow label="Circle transfer" value={truncateEvidence(transferId)} />
          )}
          {intent.recovery?.operationId === undefined ? null : (
            <SummaryRow
              label="Circle operation"
              value={truncateEvidence(intent.recovery.operationId)}
            />
          )}
          {(intent.recovery?.sourceTransactionHashes ?? []).map((hash, index) => (
            <SummaryRow
              key={hash}
              label={`Source transaction ${index + 1}`}
              value={shortenAddress(hash)}
            />
          ))}
        </div>

        <Separator />
        <ol aria-label="Funding progress" className="flex flex-col gap-sm">
          {progress.map((item) => (
            <li
              className="flex items-start gap-md rounded-md border border-border bg-surface-raised p-lg"
              key={item.label}
            >
              {item.state === 'complete' ? (
                <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-escrow" />
              ) : item.state === 'active' ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary motion-safe:animate-spin"
                />
              ) : (
                <Circle aria-hidden="true" className="size-5 shrink-0 text-text-disabled" />
              )}
              <span className="flex min-w-0 flex-col gap-xs">
                <span className="text-label-lg text-text">{item.label}</span>
                <span className="text-label-sm text-text-muted">{item.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <Callout title="Verification boundary" variant="warning">
          Circle App Kit results are not the escrow source of truth. CP-13 must persist the funding
          intent, verify canonical Arc USDC received, call syncExternalFunding(), and reconcile the
          database before this screen can show success.
        </Callout>
        {executionAvailable ? null : (
          <Callout title="Signing is locked" variant="warning">
            The current API does not issue a durable, server-verified funding intent. No Send,
            Bridge or Unified Balance spend can start from the legacy client-supplied contract
            address.
          </Callout>
        )}
        {phase !== 'source_submitted' || destinationTransactionHash !== undefined ? null : (
          <Field
            helperText="Paste only the original destination transaction returned by the wallet. The server binds it to this claimed attempt and independently verifies Arc before crediting funds."
            htmlFor="funding-destination-recovery-hash"
            label="Original destination transaction hash"
          >
            <Input
              id="funding-destination-recovery-hash"
              onChange={(event) => onRecoveryHashChange(event.currentTarget.value)}
              placeholder="0x…"
              value={recoveryHash}
            />
          </Field>
        )}

        <div className="mt-2xl grid grid-cols-1 gap-md pt-md sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            disabled={operationSubmitted || working}
            onClick={onBack}
            size="lg"
            variant="ghost"
          >
            Back
          </Button>
          {walletAddress === undefined || !walletMatchesIntent ? (
            <RainbowKitFundingButton className="w-full sm:w-auto" />
          ) : (
            <Button
              className="w-full sm:w-auto"
              disabled={!executionAvailable || phase === 'complete'}
              loading={working}
              onClick={onContinue}
              size="lg"
            >
              {executionAvailable
                ? (recoveryAction ?? 'Continue and sign')
                : 'Funding API required'}
            </Button>
          )}
        </div>
      </FormCard>
    </div>
  );
}

export function FundingConfirmationEvidence({
  artifact,
}: {
  readonly artifact: FundingConfirmationArtifact;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-xl"
      data-funding-confirmation={artifact.fundingIntentId}
    >
      <FormCard
        description="Immutable deployment and Arc destination evidence for the latest completed funding intent."
        title="Canonical funding confirmation"
      >
        <div className="flex flex-col">
          <SummaryRow label="Route" value={fundingRouteLabel(artifact.routeMode)} />
          <SummaryRow label="Escrow" value={shortenAddress(artifact.escrowAddress)} />
          <SummaryRow label="Artifact version" value={artifact.artifactVersion} />
          <SummaryRow label="Artifact checksum" value={shortenAddress(artifact.artifactChecksum)} />
          <SummaryRow
            label="Canonical Arc USDC"
            value={`${shortenAddress(artifact.tokenAddress)} · ${artifact.tokenDecimals} decimals`}
          />
          <SummaryRow
            label="Destination transaction"
            value={shortenAddress(artifact.destinationTransactionHash)}
          />
          <SummaryRow
            label="Destination evidence"
            value={`log ${artifact.destinationLogIndex} · block ${artifact.destinationBlockNumber} · ${shortenAddress(artifact.destinationBlockHash)}`}
          />
          <SummaryRow
            label="Funding sync transaction"
            value={shortenAddress(artifact.syncTransactionHash)}
          />
          <SummaryRow
            label="Sync evidence"
            value={`${artifact.syncLogIndex === undefined ? 'no event log' : `log ${artifact.syncLogIndex}`} · block ${artifact.syncBlockNumber} · ${shortenAddress(artifact.syncBlockHash)}`}
          />
        </div>
      </FormCard>

      <FormCard
        description="Gross, source-debit headroom and verified Arc receipt are intentionally distinct."
        title="Verified funding amounts"
      >
        <div className="flex flex-col">
          <SummaryRow label="Gross spend" value={formatUsdc(artifact.grossAmount)} />
          <SummaryRow
            label="Provider + gas reserve"
            value={formatUsdc(artifact.estimatedFeeReserve)}
          />
          <SummaryRow
            label="Actual Arc net received"
            value={formatUsdc(artifact.netReceivedAmount)}
          />
          <SummaryRow
            label="Lifetime funded before"
            value={formatUsdc(artifact.preTotalFundedAmount)}
          />
          <SummaryRow
            label="Required lifetime funded"
            value={formatUsdc(artifact.requiredTotalFundedAmount)}
          />
          <SummaryRow
            label="Verified lifetime funded"
            value={formatUsdc(artifact.postTotalFundedAmount)}
          />
        </div>
      </FormCard>

      <FormCard
        description="Immutable accounting projection captured in the same reconciliation."
        title="Reconciled pool snapshot"
      >
        <div className="flex flex-col">
          <SummaryRow label="Total pool" value={formatUsdc(artifact.accounting.totalPool)} />
          <SummaryRow
            label="Approved outstanding"
            value={formatUsdc(artifact.accounting.approvedOutstanding)}
          />
          <SummaryRow label="Total paid" value={formatUsdc(artifact.accounting.totalPaid)} />
          <SummaryRow
            label="Total withdrawn"
            value={formatUsdc(artifact.accounting.totalWithdrawn)}
          />
          <SummaryRow
            label="Available pool"
            value={formatUsdc(artifact.accounting.availablePool)}
          />
          <SummaryRow
            label="Reconciled at (UTC)"
            value={formatFundingConfirmationTimestamp(artifact.reconciledAt)}
          />
        </div>
      </FormCard>
    </div>
  );
}

export function formatFundingConfirmationTimestamp(iso: string): string {
  const timestamp = new Date(iso);
  return Number.isNaN(timestamp.getTime()) ? 'Unknown timestamp' : timestamp.toISOString();
}

export function NetworkIdentity({ network }: { readonly network: FundingNetworkId }) {
  return (
    <span className="!flex min-w-0 flex-row items-center gap-sm">
      <NetworkLogo network={network} />
      <span className="truncate text-label-sm">{FUNDING_NETWORKS[network].label}</span>
    </span>
  );
}

function NetworkLogo({ network }: { readonly network: FundingNetworkId }) {
  const common = 'size-5 shrink-0';
  if (network === 'Ethereum_Sepolia') {
    return (
      <svg aria-hidden="true" className={common} fill="none" viewBox="0 0 24 24">
        <path d="m12 1.75-6.1 10.17L12 15.5l6.1-3.58L12 1.75Z" fill="var(--color-usdc)" />
        <path d="m12 16.63-6.1-3.55L12 22.25l6.1-9.17-6.1 3.55Z" fill="var(--color-usdc)" />
        <path d="m12 15.5 6.1-3.58-6.1 2.45v1.13Z" fill="var(--color-usdc)" />
      </svg>
    );
  }
  if (network === 'Arbitrum_Sepolia') {
    return (
      <svg aria-hidden="true" className={common} fill="none" viewBox="0 0 24 24">
        <path
          d="m12 1.75 8.75 5.06v10.38L12 22.25l-8.75-5.06V6.81L12 1.75Z"
          fill="var(--color-primary)"
        />
        <path d="m8.1 16.85 3.25-9.7h2.05l-3.23 9.7H8.1Z" fill="var(--color-primary-contrast)" />
        <path d="m12.3 16.85 3.25-9.7h2.05l-3.23 9.7H12.3Z" fill="var(--color-low)" />
      </svg>
    );
  }
  if (network === 'Base_Sepolia') {
    return (
      <svg aria-hidden="true" className={common} fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" fill="var(--color-usdc)" r="10" />
        <path
          d="M6.25 12c0-1.02.84-1.85 1.87-1.85h7.89a1.85 1.85 0 1 1 0 3.7H8.12A1.87 1.87 0 0 1 6.25 12Z"
          fill="var(--color-primary-contrast)"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={common} fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.25" stroke="var(--color-escrow)" strokeWidth="2" />
      <path
        d="M7.1 14.55c1.15-3.5 3.18-5.28 5.44-5.28 1.61 0 3.18.88 4.35 2.48"
        stroke="var(--color-escrow)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M8.15 16.2c1.28-2.05 2.81-3.08 4.55-3.08 1.27 0 2.42.47 3.2 1.3"
        stroke="var(--color-escrow)"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function depositStatusLabel(status: SourceDepositStatus): string {
  if (status === 'submitting') return 'Waiting for wallet signature';
  if (status === 'pending') return 'Deposit submitted · waiting for confirmed balance';
  if (status === 'confirmed') return 'Confirmed in Unified Balance';
  if (status === 'failed') return 'Deposit needs attention';
  if (status === 'replaceable') return 'Deposit reverted · replacement available';
  if (status === 'top_up_required') return 'Deposit or fee top-up required';
  if (status === 'recovery_required') return 'Recovery required · no automatic retry';
  return 'Ready to deposit';
}

function depositStatusVariant(
  status: SourceDepositStatus,
): 'neutral' | 'warning' | 'success' | 'danger' {
  if (status === 'pending') return 'warning';
  if (status === 'confirmed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'replaceable') return 'warning';
  if (status === 'top_up_required') return 'warning';
  if (status === 'recovery_required') return 'danger';
  return 'neutral';
}

type ProgressItemState = 'pending' | 'active' | 'complete';
type RecoveryStep = NonNullable<VerifiedFundingIntent['recovery']>['steps'][number];

function routeProgress(
  routeMode: ValidatedFundingSelection['routeMode'],
  phase: FundingOperationPhase,
  recoverySteps: readonly RecoveryStep[],
): readonly {
  readonly label: string;
  readonly detail: string;
  readonly state: ProgressItemState;
}[] {
  const routeDelivered =
    phase === 'verifying_destination' ||
    phase === 'syncing_pool' ||
    phase === 'sync_failed' ||
    phase === 'complete';
  const destinationPending = phase === 'destination_submitted' || phase === 'delivery_pending';
  const sourceSubmitted = phase === 'source_submitted';
  const routeSteps =
    routeMode === 'send'
      ? [
          fundingRouteStep(
            'Sending USDC to the Arc escrow',
            ['send'],
            recoverySteps,
            routeDelivered ? 'complete' : destinationPending ? 'active' : 'pending',
          ),
        ]
      : routeMode === 'bridge'
        ? [
            fundingRouteStep(
              'Approve USDC (if required)',
              ['approve', 'approval'],
              recoverySteps,
              sourceSubmitted || destinationPending || routeDelivered ? 'complete' : 'pending',
            ),
            fundingRouteStep(
              'Burn source USDC',
              ['burn'],
              recoverySteps,
              sourceSubmitted || destinationPending || routeDelivered ? 'complete' : 'pending',
            ),
            fundingRouteStep(
              'Fetch CCTP attestation',
              ['attestation', 'fetchattestation'],
              recoverySteps,
              routeDelivered
                ? 'complete'
                : sourceSubmitted || destinationPending
                  ? 'active'
                  : 'pending',
            ),
            fundingRouteStep(
              'Mint USDC on Arc',
              ['mint'],
              recoverySteps,
              routeDelivered ? 'complete' : destinationPending ? 'active' : 'pending',
            ),
          ]
        : [
            fundingRouteStep(
              'Build Unified Balance burn intents',
              ['buildburnintents', 'build_burn_intents'],
              recoverySteps,
              sourceSubmitted || destinationPending || routeDelivered ? 'complete' : 'pending',
            ),
            fundingRouteStep(
              'Sign burn intents sequentially',
              ['signburnintents', 'sign_burn_intents', 'sign'],
              recoverySteps,
              sourceSubmitted || destinationPending || routeDelivered ? 'complete' : 'pending',
            ),
            fundingRouteStep(
              'Fetch Gateway attestation',
              ['attestation', 'fetchattestation'],
              recoverySteps,
              routeDelivered
                ? 'complete'
                : sourceSubmitted || destinationPending
                  ? 'active'
                  : 'pending',
            ),
            fundingRouteStep(
              'Mint USDC on Arc',
              ['mint'],
              recoverySteps,
              routeDelivered ? 'complete' : destinationPending ? 'active' : 'pending',
            ),
          ];

  return [
    {
      label:
        routeMode === 'send' ? 'Waiting for Arc signature' : 'Waiting for sequential signatures',
      detail: 'Wallet prompts only open after Continue and sign.',
      state:
        phase === 'ready_to_sign'
          ? 'pending'
          : phase === 'awaiting_signature'
            ? 'active'
            : 'complete',
    },
    ...routeSteps,
    {
      label: 'Verifying escrow balance received',
      detail:
        'Verify exact canonical Arc USDC receipt/event evidence and the required lifetime totalFunded threshold.',
      state:
        phase === 'verifying_destination'
          ? 'active'
          : phase === 'syncing_pool' || phase === 'sync_failed' || phase === 'complete'
            ? 'complete'
            : 'pending',
    },
    {
      label: 'Reconciling reward pool',
      detail: 'Call syncExternalFunding() and reconcile the database projection exactly once.',
      state:
        phase === 'syncing_pool' || phase === 'sync_failed'
          ? 'active'
          : phase === 'complete'
            ? 'complete'
            : 'pending',
    },
  ];
}

function fundingRouteStep(
  label: string,
  names: readonly string[],
  recoverySteps: readonly RecoveryStep[],
  fallback: ProgressItemState,
): { readonly label: string; readonly detail: string; readonly state: ProgressItemState } {
  const observed = [...recoverySteps].reverse().find((step) => {
    const normalized = step.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return names.some((name) => normalized.includes(name.replace(/[^a-z0-9]/g, '')));
  });
  if (observed === undefined) {
    return {
      label,
      detail: 'The server persists accepted operation IDs and transaction hashes for recovery.',
      state: fallback,
    };
  }
  return {
    label,
    detail:
      observed.transactionHash === undefined
        ? `Server state: ${observed.state}.`
        : `Server state: ${observed.state} · ${shortenAddress(observed.transactionHash)}.`,
    state:
      observed.state === 'success'
        ? 'complete'
        : observed.state === 'pending'
          ? 'active'
          : 'active',
  };
}

function truncateEvidence(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}
