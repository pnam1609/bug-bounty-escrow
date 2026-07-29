import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

export const ARC_ACCEPTANCE_STEPS = [
  { id: 'dedicated_draft', kind: 'automatic', label: 'Validate dedicated short-deadline draft' },
  { id: 'production_preflight', kind: 'automatic', label: 'Read-only production preflight' },
  { id: 'deploy_wallet_challenge', kind: 'signature', label: 'Sign CP-10 wallet challenge' },
  { id: 'deploy_verify', kind: 'automatic', label: 'Verify custom Arc deployment' },
  { id: 'reload_after_deploy', kind: 'reload', label: 'Reload after deployment' },
  { id: 'send_wallet_signature', kind: 'signature', label: 'Sign Arc Send transaction' },
  { id: 'send_verify', kind: 'automatic', label: 'Verify Arc Send and reconciliation' },
  { id: 'reload_after_send', kind: 'reload', label: 'Reload after Arc Send' },
  { id: 'bridge_wallet_signatures', kind: 'signature', label: 'Sign Base Bridge prompts' },
  { id: 'bridge_verify', kind: 'automatic', label: 'Verify Base Bridge and Arc mint' },
  { id: 'reload_after_bridge', kind: 'reload', label: 'Reload after Base Bridge' },
  {
    id: 'ub_ethereum_deposit_signatures',
    kind: 'signature',
    label: 'Sign Ethereum Unified Balance deposit prompts',
  },
  {
    id: 'ub_ethereum_deposit_verify',
    kind: 'automatic',
    label: 'Verify Ethereum source dual proof',
  },
  {
    id: 'ub_base_deposit_signatures',
    kind: 'signature',
    label: 'Sign Base Unified Balance deposit prompts',
  },
  {
    id: 'ub_base_deposit_verify',
    kind: 'automatic',
    label: 'Verify Base source dual proof',
  },
  {
    id: 'ub_arbitrum_deposit_signatures',
    kind: 'signature',
    label: 'Sign Arbitrum Unified Balance deposit prompts',
  },
  {
    id: 'ub_arbitrum_deposit_verify',
    kind: 'automatic',
    label: 'Verify Arbitrum source dual proof',
  },
  { id: 'ub_spend_signatures', kind: 'signature', label: 'Sign Unified Balance spend prompts' },
  { id: 'ub_spend_verify', kind: 'automatic', label: 'Verify Unified Balance Arc delivery' },
  { id: 'reload_before_cp13', kind: 'reload', label: 'Reload before CP-13 evidence' },
  { id: 'cp13_artifact_verify', kind: 'automatic', label: 'Verify immutable CP-13 artifact' },
  {
    id: 'reward_approval_signature',
    kind: 'signature',
    label: 'Sign reward approval transaction',
  },
  { id: 'reward_payout_verify', kind: 'automatic', label: 'Verify payout and accounting' },
  { id: 'end_program', kind: 'operator', label: 'End the dedicated program in owner UI' },
  { id: 'end_program_verify', kind: 'automatic', label: 'Verify expired or closed product state' },
  { id: 'close_wallet_signature', kind: 'signature', label: 'Sign escrow close transaction' },
  { id: 'close_verify', kind: 'automatic', label: 'Verify EscrowClosed event' },
  { id: 'reload_after_close', kind: 'reload', label: 'Reload after escrow close' },
  { id: 'withdraw_wallet_signature', kind: 'signature', label: 'Sign remaining withdrawal' },
  { id: 'withdraw_verify', kind: 'automatic', label: 'Verify final recipient and event' },
] as const;

export type ArcAcceptanceStep = (typeof ARC_ACCEPTANCE_STEPS)[number];
export type ArcAcceptanceStepId = ArcAcceptanceStep['id'];

const uuidSchema = z.string().uuid();
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const unsignedIntegerSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const timestampSchema = z.iso.datetime({ offset: true });
const sensitiveTextPattern =
  /(?:eyJ[a-zA-Z0-9_-]{8,}\.|api[_-]?key|access[_-]?token|bearer|secret|private[_-]?key|seed[_-]?phrase|mnemonic|@[a-z0-9.-]+\.[a-z]{2,})/i;
const manualOperationReferenceSchema = z
  .string()
  .min(5)
  .max(96)
  .regex(/^[a-z][a-z0-9_-]{1,47}:(?:action|attempt):[1-9]\d{0,5}$/);
