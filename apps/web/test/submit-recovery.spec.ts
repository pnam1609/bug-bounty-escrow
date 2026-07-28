import type { CreateReportRequest } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FORBIDDEN_TITLE, forbiddenAccessMessage } from '@/components/role-guard-model';
import { AttachmentRecovery } from '@/components/submit-bug/attachment-recovery';
import {
  DISCARD_DRAFT_DESCRIPTION,
  DISCARD_DRAFT_TITLE,
} from '@/components/submit-bug/discard-draft-dialog';
import { ProgramClosed } from '@/components/submit-bug/program-closed';
import {
  composerReturnTo,
  discardLocalReportDraft,
  MISSING_PROGRAM_TITLE,
  retainFailedCreatePayload,
  retryAttachmentOnly,
  SUBMIT_ERROR_ALERT,
  SUBMIT_ERROR_SUPPORT,
  SUBMIT_WRONG_ROLE_DESCRIPTION,
  SUBMIT_WRONG_ROLE_TITLE,
} from '@/components/submit-bug/recovery-actions';
import { SessionExpired } from '@/components/submit-bug/session-expired';

const firstPayload: CreateReportRequest = {
  affectedScopeId: 'scope-a',
  programImpactIds: ['impact-a'],
  customImpacts: [],
  proposedSeverity: 'high',
  severityMismatchAcknowledged: false,
  title: 'Original title',
  description: 'Original report body',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SR-11 pre-create submit recovery', () => {
  it('pins the exact alert and supporting copy', () => {
    expect(SUBMIT_ERROR_ALERT).toBe(
      'Your report could not be submitted. Your draft is still saved in this browser.',
    );
    expect(SUBMIT_ERROR_SUPPORT).toBe(
      'Check your connection and try again. Retrying sends the same report once.',
    );
  });

  it('reuses the first failed payload even if the live draft has changed', () => {
    const editedPayload: CreateReportRequest = {
      ...firstPayload,
      title: 'Edited after the failed request',
    };

    expect(retainFailedCreatePayload(firstPayload, editedPayload)).toBe(firstPayload);
    expect(retainFailedCreatePayload(null, editedPayload)).toBe(editedPayload);
  });
});

describe('SR-11 post-create attachment recovery', () => {
  it('renders the exact warning, report id, filename and three actions without a submit action', () => {
    const markup = renderToStaticMarkup(
      createElement(AttachmentRecovery, {
        file: new File(['proof'], 'poc-private.md', { type: 'text/markdown' }),
        onContinueWithout: () => undefined,
        onOpenReport: () => undefined,
        onRetry: () => undefined,
        reportId: 'report-existing',
        retrying: false,
      }),
    );

    expect(markup).toContain(
      'Your report was submitted, but the attachment did not finish uploading.',
    );
    expect(markup).toContain('Report ID report-existing');
    expect(markup).toContain('poc-private.md');
    expect(markup).toContain('Retry attachment');
    expect(markup).toContain('Continue without attachment');
    expect(markup).toContain('Open submitted report');
    expect(markup).toContain(
      'Do not resubmit the report. You can attach proof again from this recovery step.',
    );
    expect(markup).not.toContain('Submit private report');
  });

  it('retries only the existing report attachment path', async () => {
    const upload = vi.fn(async () => true);
    const file = new File(['proof'], 'poc.pdf', { type: 'application/pdf' });

    await expect(
      retryAttachmentOnly({ file, reportId: 'report-existing', upload }),
    ).resolves.toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith('report-existing', file);
  });
});

describe('SR-11 discard and terminal states', () => {
  it('clears only the current program key before returning to the requested safe route', () => {
    const removed: string[] = [];
    const visited: string[] = [];
    vi.stubGlobal('window', {
      localStorage: { removeItem: (key: string) => removed.push(key) },
    });

    discardLocalReportDraft({
      navigate: (href) => visited.push(href),
      programSlug: 'program-a',
      returnTo: '/programs/program-a',
    });

    expect(removed).toEqual(['offchain-report-draft:program-a']);
    expect(visited).toEqual(['/programs/program-a']);
    expect(DISCARD_DRAFT_TITLE).toBe('Discard this report draft?');
    expect(DISCARD_DRAFT_DESCRIPTION).toBe(
      'This removes the draft saved in this browser. Nothing has been submitted to the program.',
    );
  });

  it('encodes the program slug in the default discard destination', () => {
    const visited: string[] = [];
    vi.stubGlobal('window', {
      localStorage: { removeItem: vi.fn() },
    });

    discardLocalReportDraft({
      navigate: (href) => visited.push(href),
      programSlug: 'program/a?unsafe=true',
    });

    expect(visited).toEqual(['/programs/program%2Fa%3Funsafe%3Dtrue']);
  });

  it('renders Program closed with the exact preserved-draft copy and only program destinations', () => {
    const markup = renderToStaticMarkup(
      createElement(ProgramClosed, {
        draftSummary: '2 impacts selected · saved in this browser',
        programSlug: 'program-a',
      }),
    );

    expect(markup).toContain('This program is no longer accepting reports');
    expect(markup).toContain(
      'The program changed while you were preparing this disclosure. Your local draft is still available in this browser.',
    );
    expect(markup).toContain('View program');
    expect(markup).not.toContain('/reports/new?programSlug=');
  });

  it('keeps wrong-role copy exact and researcher-specific', () => {
    expect(FORBIDDEN_TITLE).toBe('This workspace isn’t available');
    expect(forbiddenAccessMessage(['researcher'])).toBe(
      'Your account does not have Security researcher access.',
    );
    expect(SUBMIT_WRONG_ROLE_TITLE).toBe("This workspace isn't available");
    expect(SUBMIT_WRONG_ROLE_DESCRIPTION).toBe(
      'Your account does not have Security researcher access.',
    );
  });

  it('renders Session expired with an encoded internal composer returnTo', () => {
    const markup = renderToStaticMarkup(
      createElement(SessionExpired, { programSlug: 'program/a?unsafe=true' }),
    );

    expect(markup).toContain('Your session expired before the report was submitted.');
    expect(markup).toContain(
      'Sign in again to continue with the draft saved in this browser.',
    );
    expect(markup).toContain('Sign in again');
    expect(composerReturnTo('program/a?unsafe=true')).toBe(
      '/reports/new?programSlug=program%2Fa%3Funsafe%3Dtrue',
    );
    expect(markup).toContain(
      'href="/login?returnTo=%2Freports%2Fnew%3FprogramSlug%3Dprogram%252Fa%253Funsafe%253Dtrue"',
    );
    expect(markup).not.toContain('https://');
  });

  it('pins the exact Missing program copy used before any composer can mount', () => {
    expect(MISSING_PROGRAM_TITLE).toBe('Choose a program before starting a report.');
  });
});
