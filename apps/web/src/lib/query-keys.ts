export const queryKeys = {
  me: ['me'] as const,
  programs: (filters: Readonly<Record<string, unknown>>) => ['programs', filters] as const,
  program: (id: string) => ['program', id] as const,
  reports: (filters: Readonly<Record<string, unknown>>) => ['reports', filters] as const,
  reportSummary: ['reports', 'summary'] as const,
  report: (id: string) => ['report', id] as const,
  comments: (reportId: string) => ['report', reportId, 'comments'] as const,
};
