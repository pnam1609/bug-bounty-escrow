import {
  approveRewardRequestSchema,
  commentListResponseSchema,
  createCommentResponseSchema,
  createProgramRequestSchema,
  createReportRequestSchema,
  currentUserResponseSchema,
  onboardingRequestSchema,
  programListResponseSchema,
  programResponseSchema,
  publicDisclosureListResponseSchema,
  reportListResponseSchema,
  reportResponseSchema,
  signedDownloadResponseSchema,
  signedUploadResponseSchema,
  updateProfileRequestSchema,
  type ApplicationRole,
  type Program,
  type ProgramSummary,
  type ReportDetail,
  type ReportStatus,
  type ReportSummary,
  type Severity,
} from '@bug-bounty-escrow/shared';
import { test as base, expect, type Browser, type Page, type Route } from '@playwright/test';
import type { ZodType } from 'zod';

/*
 * Mock API for the browser journeys.
 *
 * Two rules keep these fixtures useful rather than decorative:
 *
 *  1. Every response is parsed with the real contract schema from `@bug-bounty-escrow/shared`
 *     before it is served, and every request body is parsed with the real request schema. A
 *     contract change that the web app has not caught up with therefore fails a test instead of
 *     passing silently against a hand-rolled shape.
 *  2. `GET /api/programs` applies the same public-only projection the server does — a program with
 *     no `publicStatus` is never returned. Owner-visible rows live behind `GET /api/owner/programs`.
 *     Pointing the public browse page at the owner endpoint would break QA-E2E-001.
 */

const API_ORIGIN = 'http://127.0.0.1:3001';
const UPLOAD_ORIGIN = 'https://uploads.example.test';
const SUPABASE_ORIGIN = 'https://example.supabase.co';

export type Role = 'anonymous' | 'owner' | 'researcher' | 'reviewer';

export const IDS = {
  owner: '40000000-0000-4000-8000-000000000001',
  researcher: '40000000-0000-4000-8000-000000000002',
  reviewer: '40000000-0000-4000-8000-000000000003',
  newcomer: '40000000-0000-4000-8000-000000000004',

  aegis: '41000000-0000-4000-8000-000000000001',
  lumen: '41000000-0000-4000-8000-000000000002',
  orbit: '41000000-0000-4000-8000-000000000003',
  vaultDraft: '41000000-0000-4000-8000-000000000004',
  paused: '41000000-0000-4000-8000-000000000005',
  createdProgram: '41000000-0000-4000-8000-000000000009',

  aegisScope: '42000000-0000-4000-8000-000000000001',
  lumenScope: '42000000-0000-4000-8000-000000000002',
  aegisImpactCritical: '42500000-0000-4000-8000-000000000001',
  aegisImpactHigh: '42500000-0000-4000-8000-000000000002',

  report: '43000000-0000-4000-8000-000000000001',
  duplicateTarget: '43000000-0000-4000-8000-000000000002',
  attachment: '44000000-0000-4000-8000-000000000001',
  comment: '45000000-0000-4000-8000-000000000001',
} as const;

// --------------------------------------------------------------------------------- program data

interface SummarySeed {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly shortSummary: string;
  readonly status: ProgramSummary['status'];
  readonly publicStatus: ProgramSummary['publicStatus'];
  readonly tags: readonly string[];
  readonly totalPool: string;
  readonly remainingPool: string;
  readonly totalPaid: string | null;
  readonly maxBounty: string;
  readonly inScopeAssetTypes: ProgramSummary['inScopeAssetTypes'];
  readonly rewardSeverities: readonly Severity[];
  readonly deadline?: string;
}

