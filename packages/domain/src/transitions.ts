import type { ProgramStatus, ReportStatus } from './statuses.js';

function reportTransitions(...statuses: ReportStatus[]): readonly ReportStatus[] {
  return Object.freeze(statuses);
}

function programTransitions(...statuses: ProgramStatus[]): readonly ProgramStatus[] {
  return Object.freeze(statuses);
}

export const REPORT_STATUS_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> =
  Object.freeze({
    draft: reportTransitions('submitted'),
    submitted: reportTransitions(
      'triaged',
      'needs_information',
      'rejected',
      'duplicate',
      'validated',
    ),
    triaged: reportTransitions('needs_information', 'rejected', 'duplicate', 'validated'),
    needs_information: reportTransitions('submitted'),
    rejected: reportTransitions(),
    duplicate: reportTransitions(),
    validated: reportTransitions('reward_approved'),
    reward_approved: reportTransitions('payment_pending'),
    payment_pending: reportTransitions('paid'),
    paid: reportTransitions(),
  });

export const PROGRAM_STATUS_TRANSITIONS: Readonly<Record<ProgramStatus, readonly ProgramStatus[]>> =
  Object.freeze({
    draft: programTransitions('awaiting_funding', 'closed'),
    awaiting_funding: programTransitions('active', 'closed'),
    active: programTransitions('paused', 'expired', 'closed'),
    paused: programTransitions('active', 'expired', 'closed'),
    deactivated: programTransitions(),
    expired: programTransitions('closed'),
    closed: programTransitions(),
  });

export function getAllowedReportStatusTransitions(status: ReportStatus): readonly ReportStatus[] {
  return REPORT_STATUS_TRANSITIONS[status];
}

export function canTransitionReportStatus(from: ReportStatus, to: ReportStatus): boolean {
  return REPORT_STATUS_TRANSITIONS[from].includes(to);
}

export function getAllowedProgramStatusTransitions(
  status: ProgramStatus,
): readonly ProgramStatus[] {
  return PROGRAM_STATUS_TRANSITIONS[status];
}

export function canTransitionProgramStatus(from: ProgramStatus, to: ProgramStatus): boolean {
  return PROGRAM_STATUS_TRANSITIONS[from].includes(to);
}
