import { describe, expect, it } from 'vitest';

import {
  formatDatePickerValue,
  getDatePickerDays,
  parseDatePickerValue,
} from '@/components/owner/date-picker';

describe('DatePicker helpers', () => {
  it('round-trips the draft date-only format without timezone shifts', () => {
    const parsed = parseDatePickerValue('2026-08-09');

    expect(parsed).toBeDefined();
    expect(formatDatePickerValue(parsed as Date)).toBe('2026-08-09');
  });

  it.each(['', '2026-02-29', '2026-13-01', '08/09/2026', '2026-8-9'])(
    'rejects malformed or impossible dates: %s',
    (value) => {
      expect(parseDatePickerValue(value)).toBeUndefined();
    },
  );

  it('builds a six-week Sunday-first grid for the calendar', () => {
    const days = getDatePickerDays(new Date(2026, 7, 1, 12));

    expect(days).toHaveLength(42);
    expect(formatDatePickerValue(days[0] as Date)).toBe('2026-07-26');
    expect(formatDatePickerValue(days[35] as Date)).toBe('2026-08-30');
  });
});
