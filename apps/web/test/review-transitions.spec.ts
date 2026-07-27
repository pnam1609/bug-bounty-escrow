import { REPORT_STATUS_TRANSITIONS, type ReportStatus } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

import {
  ACTIONS_BY_STATUS,
  ACTION_RESULT_STATUS,
} from '@/components/reports/review-transitions';

/*
 * The reviewer panel keeps its own status -> action map because the domain state machine knows
 * nothing about HTTP endpoints. That copy can drift, and drifting the wrong way means offering a
 * button the server will reject with `invalid_report_transition`. These tests tie the two
 * together so the drift cannot survive a test run.
 */
describe('reviewer action map', () => {
  it('never offers an action the domain state machine forbids', () => {
    for (const [status, actions] of Object.entries(ACTIONS_BY_STATUS)) {
      const allowed = REPORT_STATUS_TRANSITIONS[status as ReportStatus];

      for (const action of actions) {
        expect(
          allowed,
          `status "${status}" offers "${action}" -> "${ACTION_RESULT_STATUS[action]}"`,
        ).toContain(ACTION_RESULT_STATUS[action]);
      }
    }
  });

  it('offers an action for every status the domain can still move out of', () => {
    // `needs_information` is the deliberate exception: the next move belongs to the researcher,
    // who resubmits, not to the reviewer.
    const reviewerWaits: readonly ReportStatus[] = ['draft', 'needs_information'];

    for (const [status, nextStatuses] of Object.entries(REPORT_STATUS_TRANSITIONS)) {
      if (nextStatuses.length === 0 || reviewerWaits.includes(status as ReportStatus)) {
        continue;
      }

      expect(
        ACTIONS_BY_STATUS[status as ReportStatus],
        `status "${status}" can still move but the reviewer is offered nothing`,
      ).not.toHaveLength(0);
    }
  });

  it('covers every report status so a new one cannot be silently unhandled', () => {
    expect(Object.keys(ACTIONS_BY_STATUS).sort()).toEqual(
      Object.keys(REPORT_STATUS_TRANSITIONS).sort(),
    );
  });
});