const publicIdentifierSchema = z
  .union([uuidSchema, manualOperationReferenceSchema])
  .refine((value) => !sensitiveTextPattern.test(value), 'Sensitive identifier is forbidden');
const evidenceLabelSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-z0-9_]*$/)
  .refine((value) => !sensitiveTextPattern.test(value), 'Sensitive label is forbidden');
const originSchema = z
  .string()
  .url()
  .transform((value, context) => {
    const url = new URL(value);
    if (
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname !== '/'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Origins must not contain credentials, paths, query strings, or fragments',
      });
      return z.NEVER;
    }
    return url.origin;
  });

export const publicEvidenceSchema = z
  .object({
    stepId: z.enum(ARC_ACCEPTANCE_STEPS.map(({ id }) => id)),
    recordedAt: timestampSchema,
    kind: z.enum([
      'checkpoint',
      'operation',
      'transaction',
      'event',
      'address',
      'accounting',
      'invariant',
      'preflight',
    ]),
    label: evidenceLabelSchema,
    operationId: publicIdentifierSchema.optional(),
    intentId: uuidSchema.optional(),
    depositId: uuidSchema.optional(),
    challengeId: uuidSchema.optional(),
    transactionHash: hashSchema.optional(),
    blockHash: hashSchema.optional(),
    blockNumber: unsignedIntegerSchema.optional(),
    logIndex: z.number().int().nonnegative().optional(),
    address: addressSchema.optional(),
    amountBaseUnits: unsignedIntegerSchema.optional(),
    expectedAmountBaseUnits: unsignedIntegerSchema.optional(),
    invariantPassed: z.boolean().optional(),
    checksum: hashSchema.optional(),
    capacityUsed: z.number().int().nonnegative().max(50).optional(),
    capacityLimit: z.literal(50).optional(),
    routeMode: z.enum(['send', 'bridge', 'unified_balance']).optional(),
    network: z
      .enum(['Arc_Testnet', 'Ethereum_Sepolia', 'Arbitrum_Sepolia', 'Base_Sepolia'])
      .optional(),
    productStatus: z
      .enum(['draft', 'awaiting_funding', 'active', 'paused', 'expired', 'closed'])
      .optional(),
    transferLogIndex: z.number().int().nonnegative().optional(),
    burnTransferLogIndex: z.number().int().nonnegative().optional(),
    protocolLogIndex: z.number().int().nonnegative().optional(),
    transferSpecHash: hashSchema.optional(),
    sourceDomain: z.number().int().nonnegative().max(4_294_967_295).optional(),
    sourceDepositor: hashSchema.optional(),
    sourceSigner: hashSchema.optional(),
    durableStatus: z
      .enum([
        'confirmed',
        'complete',
        'paid',
        'expired',
        'closed',
        'ready_to_withdraw',
        'withdraw_submitted',
        'verifying',
      ])
      .optional(),
  })
  .strict();

export type PublicEvidence = z.output<typeof publicEvidenceSchema>;

const diagnosticSchema = z
  .object({
    stepId: z.enum(ARC_ACCEPTANCE_STEPS.map(({ id }) => id)),
    recordedAt: timestampSchema,
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    retryable: z.boolean(),
  })
  .strict();

const stepStateSchema = z
  .object({
    status: z.enum([
      'pending',
      'running',
      'waiting_signature',
      'waiting_reload',
      'waiting_operator',
      'passed',
      'failed',
    ]),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
  })
  .strict();

export const arcAcceptanceStateSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    runId: uuidSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    apiOrigin: originSchema,
    webOrigin: originSchema,
    programId: uuidSchema,
    reportId: uuidSchema,
    currentStepIndex: z.number().int().min(0).max(ARC_ACCEPTANCE_STEPS.length),
    steps: z.record(z.enum(ARC_ACCEPTANCE_STEPS.map(({ id }) => id)), stepStateSchema),
    evidence: z.array(publicEvidenceSchema).max(256),
    diagnostics: z.array(diagnosticSchema).max(32),
  })
  .strict();

export type ArcAcceptanceState = z.output<typeof arcAcceptanceStateSchema>;

export interface VerificationResult {
  readonly evidence: readonly Omit<PublicEvidence, 'stepId' | 'recordedAt'>[];
  readonly durableFingerprint?: `0x${string}`;
}