function summary(seed: SummarySeed): ProgramSummary {
  return programSummarySchemaParse({
    id: seed.id,
    name: seed.name,
    slug: seed.slug,
    shortSummary: seed.shortSummary,
    status: seed.status,
    publicStatus: seed.publicStatus,
    tags: [...seed.tags],
    totalPool: seed.totalPool,
    reservedPool: '0',
    remainingPool: seed.remainingPool,
    totalPaid: seed.totalPaid,
    totalPaidVisibility: seed.totalPaid === null ? 'private' : 'public',
    paidReportCount: seed.totalPaid === null ? null : 3,
    maxBounty: seed.maxBounty,
    inScopeAssetTypes: [...seed.inScopeAssetTypes],
    rewardSeverities: [...seed.rewardSeverities],
    ...(seed.deadline === undefined ? {} : { deadline: seed.deadline }),
    publishedAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
}

/** Parsed eagerly at module load so a contract drift breaks the suite immediately. */
function programSummarySchemaParse(value: unknown): ProgramSummary {
  return programListResponseSchema.parse({
    success: true,
    data: [value],
    metadata: page(1, 12, 1),
  }).data[0] as ProgramSummary;
}

function page(pageNumber: number, limit: number, totalItems: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  return {
    page: pageNumber,
    limit,
    totalItems,
    totalPages,
    hasNextPage: pageNumber < totalPages,
    hasPreviousPage: pageNumber > 1,
  };
}

const AEGIS_SUMMARY = summary({
  id: IDS.aegis,
  name: 'Aegis Protocol',
  slug: 'aegis-protocol',
  shortSummary: 'Lending vaults and the staking core on Arc.',
  status: 'active',
  publicStatus: 'active',
  tags: ['DeFi', 'Solidity'],
  totalPool: '500000',
  remainingPool: '250000',
  totalPaid: '250000',
  maxBounty: '50000',
  inScopeAssetTypes: ['smart_contract'],
  rewardSeverities: ['critical', 'high'],
  deadline: '2027-03-12T23:59:59.000Z',
});

/** `totalPaid: null` is the owner keeping the figure private; the table must render "Private". */
const LUMEN_SUMMARY = summary({
  id: IDS.lumen,
  name: 'Lumen Exchange',
  slug: 'lumen-exchange',
  shortSummary: 'Public trading surfaces and the account dashboard.',
  status: 'active',
  publicStatus: 'active',
  tags: ['Web'],
  totalPool: '80000',
  remainingPool: '80000',
  totalPaid: null,
  maxBounty: '10000',
  inScopeAssetTypes: ['website'],
  rewardSeverities: ['critical', 'medium'],
});

const ORBIT_SUMMARY = summary({
  id: IDS.orbit,
  name: 'Orbit Bridge',
  slug: 'orbit-bridge',
  shortSummary: 'A retired cross-chain bridge kept for disclosure history.',
  status: 'expired',
  publicStatus: 'ended',
  tags: ['Bridge'],
  totalPool: '20000',
  remainingPool: '0',
  totalPaid: '20000',
  maxBounty: '5000',
  inScopeAssetTypes: ['smart_contract'],
  rewardSeverities: ['high'],
  deadline: '2026-01-31T23:59:59.000Z',
});

/** No public representation at all. Must never reach the public listing. */
const VAULT_DRAFT_SUMMARY = summary({
  id: IDS.vaultDraft,
  name: 'Vault Rebuild Draft',
  slug: 'vault-rebuild-draft',
  shortSummary: 'An unfinished draft that no researcher may discover.',
  status: 'draft',
  publicStatus: null,
  tags: ['DeFi'],
  totalPool: '0',
  remainingPool: '0',
  totalPaid: null,
  maxBounty: '1000',
  inScopeAssetTypes: ['smart_contract'],
  rewardSeverities: ['critical'],
});

const PAUSED_SUMMARY = summary({
  id: IDS.paused,
  name: 'Halcyon Wallet Paused',
  slug: 'halcyon-wallet-paused',
  shortSummary: 'Temporarily paused while the team triages a backlog.',
  status: 'paused',
  publicStatus: null,
  tags: ['Web'],
  totalPool: '30000',
  remainingPool: '30000',
  totalPaid: '0',
  maxBounty: '9000',
  inScopeAssetTypes: ['website'],
  rewardSeverities: ['high'],
});

const CATALOG: readonly ProgramSummary[] = [
  AEGIS_SUMMARY,
  LUMEN_SUMMARY,
  ORBIT_SUMMARY,
  VAULT_DRAFT_SUMMARY,
  PAUSED_SUMMARY,
];

/** Names a public visitor must never see, used as the negative assertion in QA-E2E-001. */
export const PRIVATE_PROGRAM_NAMES = [VAULT_DRAFT_SUMMARY.name, PAUSED_SUMMARY.name] as const;

function detail(base_: ProgramSummary, extra: Partial<Program> = {}): Program {
  return programResponseSchema.parse({
    success: true,
    data: {
      ...base_,
      ownerId: IDS.owner,
      description: `${base_.shortSummary} Full program overview for the browser journeys.`,
      websiteUrl: `https://${base_.slug}.example.test`,
      createdAt: '2026-04-01T00:00:00.000Z',
      scopes: [],
      impacts: [],
      rewardTiers: [],
      resources: [],
      metrics: { totalAssetsInScope: 1, medianResolutionSeconds: null },
      rules: {
        pocPolicy: 'required',
        rewardPolicy: 'Rewards follow the published tiers for the affected asset type.',
        allowCustomImpact: true,
        prohibitedActivities: [
          {
            id: '46000000-0000-4000-8000-000000000001',
            source: 'platform_default',
            ruleKey: 'no_denial_of_service',
            body: 'No denial of service, resource exhaustion or availability testing of any kind.',
            sortOrder: 0,
          },
        ],
      },
      ...extra,
    },
  }).data;
}

const AEGIS = detail(AEGIS_SUMMARY, {
  scopes: [
    {
      id: IDS.aegisScope,
      assetType: 'smart_contract',
      assetName: 'Aegis Core Contract',
      contractAddress: '0xA41E1B0F7C4D5E6A7B8C9D0E1F2A3B4C5D6E7F80',
      isInScope: true,
      description: 'Primary protocol contracts deployed on Arc.',
      sortOrder: 0,
      archived: false,
    },
  ],
  impacts: [
    {
      id: IDS.aegisImpactCritical,
      assetType: 'smart_contract',
      severity: 'critical',
      title: 'Direct theft of user funds',
      description: 'Any unauthorised transfer of principal out of the vaults.',
      source: 'template',
      templateKey: 'direct_theft_of_user_funds',
      enabled: true,
      sortOrder: 0,
    },
    {
      id: IDS.aegisImpactHigh,
      assetType: 'smart_contract',
      severity: 'high',
      title: 'Temporary freezing of funds',
      source: 'template',
      templateKey: 'temporary_freezing_of_funds',
      enabled: true,
      sortOrder: 1,
    },
  ],
  rewardTiers: [
    {
      assetType: 'smart_contract',
      severity: 'critical',
      calculationType: 'range',
      minReward: '10000',
      maxReward: '50000',
    },
  ],
});

const LUMEN = detail(LUMEN_SUMMARY, {
  scopes: [
    {
      id: IDS.lumenScope,
      assetType: 'website',
      assetName: 'Lumen Web App',
      assetUrl: 'https://app.lumen.example.test',
      isInScope: true,
      sortOrder: 0,
      archived: false,
    },
  ],
});

const DETAILS: Readonly<Record<string, Program>> = {
  [IDS.aegis]: AEGIS,
  [IDS.lumen]: LUMEN,
  [IDS.orbit]: detail(ORBIT_SUMMARY),
  [IDS.vaultDraft]: detail(VAULT_DRAFT_SUMMARY),
  [IDS.paused]: detail(PAUSED_SUMMARY),
};

// ------------------------------------------------------------------------------ mutable state

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface MockApi {
  /** Every intercepted API call, in order. */
  readonly requests: readonly RecordedRequest[];
  /** Calls matching `method` whose path ends with `pathSuffix`. */
  calls(method: string, pathSuffix: string): readonly RecordedRequest[];
  /** Body of the last matching call, or `undefined` when it was never made. */
  lastBody(method: string, pathSuffix: string): unknown;
  /** Query string of the last matching call. */
  lastQuery(method: string, pathSuffix: string): URLSearchParams | undefined;
  /** Makes the next signed attachment PUT fail, as a storage outage would. */
  failAttachmentUpload(failing?: boolean): void;
  /** Seeds the report state machine before a review journey. */
  setReportStatus(status: ReportStatus, options?: { readonly finalSeverity?: Severity }): void;
  /** Controls the profile `GET /api/me` returns, and the identity the Supabase mock hands out. */
  setProfile(profile: {
    readonly role: ApplicationRole;
    readonly displayName: string;
    readonly onboardingComplete: boolean;
    readonly id?: string;
    readonly email?: string;
  }): void;
}

interface Profile {
  id: string;
  email: string;
  role: ApplicationRole;
  displayName: string;
  onboardingComplete: boolean;
}

interface MockState {
  readonly recorded: RecordedRequest[];
  readonly violations: string[];
  readonly comments: {
    id: string;
    authorId: string;
    body: string;
    deleted: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  profile: Profile;
  reportStatus: ReportStatus;
  finalSeverity: Severity | undefined;
  approvedReward: string | undefined;
  reportTitle: string;
  uploadFails: boolean;
}

function profileFor(role: ApplicationRole): Profile {
  return {
    id: IDS[role],
    email: `${role}@local.demo`,
    role,
    displayName: `Demo ${role}`,
    onboardingComplete: true,
  };
}

function createState(): MockState {
  return {
    recorded: [],
    violations: [],
    comments: [
      {
        id: IDS.comment,
        authorId: IDS.researcher,
        body: 'Initial synthetic comment',
        deleted: false,
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      },
    ],
    profile: profileFor('researcher'),
    reportStatus: 'submitted',
    finalSeverity: undefined,
    approvedReward: undefined,
    reportTitle: 'Re-entrancy can drain the staking pool',
    uploadFails: false,
  };
}

// ------------------------------------------------------------------------------- report shapes

function reportDetail(state: MockState): ReportDetail {
  return reportResponseSchema.parse({
    success: true,
    data: {
      id: IDS.report,
      programId: IDS.aegis,
      programName: AEGIS.name,
      programSlug: AEGIS.slug,
      researcherId: IDS.researcher,
      affectedScopeId: IDS.aegisScope,
      title: state.reportTitle,
      proposedSeverity: 'critical',
      ...(state.finalSeverity === undefined ? {} : { finalSeverity: state.finalSeverity }),
      status: state.reportStatus,
      ...(state.approvedReward === undefined ? {} : { approvedReward: state.approvedReward }),
      submittedAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      description: 'The vault withdraw path re-enters before the balance is written back.',
      reproductionSteps: '1. Deposit\n2. Call withdraw from a malicious receiver\n3. Observe',
      severityMismatchAcknowledged: false,
      impacts: [
        {
          id: '47000000-0000-4000-8000-000000000001',
          source: 'program',
          programImpactId: IDS.aegisImpactCritical,
          title: 'Direct theft of user funds',
          severity: 'critical',
          assetType: 'smart_contract',
        },
      ],
      attachments: [
        {
          id: IDS.attachment,
          filename: 'proof.txt',
          mimeType: 'text/plain',
          sizeBytes: 12,
          createdAt: '2026-07-25T00:00:00.000Z',
        },
      ],
      contentHash: `0x${'a'.repeat(64)}`,
      createdAt: '2026-07-25T00:00:00.000Z',
    },
  }).data;
}

function reportSummary(state: MockState): ReportSummary {
  const full = reportDetail(state);
  return {
    id: full.id,
    programId: full.programId,
    programName: full.programName,
    programSlug: full.programSlug,
    researcherId: full.researcherId,
    affectedScopeId: full.affectedScopeId,
    title: full.title,
    proposedSeverity: full.proposedSeverity,
    ...(full.finalSeverity === undefined ? {} : { finalSeverity: full.finalSeverity }),
    status: full.status,
    ...(full.approvedReward === undefined ? {} : { approvedReward: full.approvedReward }),
    ...(full.submittedAt === undefined ? {} : { submittedAt: full.submittedAt }),
    updatedAt: full.updatedAt,
  };
}

// -------------------------------------------------------------------------- listing projection

function commaList(value: string | null): readonly string[] {
  if (value === null || value.trim() === '') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * Mirrors `GET /api/programs`: public rows only, then the documented filters and sort. Keeping the
 * filter honest is what makes the URL round-trip in QA-E2E-002 mean anything — the visible rows
 * change because the query changed, not because the component re-rendered.
 */
function publicPrograms(query: URLSearchParams): readonly ProgramSummary[] {
  let rows = CATALOG.filter((program) => program.publicStatus !== null);

  const search = query.get('search');
  if (search !== null && search.trim() !== '') {
    const needle = search.trim().toLowerCase();
    rows = rows.filter(
      (program) =>
        program.name.toLowerCase().includes(needle) ||
        program.shortSummary.toLowerCase().includes(needle),
    );
  }

  const statuses = commaList(query.get('status'));
  if (statuses.length > 0) {
    rows = rows.filter(
      (program) => program.publicStatus !== null && statuses.includes(program.publicStatus),
    );
  }

  const assetTypes = commaList(query.get('assetType'));
  if (assetTypes.length > 0) {
    rows = rows.filter((program) =>
      program.inScopeAssetTypes.some((assetType) => assetTypes.includes(assetType)),
    );
  }

  const severities = commaList(query.get('severity'));
  if (severities.length > 0) {
    rows = rows.filter((program) =>
      program.rewardSeverities.some((severity) => severities.includes(severity)),
    );
  }

  const minMaxReward = query.get('minMaxReward');
  if (minMaxReward !== null && minMaxReward !== '') {
    rows = rows.filter((program) => Number(program.maxBounty) >= Number(minMaxReward));
  }

  if (query.get('funded') === 'true') {
    rows = rows.filter((program) => Number(program.remainingPool) > 0);
  }

  const closing = query.get('closing');
  if (closing === 'ongoing') {
    rows = rows.filter((program) => program.deadline === undefined);
  } else if (closing === '7d' || closing === '30d') {
    rows = rows.filter((program) => program.deadline !== undefined);
  }

  const direction = query.get('sortDirection') === 'desc' ? -1 : 1;
  const sort = query.get('sort') ?? 'newest';
  const sorted = [...rows];

  if (sort === 'name') {
    sorted.sort((left, right) => direction * left.name.localeCompare(right.name));
  } else if (sort === 'maxBounty') {
    sorted.sort((left, right) => direction * (Number(left.maxBounty) - Number(right.maxBounty)));
  } else if (sort === 'totalPaid') {
    sorted.sort(
      (left, right) => direction * (Number(left.totalPaid ?? 0) - Number(right.totalPaid ?? 0)),
    );
  } else if (sort === 'deadline') {
    sorted.sort(
      (left, right) =>
        direction * ((left.deadline ?? '9999').localeCompare(right.deadline ?? '9999')),
    );
  } else {
    // `newest`: active programs first, exactly as the contract documents.
    sorted.sort((left, right) => Number(right.publicStatus === 'active') - Number(left.publicStatus === 'active'));
  }

  return sorted;
}

function ownerPrograms(query: URLSearchParams): readonly ProgramSummary[] {
  const status = query.get('status');
  const rows = status === null ? CATALOG : CATALOG.filter((program) => program.status === status);
  const search = query.get('search');
  if (search === null || search.trim() === '') return rows;
  const needle = search.trim().toLowerCase();
  return rows.filter((program) => program.name.toLowerCase().includes(needle));
}

// ------------------------------------------------------------------------------- route helpers

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
} as const;

async function serve<T>(
  state: MockState,
  route: Route,
  schema: ZodType<T>,
  payload: unknown,
  label: string,
): Promise<void> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    state.violations.push(`${label} response does not satisfy its contract: ${parsed.error.message}`);
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { ...CORS },
    body: JSON.stringify(payload),
  });
}

