'use client';

import {
  deployEscrowRequestSchema,
  escrowTransactionResponseSchema,
  fundProgramRequestSchema,
  programResponseSchema,
  type Program,
} from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Separator,
  StatusBadge,
  Stepper,
} from '@bug-bounty-escrow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { GuidancePanel, WorkspaceHeading } from './owner-workspace';
import { recordEscrowDeployment } from './program-deploy';
import { recordProgramFunding } from './program-funding';
import { CREATE_PROGRAM_STEPS } from './program-wizard';
import { fieldId, formatUsdc, shortenAddress } from './program-draft';
import {
  buildProgramReadiness,
  type ProgramReadinessItem,
} from './program-readiness-model';
import { AffixedField, FormCard, StepLayout, SummaryRow, WizardShell } from './wizard-parts';
import { readPublicConfig } from '@/config/public-config';
import { apiRequest, ApiClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function ReadinessRow({ item }: { readonly item: ProgramReadinessItem }) {
  const Icon = item.complete ? CheckCircle2 : Circle;

  return (
    <li
      className="flex items-start gap-md rounded-md border border-border bg-surface-raised p-lg"
      data-readiness-item={item.id}
    >
      <Icon
        aria-hidden="true"
        className={`size-5 shrink-0 ${item.complete ? 'text-escrow' : 'text-text-disabled'}`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-xs sm:flex-row sm:items-start sm:justify-between sm:gap-lg">
        <span className="flex min-w-0 flex-col">
          <span className="text-label-lg text-text">{item.title}</span>
          <span className="text-label-md text-text-muted">{item.detail}</span>
        </span>
        <span
          className={`shrink-0 text-label-sm font-semibold uppercase ${
            item.complete ? 'text-escrow' : 'text-medium'
          }`}
        >
          {item.status}
        </span>
      </span>
    </li>
  );
}

function escrowSummary(program: Program, chainLabel: string): ReactNode {
  return (
    <>
      <SummaryRow label="Network" value={chainLabel} />
      <SummaryRow label="Token" value="USDC" />
      <SummaryRow
        label="Escrow contract"
        value={
          program.contractAddress === undefined
            ? 'Not deployed'
            : shortenAddress(program.contractAddress)
        }
      />
    </>
  );
}

export interface ProgramLifecycleProps {
  readonly program: Program;
  /** Rendered once after `POST /api/programs` lands on this route. */
  readonly showCreatedBanner: boolean;
  readonly logoFailed: boolean;
  readonly onBlockingPendingChange: (pending: boolean) => void;
  readonly onEditProgram: () => void;
}

export function ProgramLifecycle({
  logoFailed,
  onBlockingPendingChange,
  onEditProgram,
  program,
  showCreatedBanner,
}: ProgramLifecycleProps) {
  const { session } = useAuth();
  const client = useQueryClient();
  const router = useRouter();

  const [view, setView] = useState<'readiness' | 'fund'>('readiness');
  const [deployOpen, setDeployOpen] = useState(false);
  const [contractAddress, setContractAddress] = useState('');
  const [deployHash, setDeployHash] = useState('');
  const [amount, setAmount] = useState('');
  const [fundHash, setFundHash] = useState('');
  const [formError, setFormError] = useState<Record<string, string>>({});

  const config = readPublicConfig();
  const chainLabel = 'Arc testnet';
  const deployed = program.contractAddress !== undefined;
  const funded = Number(program.totalPool) > 0;

  function cacheProgram(saved: Program) {
    client.setQueryData(
      queryKeys.ownerProgram(session?.user.id ?? 'no-session', saved.id),
      { success: true, data: saved },
    );
    return client.invalidateQueries({ queryKey: ['programs'] });
  }

  const deployMutation = useMutation({
    mutationFn: async (): Promise<Program> => {
      const body = deployEscrowRequestSchema.parse({
        chainId: config.NEXT_PUBLIC_ARC_CHAIN_ID,
        contractAddress: contractAddress.trim(),
        transactionHash: deployHash.trim(),
      });

      return recordEscrowDeployment(body, {
        loadProgram: async () => {
          const response = await apiRequest(
            `/api/owner/programs/${program.id}`,
            programResponseSchema,
            { token: session?.access_token },
          );
          return response.data;
        },
        recordDeployment: async (input) => {
          const response = await apiRequest(
            `/api/programs/${program.id}/deploy`,
            programResponseSchema,
            { method: 'POST', token: session?.access_token, body: input },
          );
          return response.data;
        },
      });
    },
    onSuccess: async (saved) => {
      setDeployOpen(false);
      await cacheProgram(saved);
      // CP-10 → CP-11 happens automatically once the contract is ready.
      setView(Number(saved.totalPool) > 0 ? 'readiness' : 'fund');
    },
  });

  const fundMutation = useMutation({
    mutationFn: async (): Promise<Program> => {
      const body = fundProgramRequestSchema.parse({
        amount: amount.trim(),
        transactionHash: fundHash.trim(),
        tokenAddress: config.NEXT_PUBLIC_USDC_ADDRESS,
      });

      return recordProgramFunding(program.id, body, {
        loadProgram: async () => {
          const response = await apiRequest(
            `/api/owner/programs/${program.id}`,
            programResponseSchema,
            { token: session?.access_token },
          );
          return response.data;
        },
        loadTransaction: async (transactionHash) => {
          const response = await apiRequest(
            `/api/transactions/${transactionHash}`,
            escrowTransactionResponseSchema,
            { token: session?.access_token },
          );
          return response.data;
        },
        recordFunding: async (input) => {
          const response = await apiRequest(
            `/api/programs/${program.id}/fund`,
            programResponseSchema,
            {
              method: 'POST',
              token: session?.access_token,
              body: input,
            },
          );
          return response.data;
        },
      });
    },
    onSuccess: async (saved) => {
      await cacheProgram(saved);
      setView('readiness');
    },
  });

  const lifecyclePending = deployMutation.isPending || fundMutation.isPending;

  useEffect(() => {
    onBlockingPendingChange(lifecyclePending);
  }, [lifecyclePending, onBlockingPendingChange]);

  useEffect(
    () => () => {
      onBlockingPendingChange(false);
    },
    [onBlockingPendingChange],
  );

  const publishMutation = useMutation({
    mutationFn: async (): Promise<Program> => {
      const response = await apiRequest(
        `/api/programs/${program.id}/publish`,
        programResponseSchema,
        { method: 'POST', token: session?.access_token },
      );
      return response.data;
    },
    onSuccess: async (saved) => {
      await cacheProgram(saved);
      router.push('/owner/programs');
    },
  });

  const readiness = buildProgramReadiness(program);

  /* CP-10 — Deploying escrow. Navigation and actions stay locked while the mutation is pending. */
  if (deployMutation.isPending) {
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Deploying a dedicated escrow contract before funding the reward pool."
          title="Preparing program escrow…"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout
          aside={
            <GuidancePanel eyebrow="Next step" title="Fund reward pool">
              <p>
                Once the contract is ready, transfer USDC into escrow. Funding does not publish the
                program.
              </p>
              <p className="text-label-sm uppercase text-text-muted">Current pool</p>
              <p className="text-h2 text-text">{formatUsdc(program.totalPool)}</p>
            </GuidancePanel>
          }
        >
          <div aria-busy="true" aria-live="polite" role="status">
            <FormCard title="Creating a secure reward vault">
              <div className="flex flex-wrap items-start justify-between gap-lg">
                <div className="flex min-w-0 flex-col gap-md">
                  <span className="w-fit rounded-full bg-primary px-md py-xs text-label-sm font-semibold uppercase text-primary-contrast">
                    Deploying contract
                  </span>
                  <p className="text-body-sm text-text-muted">
                    This usually takes less than a minute. Keep this window open while the contract
                    is confirmed.
                  </p>
                </div>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-2xl shrink-0 text-primary motion-safe:animate-spin"
                />
              </div>
              <Separator />
              <div className="flex flex-col">
                <SummaryRow label="Program" value={program.name} />
                <SummaryRow label="Network" value={chainLabel} />
                <SummaryRow label="Reward token" value="USDC" />
              </div>
              <p className="text-body-sm text-low">
                Do not close this window until the escrow address is available.
              </p>
            </FormCard>
          </div>
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-12 — Funding pending. */
  if (fundMutation.isPending) {
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Waiting for the USDC transfer to be confirmed by the escrow service."
          title="Funding reward pool…"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout
          aside={
            <GuidancePanel eyebrow="Transaction" title="Pending confirmation">
              <div className="flex flex-col">
                <SummaryRow label="Network" value={chainLabel} />
                <SummaryRow label="Token" value="USDC" />
              </div>
              <p>Safe to retry only after an error is returned.</p>
            </GuidancePanel>
          }
        >
          <div aria-busy="true" aria-live="polite" role="status">
            <FormCard title={`Transferring ${formatUsdc(amount)}`}>
              <div className="flex flex-wrap items-start justify-between gap-lg">
                <div className="flex min-w-0 flex-col gap-md">
                  <span className="w-fit rounded-full bg-primary px-md py-xs text-label-sm font-semibold uppercase text-primary-contrast">
                    Confirming
                  </span>
                  <p className="text-body-sm text-text-muted">
                    Your amount is locked while this transaction is pending. Do not submit another
                    funding request.
                  </p>
                </div>
                <LoaderCircle
                  aria-hidden="true"
                  className="size-2xl shrink-0 text-primary motion-safe:animate-spin"
                />
              </div>
              <Separator />
              <div className="flex flex-col">
                <SummaryRow label="Program" value={program.name} />
                <SummaryRow
                  label="Escrow address"
                  value={
                    program.contractAddress === undefined
                      ? 'Not deployed'
                      : shortenAddress(program.contractAddress)
                  }
                />
                <SummaryRow label="Amount" value={formatUsdc(amount)} />
                <SummaryRow label="Token" value="USDC" />
              </div>
              <p className="text-body-sm text-low">
                Confirmation will update the program&apos;s reward pool automatically.
              </p>
            </FormCard>
          </div>
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-11 — Fund rewards. */
  if (view === 'fund') {
    const coverageCount =
      Number(program.maxBounty) > 0 && Number(amount) > 0
        ? Math.floor(Number(amount) / Number(program.maxBounty))
        : 0;
    const submitFunding = () => {
      const next: Record<string, string> = {};
      if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount.trim()) || Number(amount.trim()) <= 0) {
        next['amount'] = 'Enter a valid USDC amount above zero.';
      }
      if (!TRANSACTION_HASH_PATTERN.test(fundHash.trim())) {
        next['fundHash'] = 'Enter the 0x transaction hash of the USDC transfer.';
      }
      setFormError(next);
      if (Object.keys(next).length === 0) fundMutation.mutate();
    };

    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Transfer USDC into the program escrow. The program remains private until publishing."
          title="Fund reward pool"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />
        <StepLayout
          aside={
            <GuidancePanel eyebrow="Escrow summary" title={formatUsdc(program.totalPool)}>
              <p>Current reward pool</p>
              <div className="flex flex-col">{escrowSummary(program, chainLabel)}</div>
              <Callout variant="warning">
                USDC will be transferred to the program escrow. This does not publish the program.
              </Callout>
            </GuidancePanel>
          }
        >
          {fundMutation.isError ? (
            <Callout title="The funding could not be recorded" variant="danger">
              <p>The amount and transfer hash are still here. Check the receipt and try again.</p>
              <Button className="mt-md" onClick={submitFunding} variant="secondary">
                Try again
              </Button>
            </Callout>
          ) : null}

          <FormCard
            description="Choose the starting reward pool for this program."
            title="Funding amount"
          >
            <AffixedField
              error={formError['amount']}
              helperText="Enter the amount from the confirmed USDC transfer receipt."
              id={fieldId('fund.amount')}
              inputMode="decimal"
              label="Amount"
              onChange={setAmount}
              placeholder="185000"
              required
              size="lg"
              suffix="USDC"
              value={amount}
            />

            <Callout title="Confirmed transfer receipt required" variant="info">
              This build does not connect a wallet or submit a USDC transfer. Transfer USDC with
              your existing wallet, then enter its confirmed transaction hash below.
            </Callout>

            <Field
              error={formError['fundHash']}
              helperText="The API records this already-confirmed transfer; it does not broadcast a transaction."
              htmlFor={fieldId('fund.hash')}
              label="Transfer transaction hash"
              required
            >
              <Input
                id={fieldId('fund.hash')}
                onChange={(event) => setFundHash(event.target.value)}
                placeholder="0x…"
                size="lg"
                value={fundHash}
              />
            </Field>

            <Separator />

            <p className="text-label-lg font-semibold text-text">Reward coverage</p>
            <div className="flex flex-col">
              {program.rewardTiers.map((tier, index) => (
                <SummaryRow
                  key={`${tier.assetType}-${tier.severity}-${index}`}
                  label={`${tier.severity.charAt(0).toUpperCase()}${tier.severity.slice(1)} max reward`}
                  value={formatUsdc(
                    tier.maxReward ?? tier.flatAmount ?? tier.maxRewardCap ?? '0',
                  )}
                />
              ))}
            </div>
            {coverageCount > 0 ? (
              <p className="text-label-md text-escrow">
                {`Funding covers at least ${coverageCount} maximum ${coverageCount === 1 ? 'payout' : 'payouts'}.`}
              </p>
            ) : null}

            <div className="mt-2xl flex flex-wrap items-center justify-end gap-md pt-md">
              <Button onClick={() => setView('readiness')} size="lg" variant="ghost">
                Do this later
              </Button>
              <Button onClick={submitFunding} size="lg">
                Fund reward pool
              </Button>
            </div>
          </FormCard>
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-13 — Funding succeeded, but publishing remains a separate owner action. */
  if (funded) {
    return (
      <WizardShell>
        <WorkspaceHeading
          breadcrumb={`Programs / ${program.name} / Funding`}
          subtitle="Escrow is ready. Review readiness before publishing the program."
          title="Reward pool funded"
        />
        <Stepper
          aria-label="Create program progress"
          currentStep={6}
          steps={CREATE_PROGRAM_STEPS}
        />

        <Callout role="status" title="Rewards funded" variant="escrow">
          {`${formatUsdc(program.totalPool)} is now secured in the ${program.name} escrow.`}
        </Callout>

        <StepLayout
          aside={
            <GuidancePanel eyebrow="Reward pool" title={formatUsdc(program.totalPool)}>
              <p className="text-label-md text-escrow">USDC funded</p>
              <div className="flex flex-col">
                <SummaryRow label="Remaining" value={formatUsdc(program.remainingPool)} />
                <SummaryRow label="Status" value="Ready" />
              </div>
            </GuidancePanel>
          }
        >
          {publishMutation.isError ? (
            <Callout title="The program could not be published" variant="danger">
              Funding is still secure. Publishing remains a separate action and can be retried.
            </Callout>
          ) : null}

          <FormCard
            description="The escrow is funded and ready. Researchers still cannot see this program until you publish it."
            title="Program readiness"
          >
            <ul aria-label="Program readiness checklist" className="flex flex-col gap-sm">
              {readiness.map((item) => (
                <ReadinessRow item={item} key={item.id} />
              ))}
            </ul>

            <div className="mt-2xl grid grid-cols-1 gap-md pt-md sm:flex sm:flex-wrap sm:items-center sm:justify-end">
              <Button asChild className="w-full sm:w-auto" size="lg" variant="secondary">
                <Link href="/owner/programs">Back to program</Link>
              </Button>
              <Button
                className="w-full sm:w-auto"
                loading={publishMutation.isPending}
                onClick={() => publishMutation.mutate()}
                size="lg"
              >
                Publish program
              </Button>
            </div>
          </FormCard>
        </StepLayout>
      </WizardShell>
    );
  }

  /* CP-06 — Draft created / edit landing. */
  return (
    <WizardShell>
      {showCreatedBanner ? (
        <Callout role="status" title="Draft created" variant="escrow">
          Your program is saved and remains private.
        </Callout>
      ) : null}

      {logoFailed ? (
        <Callout title="The logo was not attached" variant="warning">
          The draft was saved. Open <strong>Edit program</strong> to upload the logo again.
        </Callout>
      ) : null}

      <WorkspaceHeading
        badge={<StatusBadge kind="program" status={program.status} />}
        breadcrumb={
          <Link className="hover:text-text" href="/owner/programs">
            Programs
          </Link>
        }
        subtitle={`Last saved ${new Date(program.updatedAt).toLocaleString()} · /programs/${program.slug}`}
        title={program.name}
      />

      <StepLayout
        aside={
          <GuidancePanel
            eyebrow="Private draft"
            title="Not visible to researchers"
          >
            <p className="text-label-sm uppercase text-text-muted">Escrow pool</p>
            <p className="text-h2 text-text">{formatUsdc(program.totalPool)}</p>
            <div className="flex flex-col">
              <SummaryRow label="Remaining" value={formatUsdc(program.remainingPool)} />
              {escrowSummary(program, chainLabel)}
            </div>
            <p className="text-label-sm uppercase text-text-muted">Next action</p>
            <p className="text-body-sm text-primary">
              {deployed ? 'Fund the reward pool' : 'Deploy escrow contract'}
            </p>
          </GuidancePanel>
        }
      >
        {deployMutation.isError ? (
          <Callout title="The escrow could not be recorded" variant="danger">
            <p>Check the contract address and transaction hash, then retry the same deployment.</p>
            <Button className="mt-md" onClick={() => setDeployOpen(true)} variant="secondary">
              Try again
            </Button>
          </Callout>
        ) : null}
        <FormCard
          description="Complete the remaining launch steps before researchers can see this program."
          title="Program readiness"
        >
          <ul aria-label="Program readiness checklist" className="flex flex-col gap-sm">
            {readiness.map((item) => (
              <ReadinessRow item={item} key={item.id} />
            ))}
          </ul>

          <div className="mt-2xl grid grid-cols-1 gap-md pt-md sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            <Button asChild className="w-full sm:w-auto" size="lg" variant="ghost">
              <Link href="/owner/programs">Back to programs</Link>
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={onEditProgram}
              size="lg"
              variant="secondary"
            >
              Edit program
            </Button>
            {deployed ? null : (
              <Button
                className="w-full sm:w-auto"
                onClick={() => setDeployOpen(true)}
                size="lg"
              >
                Deploy escrow
              </Button>
            )}
            {deployed ? (
              <Button
                className="w-full sm:w-auto"
                onClick={() => setView('fund')}
                size="lg"
              >
                Fund rewards
              </Button>
            ) : null}
          </div>
        </FormCard>
      </StepLayout>

      {/*
        Figma draws CP-10 as a pending state only, but `deployEscrowRequestSchema` needs the
        deployed address and the deployment transaction hash and no screen in the flow collects
        them — the product has no wallet connector. This dialog is the minimum affordance that
        keeps CP-10 exactly as drawn.
      */}
      <Dialog onOpenChange={setDeployOpen} open={deployOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Deploy escrow contract</DialogTitle>
            <DialogDescription>
              This build records a confirmed Arc deployment receipt; it does not submit a wallet or
              factory transaction. Enter the address and transaction hash produced by your existing
              deployment tool.
            </DialogDescription>
          </DialogHeader>

          {deployMutation.isError ? (
            <Callout title="The escrow could not be recorded" variant="danger">
              {deployMutation.error instanceof ApiClientError &&
              deployMutation.error.code === 'program_escrow_already_deployed'
                ? 'A different escrow is already recorded for this program. The existing escrow was not replaced.'
                : 'Your draft and deployment details are still here. Retry sends the same receipt and will not create a duplicate escrow.'}
            </Callout>
          ) : null}

          <Field
            error={formError['contractAddress']}
            htmlFor={fieldId('deploy.address')}
            label="Escrow contract address"
            required
          >
            <Input
              id={fieldId('deploy.address')}
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="0x0000000000000000000000000000000000000000"
              size="lg"
              value={contractAddress}
            />
          </Field>

          <Field
            error={formError['deployHash']}
            htmlFor={fieldId('deploy.hash')}
            label="Deployment transaction hash"
            required
          >
            <Input
              id={fieldId('deploy.hash')}
              onChange={(event) => setDeployHash(event.target.value)}
              placeholder="0x…"
              size="lg"
              value={deployHash}
            />
          </Field>

          <div className="flex flex-col">
            <SummaryRow label="Network" value={chainLabel} />
            <SummaryRow label="Reward token" value="USDC" />
          </div>

          <DialogFooter>
            <Button onClick={() => setDeployOpen(false)} size="lg" variant="secondary">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const next: Record<string, string> = {};
                if (!EVM_ADDRESS_PATTERN.test(contractAddress.trim())) {
                  next['contractAddress'] = 'Enter a valid EVM contract address.';
                }
                if (!TRANSACTION_HASH_PATTERN.test(deployHash.trim())) {
                  next['deployHash'] = 'Enter the 0x deployment transaction hash.';
                }
                setFormError(next);
                if (Object.keys(next).length === 0) deployMutation.mutate();
              }}
              size="lg"
            >
              {deployMutation.isError ? 'Try again' : 'Deploy escrow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WizardShell>
  );
}
