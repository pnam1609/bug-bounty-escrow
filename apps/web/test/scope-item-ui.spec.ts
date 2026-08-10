import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StepScope } from '@/components/owner/step-scope';
import { createEmptyDraft, nextRowId, type ProgramDraft } from '@/components/owner/program-draft';

function draftWithScope(): ProgramDraft {
  const empty = createEmptyDraft();
  return {
    ...empty,
    scopes: [
      {
        rowId: nextRowId('scope'),
        assetType: 'smart_contract',
        assetName: 'Aegis Core',
        assetUrl: '',
        contractAddress: '',
        isInScope: true,
        description: 'Primary protocol contracts.',
      },
    ],
  };
}

describe('CP-02 scope item actions', () => {
  it('keeps the scope badge content-sized and exposes a red text Remove action', () => {
    const markup = renderToStaticMarkup(
      createElement(StepScope, {
        draft: draftWithScope(),
        errors: {},
        onBack: () => undefined,
        onContinue: () => undefined,
        update: () => undefined,
      }),
    );

    expect(markup).toContain('inline-flex w-fit items-center gap-sm self-start');
    expect(markup).not.toContain('inline-flex w-full items-center gap-sm rounded-full');
    expect(markup).toContain('>Remove</button>');
    expect(markup).toContain('text-error');
    expect(markup).toContain('>Edit</button>');
  });
});
