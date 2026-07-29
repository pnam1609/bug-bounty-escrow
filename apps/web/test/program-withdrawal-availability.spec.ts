import { describe, expect, it } from 'vitest';

import { isWithdrawalPanelAvailable } from '@/components/owner/program-withdrawal-availability';

describe('CP-13 withdrawal panel availability', () => {
  it.each(['draft', 'awaiting_funding', 'active', 'paused'] as const)(
    'does not offer a new withdrawal for %s even if its deadline has elapsed',
    (status) => {
      expect(isWithdrawalPanelAvailable(status, undefined)).toBe(false);
    },
  );

  it.each(['expired', 'closed'] as const)(
    'offers a new withdrawal after the program is %s',
    (status) => {
      expect(isWithdrawalPanelAvailable(status, undefined)).toBe(true);
    },
  );

  it.each(['draft', 'awaiting_funding', 'active', 'paused', 'expired', 'closed'] as const)(
    'keeps recovery visible for an existing intent while the program is %s',
    (status) => {
      expect(
        isWithdrawalPanelAvailable(status, {
          id: '31990000-0000-4000-8000-000000000031',
        }),
      ).toBe(true);
    },
  );
});
