import { GoneException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReportController } from '../src/reports/report.controller.js';

const REPORT_ID = '31000000-0000-4000-8000-000000000001';
const principal = {
  userId: '31000000-0000-4000-8000-000000000002',
  email: 'owner@example.test',
  role: 'owner' as const,
};

describe('retired client-evidence reward routes', () => {
  it('returns 410 before any legacy report service mutation can run', () => {
    const service = {
      review: vi.fn(),
      get: vi.fn(),
    };
    const controller = new ReportController(service as never);

    for (const invoke of [
      () => controller.approve({ id: REPORT_ID }, { amount: '10.000000' }, principal),
      () =>
        controller.pay(
          { id: REPORT_ID },
          {
            transactionHash: `0x${'1'.repeat(64)}`,
            tokenAddress: '0x3600000000000000000000000000000000000000',
          },
          principal,
        ),
      () =>
        controller.confirmPayment(
          { id: REPORT_ID },
          {
            blockNumber: 42,
            blockHash: `0x${'2'.repeat(64)}`,
            confirmations: 1,
          },
          principal,
        ),
    ]) {
      try {
        invoke();
        throw new Error('legacy_route_did_not_throw');
      } catch (error) {
        expect(error).toBeInstanceOf(GoneException);
        expect((error as GoneException).getStatus()).toBe(410);
      }
    }
    expect(service.review).not.toHaveBeenCalled();
  });
});
