import { randomBytes, randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ApiEnvironment,
  CreatePayoutWalletChallengeRequest,
  PayoutWalletChallenge,
  PayoutWalletResponse,
  RequestPrincipal,
  ResearcherRewardListQuery,
  ResearcherRewardListResponse,
  ResearcherPayoutWallet,
  UpdatePayoutWalletRequest,
  UpdatePayoutWalletResponse,
  VerifyPayoutWalletRequest,
} from '@bug-bounty-escrow/shared';
import { getAddress, keccak256, recoverMessageAddress, stringToHex, type Hex } from 'viem';

import { createApiErrorResponse } from '../common/http/api-error.js';
import { API_CONFIG } from '../config/api-config.module.js';
import { RewardRepository } from './reward.repository.js';

const ARC_TESTNET_CHAIN_ID = 5_042_002;
const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const WALLET_CHALLENGE_PURPOSE = 'researcher_payout_wallet_verification' as const;
const WALLET_RESOURCE = 'urn:bountyescrow:researcher-payout-wallet';

function walletVerificationLocation(webAppOrigin: string): { domain: string; uri: string } {
  const origin = new URL(webAppOrigin).origin;
  return {
    domain: new URL(origin).host.toLowerCase(),
    uri: `${origin}/rewards/wallets`,
  };
}

function canonicalUtcTimestamp(value: string): { iso: string; epochMs: number } | null {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return null;

  return { iso: new Date(epochMs).toISOString(), epochMs };
}

