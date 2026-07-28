import { describe, expect, it } from 'vitest';

import { REQUIRED_ROLES } from '../src/common/decorators/roles.decorator.js';
import {
  ProgramController,
  TransactionController,
} from '../src/programs/program.controller.js';
import { ReportController } from '../src/reports/report.controller.js';

function roles(target: object, method: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, method);
  return Reflect.getMetadata(REQUIRED_ROLES, descriptor?.value as object);
}

describe('RW-02 settlement authorization boundary', () => {
  it('keeps program and hash transaction lookup on the program-review side', () => {
    expect(roles(ProgramController.prototype, 'transactions')).toEqual(['owner', 'reviewer']);
    expect(roles(TransactionController.prototype, 'get')).toEqual(['owner', 'reviewer']);
  });

  it('keeps every settlement mutation unavailable to a researcher or AI caller', () => {
    expect(roles(ReportController.prototype, 'approve')).toEqual(['owner', 'reviewer']);
    expect(roles(ReportController.prototype, 'pay')).toEqual(['owner', 'reviewer']);
    expect(roles(ReportController.prototype, 'confirmPayment')).toEqual(['owner', 'reviewer']);
  });
});
