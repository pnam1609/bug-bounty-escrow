import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StepMainReport } from '@/components/submit-bug/step-main-report';
import { EMPTY_DRAFT } from '@/components/submit-bug/submit-bug-model';

describe('SR-08 main report Markdown fields', () => {
  it('uses the shared Markdown editor for both long-form report fields', () => {
    const markup = renderToStaticMarkup(
      createElement(StepMainReport, {
        draft: EMPTY_DRAFT,
        errors: {},
        file: null,
        onChangeField: () => undefined,
        onClearFile: () => undefined,
        onPickFile: () => undefined,
        pocPolicyNote: undefined,
        proofRequired: true,
      }),
    );

    expect(markup.match(/aria-label="Markdown editor"/g)).toHaveLength(2);
    expect(markup).toContain('Vulnerability description');
    expect(markup).toContain('Proof of concept / reproduction steps');
    expect(markup.match(/rows="20"/g)).toHaveLength(2);
  });
});