export function buildResearcherPayoutWalletMessage(input: {
  domain: string;
  uri: string;
  address: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  challengeId: string;
}): string {
  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    getAddress(input.address),
    '',
    'Verify this wallet as an Arc USDC payout destination for BountyEscrow. This does not submit a transaction or grant token approval.',
    '',
    `URI: ${input.uri}`,
    'Version: 1',
    `Chain ID: ${ARC_TESTNET_CHAIN_ID}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    `Request ID: ${input.challengeId}`,
    'Resources:',
    `- ${WALLET_RESOURCE}`,
  ].join('\n');
}

function paginationMetadata(page: number, limit: number, total: number) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

@Injectable()
export class RewardService {
  public constructor(
    @Inject(RewardRepository) private readonly repository: RewardRepository,
    @Inject(API_CONFIG) private readonly config: ApiEnvironment,
  ) {}

  public async list(
    principal: RequestPrincipal,
    query: ResearcherRewardListQuery,
  ): Promise<ResearcherRewardListResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    const { rewards, total } = await this.repository.listForResearcher(principal.userId, query);

    return {
      success: true,
      data: rewards,
      metadata: paginationMetadata(query.page, query.limit, total),
    };
  }

  public async getPayoutWallet(principal: RequestPrincipal): Promise<PayoutWalletResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    return {
      success: true,
      data: await this.repository.getPayoutWallet(principal.userId),
    };
  }

  public async updatePayoutWallet(
    principal: RequestPrincipal,
    input: UpdatePayoutWalletRequest,
  ): Promise<UpdatePayoutWalletResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    return {
      success: true,
      data: await this.repository.updatePayoutWallet(principal.userId, input),
    };
  }

  public async listPayoutWallets(principal: RequestPrincipal): Promise<ResearcherPayoutWallet[]> {
    this.requireResearcher(principal);
    return this.repository.listVerifiedPayoutWallets(principal.userId);
  }

  public async createPayoutWalletChallenge(
    principal: RequestPrincipal,
    input: CreatePayoutWalletChallengeRequest,
  ): Promise<PayoutWalletChallenge> {
    this.requireResearcher(principal);
    const { domain, uri } = walletVerificationLocation(this.config.WEB_APP_ORIGIN);
    const challengeId = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + WALLET_CHALLENGE_TTL_MS);
    const nonce = randomBytes(16).toString('hex');
    const message = buildResearcherPayoutWalletMessage({
      domain,
      uri,
      address: input.address,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      challengeId,
    });
    const messageHash = keccak256(stringToHex(message));
    const persistedId = await this.repository.createPayoutWalletChallenge({
      challengeId,
      researcherId: principal.userId,
      address: input.address,
      domain,
      uri,
      purpose: WALLET_CHALLENGE_PURPOSE,
      nonce,
      message,
      messageHash,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return {
      id: persistedId,
      address: input.address,
      chainId: ARC_TESTNET_CHAIN_ID,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async verifyPayoutWallet(
    principal: RequestPrincipal,
    challengeId: string,
    input: VerifyPayoutWalletRequest,
  ): Promise<ResearcherPayoutWallet> {
    this.requireResearcher(principal);
    const challenge = await this.repository.findPayoutWalletChallenge(challengeId);
    if (challenge === null || challenge.researcher_id !== principal.userId) {
      throw new NotFoundException(
        createApiErrorResponse(
          'wallet_verification_challenge_not_accessible',
          'The wallet verification request was not found.',
        ),
      );
    }

    if (challenge.consumed_at !== null) {
      const existing = await this.repository.findVerifiedPayoutWalletByAddress(
        principal.userId,
        challenge.address,
      );
      if (existing !== null) return existing;
      throw this.walletConflict(
        'wallet_verification_challenge_consumed',
        'This wallet verification request has already been used.',
      );
    }
    if (challenge.invalidated_at !== null) {
      throw this.walletConflict(
        'wallet_verification_challenge_invalidated',
        'This wallet verification request is no longer active.',
      );
    }
    const canonicalIssuedAt = canonicalUtcTimestamp(challenge.issued_at);
    const canonicalExpiresAt = canonicalUtcTimestamp(challenge.expires_at);
    if (
      canonicalIssuedAt === null ||
      canonicalExpiresAt === null ||
      canonicalExpiresAt.epochMs - canonicalIssuedAt.epochMs !== WALLET_CHALLENGE_TTL_MS
    ) {
      throw this.walletConflict(
        'wallet_verification_challenge_mismatch',
        'The wallet verification request does not match this application.',
      );
    }
    if (canonicalExpiresAt.epochMs <= Date.now()) {
      throw this.walletConflict(
        'wallet_verification_challenge_expired',
        'This wallet verification request has expired.',
      );
    }

    const { domain, uri } = walletVerificationLocation(this.config.WEB_APP_ORIGIN);
    const expectedMessage = buildResearcherPayoutWalletMessage({
      domain,
      uri,
      address: challenge.address,
      nonce: challenge.nonce,
      issuedAt: canonicalIssuedAt.iso,
      expiresAt: canonicalExpiresAt.iso,
      challengeId: challenge.id,
    });
    const signedMessageHash = keccak256(stringToHex(challenge.message));
    if (
      Number(challenge.chain_id) !== ARC_TESTNET_CHAIN_ID ||
      challenge.domain !== domain ||
      challenge.uri !== uri ||
      challenge.purpose !== WALLET_CHALLENGE_PURPOSE ||
      challenge.message !== expectedMessage ||
      challenge.message_hash.toLowerCase() !== signedMessageHash.toLowerCase()
    ) {
      throw this.walletConflict(
        'wallet_verification_challenge_mismatch',
        'The wallet verification request does not match this application.',
      );
    }

    let recoveredAddress: string;
    try {
      recoveredAddress = await recoverMessageAddress({
        message: challenge.message,
        signature: input.signature as Hex,
      });
    } catch {
      throw new UnprocessableEntityException(
        createApiErrorResponse(
          'wallet_signature_invalid',
          'The wallet signature could not be verified.',
        ),
      );
    }
    if (recoveredAddress.toLowerCase() !== challenge.address.toLowerCase()) {
      throw new UnprocessableEntityException(
        createApiErrorResponse(
          'wallet_signature_invalid',
          'The wallet signature was created by a different account.',
        ),
      );
    }

    const walletId = await this.repository.completePayoutWalletVerification({
      researcherId: principal.userId,
      challengeId,
      verifiedAddress: recoveredAddress,
      verifiedMessageHash: signedMessageHash,
      ...(input.label === undefined ? {} : { label: input.label }),
    });
    const wallet = await this.repository.findVerifiedPayoutWallet(principal.userId, walletId);
    if (wallet === null) throw new Error('The verified payout wallet could not be reloaded');
    return wallet;
  }

  private requireResearcher(principal: RequestPrincipal): void {
    if (principal.role !== 'researcher') throw new ForbiddenException();
  }

  private walletConflict(code: string, message: string): ConflictException {
    return new ConflictException(createApiErrorResponse(code, message));
  }
}