async function fail(route: Route, status: number, code: string, message: string): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { ...CORS },
    body: JSON.stringify({ success: false, error: { code, message } }),
  });
}

/** Validates a request body against its contract and records a violation when it drifts. */
function checkRequest(state: MockState, schema: ZodType, body: unknown, label: string): void {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    state.violations.push(`${label} request does not satisfy its contract: ${parsed.error.message}`);
  }
}

function readBody(route: Route): unknown {
  try {
    return route.request().postDataJSON();
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------------------------ supabase session

function session(profile: Profile) {
  return {
    access_token: `${profile.role}-access-token`,
    refresh_token: `${profile.role}-refresh-token`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: profile.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: profile.email,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-07-25T00:00:00.000Z',
    },
  };
}

// ------------------------------------------------------------------------------------- routing

async function configurePage(page_: Page, role: Role, state: MockState): Promise<void> {
  if (role !== 'anonymous') {
    await page_.addInitScript(
      ({ value }) => window.localStorage.setItem('sb-example-auth-token', JSON.stringify(value)),
      { value: session(state.profile) },
    );
  }

  await page_.route(`${SUPABASE_ORIGIN}/auth/v1/**`, async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...CORS }, body: '' });
    }
    if (url.includes('/logout')) {
      return route.fulfill({ status: 204, headers: { ...CORS }, body: '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...CORS },
      body: JSON.stringify(session(state.profile)),
    });
  });

  // The signed storage PUT is deliberately not an API route, so it gets its own handler.
  await page_.route(`${UPLOAD_ORIGIN}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...CORS }, body: '' });
    }
    if (state.uploadFails) {
      return route.fulfill({ status: 503, headers: { ...CORS }, body: 'storage unavailable' });
    }
    return route.fulfill({ status: 200, headers: { ...CORS }, body: '' });
  });

  await page_.route(`${API_ORIGIN}/api/**`, async (route) => {
    const request = route.request();
    const method = request.method();

    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...CORS }, body: '' });
    }

    const url = new URL(request.url());
    const path = url.pathname;
    const body = readBody(route);
    state.recorded.push({ method, path, query: url.searchParams, body });

    // ---------------------------------------------------------------- profile
    if (path === '/api/me' && method === 'GET') {
      return serve(
        state,
        route,
        currentUserResponseSchema,
        { success: true, data: state.profile },
        'GET /api/me',
      );
    }

    if (path === '/api/me' && method === 'PATCH') {
      checkRequest(state, updateProfileRequestSchema, body, 'PATCH /api/me');
      const next = body as { displayName?: string } | undefined;
      if (next?.displayName !== undefined) state.profile.displayName = next.displayName;
      return serve(
        state,
        route,
        currentUserResponseSchema,
        { success: true, data: state.profile },
        'PATCH /api/me',
      );
    }

    if (path === '/api/me/onboarding') {
      checkRequest(state, onboardingRequestSchema, body, 'PATCH /api/me/onboarding');
      const input = body as { role: ApplicationRole; displayName: string };
      state.profile = {
        ...state.profile,
        role: input.role,
        displayName: input.displayName,
        onboardingComplete: true,
      };
      return serve(
        state,
        route,
        currentUserResponseSchema,
        { success: true, data: state.profile },
        'PATCH /api/me/onboarding',
      );
    }

    // ---------------------------------------------------------------- programs
    if (path === '/api/programs' && method === 'GET') {
      const rows = publicPrograms(url.searchParams);
      const limit = Number(url.searchParams.get('limit') ?? '12');
      return serve(
        state,
        route,
        programListResponseSchema,
        { success: true, data: rows, metadata: page(1, limit, rows.length) },
        'GET /api/programs',
      );
    }

    if (path === '/api/owner/programs' && method === 'GET') {
      const rows = ownerPrograms(url.searchParams);
      const limit = Number(url.searchParams.get('limit') ?? '20');
      return serve(
        state,
        route,
        programListResponseSchema,
        { success: true, data: rows, metadata: page(1, limit, rows.length) },
        'GET /api/owner/programs',
      );
    }

    if (path === '/api/programs' && method === 'POST') {
      checkRequest(state, createProgramRequestSchema, body, 'POST /api/programs');
      const input = body as { name?: string; slug?: string; shortSummary?: string };
      const created = detail(
        summary({
          id: IDS.createdProgram,
          name: input.name ?? 'Created program',
          slug: input.slug ?? 'created-program',
          shortSummary: input.shortSummary ?? 'Created by the wizard journey.',
          status: 'draft',
          publicStatus: null,
          tags: ['DeFi'],
          totalPool: '0',
          remainingPool: '0',
          totalPaid: null,
          maxBounty: '50000',
          inScopeAssetTypes: ['smart_contract'],
          rewardSeverities: ['critical'],
        }),
      );
      return serve(
        state,
        route,
        programResponseSchema,
        { success: true, data: created },
        'POST /api/programs',
      );
    }

    const disclosures = /^\/api\/programs\/([^/]+)\/disclosures$/.exec(path);
    if (disclosures !== null) {
      return serve(
        state,
        route,
        publicDisclosureListResponseSchema,
        { success: true, data: [], metadata: page(1, 20, 0) },
        'GET /api/programs/:id/disclosures',
      );
    }

    const createReport = /^\/api\/programs\/([^/]+)\/reports$/.exec(path);
    if (createReport !== null && method === 'POST') {
      checkRequest(state, createReportRequestSchema, body, 'POST /api/programs/:id/reports');
      const input = body as { title?: string };
      if (input.title !== undefined) state.reportTitle = input.title;
      return serve(
        state,
        route,
        reportResponseSchema,
        { success: true, data: reportDetail(state) },
        'POST /api/programs/:id/reports',
      );
    }

    const programDetail = /^\/api\/programs\/([^/]+)$/.exec(path);
    if (programDetail !== null) {
      const found = DETAILS[programDetail[1] ?? ''];
      if (found === undefined) {
        return fail(route, 404, 'not_found', 'Program not found');
      }
      if (method === 'PATCH') {
        return serve(
          state,
          route,
          programResponseSchema,
          { success: true, data: found },
          'PATCH /api/programs/:id',
        );
      }
      return serve(
        state,
        route,
        programResponseSchema,
        { success: true, data: found },
        'GET /api/programs/:id',
      );
    }

    // ---------------------------------------------------------------- reports
    if (path === '/api/reports' && method === 'GET') {
      return serve(
        state,
        route,
        reportListResponseSchema,
        { success: true, data: [reportSummary(state)], metadata: page(1, 20, 1) },
        'GET /api/reports',
      );
    }

    const uploadUrl = /^\/api\/reports\/([^/]+)\/attachments\/upload-url$/.exec(path);
    if (uploadUrl !== null) {
      return serve(
        state,
        route,
        signedUploadResponseSchema,
        {
          success: true,
          data: {
            attachmentId: IDS.attachment,
            uploadUrl: `${UPLOAD_ORIGIN}/private/${IDS.attachment}`,
            expiresAt: '2026-07-25T00:01:00.000Z',
          },
        },
        'POST /api/reports/:id/attachments/upload-url',
      );
    }

    if (/\/attachments\/[^/]+\/complete$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { ...CORS },
        body: JSON.stringify({ success: true, data: { attachmentId: IDS.attachment } }),
      });
    }

    if (/\/attachments\/[^/]+\/download-url$/.test(path)) {
      return serve(
        state,
        route,
        signedDownloadResponseSchema,
        {
          success: true,
          data: {
            downloadUrl: `${UPLOAD_ORIGIN}/download/${IDS.attachment}`,
            expiresAt: '2026-07-25T00:01:00.000Z',
          },
        },
        'POST /api/reports/:id/attachments/:attachmentId/download-url',
      );
    }

    if (path.endsWith('/comments')) {
      if (method === 'GET') {
        return serve(
          state,
          route,
          commentListResponseSchema,
          { success: true, data: state.comments, metadata: page(1, 50, state.comments.length) },
          'GET /api/reports/:id/comments',
        );
      }
      const input = body as { body?: string } | undefined;
      const created = {
        id: '45000000-0000-4000-8000-000000000002',
        authorId: state.profile.id,
        body: input?.body ?? '',
        deleted: false,
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      };
      state.comments.push(created);
      return serve(
        state,
        route,
        createCommentResponseSchema,
        { success: true, data: { id: created.id } },
        'POST /api/reports/:id/comments',
      );
    }

    // ------------------------------------------------------- review transitions
    const transition = /^\/api\/reports\/([^/]+)\/([a-z-]+)$/.exec(path);
    if (transition !== null && method === 'POST') {
      const action = transition[2] ?? '';
      const applied = applyTransition(state, action, body);
      if (applied !== null) return fail(route, 409, applied.code, applied.message);
      return serve(
        state,
        route,
        reportResponseSchema,
        { success: true, data: reportDetail(state) },
        `POST /api/reports/:id/${action}`,
      );
    }

    const reportDetailPath = /^\/api\/reports\/([^/]+)$/.exec(path);
    if (reportDetailPath !== null) {
      return serve(
        state,
        route,
        reportResponseSchema,
        { success: true, data: reportDetail(state) },
        'GET /api/reports/:id',
      );
    }

    return fail(route, 404, 'not_found', `No fixture route for ${method} ${path}`);
  });
}

interface TransitionRefusal {
  readonly code: string;
  readonly message: string;
}

const OPEN_STATUSES: readonly ReportStatus[] = ['submitted', 'triaged'];

function applyTransition(
  state: MockState,
  action: string,
  body: unknown,
): TransitionRefusal | null {
  const refuse: TransitionRefusal = {
    code: 'invalid_report_transition',
    message: 'Invalid report transition',
  };

  if (action === 'request-information') {
    if (!OPEN_STATUSES.includes(state.reportStatus)) return refuse;
    state.reportStatus = 'needs_information';
    return null;
  }

  if (action === 'validate') {
    if (!OPEN_STATUSES.includes(state.reportStatus)) return refuse;
    const input = body as { finalSeverity?: Severity } | undefined;
    state.finalSeverity = input?.finalSeverity ?? 'critical';
    state.reportStatus = 'validated';
    return null;
  }

  if (action === 'reject') {
    if (!OPEN_STATUSES.includes(state.reportStatus)) return refuse;
    state.reportStatus = 'rejected';
    return null;
  }

  if (action === 'mark-duplicate') {
    if (!OPEN_STATUSES.includes(state.reportStatus)) return refuse;
    state.reportStatus = 'duplicate';
    return null;
  }

  if (action === 'approve-reward') {
    if (state.reportStatus !== 'validated') return refuse;
    checkRequest(state, approveRewardRequestSchema, body, 'POST /api/reports/:id/approve-reward');
    const input = body as
      | { amount?: string; calculationBasisAmount?: string }
      | undefined;
    // The server, not the client, decides a percentage payout.
    state.approvedReward = input?.amount ?? '12000';
    state.reportStatus = 'reward_approved';
    return null;
  }

  return refuse;
}

// ------------------------------------------------------------------------------------ fixtures

function publicApi(state: MockState): MockApi {
  const matching = (method: string, pathSuffix: string) =>
    state.recorded.filter(
      (entry) => entry.method === method && entry.path.endsWith(pathSuffix),
    );

  return {
    get requests() {
      return state.recorded;
    },
    calls: matching,
    lastBody: (method, pathSuffix) => matching(method, pathSuffix).at(-1)?.body,
    lastQuery: (method, pathSuffix) => matching(method, pathSuffix).at(-1)?.query,
    failAttachmentUpload: (failing = true) => {
      state.uploadFails = failing;
    },
    setReportStatus: (status, options) => {
      state.reportStatus = status;
      state.finalSeverity = options?.finalSeverity ?? (status === 'validated' ? 'critical' : undefined);
    },
    setProfile: (profile) => {
      state.profile = {
        id: profile.id ?? IDS[profile.role],
        email: profile.email ?? `${profile.role}@local.demo`,
        role: profile.role,
        displayName: profile.displayName,
        onboardingComplete: profile.onboardingComplete,
      };
    },
  };
}

async function rolePage(
  browser: Browser,
  role: Role,
  state: MockState,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext();
  const page_ = await context.newPage();
  await configurePage(page_, role, state);
  try {
    await use(page_);
  } finally {
    await context.close();
  }
}

export const test = base.extend<{
  api: MockApi;
  state: MockState;
  anonymousPage: Page;
  ownerPage: Page;
  researcherPage: Page;
  reviewerPage: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  state: async ({}, use) => {
    const state = createState();
    await use(state);
    // A schema mismatch is a contract drift, not a flaky test: surface it loudly.
    expect(state.violations, 'API contract violations detected by the fixtures').toEqual([]);
  },
  api: async ({ state }, use) => {
    await use(publicApi(state));
  },
  anonymousPage: async ({ browser, state }, use) => {
    await rolePage(browser, 'anonymous', state, use);
  },
  ownerPage: async ({ browser, state }, use) => {
    state.profile = profileFor('owner');
    await rolePage(browser, 'owner', state, use);
  },
  researcherPage: async ({ browser, state }, use) => {
    state.profile = profileFor('researcher');
    await rolePage(browser, 'researcher', state, use);
  },
  reviewerPage: async ({ browser, state }, use) => {
    state.profile = profileFor('reviewer');
    await rolePage(browser, 'reviewer', state, use);
  },
});

export { expect, AEGIS_SUMMARY, LUMEN_SUMMARY, ORBIT_SUMMARY };
