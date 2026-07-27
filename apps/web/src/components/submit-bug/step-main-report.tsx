'use client';

/*
 * SR-03 / SR-03V — Main Report.
 *
 * Figma `145:30` supplies the field stack, counters, helper lines, the dropzone treatment and the
 * selected-file row with Replace / Remove.
 *
 * Flow doc overrides applied here:
 *  · One attachment, not "Attachments" — MVP is 0 or 1 file, and the allowed types are the
 *    contract's SAFE_UPLOAD_MIME_TYPES (Figma's example is a .zip, which the API rejects).
 *  · The PoC field is required only when the published program's `pocPolicy` is `required`.
 *  · Figma's "I confirm the report is original…" checkbox is not rendered here; the single
 *    confirmation belongs to Review.
 *
 * Description and PoC are two fields, never one textarea: they are two columns of the report
 * contract and the server must not have to parse a body to tell them apart (flow doc §3).
 */

import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Textarea,
} from '@bug-bounty-escrow/ui';
import { CircleAlert, Paperclip, Upload, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_SECURITY_NOTE,
  ATTACHMENT_TYPE_SUMMARY,
  BODY_MAX_LENGTH,
  characterCounter,
  describeUploadType,
  formatBytes,
  MAX_UPLOAD_MB,
  POC_PLACEHOLDER,
  REPORT_PRIVACY_NOTICE,
  TITLE_MAX_LENGTH,
  type FieldErrors,
  type ReportDraft,
  type TextDraftField,
} from './submit-bug-model';

export interface StepMainReportProps {
  readonly draft: ReportDraft;
  readonly errors: FieldErrors;
  /** The picked file, valid or not. A refused file stays here so it can be named and removed. */
  readonly file: File | null;
  readonly onChangeField: (field: TextDraftField, value: string) => void;
  readonly onClearFile: () => void;
  readonly onPickFile: (file: File | null) => void;
  readonly pocPolicyNote: string | undefined;
  /** From the published program's `pocPolicy`. Never a constant — see AC 4 / flow doc §8 SR-03. */
  readonly proofRequired: boolean;
}

