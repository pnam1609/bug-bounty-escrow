'use client';

import {
  Callout,
  CheckboxField,
  Field,
  Input,
  RadioGroup,
  RadioGroupItemField,
  Textarea,
} from '@bug-bounty-escrow/ui';
import { Plus } from 'lucide-react';

import {
  fieldId,
  nextRowId,
  PLATFORM_PROHIBITED_ACTIVITIES,
  type FieldErrors,
  type PocPolicy,
  type ProgramDraft,
} from './program-draft';
import { GuidancePanel } from './owner-workspace';
import {
  DeleteRowButton,
  FormCard,
  StepActions,
  StepLayout,
  ValidationSummary,
} from './wizard-parts';

/*
 * CP-03R — Rules. Sections are exactly the five the flow document lists: Proof of Concept, reward
 * and eligibility policy, prohibited activities, testing restrictions and custom acknowledgment,
 * closed by the disclosure callout. No KYC section and no Known Issues editor: disclosure is a
 * post-program decision per report, never authored here.
 *
 * The optional text fields deliberately carry no `maxLength`. Their limits are CP-03RV validator
 * rules, and a hard cap would both truncate a paste in silence and make the messages unreachable.
 */

/** Mirrors `MAX_CUSTOM_PROHIBITED_RULES` in `programRulesInputSchema`; defaults are never counted. */
const MAX_CUSTOM_RULES = 20;

export interface StepRulesProps {
  readonly draft: ProgramDraft;
  readonly errors: FieldErrors;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly update: (patch: Partial<ProgramDraft>) => void;
}

