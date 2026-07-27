import type { AssetType, Severity } from './statuses.js';

/**
 * Platform-provided starting points an owner can pull into a program's impact catalog.
 *
 * These are never referenced by a program at runtime: create_program_atomic copies the chosen
 * entries into `program_impacts` as owner-editable rows. Editing this list therefore changes what
 * new programs are offered, and never the terms of a program researchers are already working on.
 */
export interface ImpactTemplate {
  readonly templateKey: string;
  readonly assetType: AssetType;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
}

export const IMPACT_TEMPLATES: readonly ImpactTemplate[] = Object.freeze([
  // Smart contract ---------------------------------------------------------------------------
  {
    templateKey: 'sc.direct_theft_of_funds',
    assetType: 'smart_contract',
    severity: 'critical',
    title: 'Direct theft of user funds',
    description: 'An attacker can withdraw or redirect assets belonging to users or the protocol.',
  },
  {
    templateKey: 'sc.permanent_freezing_of_funds',
    assetType: 'smart_contract',
    severity: 'critical',
    title: 'Permanent freezing of funds',
    description: 'Assets become permanently unrecoverable for users or the protocol.',
  },
  {
    templateKey: 'sc.protocol_insolvency',
    assetType: 'smart_contract',
    severity: 'critical',
    title: 'Protocol insolvency',
    description: 'Accounting can be manipulated so that liabilities exceed backing assets.',
  },
  {
    templateKey: 'sc.theft_of_yield',
    assetType: 'smart_contract',
    severity: 'high',
    title: 'Theft of unclaimed yield or rewards',
    description: 'An attacker can claim yield, fees or rewards owed to other participants.',
  },
  {
    templateKey: 'sc.temporary_freezing_of_funds',
    assetType: 'smart_contract',
    severity: 'high',
    title: 'Temporary freezing of funds',
    description: 'Withdrawals can be blocked for a meaningful period without permanent loss.',
  },
  {
    templateKey: 'sc.griefing',
    assetType: 'smart_contract',
    severity: 'medium',
    title: 'Griefing with no attacker profit',
    description: 'An attacker can damage other users or the protocol without financial gain.',
  },
  {
    templateKey: 'sc.unbounded_gas_consumption',
    assetType: 'smart_contract',
    severity: 'low',
    title: 'Unbounded gas consumption',
    description: 'A code path can be forced into gas exhaustion under realistic conditions.',
  },

  // Website ----------------------------------------------------------------------------------
  {
    templateKey: 'web.remote_code_execution',
    assetType: 'website',
    severity: 'critical',
    title: 'Remote code execution',
    description: 'Arbitrary commands or code can be executed on an in-scope host.',
  },
  {
    templateKey: 'web.sensitive_data_exposure',
    assetType: 'website',
    severity: 'critical',
    title: 'Exposure of sensitive user data',
    description: 'Credentials, keys or personal data of other users can be retrieved.',
  },
  {
    templateKey: 'web.authentication_bypass',
    assetType: 'website',
    severity: 'high',
    title: 'Authentication bypass',
    description: 'A session or account can be accessed without valid credentials.',
  },
  {
    templateKey: 'web.subdomain_takeover',
    assetType: 'website',
    severity: 'high',
    title: 'Subdomain takeover',
    description: 'A dangling DNS record allows an attacker to serve content from the domain.',
  },
  {
    templateKey: 'web.stored_xss',
    assetType: 'website',
    severity: 'medium',
    title: 'Stored cross-site scripting',
    description: 'Persisted attacker input executes in the browser of another user.',
  },
  {
    templateKey: 'web.csrf_state_change',
    assetType: 'website',
    severity: 'medium',
    title: 'Cross-site request forgery with state change',
    description: 'A cross-origin request can perform a meaningful action as the victim.',
  },
  {
    templateKey: 'web.reflected_xss',
    assetType: 'website',
    severity: 'low',
    title: 'Reflected cross-site scripting',
    description: 'Attacker input is reflected and executed, requiring victim interaction.',
  },

  // API --------------------------------------------------------------------------------------
  {
    templateKey: 'api.authentication_bypass',
    assetType: 'api',
    severity: 'critical',
    title: 'Authentication bypass',
    description: 'A protected endpoint can be reached without a valid access token.',
  },
  {
    templateKey: 'api.broken_access_control',
    assetType: 'api',
    severity: 'high',
    title: 'Broken access control',
    description: 'A caller can read or modify a resource belonging to another account.',
  },
  {
    templateKey: 'api.injection',
    assetType: 'api',
    severity: 'high',
    title: 'Injection into a backend query or command',
    description: 'Caller input reaches a query, command or template without safe handling.',
  },
  {
    templateKey: 'api.rate_limit_bypass',
    assetType: 'api',
    severity: 'medium',
    title: 'Rate limit bypass',
    description: 'A protected operation can be invoked beyond its documented limit.',
  },
  {
    templateKey: 'api.information_disclosure',
    assetType: 'api',
    severity: 'low',
    title: 'Information disclosure',
    description: 'Responses or errors reveal internal details that aid further attacks.',
  },

  // Mobile -----------------------------------------------------------------------------------
  {
    templateKey: 'mobile.sandbox_data_extraction',
    assetType: 'mobile',
    severity: 'critical',
    title: 'Extraction of sensitive data from the app sandbox',
    description: 'Keys, tokens or personal data can be read from device storage by another app.',
  },
  {
    templateKey: 'mobile.insecure_credential_storage',
    assetType: 'mobile',
    severity: 'high',
    title: 'Insecure credential storage',
    description: 'Long-lived secrets are stored without platform-provided protection.',
  },
  {
    templateKey: 'mobile.transport_security_bypass',
    assetType: 'mobile',
    severity: 'medium',
    title: 'Transport security bypass',
    description: 'Certificate validation or pinning can be defeated to intercept traffic.',
  },
  {
    templateKey: 'mobile.debug_logging_leak',
    assetType: 'mobile',
    severity: 'low',
    title: 'Sensitive data written to device logs',
    description: 'Tokens or personal data are written to logs readable outside the app.',
  },
] as const);

export function impactTemplatesForAssetType(assetType: AssetType): readonly ImpactTemplate[] {
  return IMPACT_TEMPLATES.filter((template) => template.assetType === assetType);
}

/**
 * Baseline rules every program starts with. Mirrors `public.platform_prohibited_activities()`;
 * both copies must be changed together.
 */
export interface ProhibitedActivityTemplate {
  readonly ruleKey: string;
  readonly body: string;
  readonly sortOrder: number;
}

export const PLATFORM_PROHIBITED_ACTIVITIES: readonly ProhibitedActivityTemplate[] = Object.freeze([
  {
    ruleKey: 'no_social_engineering',
    body: 'No social engineering, phishing or physical attacks against the team, users or vendors.',
    sortOrder: 0,
  },
  {
    ruleKey: 'no_denial_of_service',
    body: 'No denial of service, resource exhaustion or availability testing of any kind.',
    sortOrder: 1,
  },
  {
    ruleKey: 'no_automated_high_volume',
    body: 'No automated scanning or high-volume traffic against production systems.',
    sortOrder: 2,
  },
  {
    ruleKey: 'no_damaging_mainnet_testing',
    body: 'No testing against mainnet or public deployments in a way that causes loss or damage to real users.',
    sortOrder: 3,
  },
  {
    ruleKey: 'no_public_unpatched_disclosure',
    body: 'No public disclosure of an unpatched vulnerability before the program authorizes it.',
    sortOrder: 4,
  },
] as const);
