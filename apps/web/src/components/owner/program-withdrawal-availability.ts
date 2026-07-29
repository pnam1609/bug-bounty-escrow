import type { Program, WithdrawalIntent } from '@bug-bounty-escrow/shared';

export function isWithdrawalPanelAvailable(
  status: Program['status'],
  activeIntent: Pick<WithdrawalIntent, 'id'> | undefined,
): boolean {
  return status === 'expired' || status === 'closed' || activeIntent !== undefined;
}