export interface ArcAcceptanceDriver {
  verify(
    stepId: ArcAcceptanceStepId,
    state: Readonly<ArcAcceptanceState>,
  ): Promise<VerificationResult>;
}

export interface RunnerResult {
  readonly state: ArcAcceptanceState;
  readonly checkpoint?: {
    readonly kind: 'signature' | 'reload' | 'operator';
    readonly stepId: ArcAcceptanceStepId;
    readonly label: string;
    readonly resumeUrl: string;
    readonly warning: string;
  };
}

export class AcceptanceAssertionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'AcceptanceAssertionError';
  }
}

export function createArcAcceptanceState(input: {
  apiOrigin: string;
  webOrigin: string;
  programId: string;
  reportId: string;
  now?: Date;
}): ArcAcceptanceState {
  const now = (input.now ?? new Date()).toISOString();
  const steps = Object.fromEntries(
    ARC_ACCEPTANCE_STEPS.map(({ id }) => [id, { status: 'pending' as const }]),
  );
  return arcAcceptanceStateSchema.parse({
    version: 1,
    revision: 0,
    runId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    apiOrigin: input.apiOrigin,
    webOrigin: input.webOrigin,
    programId: input.programId,
    reportId: input.reportId,
    currentStepIndex: 0,
    steps,
    evidence: [],
    diagnostics: [],
  });
}

export class ArcAcceptanceRunner {
  public constructor(
    private state: ArcAcceptanceState,
    private readonly driver: ArcAcceptanceDriver,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = arcAcceptanceStateSchema.parse(state);
  }

  public snapshot(): ArcAcceptanceState {
    return structuredClone(this.state);
  }

  public async advance(): Promise<RunnerResult> {
    const step = ARC_ACCEPTANCE_STEPS[this.state.currentStepIndex];
    if (step === undefined) return { state: this.snapshot() };
    const current = this.state.steps[step.id];
    if (current.status === 'passed') {
      this.state.currentStepIndex += 1;
      return this.advance();
    }
    if (current.status === 'failed') {
      throw new AcceptanceAssertionError(
        'failed_step_requires_retry',
        'The current failed assertion must be explicitly retried.',
      );
    }
    if (step.kind !== 'automatic') {
      const status =
        step.kind === 'signature'
          ? 'waiting_signature'
          : step.kind === 'reload'
            ? 'waiting_reload'
            : 'waiting_operator';
      this.setStep(step.id, {
        status,
        startedAt: current.startedAt ?? this.timestamp(),
      });
      if (step.kind === 'reload') {
        const sourceStep = reloadSourceStep(step.id);
        const existing = this.state.evidence.some(
          ({ stepId, label }) => stepId === step.id && label === 'pre_reload_durable_fingerprint',
        );
        if (!existing) {
          this.appendEvidence({
            stepId: step.id,
            recordedAt: this.timestamp(),
            kind: 'checkpoint',
            label: 'pre_reload_durable_fingerprint',
            blockHash: fingerprintPublicEvidence(
              this.state.evidence.filter(({ stepId }) => stepId === sourceStep),
            ),
          });
        }
      }
      return {
        state: this.snapshot(),
        checkpoint: {
          kind: step.kind,
          stepId: step.id,
          label: step.label,
          resumeUrl: new URL(
            `/owner/programs/${this.state.programId}/edit`,
            this.state.webOrigin,
          ).toString(),
          warning:
            step.kind === 'signature'
              ? 'Complete this browser-wallet prompt manually. Never paste a signature, private key, or seed phrase into the runner.'
              : step.kind === 'reload'
                ? 'Reload the owner page, verify that durable state hydrates, then acknowledge this checkpoint.'
                : 'Complete this owner action in the browser, then acknowledge it. The runner never performs this mutation.',
        },
      };
    }

    this.setStep(step.id, {
      status: 'running',
      startedAt: current.startedAt ?? this.timestamp(),
    });
    try {
      const result = await this.driver.verify(step.id, this.snapshot());
      for (const evidence of result.evidence) {
        this.appendEvidence({ ...evidence, stepId: step.id, recordedAt: this.timestamp() });
      }
      this.setStep(step.id, {
        status: 'passed',
        startedAt: this.state.steps[step.id].startedAt,
        completedAt: this.timestamp(),
      });
      this.state.currentStepIndex += 1;
      this.touch();
      return { state: this.snapshot() };
    } catch (error) {
      const assertion =
        error instanceof AcceptanceAssertionError
          ? error
          : new AcceptanceAssertionError(
              'acceptance_check_failed',
              'Automatic acceptance check failed.',
            );
      this.setStep(step.id, {
        status: 'failed',
        startedAt: this.state.steps[step.id].startedAt,
      });
      this.state.diagnostics = [
        ...this.state.diagnostics.slice(-31),
        {
          stepId: step.id,
          recordedAt: this.timestamp(),
          code: assertion.code,
          retryable: assertion.retryable,
        },
      ];
      this.touch();
      return { state: this.snapshot() };
    }
  }

