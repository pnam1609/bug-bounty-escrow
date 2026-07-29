import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { FundingIntentRow } from '../src/escrow/escrow.repository.js';
import { EscrowService } from '../src/escrow/escrow.service.js';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const INTENT_ID = '31000000-0000-4000-8000-000000000002';
const ESCROW_ID = '31000000-0000-4000-8000-000000000003';
const OWNER_ID = '31000000-0000-4000-8000-000000000004';
const CLAIM_TOKEN = '31000000-0000-4000-8000-000000000005';
const WALLET = `0x${'a'.repeat(40)}` as const;
const ESCROW = `0x${'b'.repeat(40)}` as const;
const components = (network: 'Arc_Testnet' | 'Base_Sepolia', provider: string) => [
  { network, type: 'provider' as const, token: 'USDC' as const, amountBaseUnits: provider },
  { network, type: 'gas' as const, token: 'USDC' as const, amountBaseUnits: '0' },
  { network, type: 'kit' as const, token: 'USDC' as const, amountBaseUnits: '0' },
  { network, type: 'forwarder' as const, token: 'USDC' as const, amountBaseUnits: '0' },
];

function fundingRow(
  fundingPhase: FundingIntentRow['funding_phase'] = 'collecting_deposits',
): FundingIntentRow {
  return {
    id: INTENT_ID,
    program_id: PROGRAM_ID,
    escrow_contract_id: ESCROW_ID,
    wallet_address: WALLET,
    route_mode: 'unified_balance',
    gross_amount_base_units: '10000000',
    estimated_fee_reserve_base_units: '100000',
    fee_allocations: [
      {
        network: 'Arc_Testnet',
        amountBaseUnits: '40000',
        components: components('Arc_Testnet', '40000'),
      },
      {
        network: 'Base_Sepolia',
        amountBaseUnits: '60000',
        components: components('Base_Sepolia', '60000'),
      },
    ],
    sources: [
      { network: 'Arc_Testnet', amountBaseUnits: '4000000' },
      { network: 'Base_Sepolia', amountBaseUnits: '6000000' },
    ],
    destination_address: ESCROW,
    pre_balance_base_units: '0',
    pre_total_funded_base_units: '0',
    funding_phase: fundingPhase,
    status: 'ready_to_sign',
    destination_transaction_hash: null,
    transfer_id: null,
    net_received_base_units: null,
    failure_code: null,
    expires_at: '2099-07-29T01:00:00.000Z',
    quote_quoted_at: '2026-07-29T00:00:00.000Z',
    quote_expires_at: '2099-07-29T01:00:00.000Z',
    sync_idempotency_key: '31000000-0000-4000-8000-000000000005',
    sync_circle_transaction_id: null,
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:01:00.000Z',
    funding_operations: [],
  };
}

const principal = {
  userId: OWNER_ID,
  email: 'owner@example.test',
  role: 'owner' as const,
};

function serviceFixture(
  initialRow: FundingIntentRow,
  balances: readonly bigint[] = [4_040_000n, 6_060_000n],
) {
  let row = initialRow;
  const repository = {
    isProgramOwner: vi.fn().mockResolvedValue(true),
    findFundingIntentRow: vi.fn().mockImplementation(async () => row),
    prepareFundingDestination: vi.fn().mockImplementation(async () => {
      row = { ...row, funding_phase: 'ready_for_destination' };
      return true;
    }),
    createSourceDeposit: vi.fn(),
    observeFundingOperation: vi.fn(),
    toFundingIntent: vi.fn().mockImplementation((value: FundingIntentRow) => ({
      id: value.id,
      fundingPhase: value.funding_phase,
    })),
  };
  const arc = {
    getGatewayConfirmedBalance: vi
      .fn()
      .mockResolvedValueOnce(balances[0] ?? 0n)
      .mockResolvedValueOnce(balances[1] ?? 0n),
  };
  const gatewaySubscriptions = {
    ensureIntentRegistered: vi.fn(),
  };
  const service = new EscrowService(
    repository as never,
    {} as never,
    arc as never,
    {} as never,
    gatewaySubscriptions as never,
  );
  return { arc, gatewaySubscriptions, repository, service };
}

