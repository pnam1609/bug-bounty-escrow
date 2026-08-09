'use client';

import {
  cn,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  type TextareaProps,
} from '@bug-bounty-escrow/ui';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Eye, Pencil } from 'lucide-react';
import { useState, type ChangeEventHandler } from 'react';

type MarkdownMode = 'edit' | 'preview';

/** Keep long-form Markdown fields comfortable to edit without requiring immediate scrolling. */
export const MARKDOWN_EDITOR_MIN_ROWS = 20;

const SAFE_URL_PATTERN = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

/**
 * Keeps links in previews useful without allowing javascript/data/vbscript URL schemes.
 * Raw HTML is intentionally not enabled on ReactMarkdown, so preview never becomes an HTML sink.
 */
export function safeMarkdownUrl(url: string): string {
  const value = url.trim();
  return value === '' || SAFE_URL_PATTERN.test(value) ? value : '';
}

export interface MarkdownPreviewProps {
  readonly className?: string;
  readonly emptyText?: string;
  readonly value: string;
}

/** Render Markdown with the same safe, tokenized surface used by the editor Preview tab. */
export function MarkdownPreview({
  className,
  emptyText = 'Nothing to preview yet.',
  value,
}: MarkdownPreviewProps) {
  if (value.trim() === '') {
    return (
      <p
        className={cn(
          'min-h-28 rounded-md border border-dashed border-border bg-input p-lg text-body-sm text-text-muted',
          className,
        )}
      >
        {emptyText}
      </p>
    );
  }

  return (
    <div
      className={cn(
        'min-h-28 rounded-md border border-border bg-surface-raised p-lg text-body-sm text-text',
        '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_blockquote]:border-s-2 [&_blockquote]:border-border-brand [&_blockquote]:ps-lg [&_blockquote]:text-text-muted',
        '[&_code]:rounded-sm [&_code]:bg-input [&_code]:px-xs [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-label-md',
        '[&_h1]:mb-md [&_h1]:text-h3 [&_h2]:mb-sm [&_h2]:mt-lg [&_h2]:text-h4 [&_h3]:mb-sm [&_h3]:mt-md [&_h3]:text-label-lg',
        '[&_li]:ms-lg [&_ol]:list-decimal [&_ol]:ps-lg [&_p]:mb-md [&_p:last-child]:mb-0 [&_pre]:mb-md [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-input [&_pre]:p-md',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:mb-md [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-sm [&_th]:border [&_th]:border-border [&_th]:bg-input [&_th]:p-sm [&_ul]:list-disc [&_ul]:ps-lg',
        className,
      )}
    >
      <ReactMarkdown
        components={{
          a: ({ children, href }) =>
            href === undefined || safeMarkdownUrl(href) === '' ? (
              <span>{children}</span>
            ) : (
              <a href={safeMarkdownUrl(href)} rel="noreferrer" target="_blank">
                {children}
              </a>
            ),
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

export interface MarkdownEditorProps extends Omit<TextareaProps, 'onChange' | 'value'> {
  readonly onChange: ChangeEventHandler<HTMLTextAreaElement>;
  readonly value: string;
  readonly previewEmptyText?: string;
}

/**
 * A small GitHub-style Markdown editor for owner-authored program copy. The textarea remains the
 * source of truth; Preview only renders the current draft and never transforms the submitted value.
 */
export function MarkdownEditor({
  className,
  id,
  onChange,
  previewEmptyText = 'Nothing to preview yet.',
  rows,
  value,
  ...textareaProps
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<MarkdownMode>('edit');
  const editorRows = Math.max(rows ?? MARKDOWN_EDITOR_MIN_ROWS, MARKDOWN_EDITOR_MIN_ROWS);

  return (
    <Tabs
      aria-label="Markdown editor"
      onValueChange={(nextMode) => setMode(nextMode as MarkdownMode)}
      value={mode}
    >
      <TabsList
        aria-label="Markdown editor mode"
        className="rounded-t-md border-input-border bg-surface-raised px-xs"
      >
        <TabsTrigger value="edit">
          <span className="inline-flex items-center gap-sm">
            <Pencil aria-hidden="true" className="size-4" />
            <span>Edit</span>
          </span>
        </TabsTrigger>
        <TabsTrigger value="preview">
          <span className="inline-flex items-center gap-sm">
            <Eye aria-hidden="true" className="size-4" />
            <span>Preview</span>
          </span>
        </TabsTrigger>
      </TabsList>

      {mode === 'edit' ? (
        <TabsContent className="mt-sm" value="edit">
          <Textarea
            {...textareaProps}
            aria-label={textareaProps['aria-label'] ?? 'Markdown content'}
            className={cn('rounded-t-none', className)}
            id={id}
            onChange={onChange}
            rows={editorRows}
            value={value}
          />
        </TabsContent>
      ) : null}

      {mode === 'preview' ? (
        <TabsContent className="mt-sm" value="preview">
          <MarkdownPreview emptyText={previewEmptyText} value={value} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
