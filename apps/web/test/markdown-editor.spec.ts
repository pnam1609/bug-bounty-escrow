import { createElement, useState, type ChangeEvent } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MARKDOWN_EDITOR_MIN_ROWS,
  MarkdownEditor,
  safeMarkdownUrl,
} from '@/components/owner/markdown-editor';

function EditorHarness({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return createElement(MarkdownEditor, {
    id: 'program-description',
    maxLength: 20_000,
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value),
    rows: 6,
    value,
  });
}

function renderedText(renderer: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

async function selectPreview(renderer: TestRenderer.ReactTestRenderer): Promise<void> {
  const previewTab = renderer.root.findAll((node) => node.type === 'button')[1];
  if (previewTab === undefined) throw new Error('Preview tab was not rendered.');
  await act(async () =>
    previewTab.props['onMouseDown']({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined,
    }),
  );
}

describe('MarkdownEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  it('allows only safe link protocols in previews', () => {
    expect(safeMarkdownUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(safeMarkdownUrl('http://example.com/docs')).toBe('http://example.com/docs');
    expect(safeMarkdownUrl('/programs/aegis')).toBe('/programs/aegis');
    expect(safeMarkdownUrl('#section')).toBe('#section');
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrl('//example.com/docs')).toBe('');
    expect(safeMarkdownUrl('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('keeps the raw value editable and renders safe Markdown in Preview', async () => {
    const value =
      '# Program overview\n\n[Documentation](https://example.com)\n\n[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>';
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    await act(async () => {
      renderer = TestRenderer.create(createElement(EditorHarness, { initialValue: value }));
    });
    if (renderer === undefined) throw new Error('Markdown editor was not rendered.');

    await selectPreview(renderer);
    const preview = renderedText(renderer);
    expect(preview).toContain('Program overview');
    expect(preview).toContain('https://example.com');
    expect(renderer.root.findAll((node) => node.type === 'script')).toHaveLength(0);
    expect(
      renderer.root.findAll((node) => node.type === 'a').map((node) => node.props['href']),
    ).toEqual(['https://example.com']);

    expect(renderer.root.findAllByType('textarea')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.type === 'input')).toHaveLength(0);
  });

  it('keeps Markdown textareas at least twenty rows tall', async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(createElement(EditorHarness, { initialValue: 'Draft' }));
    });
    if (renderer === undefined) throw new Error('Markdown editor was not rendered.');

    const textarea = renderer.root.findByType('textarea');
    expect(textarea.props['rows']).toBe(MARKDOWN_EDITOR_MIN_ROWS);
    expect(textarea.props['maxLength']).toBe(20_000);
  });

  it('keeps the mode icon and label in one horizontal tab row', async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(createElement(EditorHarness, { initialValue: 'Draft' }));
    });
    if (renderer === undefined) throw new Error('Markdown editor was not rendered.');

    expect(
      renderer.root.findAllByProps({ className: 'inline-flex items-center gap-sm' }),
    ).toHaveLength(2);
  });

  it('shows an explicit empty preview state', async () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(createElement(EditorHarness, { initialValue: '' }));
    });
    if (renderer === undefined) throw new Error('Markdown editor was not rendered.');

    await selectPreview(renderer);

    expect(renderedText(renderer)).toContain('Nothing to preview yet.');
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0);
  });
});
