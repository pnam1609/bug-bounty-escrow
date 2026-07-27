import type {
  AssetType,
  DisclosureDecision,
  EscrowTransactionStatus,
  EscrowTransactionType,
  NotificationType,
  PocPolicy,
  ProgramImpactSource,
  ProgramResourceType,
  ProgramStatus,
  ReportImpactSource,
  ReportStatus,
  RewardCalculationType,
  Severity,
  TotalPaidVisibility,
  UserRole,
} from './statuses.js';

export interface BountyProgram {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  shortSummary: string;
  description: string;
  websiteUrl?: string;
  logoUrl?: string;
  status: ProgramStatus;
  /** USDC funded into escrow. */
  totalPool: string;
  /** Approved rewards not yet settled. */
  reservedPool: string;
  /** `totalPool - reservedPool - paidPool`; the budget still free to commit. */
  remainingPool: string;
  /** Settled payouts. Null on public reads when the owner keeps the figure private. */
  totalPaid?: string;
  totalPaidVisibility: TotalPaidVisibility;
  maxBounty: string;
  contractAddress?: string;
  deadline?: string;
  publishedAt?: string;
}

export interface ProgramScope {
  id: string;
  programId: string;
  assetType: AssetType;
  assetName: string;
  assetUrl?: string;
  contractAddress?: string;
  isInScope: boolean;
  description?: string;
  sortOrder: number;
}

export interface ProgramResource {
  id: string;
  programId: string;
  resourceType: ProgramResourceType;
  title: string;
  url: string;
  sortOrder: number;
}

export interface ProgramImpact {
  id: string;
  programId: string;
  assetType: AssetType;
  severity: Severity;
  title: string;
  description?: string;
  source: ProgramImpactSource;
  templateKey?: string;
  enabled: boolean;
  sortOrder: number;
}

export interface ProgramRules {
  pocPolicy: PocPolicy;
  pocPolicyNote?: string;
  rewardPolicy?: string;
  testingRestrictions?: string;
  submissionAcknowledgment?: string;
  allowCustomImpact: boolean;
  prohibitedActivities: ProhibitedActivity[];
}

export interface ProhibitedActivity {
  id: string;
  source: 'platform_default' | 'custom';
  ruleKey?: string;
  body: string;
  sortOrder: number;
}

export interface RewardTier {
  assetType: AssetType;
  severity: Severity;
  calculationType: RewardCalculationType;
  minReward?: string;
  maxReward?: string;
  flatAmount?: string;
  percentageBps?: number;
  maxRewardCap?: string;
  calculationNote?: string;
}

/** An impact claimed on a report, snapshotted at submission time. */
export interface ReportImpact {
  id: string;
  source: ReportImpactSource;
  programImpactId?: string;
  title: string;
  severity?: Severity;
  assetType: AssetType;
}

export interface VulnerabilityReport {
  id: string;
  programId: string;
  researcherId: string;
  affectedScopeId: string;
  title: string;
  description: string;
  impacts: ReportImpact[];
  reproductionSteps?: string;
  proposedSeverity: Severity;
  finalSeverity?: Severity;
  status: ReportStatus;
  contentHash: string;
  approvedReward?: string;
  submittedAt?: string;
  paidAt?: string;
}

export interface ReportDisclosure {
  id: string;
  reportId: string;
  programId: string;
  decision: DisclosureDecision;
  publicTitle?: string;
  publicSummary?: string;
  publicContent?: string;
  publicSeverity?: Severity;
  publishedAt?: string;
}

export interface UserIdentity {
  id: string;
  email: string;
  role: UserRole;
}

export interface UserProfile extends UserIdentity {
  displayName: string;
  walletAddress?: string;
  avatarUrl?: string;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  metadata: Record<string, string>;
  readAt?: string;
  createdAt: string;
}

export interface EscrowTransactionSummary {
  id: string;
  programId: string;
  reportId?: string;
  chainId: string;
  transactionHash: string;
  type: EscrowTransactionType;
  status: EscrowTransactionStatus;
  amount: string;
  tokenAddress: string;
  createdAt: string;
  confirmedAt?: string;
}
