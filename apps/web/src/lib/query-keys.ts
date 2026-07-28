export function shouldPurgePrivateQueryCache(
  previousPrincipal: string | null | undefined,
  nextPrincipal: string | null,
): boolean {
  return (
    nextPrincipal === null ||
    (previousPrincipal !== undefined && previousPrincipal !== nextPrincipal)
  );
}

export const queryKeys = {
  /** Every authenticated response lives below this root so session loss can purge it atomically. */
  private: ['private'] as const,
  me: (principalId: string) => ['private', principalId, 'me'] as const,
  programs: (filters: Readonly<Record<string, unknown>>) => ['programs', filters] as const,
  publicProgram: (slug: string) => ['programs', 'detail', slug] as const,
  privateProgramDetail: (principalId: string, slug: string) =>
    ['private', principalId, 'programs', 'detail', slug] as const,
  programDisclosures: (id: string) => ['programs', 'disclosures', id] as const,
  ownerProgram: (principalId: string, id: string) =>
    ['private', principalId, 'owner', 'program', id] as const,
  reportsRoot: (principalId: string) => ['private', principalId, 'reports'] as const,
  reports: (principalId: string, filters: Readonly<Record<string, unknown>>) =>
    ['private', principalId, 'reports', filters] as const,
  reportProgramFilterOptions: (principalId: string) =>
    ['private', principalId, 'reports', 'filter-options', 'programs'] as const,
  reportSummary: (principalId: string) => ['private', principalId, 'reports', 'summary'] as const,
  report: (principalId: string, id: string) => ['private', principalId, 'report', id] as const,
  rewards: (principalId: string, filters: Readonly<Record<string, unknown>>) =>
    ['private', principalId, 'rewards', filters] as const,
  payoutWallet: (principalId: string) =>
    ['private', principalId, 'rewards', 'payout-wallet'] as const,
  comments: (principalId: string, reportId: string) =>
    ['private', principalId, 'report', reportId, 'comments'] as const,
};
