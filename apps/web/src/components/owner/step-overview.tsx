'use client';

import {
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@bug-bounty-escrow/ui';
import { ImagePlus, Plus, X } from 'lucide-react';
import { useState, type ChangeEvent, type KeyboardEvent } from 'react';

import {
  fieldId,
  nextRowId,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  suggestSlug,
  type FieldErrors,
  type ProgramDraft,
  type ResourceType,
} from './program-draft';
import { GuidancePanel } from './owner-workspace';
import {
  AffixedField,
  DeleteRowButton,
  FormCard,
  StepActions,
  StepLayout,
  ValidationSummary,
} from './wizard-parts';

const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_TAGS = 10;

export interface StepOverviewProps {
  readonly draft: ProgramDraft;
  readonly errors: FieldErrors;
  readonly onCancel: () => void;
  readonly onContinue: () => void;
  readonly update: (patch: Partial<ProgramDraft>) => void;
}

export function StepOverview({ draft, errors, onCancel, onContinue, update }: StepOverviewProps) {
  const [tagDraft, setTagDraft] = useState('');
  const [logoError, setLogoError] = useState<string | null>(null);

  function changeName(name: string) {
    update({ name, ...(draft.slugEdited ? {} : { slug: suggestSlug(name) }) });
  }

  function commitTag() {
    const value = tagDraft.trim().slice(0, 40);
    if (value === '') return;
    if (draft.tags.length >= MAX_TAGS) return;
    if (draft.tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      setTagDraft('');
      return;
    }
    update({ tags: [...draft.tags, value] });
    setTagDraft('');
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTag();
      return;
    }
    if (event.key === 'Backspace' && tagDraft === '' && draft.tags.length > 0) {
      update({ tags: draft.tags.slice(0, -1) });
    }
  }

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;

    if (!LOGO_MIME_TYPES.includes(file.type) || file.size > MAX_LOGO_BYTES) {
      // Drop the rejected file from the control: its native filename must not suggest it was
      // accepted, and re-picking the same file (fixed elsewhere) has to re-fire `change`.
      event.target.value = '';
      setLogoError('Choose a PNG, JPEG, WebP or SVG file up to 2 MB.');
      return;
    }

    setLogoError(null);
    if (draft.logoPreviewUrl !== null && draft.logoPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(draft.logoPreviewUrl);
    }
    update({ logoFile: file, logoPreviewUrl: URL.createObjectURL(file) });
  }

  function addResource() {
    update({
      resources: [
        ...draft.resources,
        { rowId: nextRowId('resource'), resourceType: 'documentation', title: '', url: '' },
      ],
    });
  }

  function patchResource(
    rowId: string,
    patch: { title?: string; url?: string; resourceType?: ResourceType },
  ) {
    update({
      resources: draft.resources.map((resource) =>
        resource.rowId === rowId ? { ...resource, ...patch } : resource,
      ),
    });
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <StepLayout
      aside={
        <GuidancePanel eyebrow="Private draft" title="Nothing is public yet">
          <p>
            Create the draft first. Deploy escrow, fund the reward pool and publish when you are
            ready.
          </p>
          <ul className="flex flex-col gap-xs">
            <li>Overview and identity</li>
            <li>Scope, impacts and rewards</li>
            <li>Escrow and funding</li>
          </ul>
        </GuidancePanel>
      }
    >
      {hasErrors ? <ValidationSummary /> : null}

      <FormCard
        description="Public identity, discovery metadata and researcher-facing resources."
        title="Program overview"
      >
        {/* Logo — optional. The signed upload needs a program id, so the file is held locally and
            attached to the program the moment the draft exists. */}
        <div className="flex flex-col gap-sm">
          <Label htmlFor={fieldId('logo')}>Program logo</Label>
          <div className="flex flex-wrap items-center gap-lg rounded-md border border-dashed border-border bg-surface-raised p-lg">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface">
              {draft.logoPreviewUrl === null ? (
                <ImagePlus aria-hidden="true" className="size-5 text-text-muted" />
              ) : (
                // A blob: object URL for a file that has not been uploaded yet — next/image
                // cannot optimise it and the preview is capped at 56px anyway.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={draft.name === '' ? 'Program logo preview' : `${draft.name} logo`}
                  className="size-full object-cover"
                  src={draft.logoPreviewUrl}
                />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-xs">
              <span className="text-label-lg text-text">
                {draft.logoFile === null ? 'Add a square logo' : draft.logoFile.name}
              </span>
              <span className="text-label-md text-text-muted">
                PNG, JPEG, WebP or SVG · max 2 MB · attached once the draft is created.
              </span>
            </span>
            <input
              accept={LOGO_MIME_TYPES.join(',')}
              className="min-h-11 max-w-full text-body-sm text-text-muted file:mr-md file:min-h-11 file:rounded-full file:border file:border-border file:bg-surface-raised file:px-lg file:text-label-lg file:text-text hover:file:border-border-brand"
              id={fieldId('logo')}
              onChange={chooseLogo}
              type="file"
              {...(logoError === null ? {} : { 'aria-describedby': `${fieldId('logo')}-error` })}
            />
          </div>
          {logoError === null ? null : (
            <p className="text-label-sm text-error" id={`${fieldId('logo')}-error`} role="alert">
              {logoError}
            </p>
          )}
        </div>

        <Field
          error={errors['name']}
          helperText="Shown to researchers when the program is published."
          htmlFor={fieldId('name')}
          label="Program name"
          required
        >
          <Input
            id={fieldId('name')}
            maxLength={200}
            onChange={(event) => changeName(event.target.value)}
            placeholder="e.g. Aegis Protocol"
            size="lg"
            value={draft.name}
          />
        </Field>

        <AffixedField
          error={errors['slug']}
          helperText="Lowercase letters, numbers and hyphens only."
          id={fieldId('slug')}
          label="Slug"
          maxLength={120}
          onChange={(value) => update({ slug: value, slugEdited: true })}
          placeholder="aegis-protocol"
          prefix="/programs/"
          required
          size="lg"
          value={draft.slug}
        />

        <Field
          counter={`${draft.shortSummary.length} / 280`}
          error={errors['shortSummary']}
          helperText="Used on the program card and the program header."
          htmlFor={fieldId('shortSummary')}
          label="Short summary"
          required
        >
          <Input
            id={fieldId('shortSummary')}
            maxLength={280}
            onChange={(event) => update({ shortSummary: event.target.value })}
            placeholder="Describe the program in one concise sentence."
            size="lg"
            value={draft.shortSummary}
          />
        </Field>

        <Field
          error={errors['websiteUrl']}
          helperText="HTTPS URL required."
          htmlFor={fieldId('websiteUrl')}
          label="Official website"
          required
        >
          <Input
            id={fieldId('websiteUrl')}
            inputMode="url"
            onChange={(event) => update({ websiteUrl: event.target.value })}
            placeholder="https://aegis.xyz"
            size="lg"
            type="url"
            value={draft.websiteUrl}
          />
        </Field>

        <Field
          counter={`${draft.tags.length} / ${MAX_TAGS}`}
          error={errors['tags']}
          helperText="Press Enter to add a tag. Example: DeFi, Solidity, DEX, Arbitrum."
          htmlFor={fieldId('tags')}
          label="Tags"
          required
        >
          <div
            className="flex w-full flex-wrap items-center gap-sm rounded-md border border-input-border bg-input p-sm"
            id={`${fieldId('tags')}-group`}
          >
            {draft.tags.map((tag) => (
              <span
                className="inline-flex items-center gap-xs rounded-full border border-border bg-surface-raised ps-md text-label-md text-text"
                key={tag}
              >
                {tag}
                <button
                  className="inline-flex size-11 items-center justify-center rounded-full text-text-muted hover:text-error"
                  onClick={() => update({ tags: draft.tags.filter((entry) => entry !== tag) })}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">{`Remove tag ${tag}`}</span>
                </button>
              </span>
            ))}
            <input
              aria-describedby={`${fieldId('tags')}-message ${fieldId('tags')}-counter`}
              aria-invalid={errors['tags'] === undefined ? undefined : true}
              className="min-h-11 min-w-40 flex-1 bg-transparent px-sm text-body-sm text-text outline-none placeholder:text-input-placeholder"
              disabled={draft.tags.length >= MAX_TAGS}
              id={fieldId('tags')}
              maxLength={40}
              onBlur={commitTag}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={onTagKeyDown}
              placeholder={draft.tags.length >= MAX_TAGS ? 'Tag limit reached' : 'Add tag'}
              value={tagDraft}
            />
          </div>
        </Field>

        <Field
          counter={`${draft.description.length.toLocaleString('en-US')} / 20,000`}
          error={errors['description']}
          helperText="Markdown supported."
          htmlFor={fieldId('description')}
          label="Program overview"
          required
        >
          <Textarea
            id={fieldId('description')}
            maxLength={20_000}
            onChange={(event) => update({ description: event.target.value })}
            placeholder="Describe the product, security goals and what researchers should know."
            rows={6}
            size="lg"
            value={draft.description}
          />
        </Field>

        <Field
          error={errors['deadline']}
          helperText="Leave empty for an open-ended program."
          htmlFor={fieldId('deadline')}
          label="Submission deadline"
        >
          <Input
            id={fieldId('deadline')}
            onChange={(event) => update({ deadline: event.target.value })}
            size="lg"
            type="date"
            value={draft.deadline}
          />
        </Field>

        <fieldset className="flex flex-col gap-md rounded-md border border-border bg-surface-raised p-lg">
          <legend className="px-xs text-label-lg text-text">Resources</legend>
          <p className="text-label-md text-text-muted">
            Documentation and repository links shown on program detail. Optional, up to 20.
          </p>

          {draft.resources.map((resource, index) => (
            <div
              className="flex flex-col gap-sm"
              id={fieldId(`resources.${resource.rowId}`)}
              key={resource.rowId}
              tabIndex={-1}
            >
              <div className="grid gap-md md:grid-cols-[10rem_minmax(12rem,1fr)_minmax(16rem,1fr)_auto] md:items-end">
                <Field
                  className="w-40"
                  htmlFor={fieldId(`resources.${resource.rowId}.type`)}
                  label="Type"
                >
                  <Select
                    onValueChange={(value) =>
                      patchResource(resource.rowId, { resourceType: value as ResourceType })
                    }
                    value={resource.resourceType}
                  >
                    <SelectTrigger id={fieldId(`resources.${resource.rowId}.type`)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESOURCE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {RESOURCE_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  className="min-w-48 flex-1"
                  htmlFor={fieldId(`resources.${resource.rowId}.title`)}
                  label="Title"
                >
                  <Input
                    id={fieldId(`resources.${resource.rowId}.title`)}
                    maxLength={120}
                    onChange={(event) =>
                      patchResource(resource.rowId, { title: event.target.value })
                    }
                    placeholder="Developer documentation"
                    value={resource.title}
                  />
                </Field>
                <Field
                  className="min-w-64 flex-1"
                  htmlFor={fieldId(`resources.${resource.rowId}.url`)}
                  label="URL"
                >
                  <Input
                    id={fieldId(`resources.${resource.rowId}.url`)}
                    onChange={(event) => patchResource(resource.rowId, { url: event.target.value })}
                    placeholder="https://docs.aegis.xyz"
                    type="url"
                    value={resource.url}
                  />
                </Field>
                <DeleteRowButton
                  className="md:mb-0 md:self-end"
                  label={`Remove resource ${index + 1}`}
                  onClick={() =>
                    update({
                      resources: draft.resources.filter((entry) => entry.rowId !== resource.rowId),
                    })
                  }
                />
              </div>
              {errors[`resources.${resource.rowId}`] === undefined ? null : (
                <p className="text-label-sm text-error" role="alert">
                  {errors[`resources.${resource.rowId}`]}
                </p>
              )}
            </div>
          ))}

          <button
            className="inline-flex min-h-11 w-fit items-center gap-sm rounded-full border border-border bg-surface px-lg text-label-lg text-text hover:border-border-brand"
            disabled={draft.resources.length >= 20}
            onClick={addResource}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add resource
          </button>
        </fieldset>

        <StepActions
          onPrimary={onContinue}
          onSecondary={onCancel}
          primaryLabel="Continue to scope"
          secondaryLabel="Cancel"
        />
      </FormCard>
    </StepLayout>
  );
}