  public recordSignatureEvidence(
    input: Omit<PublicEvidence, 'stepId' | 'recordedAt' | 'kind'>,
  ): ArcAcceptanceState {
    const step = this.requireCurrentKind('signature');
    if (this.state.steps[step.id].status !== 'waiting_signature') {
      throw new AcceptanceAssertionError(
        'signature_checkpoint_not_active',
        'Advance to the signature checkpoint before recording public evidence.',
        false,
      );
    }
    const candidate = publicEvidenceSchema.parse({
      ...input,
      kind: input.transactionHash === undefined ? 'operation' : 'transaction',
      stepId: step.id,
      recordedAt: this.timestamp(),
    });
    const duplicate = this.state.evidence.find(
      (item) =>
        item.stepId === step.id &&
        ((candidate.transactionHash !== undefined &&
          item.transactionHash === candidate.transactionHash) ||
          (candidate.operationId !== undefined && item.operationId === candidate.operationId)),
    );
    if (duplicate !== undefined) {
      if (fingerprintPublicEvidence([duplicate]) !== fingerprintPublicEvidence([candidate])) {
        throw new AcceptanceAssertionError(
          'known_operation_evidence_conflict',
          'A durable operation already has different public evidence. Verify it; never blind-retry.',
          false,
        );
      }
      return this.snapshot();
    }
    this.appendEvidence(candidate);
    return this.snapshot();
  }

  public completeSignatureBoundary(): ArcAcceptanceState {
    const step = this.requireCurrentKind('signature');
    if (
      !this.state.evidence.some(
        (evidence) => evidence.stepId === step.id && signatureEvidenceIsDurable(step.id, evidence),
      )
    ) {
      throw new AcceptanceAssertionError(
        'signature_evidence_required',
        'Record the required durable public intent, operation or transaction evidence before continuing.',
        false,
      );
    }
    this.passManualStep(step.id);
    return this.snapshot();
  }

  public async acknowledgeReload(): Promise<ArcAcceptanceState> {
    const step = this.requireCurrentKind('reload');
    const expected = this.state.evidence.find(
      ({ stepId, label }) => stepId === step.id && label === 'pre_reload_durable_fingerprint',
    )?.blockHash;
    if (expected === undefined) {
      throw new AcceptanceAssertionError(
        'pre_reload_fingerprint_missing',
        'Advance into the reload checkpoint before acknowledging it.',
        false,
      );
    }
    try {
      const verification = await this.driver.verify(step.id, this.snapshot());
      if (verification.durableFingerprint !== expected) {
        throw new AcceptanceAssertionError(
          'reload_projection_mismatch',
          'The reloaded durable projection differs from the pre-reload operation evidence.',
        );
      }
      for (const evidence of verification.evidence) {
        this.appendEvidence({ ...evidence, stepId: step.id, recordedAt: this.timestamp() });
      }
      this.appendEvidence({
        stepId: step.id,
        recordedAt: this.timestamp(),
        kind: 'checkpoint',
        label: 'owner_page_reloaded_and_hydrated',
        invariantPassed: true,
        blockHash: verification.durableFingerprint,
      });
      this.passManualStep(step.id);
    } catch (error) {
      const assertion =
        error instanceof AcceptanceAssertionError
          ? error
          : new AcceptanceAssertionError(
              'reload_verification_failed',
              'Reload verification failed.',
            );
      this.setStep(step.id, {
        status: 'failed',
        startedAt: this.state.steps[step.id].startedAt,
      });
      this.state.diagnostics = [
        ...this.state.diagnostics.slice(-31),
        {
          stepId: step.id,
          recordedAt: this.timestamp(),
          code: assertion.code,
          retryable: assertion.retryable,
        },
      ];
      this.touch();
    }
    return this.snapshot();
  }

