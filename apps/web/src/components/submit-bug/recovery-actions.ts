import type { CreateReportRequest } from '@bug-bounty-escrow/shared';

import { clearDraft } from './submit-bug-model';

export const SUBMIT_ERROR_ALERT =
  'Your report could not be submitted. Your draft is still saved in this browser.';
export const SUBMIT_ERROR_SUPPORT =
  'Check your connection and try again. Retrying sends the same report once.';
export const MISSING_PROGRAM_TITLE = 'Choose a program before starting a report.';
export const SUBMIT_WRONG_ROLE_TITLE = "This workspace isn't available";
export const SUBMIT_WRONG_ROLE_DESCRIPTION =
  'Your account does not have Security researcher access.';

export function composerReturnTo(programSlug: string): string {
  return `/reports/new?programSlug=${encodeURIComponent(programSlug)}`;
}

export function retainFailedCreatePayload(
  failedPayload: CreateReportRequest | null,
  currentPayload: CreateReportRequest,
): CreateReportRequest {
  return failedPayload ?? currentPayload;
}

export async function retryAttachmentOnly(input: {
  readonly file: File;
  readonly reportId: string;
  readonly upload: (reportId: string, file: File) => Promise<boolean>;
}): Promise<boolean> {
  return input.upload(input.reportId, input.file);
}

export function discardLocalReportDraft(input: {
  readonly navigate: (href: string) => void;
  readonly programSlug: string;
  readonly returnTo?: string | undefined;
}): void {
  clearDraft(input.programSlug);
  input.navigate(input.returnTo ?? `/programs/${encodeURIComponent(input.programSlug)}`);
}
