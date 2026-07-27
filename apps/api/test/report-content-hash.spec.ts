import { describe, expect, it } from 'vitest';

import { reportContentHash } from '../src/reports/report-content-hash.js';

const base = {
  affectedScopeId: '10000000-0000-4000-8000-000000000200',
  title: 'Re-entrancy drains the staking pool',
  description: 'Synthetic description',
  reproductionSteps: 'Synthetic steps',
  proposedSeverity: 'high',
  severityMismatchAcknowledged: false,
  programImpactIds: ['10000000-0000-4000-8000-000000000401'],
  customImpacts: [],
} as const;

describe('reportContentHash', () => {
  it('produces a 32-byte hex digest', () => {
    expect(reportContentHash(base)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('ignores the order the client happened to send impacts in', () => {
    const ascending = reportContentHash({
      ...base,
      programImpactIds: ['aaaa', 'bbbb'],
      customImpacts: ['Second', 'First'],
    });
    const descending = reportContentHash({
      ...base,
      programImpactIds: ['bbbb', 'aaaa'],
      customImpacts: ['First', 'Second'],
    });

    expect(ascending).toBe(descending);
  });

  it.each([
    ['impact selection', { programImpactIds: ['10000000-0000-4000-8000-000000000402'] }],
    ['custom impacts', { customImpacts: ['Researcher proposed impact'] }],
    ['secret gist', { secretGistUrl: 'https://gist.github.com/example/1' }],
    ['severity acknowledgement', { severityMismatchAcknowledged: true }],
    ['reproduction steps', { reproductionSteps: 'Different steps' }],
    ['proposed severity', { proposedSeverity: 'critical' }],
  ] as const)('changes when the %s changes', (_label, patch) => {
    // The digest is the integrity anchor for the disclosure, so every part of the submitted
    // assertion has to move it — not just the prose.
    expect(reportContentHash({ ...base, ...patch })).not.toBe(reportContentHash(base));
  });

  it('treats an absent optional field and an empty one consistently', () => {
    expect(reportContentHash({ ...base, secretGistUrl: undefined })).toBe(reportContentHash(base));
  });
});