  public acknowledgeOperatorAction(operationId?: string): ArcAcceptanceState {
    const step = this.requireCurrentKind('operator');
    this.appendEvidence({
      stepId: step.id,
      recordedAt: this.timestamp(),
      kind: 'checkpoint',
      label: 'operator_action_completed',
      invariantPassed: true,
      ...(operationId === undefined ? {} : { operationId }),
    });
    this.passManualStep(step.id);
    return this.snapshot();
  }

  public retryFailedAssertion(): ArcAcceptanceState {
    const step = ARC_ACCEPTANCE_STEPS[this.state.currentStepIndex];
    if (step === undefined || this.state.steps[step.id].status !== 'failed') {
      throw new AcceptanceAssertionError(
        'failed_step_not_found',
        'There is no failed assertion at the current checkpoint.',
        false,
      );
    }
    this.setStep(step.id, {
      status: 'pending',
      startedAt: this.state.steps[step.id].startedAt,
    });
    return this.snapshot();
  }

  private requireCurrentKind<TKind extends ArcAcceptanceStep['kind']>(
    kind: TKind,
  ): Extract<ArcAcceptanceStep, { kind: TKind }> {
    const step = ARC_ACCEPTANCE_STEPS[this.state.currentStepIndex];
    if (step === undefined || step.kind !== kind) {
      throw new AcceptanceAssertionError(
        'checkpoint_kind_mismatch',
        `The current checkpoint is not ${kind}.`,
        false,
      );
    }
    return step as Extract<ArcAcceptanceStep, { kind: TKind }>;
  }

  private passManualStep(stepId: ArcAcceptanceStepId): void {
    const current = this.state.steps[stepId];
    this.setStep(stepId, {
      status: 'passed',
      startedAt: current.startedAt ?? this.timestamp(),
      completedAt: this.timestamp(),
    });
    this.state.currentStepIndex += 1;
    this.touch();
  }

  private appendEvidence(evidence: PublicEvidence): void {
    const parsed = publicEvidenceSchema.parse(evidence);
    if (this.state.evidence.length >= 256) {
      throw new AcceptanceAssertionError(
        'evidence_capacity_exceeded',
        'The bounded evidence capacity was reached; export before continuing.',
        false,
      );
    }
    this.state.evidence = [...this.state.evidence, parsed];
    this.touch();
  }