describe('durable Unified Balance destination handoff', () => {
  it('prepares the destination only after every selected Gateway domain is sufficient', async () => {
    const fixture = serviceFixture(fundingRow());

    await expect(
      fixture.service.prepareFundingDestination(principal, PROGRAM_ID, INTENT_ID),
    ).resolves.toEqual({
      id: INTENT_ID,
      fundingPhase: 'ready_for_destination',
    });

    expect(fixture.arc.getGatewayConfirmedBalance).toHaveBeenCalledTimes(2);
    expect(fixture.repository.prepareFundingDestination).toHaveBeenCalledWith({
      actorId: OWNER_ID,
      programId: PROGRAM_ID,
      intentId: INTENT_ID,
      quoteQuotedAt: '2026-07-29T00:00:00.000Z',
      feeAllocations: fundingRow().fee_allocations,
    });
  });

  it('fails closed without persisting the handoff when one Gateway domain is deficient', async () => {
    const fixture = serviceFixture(fundingRow(), [4_040_000n, 6_059_999n]);

    await expect(
      fixture.service.prepareFundingDestination(principal, PROGRAM_ID, INTENT_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.repository.prepareFundingDestination).not.toHaveBeenCalled();
  });

  it('rejects new source deposits after handoff before provider or repository work', async () => {
    const fixture = serviceFixture(fundingRow('ready_for_destination'));

    await expect(
      fixture.service.createSourceDeposit(principal, PROGRAM_ID, INTENT_ID, {
        network: 'Base_Sepolia',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.gatewaySubscriptions.ensureIntentRegistered).not.toHaveBeenCalled();
    expect(fixture.arc.getGatewayConfirmedBalance).not.toHaveBeenCalled();
    expect(fixture.repository.createSourceDeposit).not.toHaveBeenCalled();
  });

  it('passes overlapping source-deposit requests to the atomic repository with server-derived amounts', async () => {
    const fixture = serviceFixture(fundingRow(), [0n, 0n]);
    let repositoryCallsEntered = 0;
    let releaseFirstCall!: () => void;
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });

    fixture.repository.createSourceDeposit.mockImplementation(async () => {
      repositoryCallsEntered += 1;
      if (repositoryCallsEntered === 1) await firstCallGate;
    });

    const firstRequest = fixture.service.createSourceDeposit(principal, PROGRAM_ID, INTENT_ID, {
      network: 'Base_Sepolia',
    });
    await vi.waitFor(() => expect(repositoryCallsEntered).toBe(1));

    const secondRequest = fixture.service.createSourceDeposit(principal, PROGRAM_ID, INTENT_ID, {
      network: 'Base_Sepolia',
    });
    await vi.waitFor(() => expect(repositoryCallsEntered).toBe(2));

    releaseFirstCall();
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toHaveLength(2);

    expect(fixture.arc.getGatewayConfirmedBalance).toHaveBeenCalledTimes(2);
    expect(fixture.repository.createSourceDeposit).toHaveBeenCalledTimes(2);
    expect(fixture.repository.createSourceDeposit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        network: 'Base_Sepolia',
        amountBaseUnits: 6_060_000n,
        preGatewayBalanceBaseUnits: 0n,
      }),
    );
    expect(fixture.repository.createSourceDeposit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        network: 'Base_Sepolia',
        amountBaseUnits: 6_060_000n,
        preGatewayBalanceBaseUnits: 0n,
      }),
    );
  });

  it('rejects destination observations before handoff without crossing the wallet boundary', async () => {
    const fixture = serviceFixture(fundingRow());

    await expect(
      fixture.service.observeFunding(principal, PROGRAM_ID, INTENT_ID, {
        operationRecordId: '31000000-0000-4000-8000-000000000090',
        claimToken: CLAIM_TOKEN,
        operationId: 'premature-spend',
        providerState: 'pending',
        retryable: false,
        submissionUncertain: true,
        sourceTransactionHashes: [],
        steps: [{ name: 'buildBurnIntents', state: 'pending' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.arc.getGatewayConfirmedBalance).not.toHaveBeenCalled();
    expect(fixture.repository.observeFundingOperation).not.toHaveBeenCalled();
  });

  it('rejects browser-authored UB source bindings, including reordered or duplicate hashes', async () => {
    const row = fundingRow('ready_for_destination');
    row.funding_operations = [
      {
        operation_type: 'spend',
        provider_state: 'pending',
        retryable: true,
        submission_uncertain: true,
        steps: [],
        updated_at: '2026-07-29T00:02:00.000Z',
      },
    ];
    const fixture = serviceFixture(row);
    const baseHash = `0x${'1'.repeat(64)}` as const;
    const arcHash = `0x${'2'.repeat(64)}` as const;
    const destinationHash = `0x${'3'.repeat(64)}` as const;
    const authoritative = {
      operationRecordId: '31000000-0000-4000-8000-000000000090',
      claimToken: CLAIM_TOKEN,
      outcome: 'submitted' as const,
      destinationTransactionHash: destinationHash,
      sourceTransactionHashes: [baseHash, arcHash],
      steps: [
        {
          name: 'source_transaction',
          state: 'success' as const,
          network: 'Arc_Testnet' as const,
          transactionHash: arcHash,
        },
        {
          name: 'source_transaction',
          state: 'success' as const,
          network: 'Base_Sepolia' as const,
          transactionHash: baseHash,
        },
      ],
    };

    await expect(
      fixture.service.observeFunding(principal, PROGRAM_ID, INTENT_ID, authoritative),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      fixture.service.observeFunding(principal, PROGRAM_ID, INTENT_ID, {
        ...authoritative,
        sourceTransactionHashes: [baseHash, baseHash],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      fixture.service.observeFunding(principal, PROGRAM_ID, INTENT_ID, {
        ...authoritative,
        steps: authoritative.steps.map((step) => ({
          ...step,
          network: 'Arc_Testnet' as const,
        })),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.repository.observeFundingOperation).not.toHaveBeenCalled();
  });

  it.each([
    { routeMode: 'send' as const, sourceHashes: [] },
    {
      routeMode: 'bridge' as const,
      sourceHashes: [`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`],
    },
  ])(
    'persists valid $routeMode destination evidence without destination/source collisions',
    async ({ routeMode, sourceHashes }) => {
      const row = fundingRow();
      row.route_mode = routeMode;
      row.funding_operations = [
        {
          operation_type: routeMode,
          provider_state: 'pending',
          retryable: true,
          submission_uncertain: true,
          steps: [],
          updated_at: '2026-07-29T00:02:00.000Z',
        },
      ];
      const fixture = serviceFixture(row);
      const destinationHash = `0x${'3'.repeat(64)}` as const;

      await expect(
        fixture.service.observeFunding(principal, PROGRAM_ID, INTENT_ID, {
          operationRecordId: '31000000-0000-4000-8000-000000000092',
          claimToken: CLAIM_TOKEN,
          outcome: 'submitted',
          destinationTransactionHash: destinationHash,
          sourceTransactionHashes: sourceHashes,
          providerState: 'success',
        }),
      ).resolves.toEqual({
        id: INTENT_ID,
        fundingPhase: 'collecting_deposits',
      });

      expect(fixture.repository.observeFundingOperation).toHaveBeenCalledWith(
        OWNER_ID,
        PROGRAM_ID,
        INTENT_ID,
        expect.objectContaining({
          destinationTransactionHash: destinationHash,
          sourceTransactionHashes: sourceHashes,
        }),
      );
    },
  );
});

describe('server-derived funding recovery network', () => {
  const HASH = `0x${'c'.repeat(64)}` as const;
  const OPERATION_ID = '31000000-0000-4000-8000-000000000099';

  function recoveryFixture(
    stepNetwork:
      'Arc_Testnet' | 'Ethereum_Sepolia' | 'Arbitrum_Sepolia' | 'Base_Sepolia' = 'Base_Sepolia',
    selected = true,
  ) {
    const intentRow = fundingRow('ready_for_destination');
    if (selected && !intentRow.sources.some(({ network }) => network === stepNetwork)) {
      intentRow.sources = [
        ...intentRow.sources,
        { network: stepNetwork, amountBaseUnits: '1000000' },
      ];
    }
    const operation = {
      id: OPERATION_ID,
      operation_type: 'spend',
      transaction_hash: null,
      source_chain: null,
      steps: [
        {
          name: 'source_transaction',
          state: 'success',
          network: stepNetwork,
          transactionHash: HASH,
        },
      ],
    };
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findFundingIntentRow: vi.fn().mockResolvedValue(intentRow),
      findFundingOperation: vi.fn().mockResolvedValue(operation),
      recordFundingRecoveryPoll: vi.fn().mockResolvedValue(true),
      toFundingIntent: vi.fn().mockReturnValue({ id: INTENT_ID }),
    };
    const arc = {
      getTransactionRecoveryEvidence: vi.fn().mockResolvedValue({ state: 'pending' }),
    };
    const service = new EscrowService(
      repository as never,
      {} as never,
      arc as never,
      {} as never,
      {} as never,
    );
    return { arc, repository, service };
  }

  it.each(['Arc_Testnet', 'Ethereum_Sepolia', 'Arbitrum_Sepolia', 'Base_Sepolia'] as const)(
    'polls the %s RPC selected only by persisted source-step identity',
    async (network) => {
      const fixture = recoveryFixture(network);
      await fixture.service.checkFundingRecovery(principal, PROGRAM_ID, INTENT_ID, {
        operationId: OPERATION_ID,
        transactionHash: HASH,
      });
      expect(fixture.arc.getTransactionRecoveryEvidence).toHaveBeenCalledWith({
        network,
        transactionHash: HASH,
      });
      expect(fixture.repository.recordFundingRecoveryPoll).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'pending', transactionHash: HASH }),
      );
    },
  );

  it('rejects unknown hashes and persisted networks outside the locked source set', async () => {
    const unknown = recoveryFixture();
    await expect(
      unknown.service.checkFundingRecovery(principal, PROGRAM_ID, INTENT_ID, {
        operationId: OPERATION_ID,
        transactionHash: `0x${'d'.repeat(64)}`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(unknown.arc.getTransactionRecoveryEvidence).not.toHaveBeenCalled();

    const unselected = recoveryFixture('Arbitrum_Sepolia', false);
    await expect(
      unselected.service.checkFundingRecovery(principal, PROGRAM_ID, INTENT_ID, {
        operationId: OPERATION_ID,
        transactionHash: HASH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(unselected.arc.getTransactionRecoveryEvidence).not.toHaveBeenCalled();
  });
});

describe('CP-14 funding control-plane service wiring', () => {
  function controlFixture(row: FundingIntentRow) {
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findFundingIntentRow: vi.fn().mockResolvedValue(row),
      claimFundingDestinationAttempt: vi
        .fn()
        .mockResolvedValue('31000000-0000-4000-8000-000000000090'),
      cancelFundingIntent: vi.fn().mockResolvedValue(true),
      releaseRejectedSendAttempt: vi.fn().mockResolvedValue(true),
      createFundingDestinationReplacement: vi
        .fn()
        .mockResolvedValue('31000000-0000-4000-8000-000000000091'),
      toFundingIntent: vi.fn().mockReturnValue({ id: INTENT_ID }),
    };
    return {
      repository,
      service: new EscrowService(
        repository as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  }

  it('claims one durable destination row and cancels only through repository atomics', async () => {
    const fixture = controlFixture(fundingRow('ready_for_destination'));
    await fixture.service.claimFundingDestinationAttempt(
      principal,
      PROGRAM_ID,
      INTENT_ID,
      '31000000-0000-4000-8000-000000000092',
    );
    expect(fixture.repository.claimFundingDestinationAttempt).toHaveBeenCalledTimes(1);
    await fixture.service.cancelFundingIntent(principal, PROGRAM_ID, INTENT_ID);
    expect(fixture.repository.cancelFundingIntent).toHaveBeenCalledTimes(1);
  });

  it('allows linked destination replacement only for Send', async () => {
    const sendRow = {
      ...fundingRow('ready_for_destination'),
      route_mode: 'send' as const,
      sources: [{ network: 'Arc_Testnet' as const, amountBaseUnits: '10000000' }],
      fee_allocations: [
        {
          network: 'Arc_Testnet' as const,
          amountBaseUnits: '0',
          components: components('Arc_Testnet', '0'),
        },
      ],
    };
    const send = controlFixture(sendRow);
    await send.service.createFundingDestinationReplacement(principal, PROGRAM_ID, INTENT_ID);
    expect(send.repository.createFundingDestinationReplacement).toHaveBeenCalledTimes(1);

    const unified = controlFixture(fundingRow('ready_for_destination'));
    await expect(
      unified.service.createFundingDestinationReplacement(principal, PROGRAM_ID, INTENT_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(unified.repository.createFundingDestinationReplacement).not.toHaveBeenCalled();
  });

  it('releases explicit pre-broadcast rejection only for a Send intent', async () => {
    const sendRow = {
      ...fundingRow('ready_for_destination'),
      route_mode: 'send' as const,
    };
    const send = controlFixture(sendRow);
    await send.service.releaseRejectedSendAttempt(
      principal,
      PROGRAM_ID,
      INTENT_ID,
      '31000000-0000-4000-8000-000000000090',
      '31000000-0000-4000-8000-000000000091',
    );
    expect(send.repository.releaseRejectedSendAttempt).toHaveBeenCalledWith({
      actorId: OWNER_ID,
      programId: PROGRAM_ID,
      intentId: INTENT_ID,
      operationId: '31000000-0000-4000-8000-000000000090',
      claimToken: '31000000-0000-4000-8000-000000000091',
    });

    const unified = controlFixture(fundingRow('ready_for_destination'));
    await expect(
      unified.service.releaseRejectedSendAttempt(
        principal,
        PROGRAM_ID,
        INTENT_ID,
        '31000000-0000-4000-8000-000000000090',
        '31000000-0000-4000-8000-000000000091',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(unified.repository.releaseRejectedSendAttempt).not.toHaveBeenCalled();
  });

  it('allows truly overlapping API claims to converge on repository serialization', async () => {
    const row = fundingRow('ready_for_destination');
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let entered = 0;
    const fixture = controlFixture(row);
    fixture.repository.claimFundingDestinationAttempt.mockImplementation(async () => {
      entered += 1;
      if (entered === 1) await firstGate;
      return '31000000-0000-4000-8000-000000000090';
    });

    const first = fixture.service.claimFundingDestinationAttempt(
      principal,
      PROGRAM_ID,
      INTENT_ID,
      '31000000-0000-4000-8000-000000000092',
    );
    await vi.waitFor(() => expect(entered).toBe(1));
    const overlapping = fixture.service.claimFundingDestinationAttempt(
      principal,
      PROGRAM_ID,
      INTENT_ID,
      '31000000-0000-4000-8000-000000000092',
    );
    await vi.waitFor(() => expect(entered).toBe(2));
    releaseFirst();
    await expect(Promise.all([first, overlapping])).resolves.toHaveLength(2);
    expect(fixture.repository.claimFundingDestinationAttempt).toHaveBeenCalledTimes(2);
  });
});
