import { type LucideIcon } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from './class-names.js';

export const STEPPER_STATES = Object.freeze(['completed', 'current', 'upcoming'] as const);
export type StepperState = (typeof STEPPER_STATES)[number];

export interface StepperStep {
  /** Stable key; the wizard step id is the natural choice. */
  id: string;
  /**
   * Semantic Lucide glyph for the step — Create Program uses `file-text`, `crosshair`,
   * `shield-alert`, `coins`, `scroll-text`, `clipboard-check`, `wallet`; Submit Bug uses
   * `crosshair`, `gauge`, `file-text`, `clipboard-check`. The node never shows a numeral.
   */
  icon: LucideIcon;
  label: string;
}

/** Announced next to each label so state survives without colour. */
const DEFAULT_STATE_LABELS: Readonly<Record<StepperState, string>> = Object.freeze({
  completed: 'Completed',
  current: 'Current step',
  upcoming: 'Upcoming',
});

const NODE_CLASSES: Readonly<Record<StepperState, string>> = Object.freeze({
  completed: 'border-escrow bg-escrow text-background',
  current: 'border-primary bg-primary text-primary-contrast ring-4 ring-primary/25',
  upcoming: 'border-border bg-surface-raised text-text-disabled',
});

const LABEL_CLASSES: Readonly<Record<StepperState, string>> = Object.freeze({
  completed: 'text-label-md text-text',
  current: 'text-label-md font-semibold text-text',
  upcoming: 'text-label-md text-text-disabled',
});

export interface StepperProps extends Omit<ComponentPropsWithoutRef<'ol'>, 'children'> {
  /** Zero-based index of the step the wizard is on. Everything before it counts as completed. */
  currentStep: number;
  /** Override the screen-reader wording, e.g. for localisation. */
  stateLabels?: Readonly<Record<StepperState, string>>;
  /** 7 steps for Create Program, 4 for Submit Bug. */
  steps: readonly StepperStep[];
}

/**
 * Horizontal wizard progress. Completed nodes are mint with a mint connector, the current node is
 * brand violet under a soft halo, upcoming nodes are a raised surface with a disabled border and
 * label. Labels sit under the node.
 *
 * State is exposed to assistive tech through the ordered list, `aria-current="step"` and a
 * per-step status word — colour is only ever the reinforcement.
 */
export const Stepper = forwardRef<HTMLOListElement, StepperProps>(function Stepper(
  {
    'aria-label': ariaLabel = 'Progress',
    className,
    currentStep,
    stateLabels = DEFAULT_STATE_LABELS,
    steps,
    ...stepperProps
  },
  ref,
) {
  const lastIndex = steps.length - 1;

  return (
    <ol
      {...stepperProps}
      ref={ref}
      aria-label={ariaLabel}
      className={cn('flex w-full items-start', className)}
    >
      {steps.map((step, index) => {
        const state: StepperState =
          index < currentStep ? 'completed' : index === currentStep ? 'current' : 'upcoming';
        const Icon = step.icon;
        // A connector is mint once the step on its left is done, so the trail matches the nodes.
        const leadingDone = index <= currentStep;
        const trailingDone = index < currentStep;

        return (
          <li
            key={step.id}
            aria-current={state === 'current' ? 'step' : undefined}
            data-state={state}
            className="flex min-w-0 flex-1 flex-col items-center gap-sm"
          >
            <div className="flex w-full items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1',
                  index === 0 ? 'invisible' : leadingDone ? 'bg-escrow' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'flex size-2xl shrink-0 items-center justify-center rounded-full border',
                  NODE_CLASSES[state],
                )}
              >
                <Icon aria-hidden="true" className="size-lg" />
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'h-px flex-1',
                  index === lastIndex ? 'invisible' : trailingDone ? 'bg-escrow' : 'bg-border',
                )}
              />
            </div>
            <span className={`px-xs text-center ${LABEL_CLASSES[state]}`}>{step.label}</span>
            <span className="sr-only">{stateLabels[state]}</span>
          </li>
        );
      })}
    </ol>
  );
});