  private setStep(stepId: ArcAcceptanceStepId, value: z.output<typeof stepStateSchema>): void {
    this.state.steps = { ...this.state.steps, [stepId]: stepStateSchema.parse(value) };
    this.touch();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private touch(): void {
    this.state.revision += 1;
    this.state.updatedAt = this.timestamp();
    this.state = arcAcceptanceStateSchema.parse(this.state);
  }
}

export async function loadArcAcceptanceState(path: string): Promise<ArcAcceptanceState> {
  return arcAcceptanceStateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function saveArcAcceptanceState(
  path: string,
  state: ArcAcceptanceState,
  options: {
    readonly expectedRevision?: number;
    readonly createOnly?: boolean;
  } = {},
): Promise<void> {
  const parsed = arcAcceptanceStateSchema.parse(state);
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch {
      throw new AcceptanceAssertionError(
        'state_write_locked',
        'Another runner process is saving this state file.',
      );
    }
    let current: ArcAcceptanceState | undefined;
    try {
      current = await loadArcAcceptanceState(path);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
    if (options.createOnly === true && current !== undefined) {
      throw new AcceptanceAssertionError(
        'state_file_exists',
        'The state file already exists; resume it or choose a new path.',
        false,
      );
    }
    if (options.expectedRevision !== undefined && current?.revision !== options.expectedRevision) {
      throw new AcceptanceAssertionError(
        'state_write_conflict',
        'The durable state changed in another runner process; reload before continuing.',
        false,
      );
    }
    if (current !== undefined && current.runId !== parsed.runId) {
      throw new AcceptanceAssertionError(
        'state_run_mismatch',
        'Refusing to overwrite a state file owned by another acceptance run.',
        false,
      );
    }
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, path);
  } finally {
    await lock?.close();
    if (lock !== undefined) await unlink(lockPath).catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

const publicAddressEvidenceSteps = {
  verified_escrow_address: new Set(['deploy_verify', 'reload_after_deploy']),
  remaining_funds_withdrawn: new Set(['withdraw_verify']),
} as const;
function isAllowlistedPublicAddressEvidence(
  evidence: Pick<PublicEvidence, 'label' | 'stepId'>,
): boolean {
  const steps =
    publicAddressEvidenceSteps[evidence.label as keyof typeof publicAddressEvidenceSteps];
  return steps?.has(evidence.stepId) === true;
}
const redactedPublicEvidenceSchema = publicEvidenceSchema.superRefine((evidence, context) => {
  if (evidence.address !== undefined && !isAllowlistedPublicAddressEvidence(evidence)) {
    context.addIssue({
      code: 'custom',
      path: ['address'],
      message: 'Only explicitly allowlisted public addresses may be exported',
    });
  }
});

export const redactedEvidenceExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: uuidSchema,
    programId: uuidSchema,
    reportReference: hashSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    completed: z.boolean(),
    steps: z.array(
      z
        .object({
          id: z.enum(ARC_ACCEPTANCE_STEPS.map(({ id }) => id)),
          label: z.string().min(1).max(96),
          status: stepStateSchema.shape.status,
          completedAt: timestampSchema.optional(),
        })
        .strict(),
    ),
    evidence: z.array(redactedPublicEvidenceSchema).max(256),
    diagnostics: z.array(diagnosticSchema).max(32),
  })
  .strict();

export type RedactedEvidenceExport = z.output<typeof redactedEvidenceExportSchema>;

export function exportRedactedEvidence(state: ArcAcceptanceState): RedactedEvidenceExport {
  const parsed = arcAcceptanceStateSchema.parse(state);
  return redactedEvidenceExportSchema.parse({
    schemaVersion: 1,
    runId: parsed.runId,
    programId: parsed.programId,
    reportReference: `0x${createHash('sha256')
      .update(`${parsed.runId}:${parsed.reportId}`)
      .digest('hex')}`,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    completed: parsed.currentStepIndex === ARC_ACCEPTANCE_STEPS.length,
    steps: ARC_ACCEPTANCE_STEPS.map(({ id, label }) => ({
      id,
      label,
      status: parsed.steps[id].status,
      ...(parsed.steps[id].completedAt === undefined
        ? {}
        : { completedAt: parsed.steps[id].completedAt }),
    })),
    evidence: parsed.evidence.map(({ address, ...evidence }) =>
      address !== undefined && isAllowlistedPublicAddressEvidence(evidence)
        ? { ...evidence, address }
        : evidence,
    ),
    diagnostics: parsed.diagnostics,
  });
}

export function fingerprintPublicEvidence(
  evidence: readonly (PublicEvidence | Omit<PublicEvidence, 'stepId' | 'recordedAt'>)[],
): `0x${string}` {
  const normalized = evidence.map((item) =>
    Object.fromEntries(
      Object.entries(item)
        .filter(([key]) => key !== 'stepId' && key !== 'recordedAt')
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  return `0x${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

function reloadSourceStep(stepId: ArcAcceptanceStepId): ArcAcceptanceStepId {
  const source = {
    reload_after_deploy: 'deploy_verify',
    reload_after_send: 'send_verify',
    reload_after_bridge: 'bridge_verify',
    reload_before_cp13: 'ub_spend_verify',
    reload_after_close: 'close_verify',
  } as const;
  const selected = source[stepId as keyof typeof source];
  if (selected === undefined) {
    throw new AcceptanceAssertionError(
      'reload_source_step_missing',
      'The reload checkpoint has no durable source projection.',
      false,
    );
  }
  return selected;
}

function signatureEvidenceIsDurable(
  stepId: Extract<ArcAcceptanceStep, { kind: 'signature' }>['id'],
  evidence: PublicEvidence,
): boolean {
  const knownOperation =
    evidence.transactionHash !== undefined || evidence.operationId !== undefined;
  switch (stepId) {
    case 'deploy_wallet_challenge':
      return evidence.challengeId !== undefined && evidence.address !== undefined;
    case 'ub_ethereum_deposit_signatures':
    case 'ub_base_deposit_signatures':
    case 'ub_arbitrum_deposit_signatures':
      return evidence.intentId !== undefined && evidence.depositId !== undefined && knownOperation;
    case 'send_wallet_signature':
    case 'bridge_wallet_signatures':
    case 'ub_spend_signatures':
    case 'reward_approval_signature':
    case 'close_wallet_signature':
    case 'withdraw_wallet_signature':
      return evidence.intentId !== undefined && knownOperation;
  }
}
