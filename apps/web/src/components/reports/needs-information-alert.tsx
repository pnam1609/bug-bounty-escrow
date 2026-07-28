import type { ReportSummary } from '@bug-bounty-escrow/shared';
import { Callout } from '@bug-bounty-escrow/ui';

/**
 * This standing page notice intentionally uses `role="note"` through the warning Callout.
 * It is useful context after navigation, not an asynchronous event that should interrupt a
 * screen-reader user as the list loads.
 */
export function NeedsInformationAlert({
  reports,
  status,
}: {
  readonly reports: readonly ReportSummary[];
  readonly status: ReportSummary['status'] | undefined;
}) {
  if (
    status !== 'needs_information' ||
    !reports.some((report) => report.status === 'needs_information')
  ) {
    return null;
  }

  return (
    <Callout title="Action required" variant="warning">
      The program team needs more information before it can continue reviewing these reports. Open a
      report to respond in its private discussion.
    </Callout>
  );
}
