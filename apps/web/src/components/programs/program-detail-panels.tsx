'use client';

import { compareSeverity, type AssetType, type Program } from '@bug-bounty-escrow/shared';
import {
  Callout,
  Card,
  CardHeader,
  CardTitle,
  Separator,
  SeverityBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@bug-bounty-escrow/ui';
import { ArrowUpRight, Check, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import {
  ASSET_TYPE_GROUP_LABELS,
  ASSET_TYPE_LABELS,
  formatAbsoluteDate,
  formatResolutionTime,
  formatRewardTier,
  formatUsdcFull,
  RESOURCE_TYPE_LABELS,
} from './program-format';

/*
 * Program detail panels — submit-bug flow §8 `PG-DETAIL`: `Information` (overview, reward
 * policy, program rules, PoC requirement, prohibited activities, disclosure policy), `Scope`,
 * `Rewards` and `Resources`.
 *
 * Everything drawn here comes from the public program response. Nothing is invented, nothing is
 * a promise: reward tiers are described as guidance and the review decision time is a measured
 * median, not a service level. Metrics such as total paid and resolution time are server-derived;
 * the owner never enters them.
 */

const POC_POLICY_LABELS = {
  required: 'Proof of concept required',
  optional: 'Proof of concept optional',
  not_allowed: 'Proof of concept not accepted',
} as const;

/**
 * Mandatory tooltip copy for the `Median resolution time` metric — verbatim from the ticket and
 * docs/flow/submit-bug-researcher-flow-for-figma.md §3: resolution is the first review decision;
 * settlement (`reward_approved` / `payment_pending` / `paid`) never re-opens it.
 */
const MEDIAN_RESOLUTION_DEFINITION =
  'Median time from initial submission to the first validated, rejected, or duplicate decision. Reward approval and payment time are not included.';

function DetailRow({ label, value }: { readonly label: ReactNode; readonly value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-lg">
      <dt className="text-body-sm text-text-muted">{label}</dt>
      <dd className="text-right text-body-sm text-text">{value}</dd>
    </div>
  );
}

function BulletList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-sm">
      {items.map((item) => (
        <li className="flex items-start gap-sm text-body-sm text-text" key={item}>
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-escrow" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ResourceLinks({ program }: { readonly program: Program }) {
  const links = [
    ...(program.websiteUrl === undefined
      ? []
      : [
          {
            id: 'website',
            title: 'Website',
            typeLabel: RESOURCE_TYPE_LABELS.website,
            url: program.websiteUrl,
          },
        ]),
    ...program.resources.map((resource) => ({
      id: resource.id,
      title: resource.title,
      typeLabel: RESOURCE_TYPE_LABELS[resource.resourceType],
      url: resource.url,
    })),
  ];

  if (links.length === 0) {
    return <p className="text-body-sm text-text-muted">No public resources have been listed.</p>;
  }

  return (
    <ul className="flex flex-col gap-sm">
      {links.map((link) => (
        <li key={link.id}>
          <a
            className="flex min-h-11 flex-wrap items-center justify-between gap-x-md gap-y-xs rounded-sm border border-border bg-surface-raised px-md py-sm text-body-sm text-text"
            href={link.url}
            rel="noreferrer noopener"
            target="_blank"
          >
            <span className="flex min-w-0 items-center gap-sm">
              <span className="truncate">{link.title}</span>
              <span className="shrink-0 rounded-full border border-border px-sm py-xs text-label-sm uppercase text-text-muted">
                {link.typeLabel}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-xs text-text-muted">
              <span className="max-w-40 truncate">{link.url.replace(/^https?:\/\//, '')}</span>
              <ArrowUpRight aria-hidden="true" className="size-4" />
              <span className="sr-only">Opens in a new tab</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Two-column detail body: content on the left, facts rail on the right. */
function PanelLayout({
  aside,
  children,
}: {
  readonly aside: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_346px]">
      <div className="flex min-w-0 flex-col gap-xl">{children}</div>
      <div className="flex min-w-0 flex-col gap-xl">{aside}</div>
    </div>
  );
}

/* ── Information ───────────────────────────────────────────────────────────────────────── */

/**
 * §8 `Information`: overview, reward policy, program rules, PoC requirement, prohibited
 * activities and disclosure policy — one section, so a researcher reads every requirement
 * without hunting across tabs.
 */
export function InformationPanel({ program }: { readonly program: Program }) {
  const { rules } = program;

  return (
    <TooltipProvider>
      <PanelLayout
        aside={
          <>
            <Card>
              <CardHeader>
                <CardTitle>Program facts</CardTitle>
              </CardHeader>
              <dl className="flex flex-col gap-md">
                <DetailRow label="Maximum bounty" value={formatUsdcFull(program.maxBounty)} />
                <DetailRow label="Reward pool" value={formatUsdcFull(program.totalPool)} />
                <DetailRow label="Remaining" value={formatUsdcFull(program.remainingPool)} />
                {/* Null is the owner's choice to keep the figure private — never rendered as 0. */}
                <DetailRow
                  label="Total paid"
                  value={
                    program.totalPaid === null ? (
                      <span className="text-text-muted">Private</span>
                    ) : (
                      formatUsdcFull(program.totalPaid)
                    )
                  }
                />
                <DetailRow
                  label="Deadline"
                  value={
                    program.deadline === undefined
                      ? 'Ongoing'
                      : formatAbsoluteDate(program.deadline)
                  }
                />
                {program.publishedAt === undefined ? null : (
                  <DetailRow label="Live since" value={formatAbsoluteDate(program.publishedAt)} />
                )}
                <DetailRow label="Last updated" value={formatAbsoluteDate(program.updatedAt)} />
                <DetailRow label="Assets in scope" value={program.metrics.totalAssetsInScope} />
                <DetailRow
                  label={
                    <span className="inline-flex items-center gap-xs">
                      <span>Median resolution time</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            aria-label="How median resolution time is measured"
                            className="-my-md inline-flex size-11 shrink-0 items-center justify-center rounded-full text-text-muted"
                            type="button"
                          >
                            <Info aria-hidden="true" className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[19rem]">
                          {MEDIAN_RESOLUTION_DEFINITION}
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  }
                  value={
                    program.metrics.medianResolutionSeconds === null
                      ? 'No resolved reports yet'
                      : formatResolutionTime(program.metrics.medianResolutionSeconds)
                  }
                />
              </dl>
              {/* The tooltip repeats this line, never replaces it: hover is invisible to touch
                  and screen-reader users, and the figure is easy to misread as a payout speed. */}
              <p className="text-label-md text-text-muted">{MEDIAN_RESOLUTION_DEFINITION}</p>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Eligibility</CardTitle>
              </CardHeader>
              <BulletList
                items={[
                  POC_POLICY_LABELS[rules.pocPolicy],
                  'No KYC to submit a report',
                  'No wallet connection required to browse or submit',
                  'A human reviewer decides the final severity and the reward',
                ]}
              />
            </Card>

            <Callout title="Disclosure policy" variant="escrow">
              Private by default. Reports stay private while the program runs. After it ends the
              owner may keep a resolved report private, publish a sanitized summary, or approve a
              full disclosure.
            </Callout>
          </>
        }
      >
        <Card>
          <CardHeader>
            <CardTitle>Program overview</CardTitle>
          </CardHeader>
          <p className="whitespace-pre-line text-body-sm text-text">{program.description}</p>
        </Card>

        {rules.rewardPolicy === undefined ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Reward and eligibility policy</CardTitle>
            </CardHeader>
            <p className="whitespace-pre-line text-body-sm text-text-muted">
              {rules.rewardPolicy}
            </p>
          </Card>
        )}

        <div className="flex flex-col gap-md">
          <h2 className="text-h2 text-text">Program rules</h2>
          <p className="text-body-sm text-text-muted">
            Review every proof-of-concept, testing and disclosure requirement before submitting.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{POC_POLICY_LABELS[rules.pocPolicy]}</CardTitle>
          </CardHeader>
          {rules.pocPolicyNote === undefined ? null : (
            <p className="whitespace-pre-line text-body-sm text-text-muted">
              {rules.pocPolicyNote}
            </p>
          )}
        </Card>

        {rules.testingRestrictions === undefined ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Testing restrictions</CardTitle>
            </CardHeader>
            <p className="whitespace-pre-line text-body-sm text-text-muted">
              {rules.testingRestrictions}
            </p>
          </Card>
        )}

        {rules.prohibitedActivities.length === 0 ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Prohibited activities</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-sm">
              {rules.prohibitedActivities.map((activity) => (
                <li className="flex items-start gap-sm text-body-sm text-text" key={activity.id}>
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-error"
                  />
                  <span>{activity.body}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {rules.submissionAcknowledgment === undefined ? null : (
          <Card>
            <CardHeader>
              <CardTitle>Submission acknowledgment</CardTitle>
            </CardHeader>
            <p className="text-label-md text-text-muted">
              Required before the final submit action.
            </p>
            <Separator />
            <p className="whitespace-pre-line text-body-sm text-text">
              {rules.submissionAcknowledgment}
            </p>
          </Card>
        )}
      </PanelLayout>
    </TooltipProvider>
  );
}

/* ── Scope & impacts ───────────────────────────────────────────────────────────────────── */

function useAssetTypeTab(assetTypes: readonly AssetType[]) {
  const [active, setActive] = useState<string>(assetTypes[0] ?? '');
  const value = assetTypes.some((type) => type === active) ? active : (assetTypes[0] ?? '');

  return { value, setActive };
}

export function ScopePanel({
  onOpenInformation,
  program,
}: {
  readonly onOpenInformation: () => void;
  readonly program: Program;
}) {
  const scopes = program.scopes.filter((scope) => !scope.archived);
  const inScope = scopes.filter((scope) => scope.isInScope);
  const outOfScope = scopes.filter((scope) => !scope.isInScope);
  const assetTypes = [...new Set(inScope.map((scope) => scope.assetType))];
  const enabledImpacts = program.impacts.filter((impact) => impact.enabled);
  const highestSeverity = [...enabledImpacts]
    .sort((left, right) => compareSeverity(left.severity, right.severity))
    .at(0)?.severity;
  const { setActive, value } = useAssetTypeTab(assetTypes);

  return (
    <PanelLayout
      aside={
        <>
          <Card>
            <CardHeader>
              <CardTitle>Scope summary</CardTitle>
            </CardHeader>
            <dl className="flex flex-col gap-md">
              <DetailRow label="Assets in scope" value={inScope.length} />
              <DetailRow label="Enabled impacts" value={enabledImpacts.length} />
              <DetailRow
                label="Highest severity"
                value={
                  highestSeverity === undefined ? (
                    'Not published'
                  ) : (
                    <SeverityBadge severity={highestSeverity} />
                  )
                }
              />
              <DetailRow
                label="Custom impacts"
                value={program.rules.allowCustomImpact ? 'Allowed' : 'Not allowed'}
              />
            </dl>
          </Card>

          {program.rules.testingRestrictions === undefined ? null : (
            <Card>
              <CardHeader>
                <CardTitle>Testing boundaries</CardTitle>
              </CardHeader>
              <p className="whitespace-pre-line text-body-sm text-text-muted">
                {program.rules.testingRestrictions}
              </p>
              <button
                className="inline-flex min-h-11 items-center self-start rounded-sm text-body-sm text-escrow"
                onClick={onOpenInformation}
                type="button"
              >
                Read full rules →
              </button>
            </Card>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-md">
        <h2 className="text-h2 text-text">Scope &amp; impact definitions</h2>
        <p className="text-body-sm text-text-muted">
          Only these assets are eligible for a private report.
        </p>
      </div>

      {assetTypes.length === 0 ? (
        <Callout title="No published scope" variant="warning">
          This program has not published an in-scope asset yet.
        </Callout>
      ) : (
        <Tabs onValueChange={setActive} value={value}>
          <TabsList>
            {assetTypes.map((assetType) => (
              <TabsTrigger key={assetType} value={assetType}>
                {ASSET_TYPE_GROUP_LABELS[assetType]}
              </TabsTrigger>
            ))}
          </TabsList>
          {assetTypes.map((assetType) => {
            const assets = inScope.filter((scope) => scope.assetType === assetType);
            const impacts = [...enabledImpacts]
              .filter((impact) => impact.assetType === assetType)
              .sort((left, right) => compareSeverity(left.severity, right.severity));

            return (
              <TabsContent className="flex flex-col gap-xl" key={assetType} value={assetType}>
                <ul className="flex flex-col gap-md">
                  {assets.map((scope) => (
                    <li key={scope.id}>
                      <Card padding="sm" variant="subtle">
                        <div className="flex flex-wrap items-center gap-sm">
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full bg-escrow"
                          />
                          <h3 className="text-h3 text-text">{scope.assetName}</h3>
                          <span className="rounded-full border border-border px-md py-xs text-label-sm uppercase text-text-muted">
                            {ASSET_TYPE_LABELS[scope.assetType]}
                          </span>
                          {/* Scope status is words, not just the dot colour. */}
                          <span className="rounded-full border border-border px-md py-xs text-label-sm uppercase text-escrow">
                            In scope
                          </span>
                        </div>
                        {scope.assetUrl === undefined && scope.contractAddress === undefined ? null : (
                          <p className="truncate text-label-md text-text-muted">
                            {scope.assetUrl ?? scope.contractAddress}
                          </p>
                        )}
                        {scope.description === undefined ? null : (
                          <p className="text-body-sm text-text-muted">{scope.description}</p>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-col gap-md">
                  <h3 className="text-h3 text-text">Impacts in scope</h3>
                  {impacts.length === 0 ? (
                    <p className="text-body-sm text-text-muted">
                      No impacts have been published for this asset type.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-sm">
                      {impacts.map((impact) => (
                        <li key={impact.id}>
                          <Card padding="sm" variant="subtle">
                            <div className="flex flex-wrap items-start justify-between gap-md">
                              <p className="text-label-lg font-semibold text-text">
                                {impact.title}
                              </p>
                              <SeverityBadge severity={impact.severity} />
                            </div>
                            {impact.description === undefined ? null : (
                              <p className="text-body-sm text-text-muted">{impact.description}</p>
                            )}
                          </Card>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}

      {/*
       * §8 `Scope`: out-of-scope assets are published with the same detail as in-scope ones and
       * grouped by asset type — a researcher must be able to rule an asset out before touching
       * it, not discover the exclusion after testing. The list is independent of the tabs above
       * so an asset type with no in-scope siblings still shows its exclusions.
       */}
      {outOfScope.length === 0 ? null : (
        <section aria-labelledby="out-of-scope-heading" className="flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <h3 className="text-h3 text-text" id="out-of-scope-heading">
              Out of scope
            </h3>
            <p className="text-body-sm text-text-muted">
              Do not test these assets. A report against them is not eligible for a reward.
            </p>
          </div>
          {[...new Set(outOfScope.map((scope) => scope.assetType))].map((assetType) => (
            <div className="flex flex-col gap-sm" key={assetType}>
              <h4 className="text-label-sm uppercase text-text-muted">
                {ASSET_TYPE_GROUP_LABELS[assetType]}
              </h4>
              <ul className="flex flex-col gap-sm">
                {outOfScope
                  .filter((scope) => scope.assetType === assetType)
                  .map((scope) => (
                    <li key={scope.id}>
                      <Card padding="sm" variant="subtle">
                        <div className="flex flex-wrap items-center gap-sm">
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full bg-error"
                          />
                          <p className="text-label-lg font-semibold text-text">
                            {scope.assetName}
                          </p>
                          <span className="rounded-full border border-border px-md py-xs text-label-sm uppercase text-text-muted">
                            {ASSET_TYPE_LABELS[scope.assetType]}
                          </span>
                          {/* Scope status is words, not just the dot colour. */}
                          <span className="rounded-full border border-border px-md py-xs text-label-sm uppercase text-error">
                            Out of scope
                          </span>
                        </div>
                        {scope.assetUrl === undefined && scope.contractAddress === undefined ? null : (
                          <p className="truncate text-label-md text-text-muted">
                            {scope.assetUrl ?? scope.contractAddress}
                          </p>
                        )}
                        {scope.description === undefined ? null : (
                          <p className="text-body-sm text-text-muted">{scope.description}</p>
                        )}
                      </Card>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {program.rules.allowCustomImpact ? (
        <Callout title="Impact not listed?" variant="info">
          You may propose a custom impact. It needs explicit reviewer approval and may still be
          rejected as out of scope.
        </Callout>
      ) : null}
    </PanelLayout>
  );
}

/* ── Rewards ───────────────────────────────────────────────────────────────────────────── */

export function RewardsPanel({ program }: { readonly program: Program }) {
  const assetTypes = [...new Set(program.rewardTiers.map((tier) => tier.assetType))];
  const { setActive, value } = useAssetTypeTab(assetTypes);

  return (
    <PanelLayout
      aside={
        <Card>
          <CardHeader>
            <CardTitle>Reward summary</CardTitle>
          </CardHeader>
          <dl className="flex flex-col gap-md">
            <DetailRow label="Maximum bounty" value={formatUsdcFull(program.maxBounty)} />
            <DetailRow label="Total funded pool" value={formatUsdcFull(program.totalPool)} />
            <DetailRow label="Reserved for reports" value={formatUsdcFull(program.reservedPool)} />
            <DetailRow label="Remaining pool" value={formatUsdcFull(program.remainingPool)} />
            <DetailRow
              label="Total paid"
              value={
                program.totalPaid === null ? (
                  <span className="text-text-muted">Private</span>
                ) : (
                  formatUsdcFull(program.totalPaid)
                )
              }
            />
          </dl>
        </Card>
      }
    >
      <div className="flex flex-col gap-md">
        <h2 className="text-h2 text-text">Reward tiers</h2>
        {/* The escrow makes the funds visible; it does not pre-approve a report. */}
        <p className="text-body-sm text-text-muted">
          Reward tiers are program guidance. A human reviewer determines the final severity and the
          eligible reward.
        </p>
      </div>

      {assetTypes.length === 0 ? (
        <p className="text-body-sm text-text-muted">No reward tiers have been published.</p>
      ) : (
        <Tabs onValueChange={setActive} value={value}>
          <TabsList>
            {assetTypes.map((assetType) => (
              <TabsTrigger key={assetType} value={assetType}>
                {ASSET_TYPE_GROUP_LABELS[assetType]}
              </TabsTrigger>
            ))}
          </TabsList>
          {assetTypes.map((assetType) => {
            const tiers = [...program.rewardTiers]
              .filter((tier) => tier.assetType === assetType)
              .sort((left, right) => compareSeverity(left.severity, right.severity));

            return (
              <TabsContent key={assetType} value={assetType}>
                <ul className="flex flex-col gap-md">
                  {tiers.map((tier) => (
                    <li key={`${tier.assetType}:${tier.severity}`}>
                      <Card padding="sm" variant="subtle">
                        <div className="flex flex-wrap items-center justify-between gap-md">
                          <SeverityBadge severity={tier.severity} />
                          <p className="text-label-lg font-semibold text-text">
                            {formatRewardTier(tier)}
                          </p>
                        </div>
                        {tier.calculationNote === undefined ? null : (
                          <p className="text-body-sm text-text-muted">{tier.calculationNote}</p>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </PanelLayout>
  );
}

/* ── Resources ─────────────────────────────────────────────────────────────────────────── */

/**
 * §8 `Resources`: documentation, repository, audit report and official links configured by the
 * owner. Every entry is labelled with its type so a reader knows what they are opening.
 */
export function ResourcesPanel({ program }: { readonly program: Program }) {
  return (
    <PanelLayout
      aside={
        <Callout title="Owner-provided links" variant="info">
          These links are configured by the program owner and open in a new tab. The platform does
          not verify external content.
        </Callout>
      }
    >
      <div className="flex flex-col gap-md">
        <h2 className="text-h2 text-text">Resources</h2>
        <p className="text-body-sm text-text-muted">
          Documentation, repositories, audit reports and official links published by the program
          owner.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Official resources</CardTitle>
        </CardHeader>
        <ResourceLinks program={program} />
      </Card>
    </PanelLayout>
  );
}