export function StepMainReport({
  draft,
  errors,
  file,
  onChangeField,
  onClearFile,
  onPickFile,
  pocPolicyNote,
  proofRequired,
}: StepMainReportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const pocPolicyId = useId();
  const attachmentHintId = useId();
  const [dragging, setDragging] = useState(false);

  const attachmentError = errors['attachment'];
  const attachmentDescribedBy =
    attachmentError === undefined ? attachmentHintId : `${attachmentHintId} attachment-error`;

  const openPicker = () => fileInputRef.current?.click();

  /**
   * Drag and drop is the second half of SR-03 field 5; `Choose file` below is the keyboard path to
   * the same picker. Both boxes accept a drop, so replacing a refused file never needs a Remove
   * first. `accept` does not apply to a drop, which is exactly why the type rule is a validator.
   */
  const dropTarget = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      // Entering a child fires `dragleave` on the parent, so only a leave that lands outside counts.
      if (
        event.relatedTarget instanceof Node &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      setDragging(false);
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);

      // Exactly one file in this release: a multi-file drop takes the first rather than silently
      // dropping everything.
      const dropped = event.dataTransfer.files[0];
      if (dropped !== undefined) onPickFile(dropped);
    },
  };

  const idleBorderClass = attachmentError === undefined ? 'border-border' : 'border-error';
  const dropStateClass = dragging
    ? 'border-border-brand bg-surface'
    : `${idleBorderClass} bg-surface-raised`;

  return (
    <Card padding="lg" className="gap-2xl">
      <CardHeader>
        <CardTitle>Write the vulnerability report</CardTitle>
        <CardDescription>
          Provide enough detail for the program to reproduce and assess the vulnerability.
        </CardDescription>
      </CardHeader>

      {/* No `maxLength` on any of the three fields: the cap is a validator rule, so the counter can
          pass its limit and say so instead of swallowing the keystroke or the paste. */}
      <Field
        counter={characterCounter(draft.title, TITLE_MAX_LENGTH)}
        error={errors['title']}
        htmlFor="title"
        label="Report title"
        required
      >
        <Input
          id="title"
          name="title"
          onChange={(event) => onChangeField('title', event.target.value)}
          placeholder="e.g. Re-entrancy can drain the staking pool"
          value={draft.title}
        />
      </Field>

      <Field
        counter={characterCounter(draft.description, BODY_MAX_LENGTH)}
        error={errors['description']}
        helperText="Explain the vulnerable behavior, root cause and affected component."
        htmlFor="description"
        label="Vulnerability description"
        required
      >
        <Textarea
          id="description"
          name="description"
          onChange={(event) => onChangeField('description', event.target.value)}
          placeholder="Explain the vulnerable behavior, root cause and affected component."
          rows={8}
          value={draft.description}
        />
      </Field>

      {/* The policy line sits outside the field group on purpose: `Field` swaps helper text for the
          error message, and the program's own PoC policy must stay readable while that message is
          on screen. */}
      <div className="flex flex-col gap-sm">
        <p className="text-label-lg font-semibold text-text">Proof of concept policy</p>
        <p className="text-body-sm text-text-muted" id={pocPolicyId}>
          {proofRequired
            ? 'Required by this program. Provide reproducible steps and a working demonstration.'
            : 'Optional for this program, but reproducible steps speed up triage.'}
          {pocPolicyNote === undefined ? null : ` ${pocPolicyNote}`}
        </p>
      </div>

      <Field
        counter={characterCounter(draft.reproductionSteps, BODY_MAX_LENGTH)}
        error={errors['reproductionSteps']}
        helperText="Markdown supported. Do not include secrets unrelated to this disclosure."
        htmlFor="reproductionSteps"
        label="Proof of concept / reproduction steps"
        required={proofRequired}
      >
        <Textarea
          aria-describedby={pocPolicyId}
          className="font-mono"
          id="reproductionSteps"
          name="reproductionSteps"
          onChange={(event) => onChangeField('reproductionSteps', event.target.value)}
          placeholder={POC_PLACEHOLDER}
          rows={10}
          value={draft.reproductionSteps}
        />
      </Field>

      <Field
        error={errors['secretGistUrl']}
        helperText="HTTPS only. Keep the Gist secret — it does not replace a required proof of concept."
        htmlFor="secretGistUrl"
        label="Secret Gist URL (optional)"
      >
        <Input
          id="secretGistUrl"
          inputMode="url"
          name="secretGistUrl"
          onChange={(event) => onChangeField('secretGistUrl', event.target.value)}
          placeholder="https://gist.github.com/…"
          type="url"
          value={draft.secretGistUrl}
        />
      </Field>

      <div className="flex flex-col gap-sm" id="attachment">
        <Label htmlFor={fileInputId}>Private attachment (optional)</Label>
        <p className="text-body-sm text-text-muted" id={attachmentHintId}>
          One file in this release. {ATTACHMENT_TYPE_SUMMARY}, up to {MAX_UPLOAD_MB} MB.
        </p>

        {file === null ? (
          <div
            {...dropTarget}
            className={`flex flex-col items-center gap-md rounded-md border border-dashed p-xl text-center transition-colors motion-reduce:transition-none ${dropStateClass}`}
          >
            <Upload aria-hidden="true" className="size-6 text-text-muted" />
            <p className="text-body-sm text-text">Drag and drop your file here</p>
            <Button onClick={openPicker} variant="secondary">
              Choose file
            </Button>
          </div>
        ) : (
          <div
            {...dropTarget}
            className={`flex flex-wrap items-center gap-md rounded-md border p-lg transition-colors motion-reduce:transition-none ${dropStateClass}`}
          >
            <Paperclip aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
            <span className="flex min-w-0 flex-1 flex-col gap-xs">
              <span className="truncate text-label-lg text-text">{file.name}</span>
              <span className="text-label-sm text-text-muted">
                {describeUploadType(file.type)} · {formatBytes(file.size)} ·{' '}
                {attachmentError === undefined ? 'ready to upload' : 'not attached'}
              </span>
            </span>
            <Button onClick={openPicker} variant="ghost">
              Replace
            </Button>
            <Button onClick={onClearFile} variant="ghost">
              <X aria-hidden="true" className="size-4" />
              Remove
            </Button>
          </div>
        )}

        {/* Never colour alone — the same icon + message pairing `Field` uses for its own errors. */}
        {attachmentError === undefined ? null : (
          <p
            className="flex items-start gap-xs text-label-sm text-error"
            id="attachment-error"
            role="alert"
          >
            <CircleAlert aria-hidden="true" className="mt-px size-3 shrink-0" />
            {attachmentError}
          </p>
        )}

        <p className="text-label-sm text-text-muted">{ATTACHMENT_SECURITY_NOTE}</p>

        {/* Last in the block, and out of the tab order, so both the failed-Continue focus jump and
            Tab land on the visible `Choose file` / `Replace` button instead of on a clipped input
            whose focus ring nobody can see. It keeps its label and its aria wiring, and resetting
            the value on change means re-picking the same file still fires. */}
        <input
          accept={ATTACHMENT_ACCEPT}
          aria-describedby={attachmentDescribedBy}
          aria-invalid={attachmentError === undefined ? undefined : true}
          className="sr-only"
          id={fileInputId}
          onChange={(event) => {
            const picked = event.target.files?.[0] ?? null;
            event.target.value = '';
            onPickFile(picked);
          }}
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>

      <Callout title="This report stays private">{REPORT_PRIVACY_NOTICE}</Callout>
    </Card>
  );
}
