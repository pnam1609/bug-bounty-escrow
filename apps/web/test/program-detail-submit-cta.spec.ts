import { describe, expect, it } from 'vitest';

import { canSubmitProgramReports } from '@/components/programs/program-format';

describe('SR-01/SR-09 program submit capability', () => {
  it('hides the submit CTA for a program owner even when a legacy payload says it is available', () => {
    expect(canSubmitProgramReports({ status: 'active', canSubmitReports: true }, 'owner')).toBe(
      false,
    );
  });

  it('allows an active non-owning researcher when the server grants the capability', () => {
    expect(
      canSubmitProgramReports({ status: 'active', canSubmitReports: true }, 'researcher', true),
    ).toBe(true);
  });

  it('keeps public anonymous details available while authenticated role loading fails closed', () => {
    expect(canSubmitProgramReports({ status: 'active', canSubmitReports: true })).toBe(true);
    expect(
      canSubmitProgramReports({ status: 'active', canSubmitReports: true }, undefined, true),
    ).toBe(false);
  });

  it('fails closed when the capability is absent or the program is not active', () => {
    expect(canSubmitProgramReports({ status: 'active' }, 'researcher')).toBe(false);
    expect(
      canSubmitProgramReports({ status: 'paused', canSubmitReports: true }, 'researcher', true),
    ).toBe(false);
  });
});
