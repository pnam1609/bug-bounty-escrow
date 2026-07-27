'use client';

import { programResponseSchema } from '@bug-bounty-escrow/shared';
import {
  Button,
  Card,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { DisclosuresPanel } from './program-disclosures';
import {
  InformationPanel,
  ResourcesPanel,
  RewardsPanel,
  ScopePanel,
} from './program-detail-panels';
import { describeDeadline, formatUsdcFull, programMonogram } from './program-format';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/*
 * Program detail — submit-bug flow §8 `PG-DETAIL`, the entry point of the Submit Bug flow.
 *
 * Researcher screens carry no sidebar, so the hero, the tab strip and every panel share one
 * 1104px column. The selected tab is mirrored into `?tab=`, which makes a deep link to
 * "Rewards" or "Disclosures" shareable and keeps Back/Forward meaningful inside the page.
 */

const TABS = [
  { value: 'information', label: 'Information' },
  { value: 'scope', label: 'Scope & impacts' },
  { value: 'rewards', label: 'Rewards' },
  { value: 'resources', label: 'Resources' },
  { value: 'disclosures', label: 'Disclosures' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

function readTab(raw: string | null): TabValue {
  // Unknown values — including pre-rename links such as `?tab=overview` or `?tab=rules` — fall
  // back to `Information`, which now carries the overview and the program rules.
  return TABS.find((tab) => tab.value === raw)?.value ?? 'information';
}

/**
 * Tabs that also carry a same-named element id, so a URL hash can land inside the page. `scope`
 * is the published anchor contract: the composer's SR-01 `View impact definitions` link points at
 * `/programs/:id#scope` (submit-bug flow §8 — "mở đúng section của program detail").
 */
const ANCHORED_TABS: readonly TabValue[] = ['scope'];

export function ProgramDetailView({ id }: { readonly id: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const activeTab = readTab(searchParams.get('tab'));

  const query = useQuery({
    queryKey: queryKeys.program(id),
    queryFn: () =>
      apiRequest(`/api/programs/${encodeURIComponent(id)}`, programResponseSchema),
  });

  const openTab = useCallback(
    (tab: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (tab === 'information') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }

      const queryString = params.toString();

      router.replace(queryString === '' ? pathname : `${pathname}?${queryString}`, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  /*
   * A `#scope`-style hash never reaches the server or `useSearchParams`, so it is consumed once
   * on the client after the program has loaded: it selects the matching tab, and — for anchored
   * tabs — remembers the element id to scroll to. The scroll itself waits in the effect below
   * because the target panel only mounts on the render that follows `openTab`.
   */
  const pendingAnchorRef = useRef<string | null>(null);
  const hashConsumedRef = useRef(false);
  const isLoaded = query.isSuccess;

  useEffect(() => {
    if (!isLoaded || hashConsumedRef.current) {
      return;
    }

    hashConsumedRef.current = true;
    const anchor = window.location.hash.slice(1);

    if (TABS.some((tab) => tab.value === anchor)) {
      if (ANCHORED_TABS.some((tab) => tab === anchor)) {
        pendingAnchorRef.current = anchor;
      }

      // Also normalises the URL: the fragment becomes `?tab=` and is not re-consumed.
      openTab(anchor);
    }
  }, [isLoaded, openTab]);

  useEffect(() => {
    const anchor = pendingAnchorRef.current;

    if (anchor === null) {
      return;
    }

    const element = document.getElementById(anchor);

    if (element !== null) {
      pendingAnchorRef.current = null;
      element.scrollIntoView({ block: 'start' });
    }
  });

  if (query.isPending) {
    return <ProgramDetailSkeleton />;
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiClientError && query.error.status === 404;

    return (
      <div className="flex flex-col items-start gap-lg" role="alert">
        <h1 className="text-h2 text-text">
          {notFound ? 'This program is not available' : 'We couldn’t load this program'}
        </h1>
        <p className="text-body-sm text-text-muted">
          {notFound
            ? 'It may have been unpublished, or the link may be wrong.'
            : 'Try again in a moment.'}
        </p>
        <div className="flex flex-wrap gap-md">
          {notFound ? null : (
            <Button onClick={() => void query.refetch()}>Try again</Button>
          )}
          <Button asChild variant="secondary">
            <Link href="/programs">Back to bounties</Link>
          </Button>
        </div>
      </div>
    );
  }

  const program = query.data.data;
  const hasEnded = program.publicStatus === 'ended';
  /*
   * §8: the CTA only works while the program is `active`. An owner or reviewer can open a
   * draft, awaiting-funding or paused program through this route (`publicStatus === null`), and
   * none of those accept reports — the server would reject the submit, so the button must not
   * offer it.
   */
  const isAcceptingReports = program.status === 'active';
  const deadline = describeDeadline(program);
  const deadlineText =
    program.deadline === undefined ? deadline.primary : `${deadline.primary} · ${deadline.secondary}`;

  return (
    <div className="flex flex-col gap-xl">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-sm text-body-sm text-text-muted">
          <li>
            <Link className="inline-flex min-h-11 items-center rounded-sm" href="/programs">
              Programs
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="truncate text-text">
            {program.name}
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-lg md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-md">
          {program.publicStatus === null ? (
            <StatusBadge className="self-start" kind="program" status={program.status} />
          ) : (
            <StatusBadge
              className="self-start"
              kind="program"
              label={program.publicStatus === 'active' ? 'Active' : 'Ended'}
              status={program.status}
            />
          )}
          <div className="flex items-start gap-lg">
            {program.logoUrl === undefined ? (
              <span
                aria-hidden="true"
                className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-h1 text-text"
              >
                {programMonogram(program.name)}
              </span>
            ) : (
              /* A plain <img>: the logo is an arbitrary owner-supplied URL and the project has
                 no next/image loader configured for remote hosts. */
              <img
                alt=""
                className="size-16 shrink-0 rounded-lg border border-border object-cover"
                src={program.logoUrl}
              />
            )}
            <div className="flex min-w-0 flex-col gap-sm">
              <h1 className="text-h1 text-text">{program.name}</h1>
              <p className="max-w-[650px] text-body text-text-muted">{program.shortSummary}</p>
              {program.tags.length === 0 ? null : (
                <ul className="flex flex-wrap gap-sm">
                  {program.tags.map((tag) => (
                    <li
                      className="rounded-full border border-border bg-surface-raised px-md py-xs text-label-sm text-text-muted"
                      key={tag}
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
              {/* §8 header facts: remaining pool over total pool in USDC, and the deadline or
                  `Ongoing`. Pool figures come from escrow accounting — they are visibility, not
                  a promise that any specific report will be paid. */}
              <dl className="flex flex-wrap gap-x-2xl gap-y-sm pt-xs">
                <div className="flex flex-col gap-xs">
                  <dt className="text-label-sm uppercase text-text-muted">Remaining pool</dt>
                  <dd className="text-body font-semibold text-text">
                    {formatUsdcFull(program.remainingPool)}{' '}
                    <span className="font-normal text-text-muted">
                      of {formatUsdcFull(program.totalPool)}
                    </span>
                  </dd>
                </div>
                <div className="flex flex-col gap-xs">
                  <dt className="text-label-sm uppercase text-text-muted">Deadline</dt>
                  <dd className="text-body font-semibold text-text">
                    <span aria-hidden="true">{deadlineText}</span>
                    <span className="sr-only">{deadline.label}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-sm md:items-end">
          {isAcceptingReports ? (
            <Button asChild size="lg">
              <Link href={`/reports/new?programId=${encodeURIComponent(program.id)}`}>
                Submit a private report
              </Link>
            </Button>
          ) : (
            <Button disabled size="lg">
              {hasEnded ? 'Program closed' : 'Not accepting reports'}
            </Button>
          )}
          <p className="text-label-md text-text-muted">
            {isAcceptingReports
              ? 'Private by default · No wallet required'
              : hasEnded
                ? 'Program ended · Browse approved disclosures'
                : 'This program is not accepting reports right now'}
          </p>
        </div>
      </header>

      <Tabs onValueChange={openTab} value={activeTab}>
        <TabsList className="overflow-x-auto">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="information">
          <InformationPanel program={program} />
        </TabsContent>
        <TabsContent value="scope">
          {/* `id="scope"` is the anchor behind the composer's `View impact definitions` link
              (`/programs/:id#scope`). Keep the id stable — SR-01 depends on it. */}
          <div className="scroll-mt-2xl" id="scope">
            <ScopePanel onOpenInformation={() => openTab('information')} program={program} />
          </div>
        </TabsContent>
        <TabsContent value="rewards">
          <RewardsPanel program={program} />
        </TabsContent>
        <TabsContent value="resources">
          <ResourcesPanel program={program} />
        </TabsContent>
        <TabsContent value="disclosures">
          <DisclosuresPanel programId={program.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProgramDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-xl">
      <span className="h-4 w-40 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
      <div className="flex items-start gap-lg">
        <span className="size-16 rounded-lg bg-surface-raised motion-safe:animate-pulse" />
        <div className="flex flex-1 flex-col gap-sm">
          <span className="h-8 w-64 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-4 w-full max-w-[520px] rounded-sm bg-surface-raised motion-safe:animate-pulse" />
        </div>
      </div>
      <span className="h-12 w-full rounded-sm bg-surface-raised motion-safe:animate-pulse" />
      <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_346px]">
        <Card className="h-64" />
        <Card className="h-64" />
      </div>
    </div>
  );
}
