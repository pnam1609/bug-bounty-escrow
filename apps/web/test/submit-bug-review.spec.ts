import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  REVIEW_CONFIRMATION,
  REVIEW_NEXT_STEPS,
  REVIEW_PRIVACY_NOTICE,
  StepReview,
  type StepReviewProps,
} from '@/components/submit-bug/step-review';
import type {
  ProgramScope,
  ReportDraft,
} from '@/components/submit-bug/submit-bug-model';

const scope: ProgramScope = {
  id: 'scope-vault',
  assetType: 'smart_contract',
  assetName: 'Aegis Staking Pool',
  contractAddress: '0xA41e5f0d2c8b9a7361f4e2d3c5b6a7980f1e2d3c',
  isInScope: true,
  sortOrder: 0,
  archived: false,
};

const draft: ReportDraft = {
  affectedScopeId: scope.id,
  programImpactIds: ['impact-theft', 'impact-freeze'],
  customImpacts: ['  Cross-chain retry locks reward accounting  '],
  proposedSeverity: 'high',
  severityMismatchAcknowledged: true,
  title: 'Reward accounting can freeze after cross-chain retry',
  description:
    'A retried message can increment the settlement nonce before the original transfer finishes.',
  reproductionSteps: '1. Queue the transfer.\n2. Retry the message.\n3. Observe the frozen reward.',
  secretGistUrl: 'https://gist.github.com/researcher/secret-proof',
};

function renderReview(overrides: Partial<StepReviewProps> = {}): string {
  const props: StepReviewProps = {
    confirmed: true,
    confirmError: undefined,
    draft,
    file: new File(['proof'], 'poc-aegis-retry.md', { type: 'text/markdown' }),
    onConfirm: () => undefined,
    onEditStep: () => undefined,
    programName: 'Aegis Protocol',
    scope,
    selectedImpactTitles: ['Direct theft of user funds', 'Permanent freezing of user funds'],
    suggestedSeverity: 'critical',
    ...overrides,
  };

  return renderToStaticMarkup(createElement(StepReview, props));
}

describe('SR-09 review summary', () => {
  it('renders the exact private-disclosure warning and every required review section', () => {
    const markup = renderReview();
    const readableMarkup = markup.replaceAll('&#x27;', "'");

    expect(markup).toContain('Review your private report');
    expect(readableMarkup).toContain(REVIEW_PRIVACY_NOTICE);
    expect(markup).toContain('role="note" data-variant="warning"');
    expect(markup).toContain('Program and scope');
    expect(markup).toContain('Aegis Protocol');
    expect(markup).toContain('Aegis Staking Pool');
    expect(markup).toContain('Smart contract');
    expect(markup).toContain('Impacts and severity');
    expect(markup).toContain('Direct theft of user funds');
    expect(markup).toContain('Permanent freezing of user funds');
    expect(markup).toContain('Highest selected impact');
    expect(markup).toContain('Proposed severity');
    expect(markup).toContain('Vulnerability report');
    expect(markup).toContain(draft.title);
    expect(markup).toContain(draft.description);
    expect(markup).toContain('Queue the transfer.');
    expect(markup).toContain(draft.secretGistUrl);
    expect(markup).toContain('poc-aegis-retry.md');
    expect(markup).toContain('What happens next');
  });

  it('labels custom impacts and records the acknowledged severity mismatch', () => {
    const markup = renderReview();

    expect(markup).toContain('Cross-chain retry locks reward accounting');
    expect(markup).toContain('Researcher proposed');
    expect(markup).toContain(
      'Acknowledged — you chose to continue with your own proposal.',
    );
    expect(markup).toMatch(/data-severity="critical"/);
    expect(markup).toMatch(/data-severity="high"/);
  });

  it('links each edit control to the correct earlier step with an accessible name', () => {
    const markup = renderReview();

    expect(markup).toContain('aria-label="Edit: Program and scope"');
    expect(markup).toContain('aria-label="Edit impacts: Impacts and severity"');
    expect(markup).toContain('aria-label="Edit severity: Impacts and severity"');
    expect(markup).toContain('aria-label="Edit: Vulnerability report"');
  });

  it('states every real next step without promising validation or payout', () => {
    const markup = renderReview();

    for (const nextStep of REVIEW_NEXT_STEPS) {
      expect(markup).toContain(nextStep);
    }
    expect(markup).not.toContain('will be accepted');
    expect(markup).not.toContain('will receive a reward');
    expect(markup).not.toContain('AI is validating');
  });

  it('shows the exact confirmation and exposes its validation error to assistive technology', () => {
    const markup = renderReview({
      confirmed: false,
      confirmError: 'Confirm the statement above before submitting this report.',
    });

    expect(markup).toContain(REVIEW_CONFIRMATION);
    expect(markup).toContain('aria-describedby="confirmed-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
  });

  it('uses explicit empty states only where the ticket requires them', () => {
    const markup = renderReview({
      draft: { ...draft, secretGistUrl: '' },
      file: null,
    });

    expect(markup).not.toContain('Secret Gist');
    expect(markup).toContain('No attachment');
  });

  it('does not introduce KYC, wallet, disclosure opt-in, save or publish controls', () => {
    const markup = renderReview();

    expect(markup).not.toMatch(/\bKYC\b/);
    expect(markup).not.toContain('Wallet address');
    expect(markup).not.toContain('Make this report public');
    expect(markup).not.toContain('Save draft');
    expect(markup).not.toContain('>Publish<');
  });
});
