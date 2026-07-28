import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  AUTH_TOKEN_FIXTURES,
  payoutWalletResponseSchema,
  researcherRewardListResponseSchema,
} from '@bug-bounty-escrow/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticationGuard } from '../src/auth/authentication.guard.js';
import { RolesGuard } from '../src/auth/roles.guard.js';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter.js';
import type { AppLogger } from '../src/logging/app-logger.service.js';
import { RewardController } from '../src/rewards/reward.controller.js';
import { RewardRepository } from '../src/rewards/reward.repository.js';
import { RewardService } from '../src/rewards/reward.service.js';

const RESEARCHER_ID = '10000000-0000-4000-8000-000000000001';
const REPORT_ID = '30000000-0000-4000-8000-000000000001';
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001';
const PAYOUT_WALLET = `0x${'a'.repeat(40)}`;

describe('RW-02 researcher reward HTTP contract', () => {
  let app: INestApplication;
  let role: 'owner' | 'researcher';
  const rpc = vi.fn();
  const logger = { errorEvent: vi.fn(), warnEvent: vi.fn() };

  beforeEach(async () => {
    role = 'researcher';
    rpc.mockResolvedValue({ data: [], error: null });

    const reflector = new Reflector();
    const authenticationGuard = new AuthenticationGuard(
      reflector,
      {
        auth: {
          getUser: vi.fn().mockImplementation((token: string) =>
            Promise.resolve(
              token === AUTH_TOKEN_FIXTURES.valid
                ? {
                    data: {
                      user: {
                        id: RESEARCHER_ID,
                        email: 'researcher@example.test',
                      },
                    },
                    error: null,
                  }
                : { data: { user: null }, error: { message: 'Invalid token' } },
            ),
          ),
        },
      } as never,
      {
        findProfile: vi.fn().mockImplementation(() => Promise.resolve({ role })),
      } as never,
    );
    const repository = new RewardRepository({ rpc } as never);
    const module = await Test.createTestingModule({
      controllers: [RewardController],
      providers: [RewardService, { provide: RewardRepository, useValue: repository }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalGuards(authenticationGuard, new RolesGuard(reflector));
    app.useGlobalFilters(new ApiExceptionFilter(logger as unknown as AppLogger));
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  function endpoint(): request.Test {
    return request(app.getHttpServer())
      .get('/api/rewards')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`);
  }

  function walletRead(): request.Test {
    return request(app.getHttpServer())
      .get('/api/rewards/payout-wallet')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`);
  }

  function walletUpdate(): request.Test {
    return request(app.getHttpServer())
      .put('/api/rewards/payout-wallet')
      .set('Authorization', `Bearer ${AUTH_TOKEN_FIXTURES.valid}`);
  }

  it('returns only reward metadata and links an existing payment with decimal strings intact', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          report_id: REPORT_ID,
          program_id: PROGRAM_ID,
          program_name: 'Aegis Protocol',
          report_title: 'Accounting invariant bypass',
          final_severity: 'critical',
          reward_status: 'paid',
          approved_reward: '2500.000000',
          submitted_at: '2026-07-26T09:00:00.000Z',
          reward_approved_at: '2026-07-27T10:00:00.000Z',
          payment_chain_id: '5042002',
          payment_token_address: `0x${'a'.repeat(40)}`,
          payment_transaction_hash: `0x${'b'.repeat(64)}`,
          payment_status: 'confirmed',
          payment_confirmations: 12,
          payment_confirmed_at: '2026-07-27T11:00:00.000Z',
          paid_at: '2026-07-27T11:00:00.000Z',
          total_count: '1',
        },
      ],
      error: null,
    });

    const response = await endpoint().expect(200);

    expect(researcherRewardListResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toEqual({
      success: true,
      data: [
        {
          reportId: REPORT_ID,
          programId: PROGRAM_ID,
          programName: 'Aegis Protocol',
          reportTitle: 'Accounting invariant bypass',
          finalSeverity: 'critical',
          status: 'paid',
          approvedReward: '2500.000000',
          submittedAt: '2026-07-26T09:00:00.000Z',
          rewardApprovedAt: '2026-07-27T10:00:00.000Z',
          payment: {
            chainId: '5042002',
            tokenAddress: `0x${'a'.repeat(40)}`,
            transactionHash: `0x${'b'.repeat(64)}`,
            status: 'confirmed',
            confirmations: 12,
            confirmedAt: '2026-07-27T11:00:00.000Z',
          },
          paidAt: '2026-07-27T11:00:00.000Z',
        },
      ],
      metadata: {
        page: 1,
        limit: 20,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('description');
    expect(JSON.stringify(response.body)).not.toContain('reproductionSteps');
    expect(rpc).toHaveBeenCalledWith('researcher_rewards', {
      actor_id: RESEARCHER_ID,
      requested_status: null,
      page_size: 20,
      page_offset: 0,
    });
  });

  it('passes only validated pagination and status while deriving actor from the session', async () => {
    await endpoint().query({ page: '3', limit: '10', status: 'payment_pending' }).expect(200);

    expect(rpc).toHaveBeenCalledWith('researcher_rewards', {
      actor_id: RESEARCHER_ID,
      requested_status: 'payment_pending',
      page_size: 10,
      page_offset: 20,
    });
  });

  it('keeps exact metadata when the requested page is past the final reward', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          report_id: null,
          program_id: null,
          program_name: null,
          report_title: null,
          final_severity: null,
          reward_status: null,
          approved_reward: null,
          submitted_at: null,
          reward_approved_at: null,
          payment_chain_id: null,
          payment_token_address: null,
          payment_transaction_hash: null,
          payment_status: null,
          payment_confirmations: null,
          payment_confirmed_at: null,
          paid_at: null,
          total_count: '7',
        },
      ],
      error: null,
    });

    const response = await endpoint().query({ page: '9', limit: '10' }).expect(200);

    expect(response.body).toEqual({
      success: true,
      data: [],
      metadata: {
        page: 9,
        limit: 10,
        totalItems: 7,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    });
  });

  it('rejects an arbitrary researcherId instead of accepting an identity override', async () => {
    const response = await endpoint().query({ researcherId: REPORT_ID }).expect(400);

    expect(response.body.error.code).toBe('validation_error');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects anonymous and wrong-role access before reading reward activity', async () => {
    await request(app.getHttpServer()).get('/api/rewards').expect(401);
    expect(rpc).not.toHaveBeenCalled();

    role = 'owner';
    const response = await endpoint().expect(403);

    expect(response.body.error.code).toBe('forbidden');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads only the authenticated researcher payout destination with fixed Arc/USDC context', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          wallet_address: PAYOUT_WALLET,
          wallet_updated_at: '2026-07-27T12:00:00.000Z',
          has_active_rewards: true,
        },
      ],
      error: null,
    });

    const response = await walletRead().expect(200);

    expect(payoutWalletResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toEqual({
      success: true,
      data: {
        address: PAYOUT_WALLET,
        maskedAddress: '0xaaaa…aaaa',
        network: 'Arc',
        token: 'USDC',
        hasActiveRewards: true,
        canUpdate: true,
        changeConfirmationRequired: true,
        updatedAt: '2026-07-27T12:00:00.000Z',
      },
    });
    expect(rpc).toHaveBeenCalledWith('researcher_payout_wallet', {
      actor_id: RESEARCHER_ID,
    });
  });

  it('keeps an unset payout destination read-only until a reward becomes active', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          wallet_address: null,
          wallet_updated_at: null,
          has_active_rewards: false,
        },
      ],
      error: null,
    });

    expect((await walletRead().expect(200)).body.data).toEqual({
      network: 'Arc',
      token: 'USDC',
      hasActiveRewards: false,
      canUpdate: false,
      changeConfirmationRequired: false,
    });
  });

  it('updates through the dedicated wallet RPC and never accepts a client-selected identity', async () => {
    const replacement = `0x${'B'.repeat(40)}`;
    rpc.mockResolvedValue({
      data: [
        {
          wallet_address: replacement.toLowerCase(),
          wallet_updated_at: '2026-07-27T13:00:00.000Z',
          has_active_rewards: true,
        },
      ],
      error: null,
    });

    const response = await walletUpdate()
      .send({ address: replacement, confirmActiveRewardChange: true })
      .expect(200);

    expect(response.body.data.maskedAddress).toBe('0xbbbb…bbbb');
    expect(rpc).toHaveBeenCalledWith('set_researcher_payout_wallet', {
      actor_id: RESEARCHER_ID,
      new_wallet_address: replacement.toLowerCase(),
      confirm_active_reward_change: true,
    });

    rpc.mockClear();
    await walletUpdate()
      .send({ address: replacement, researcherId: PROGRAM_ID })
      .expect(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid addresses and secret-shaped fields before the database call', async () => {
    await walletUpdate().send({ address: '0x1234' }).expect(400);
    await walletUpdate().send({ address: PAYOUT_WALLET, privateKey: 'never' }).expect(400);

    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces the race-safe replacement confirmation requirement as a stable conflict', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: '22023',
        details: 'wallet_change_confirmation_required',
        message: 'Business rule violation',
      },
    });

    const response = await walletUpdate().send({ address: PAYOUT_WALLET }).expect(409);

    expect(response.body.error.code).toBe('wallet_change_confirmation_required');
  });

  it('rejects anonymous and wrong-role wallet reads and writes before any RPC', async () => {
    await request(app.getHttpServer()).get('/api/rewards/payout-wallet').expect(401);
    await request(app.getHttpServer())
      .put('/api/rewards/payout-wallet')
      .send({ address: PAYOUT_WALLET })
      .expect(401);

    role = 'owner';
    await walletRead().expect(403);
    await walletUpdate().send({ address: PAYOUT_WALLET }).expect(403);

    expect(rpc).not.toHaveBeenCalled();
  });
});
