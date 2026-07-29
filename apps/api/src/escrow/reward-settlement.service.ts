import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateRewardSettlementIntentRequest,
  type ObserveRewardApprovalRequest,
  type RequestPrincipal,
  type RewardSettlementIntent,
} from '@bug-bounty-escrow/shared';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';

import { createApiErrorResponse } from '../common/http/api-error.js';
import {
  ARC_ESCROW_GATEWAY,
  CIRCLE_CONTRACTS_GATEWAY,
  EscrowProviderError,
  type ArcEscrowGateway,
  type CircleContractsGateway,
} from './escrow-gateways.js';
import {
  EscrowRepository,
  type RewardSettlementIntentRow,
  type RewardSettlementOperationRow,
} from './escrow.repository.js';

function canonicalReportKey(programKey: `0x${string}`, reportId: string): `0x${string}` {
  const reportUuid = `0x${reportId.replaceAll('-', '')}` as Hex;
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'bytes32' }, { type: 'bytes16' }],
      ['BBE_REPORT_V1', programKey, reportUuid],
    ),
  );
}

function latestOperation(
  row: RewardSettlementIntentRow,
  operationType: 'approval' | 'payout',
): RewardSettlementOperationRow | undefined {
  return [...(row.reward_settlement_operations ?? [])]
    .filter((operation) => operation.operation_type === operationType)
    .sort((left, right) => right.attempt_no - left.attempt_no)[0];
}

@Injectable()
export class RewardSettlementService {
  public constructor(
    @Inject(EscrowRepository) private readonly repository: EscrowRepository,
    @Inject(CIRCLE_CONTRACTS_GATEWAY) private readonly circle: CircleContractsGateway,
    @Inject(ARC_ESCROW_GATEWAY) private readonly arc: ArcEscrowGateway,
  ) {}

