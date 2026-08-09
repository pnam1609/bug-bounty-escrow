import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { StepOverview } from '@/components/owner/step-overview';
import { createEmptyDraft } from '@/components/owner/program-draft';

describe('CP-01 overview summary control', () => {
  it('renders short summary as a multiline textarea with the 1000-character counter', () => {
    const html = renderToStaticMarkup(
      createElement(StepOverview, {
        draft: createEmptyDraft(),
        errors: {},
        onCancel: vi.fn(),
        onContinue: vi.fn(),
        update: vi.fn(),
      }),
    );

    expect(html).toMatch(/<textarea[^>]*id="cp-shortSummary"[^>]*maxLength="1000"/);
    expect(html).toContain('0 / 1,000');
    expect(html).toContain('Used on the program card and the program header.');
    expect(html).toContain('id="cp-description"');
    expect(html).toContain('maxLength="20000"');
  });
});
