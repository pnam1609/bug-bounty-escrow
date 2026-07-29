import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/auth/auth.service.js';
import { DatabaseError } from '../src/database/database-error.js';
import { ProgramService } from '../src/programs/program.service.js';
import { ReportService } from '../src/reports/report.service.js';

const owner = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  role: 'owner' as const,
};
const researcher = {
  userId: '10000000-0000-4000-8000-000000000002',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};
const profile = {
  id: researcher.userId,
  role: 'researcher' as const,
  display_name: 'Researcher',
  wallet_address: null,
  avatar_url: null,
  onboarding_completed_at: '2026-07-25T00:00:00.000Z',
};

describe('off-chain application services', () => {
  it('maps only safe current-user fields', async () => {
    const repository = {
      findProfile: vi.fn().mockResolvedValue(profile),
      completeOnboarding: vi.fn(),
    };
    const result = await new AuthService(repository as never).getCurrentUser(researcher);

    expect(result).toEqual({
      id: researcher.userId,
      email: researcher.email,
      role: 'researcher',
      displayName: 'Researcher',
      onboardingComplete: true,
    });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('metadata');
  });

  it('propagates the onboarding conflict with its machine-readable reason intact', async () => {
    // The RPC raises the conflict with reason `onboarding_already_completed`. The service must
    // not re-wrap it: the exception filter turns the untouched DatabaseError into the 409 whose
    // `error.code` the onboarding UI branches on (§6.8).
    const repository = {
      findProfile: vi.fn().mockResolvedValue(profile),
      completeOnboarding: vi.fn().mockRejectedValue(
        new DatabaseError({
          code: 'unique_violation',
          databaseCode: '23505',
          message: 'onboarding_already_completed',
          reason: 'onboarding_already_completed',
        }),
      ),
    };
    const attempt = new AuthService(repository as never).completeOnboarding(researcher, {
      role: 'owner',
      displayName: 'Different Name',
    });

    await expect(attempt).rejects.toBeInstanceOf(DatabaseError);
    await expect(attempt).rejects.toMatchObject({
      code: 'unique_violation',
      reason: 'onboarding_already_completed',
    });
  });

  it('rejects wrong-role program writes and inaccessible details', async () => {
    const repository = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findAccessible: vi.fn().mockResolvedValue(null),
    };
    const service = new ProgramService(repository as never);
    await expect(service.create(researcher, {} as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hashes identical report content deterministically without passing plaintext as metadata', async () => {
    const report = {
      id: '10000000-0000-4000-8000-000000000300',
      programId: '10000000-0000-4000-8000-000000000100',
      researcherId: researcher.userId,
      affectedScopeId: '10000000-0000-4000-8000-000000000200',
      title: 'Synthetic issue',
      description: 'Description',
      reproductionSteps: 'Steps',
      proposedSeverity: 'high',
      status: 'submitted',
      updatedAt: '2026-07-25T00:00:00.000Z',
      impacts: [],
      attachments: [],
      severityMismatchAcknowledged: false,
    };
    const repository = {
      submit: vi.fn().mockResolvedValue(report.id),
      findAccessible: vi.fn().mockResolvedValue(report),
    };
    const service = new ReportService(repository as never);
    const input = {
      affectedScopeId: report.affectedScopeId,
      title: report.title,
      description: report.description,
      reproductionSteps: report.reproductionSteps,
      proposedSeverity: 'high' as const,
      programImpactIds: ['10000000-0000-4000-8000-000000000400'],
      customImpacts: [],
      severityMismatchAcknowledged: false,
    };

    await service.submit(researcher, report.programId, input);
    await service.submit(researcher, report.programId, input);

    const firstHash = repository.submit.mock.calls[0]?.[3] as string;
    expect(firstHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(repository.submit.mock.calls[1]?.[3]).toBe(firstHash);
  });

  it('dispatches safe reviews and retires the legacy reward mutation path', async () => {
    const detail = { id: '10000000-0000-4000-8000-000000000300' };
    const repository = {
      requestInformation: vi.fn(),
      validate: vi.fn(),
      reject: vi.fn(),
      markDuplicate: vi.fn(),
      approveReward: vi.fn(),
      findAccessible: vi.fn().mockResolvedValue(detail),
    };
    const service = new ReportService(repository as never);
    await service.review('information', owner, detail.id, { reason: 'Need evidence' });
    await service.review('validate', owner, detail.id, { finalSeverity: 'high' });
    await service.review('reject', owner, detail.id, { reason: 'Not reproducible' });
    await service.review('duplicate', owner, detail.id, {
      originalReportId: '10000000-0000-4000-8000-000000000301',
    });
    await expect(
      service.review('approve', owner, detail.id, { amount: '1000.000000' }),
    ).rejects.toMatchObject({ status: 410 });

    expect(repository.requestInformation).toHaveBeenCalledOnce();
    expect(repository.validate).toHaveBeenCalledOnce();
    expect(repository.reject).toHaveBeenCalledOnce();
    expect(repository.markDuplicate).toHaveBeenCalledOnce();
    expect(repository.approveReward).not.toHaveBeenCalled();
  });
});