  public async create(
    principal: RequestPrincipal,
    reportId: string,
    input: CreateRewardSettlementIntentRequest,
  ): Promise<RewardSettlementIntent> {
    const context = await this.repository.findRewardSettlementContext(reportId);
    if (context === null) throw new NotFoundException();
    await this.requireOwner(principal, context.program_id);
    const escrow = await this.repository.findConfirmedEscrow(context.program_id);
    if (
      escrow === null ||
      escrow.contract_address === null ||
      escrow.program_key === null ||
      escrow.owner_wallet === null
    ) {
      throw new ConflictException('canonical_program_escrow_required');
    }
    const row = await this.repository.createRewardSettlementIntent({
      actorId: principal.userId,
      reportId,
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.calculationBasisAmount === undefined
        ? {}
        : { calculationBasisAmount: input.calculationBasisAmount }),
      reportKey: canonicalReportKey(escrow.program_key, reportId),
      contentHash: context.content_hash,
      ownerWallet: input.ownerWallet,
      idempotencyKey: input.idempotencyKey,
    });
    return this.repository.toRewardSettlementIntent(row);
  }

  public async current(
    principal: RequestPrincipal,
    reportId: string,
  ): Promise<RewardSettlementIntent> {
    const row = await this.requireIntent(principal, reportId);
    return this.repository.toRewardSettlementIntent(row);
  }

  public async observeApproval(
    principal: RequestPrincipal,
    reportId: string,
    intentId: string,
    input: ObserveRewardApprovalRequest,
  ): Promise<RewardSettlementIntent> {
    const row = await this.requireIntent(principal, reportId, intentId);
    await this.repository.observeRewardApproval({
      actorId: principal.userId,
      intentId: row.id,
      outcome: input.outcome,
      ...(input.transactionHash === undefined ? {} : { transactionHash: input.transactionHash }),
    });
    if (input.outcome === 'submitted') {
      return this.reconcile(principal, reportId, intentId);
    }
    return this.repository.toRewardSettlementIntent(
      (await this.repository.findRewardSettlementIntentById(row.id))!,
    );
  }

  public async reconcile(
    principal: RequestPrincipal,
    reportId: string,
    intentId: string,
  ): Promise<RewardSettlementIntent> {
    let row = await this.requireIntent(principal, reportId, intentId);
    if (row.escrow_contracts?.contract_address === null) {
      throw new ConflictException('canonical_program_escrow_required');
    }
    const escrowAddress = row.escrow_contracts!.contract_address!;

    if (row.status === 'awaiting_approval') {
      const operation = latestOperation(row, 'approval');
      if (operation?.status !== 'submission_uncertain') {
        return this.repository.toRewardSettlementIntent(row);
      }
      const deploymentBlock = row.escrow_contracts?.deployment_block_number;
      if (deploymentBlock === null || deploymentBlock === undefined) {
        throw new ConflictException('escrow_deployment_block_missing');
      }
      const recovered = await this.arc.findRewardApproval({
        escrowAddress,
        reportKey: row.report_key,
        approvedContentHash: row.approved_content_hash,
        recipientAddress: row.recipient_address,
        amountBaseUnits: BigInt(row.amount_base_units),
        fromBlock: BigInt(deploymentBlock),
      });
      if (recovered === null) {
        return this.repository.toRewardSettlementIntent(row);
      }
      await this.repository.observeRewardApproval({
        actorId: principal.userId,
        intentId: row.id,
        outcome: 'submitted',
        transactionHash: recovered.transactionHash,
      });
      row = (await this.repository.findRewardSettlementIntentById(row.id))!;
    }

    if (row.status === 'approval_submitted') {
      const operation = latestOperation(row, 'approval');
      if (operation?.status !== 'submitted' || operation.transaction_hash === null) {
        throw new ConflictException('reward_approval_hash_unknown');
      }
      let approvalEvidence;
      try {
        approvalEvidence = await this.arc.verifyRewardApproval({
          escrowAddress,
          reportKey: row.report_key,
          approvedContentHash: row.approved_content_hash,
          recipientAddress: row.recipient_address,
          amountBaseUnits: BigInt(row.amount_base_units),
          transactionHash: operation.transaction_hash,
        });
      } catch (error) {
        await this.failDeterministic(row.id, 'approval', error);
        throw error;
      }
      await this.repository.confirmRewardApproval({
        intentId: row.id,
        transactionHash: approvalEvidence.transactionHash,
        eventLogIndex: approvalEvidence.eventLogIndex,
        blockNumber: approvalEvidence.blockNumber,
        blockHash: approvalEvidence.blockHash,
      });
      row = (await this.repository.findRewardSettlementIntentById(row.id))!;
      let externalPayout;
      try {
        externalPayout = await this.arc.findRewardPayout({
          escrowAddress,
          reportKey: row.report_key,
          approvedContentHash: row.approved_content_hash,
          recipientAddress: row.recipient_address,
          amountBaseUnits: BigInt(row.amount_base_units),
          fromBlock: approvalEvidence.blockNumber,
        });
      } catch (error) {
        if (error instanceof EscrowProviderError && error.retryable) {
          return this.repository.toRewardSettlementIntent(row);
        }
        throw error;
      }
      if (externalPayout !== null) {
        await this.repository.observeExternalRewardPayout(row.id, externalPayout.transactionHash);
        await this.repository.confirmRewardPayout({
          intentId: row.id,
          transactionHash: externalPayout.transactionHash,
          eventLogIndex: externalPayout.eventLogIndex,
          transferLogIndex: externalPayout.transferLogIndex,
          blockNumber: externalPayout.blockNumber,
          blockHash: externalPayout.blockHash,
          accounting: externalPayout.accounting,
        });
        return this.repository.toRewardSettlementIntent(
          (await this.repository.findRewardSettlementIntentById(row.id))!,
        );
      }
    }

    if (row.status === 'ready_for_payout' || row.status === 'payout_submitted') {
      const approvalBlock = latestOperation(row, 'approval')?.block_number;
      if (approvalBlock === null || approvalBlock === undefined) {
        throw new ConflictException('reward_approval_block_missing');
      }
      let existing;
      try {
        existing = await this.arc.findRewardPayout({
          escrowAddress,
          reportKey: row.report_key,
          approvedContentHash: row.approved_content_hash,
          recipientAddress: row.recipient_address,
          amountBaseUnits: BigInt(row.amount_base_units),
          fromBlock: BigInt(approvalBlock),
        });
      } catch (error) {
        if (error instanceof EscrowProviderError && error.retryable) {
          return this.repository.toRewardSettlementIntent(row);
        }
        throw error;
      }
      if (existing !== null) {
        await this.repository.observeExternalRewardPayout(row.id, existing.transactionHash);
        await this.repository.confirmRewardPayout({
          intentId: row.id,
          transactionHash: existing.transactionHash,
          eventLogIndex: existing.eventLogIndex,
          transferLogIndex: existing.transferLogIndex,
          blockNumber: existing.blockNumber,
          blockHash: existing.blockHash,
          accounting: existing.accounting,
        });
        return this.repository.toRewardSettlementIntent(
          (await this.repository.findRewardSettlementIntentById(row.id))!,
        );
      }
    }

    if (row.status === 'ready_for_payout') {
      let payout = latestOperation(row, 'payout');
      if (payout === undefined || payout.status === 'failed') {
        await this.repository.prepareRewardPayoutRelay(row.id, randomUUID());
        row = (await this.repository.findRewardSettlementIntentById(row.id))!;
        payout = latestOperation(row, 'payout');
      }
      if (payout?.status === 'submission_uncertain') {
        if (payout.provider_idempotency_key === null) {
          throw new ConflictException('reward_payout_idempotency_key_missing');
        }
        const accepted = await this.circle.submitRewardPayout({
          idempotencyKey: payout.provider_idempotency_key,
          escrowAddress,
          reportKey: row.report_key,
        });
        await this.repository.acceptRewardPayoutRelay(
          row.id,
          payout.provider_idempotency_key,
          accepted.transactionId,
        );
        row = (await this.repository.findRewardSettlementIntentById(row.id))!;
      }
    }

    if (row.status === 'payout_submitted') {
      let payout = latestOperation(row, 'payout');
      if (payout?.status === 'provider_accepted') {
        const providerResult = await this.circle.waitForTransaction(payout.circle_transaction_id!);
        if (providerResult.state === 'failed') {
          await this.repository.failRewardSettlementOperation(
            row.id,
            'payout',
            providerResult.failureCode ?? 'circle_reward_payout_failed',
          );
          return this.repository.toRewardSettlementIntent(
            (await this.repository.findRewardSettlementIntentById(row.id))!,
          );
        }
        if (providerResult.transactionHash === undefined) {
          throw new ConflictException('circle_reward_payout_hash_missing');
        }
        await this.repository.attachRewardPayoutHash(
          row.id,
          payout.circle_transaction_id!,
          providerResult.transactionHash,
        );
        row = (await this.repository.findRewardSettlementIntentById(row.id))!;
        payout = latestOperation(row, 'payout');
      }
      if (payout?.status === 'submitted' && payout.transaction_hash !== null) {
        try {
          const evidence = await this.arc.verifyRewardPayout({
            escrowAddress,
            reportKey: row.report_key,
            approvedContentHash: row.approved_content_hash,
            recipientAddress: row.recipient_address,
            amountBaseUnits: BigInt(row.amount_base_units),
            transactionHash: payout.transaction_hash,
          });
          await this.repository.confirmRewardPayout({
            intentId: row.id,
            transactionHash: evidence.transactionHash,
            eventLogIndex: evidence.eventLogIndex,
            transferLogIndex: evidence.transferLogIndex,
            blockNumber: evidence.blockNumber,
            blockHash: evidence.blockHash,
            accounting: evidence.accounting,
          });
        } catch (error) {
          await this.failDeterministic(row.id, 'payout', error);
          throw error;
        }
      }
    }
    const refreshed = await this.repository.findRewardSettlementIntentById(row.id);
    if (refreshed === null) throw new NotFoundException();
    return this.repository.toRewardSettlementIntent(refreshed);
  }

  public async cancel(
    principal: RequestPrincipal,
    reportId: string,
    intentId: string,
  ): Promise<RewardSettlementIntent> {
    const row = await this.requireIntent(principal, reportId, intentId);
    const escrow = await this.repository.findConfirmedEscrow(row.program_id);
    if (
      escrow === null ||
      escrow.contract_address === null ||
      escrow.deployment_block_number === null
    ) {
      throw new ConflictException('canonical_program_escrow_required');
    }
    const approval = await this.arc.findRewardApproval({
      escrowAddress: escrow.contract_address,
      reportKey: row.report_key,
      approvedContentHash: row.approved_content_hash,
      recipientAddress: row.recipient_address,
      amountBaseUnits: BigInt(row.amount_base_units),
      fromBlock: BigInt(escrow.deployment_block_number),
    });
    if (approval !== null) {
      await this.repository.observeRewardApproval({
        actorId: principal.userId,
        intentId: row.id,
        outcome: 'submitted',
        transactionHash: approval.transactionHash,
      });
      throw new ConflictException('reward_approval_already_onchain');
    }
    await this.repository.cancelRewardSettlementIntent(principal.userId, row.id);
    const refreshed = await this.repository.findRewardSettlementIntentById(row.id);
    if (refreshed === null) throw new NotFoundException();
    return this.repository.toRewardSettlementIntent(refreshed);
  }

  private async failDeterministic(
    intentId: string,
    operationType: 'approval' | 'payout',
    error: unknown,
  ): Promise<void> {
    if (error instanceof EscrowProviderError && !error.retryable) {
      await this.repository.failRewardSettlementOperation(intentId, operationType, error.code);
    }
  }

  private async requireIntent(
    principal: RequestPrincipal,
    reportId: string,
    intentId?: string,
  ): Promise<RewardSettlementIntentRow> {
    const context = await this.repository.findRewardSettlementContext(reportId);
    if (context === null) throw new NotFoundException();
    await this.requireOwner(principal, context.program_id);
    const row =
      intentId === undefined
        ? await this.repository.findRewardSettlementIntentByReport(reportId)
        : await this.repository.findRewardSettlementIntentById(intentId);
    if (row === null) {
      throw new NotFoundException(
        createApiErrorResponse(
          'reward_settlement_not_found',
          'No active reward settlement exists for this report.',
        ),
      );
    }
    if (row.report_id !== reportId) throw new NotFoundException();
    return row;
  }

  private async requireOwner(principal: RequestPrincipal, programId: string): Promise<void> {
    if (
      principal.role !== 'owner' ||
      !(await this.repository.isProgramOwner(programId, principal.userId))
    ) {
      throw new ForbiddenException();
    }
  }
}