export function StepRules({ draft, errors, onBack, onContinue, update }: StepRulesProps) {
  const { rules } = draft;
  const hasErrors = Object.keys(errors).length > 0;

  function patchRules(patch: Partial<ProgramDraft['rules']>) {
    update({ rules: { ...rules, ...patch } });
  }

  return (
    <StepLayout
      aside={
        <GuidancePanel eyebrow="Fair and explicit" title="Say what counts and what is banned">
          <p>
            Researchers read these rules before they start. Spell out how rewards are decided, what
            is excluded, and which testing activities are never allowed.
          </p>
          <Callout variant="info">
            No KYC anywhere in BountyEscrow. Reports stay private until you decide otherwise after
            the program ends.
          </Callout>
        </GuidancePanel>
      }
    >
      {hasErrors ? <ValidationSummary /> : null}

      <FormCard
        description="Explain what a valid submission must include and which testing activities are prohibited."
        title="Program rules"
      >
        <fieldset className="flex flex-col gap-md">
          <legend className="text-label-lg text-text">Proof of Concept</legend>
          <p className="text-body-sm text-text-muted">
            Applies to every submission in this program.
          </p>
          <RadioGroup
            aria-label="Proof of Concept policy"
            className="sm:grid-cols-2"
            onValueChange={(value) => patchRules({ pocPolicy: value as PocPolicy })}
            value={rules.pocPolicy}
          >
            <RadioGroupItemField
              description="A reproducible proof of concept must be attached."
              label="Required"
              value="required"
            />
            <RadioGroupItemField
              description="Researchers may submit without a proof of concept."
              label="Optional"
              value="optional"
            />
          </RadioGroup>

          <Field
            counter={`${rules.pocPolicyNote.length.toLocaleString('en-US')} / 2,000`}
            error={errors['rules.pocPolicyNote']}
            helperText="Optional."
            htmlFor={fieldId('rules.pocPolicyNote')}
            label="Policy note"
          >
            <Textarea
              id={fieldId('rules.pocPolicyNote')}
              onChange={(event) => patchRules({ pocPolicyNote: event.target.value })}
              placeholder="Explain what a usable proof of concept looks like for this program."
              rows={2}
              value={rules.pocPolicyNote}
            />
          </Field>
        </fieldset>

        <Field
          counter={`${rules.rewardPolicy.length.toLocaleString('en-US')} / 20,000`}
          error={errors['rules.rewardPolicy']}
          helperText="Markdown supported. Cover calculation, exclusions and primacy rules."
          htmlFor={fieldId('rules.rewardPolicy')}
          label="Reward and eligibility policy"
          required
        >
          <Textarea
            id={fieldId('rules.rewardPolicy')}
            maxLength={20_000}
            onChange={(event) => patchRules({ rewardPolicy: event.target.value })}
            placeholder="Explain how rewards are decided, what is out of scope for a payout and how duplicates are handled."
            rows={5}
            size="lg"
            value={rules.rewardPolicy}
          />
        </Field>

        <fieldset className="flex flex-col gap-md">
          <legend className="text-label-lg text-text">Prohibited activities</legend>
          <p className="text-body-sm text-text-muted">
            Platform defaults always apply and cannot be removed. Add up to 20 rules of your own.
          </p>

          {/* Checked and locked (CP-03R). These never enter `rules.prohibitedActivities`: the
              server snapshots the same baseline itself, so they cannot be unchecked, deleted, or
              counted against the owner's 20 custom slots. */}
          <ul
            aria-label="Platform default rules"
            className="flex flex-col gap-xs rounded-md border border-border bg-surface-raised p-lg"
          >
            {PLATFORM_PROHIBITED_ACTIVITIES.map((rule) => (
              <li key={rule}>
                <CheckboxField checked disabled label={rule} />
              </li>
            ))}
          </ul>

          {rules.prohibitedActivities.map((rule, index) => (
            <div className="flex items-end gap-md" key={rule.rowId}>
              <Field
                className="min-w-0 flex-1"
                error={errors[`rules.prohibited.${rule.rowId}`]}
                htmlFor={fieldId(`rules.prohibited.${rule.rowId}`)}
                label={`Custom rule ${index + 1}`}
              >
                <Input
                  id={fieldId(`rules.prohibited.${rule.rowId}`)}
                  maxLength={1_000}
                  onChange={(event) =>
                    patchRules({
                      prohibitedActivities: rules.prohibitedActivities.map((entry) =>
                        entry.rowId === rule.rowId ? { ...entry, body: event.target.value } : entry,
                      ),
                    })
                  }
                  placeholder="No testing against the staging environment during business hours."
                  value={rule.body}
                />
              </Field>
              <DeleteRowButton
                className="mb-xs"
                label={`Remove custom rule ${index + 1}`}
                onClick={() =>
                  patchRules({
                    prohibitedActivities: rules.prohibitedActivities.filter(
                      (entry) => entry.rowId !== rule.rowId,
                    ),
                  })
                }
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-md">
            <button
              className="inline-flex min-h-11 w-fit items-center gap-sm rounded-full border border-border bg-surface-raised px-lg text-label-lg text-text hover:border-border-brand disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:border-border"
              disabled={rules.prohibitedActivities.length >= MAX_CUSTOM_RULES}
              onClick={() =>
                patchRules({
                  prohibitedActivities: [
                    ...rules.prohibitedActivities,
                    { rowId: nextRowId('rule'), body: '' },
                  ],
                })
              }
              type="button"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add prohibited activity
            </button>
            {/* The cap is what disables the button above, so it has to be legible next to it. */}
            <p className="text-label-sm text-text-muted tabular-nums">
              {`${rules.prohibitedActivities.length} / ${MAX_CUSTOM_RULES} custom rules`}
            </p>
          </div>
        </fieldset>

        <Field
          counter={`${rules.testingRestrictions.length.toLocaleString('en-US')} / 10,000`}
          error={errors['rules.testingRestrictions']}
          helperText="Optional. Markdown supported."
          htmlFor={fieldId('rules.testingRestrictions')}
          label="Testing restrictions"
        >
          <Textarea
            id={fieldId('rules.testingRestrictions')}
            onChange={(event) => patchRules({ testingRestrictions: event.target.value })}
            placeholder="Rate limits, test accounts, environments researchers must use."
            rows={3}
            value={rules.testingRestrictions}
          />
        </Field>

        <Field
          counter={`${rules.submissionAcknowledgment.length.toLocaleString('en-US')} / 1,000`}
          error={errors['rules.submissionAcknowledgment']}
          helperText="Optional. Shown as a checkbox on Submit Bug."
          htmlFor={fieldId('rules.submissionAcknowledgment')}
          label="Custom acknowledgment"
        >
          <Textarea
            id={fieldId('rules.submissionAcknowledgment')}
            onChange={(event) => patchRules({ submissionAcknowledgment: event.target.value })}
            placeholder="I have read the program rules and tested only in-scope assets."
            rows={2}
            value={rules.submissionAcknowledgment}
          />
        </Field>

        {/* `Allow researchers to propose a custom impact` is CP-02I's switch and is not repeated
            here: two controls over one boolean is how the two screens drift apart. */}
        <Callout title="Disclosure" variant="escrow">
          Reports stay private by default. After the program ends, you decide whether each resolved
          report remains private or becomes a public summary/full disclosure.
        </Callout>

        <StepActions
          onPrimary={onContinue}
          onSecondary={onBack}
          primaryLabel="Review program"
          secondaryLabel="Back"
        />
      </FormCard>
    </StepLayout>
  );
}
