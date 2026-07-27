import type { ApplicationRole } from '@bug-bounty-escrow/shared';

/*
 * Role presentation and routing for the first-sign-in flow.
 *
 * Figma section 79:150 "MVP · First Sign-in Onboarding" and
 * docs/flow/onboarding-role-flow-for-figma.md §6.4/§6.6/§6.7.
 *
 * Two separate maps on purpose. `reviewer` is a real application role the server can return, so it
 * needs a label and a landing path for routing — but it is never a *choice*, so it has no card
 * copy and no capability list. Keeping the selectable set in its own record makes it impossible to
 * render a reviewer option by accident (§2.1: "reviewer không xuất hiện trong màn hình chọn
 * account type và không thể self-assign").
 */

/** The only roles a user may pick. Mirrors `selfAssignableRoleSchema` in the shared contract. */
export const SELECTABLE_ROLES = Object.freeze(['researcher', 'owner'] as const);
export type SelectableRole = (typeof SELECTABLE_ROLES)[number];

export function isSelectableRole(value: string): value is SelectableRole {
  return value === 'owner' || value === 'researcher';
}

export const ROLE_LABELS: Readonly<Record<ApplicationRole, string>> = Object.freeze({
  owner: 'Program owner',
  researcher: 'Security researcher',
  reviewer: 'Reviewer',
});

/** Short form for the account-type pill. Figma draws it upper-case; CSS does the casing. */
export const ROLE_BADGE_LABELS: Readonly<Record<ApplicationRole, string>> = Object.freeze({
  owner: 'Owner',
  researcher: 'Researcher',
  reviewer: 'Reviewer',
});

/** §15 "Tham chiếu implementation hiện tại". Routing always follows the role the *server* returns. */
export const ROLE_LANDING_PATHS: Readonly<Record<ApplicationRole, string>> = Object.freeze({
  owner: '/owner/programs',
  researcher: '/programs',
  reviewer: '/review',
});

export const ROLE_WORKSPACE_LABELS: Readonly<Record<ApplicationRole, string>> = Object.freeze({
  owner: 'owner workspace',
  researcher: 'researcher workspace',
  reviewer: 'review workspace',
});

interface SelectableRoleDetail {
  /** The three capabilities listed on the confirm step. */
  readonly capabilities: readonly string[];
  /** Card body copy, verbatim from §6.4. */
  readonly description: string;
}

export const SELECTABLE_ROLE_DETAILS: Readonly<Record<SelectableRole, SelectableRoleDetail>> =
  Object.freeze({
    researcher: {
      capabilities: [
        'Browse funded bounty programs',
        'Submit and collaborate on private reports',
        'Track validated rewards and payouts',
      ],
      description:
        'Find vulnerabilities, submit private reports, respond to review requests, and track rewards.',
    },
    owner: {
      capabilities: [
        'Publish and manage bounty programs',
        'Review private vulnerability reports',
        'Fund and track escrow payouts',
      ],
      description:
        'Publish bounty programs, define scopes and rewards, review reports, and fund payouts.',
    },
  });

/**
 * Neither the flow doc nor the Figma section specifies a support destination, but three frames
 * (ONB-06C, ACCESS-01 and the onboarding header) put a "Contact support" affordance on screen. An
 * internal path keeps the link safe and trivially retargetable; see the handoff notes.
 */
export const SUPPORT_HREF = '/support';

/**
 * Account-type pill. `solid` is the confirm summary (80:282) and the settings account-type row;
 * `outline` is the one in the workspace header (82:432).
 *
 * Not a `StatusBadge`: that component is keyed to the report and program lifecycle unions and
 * renders an outlined tone chip with a dot. The design system has no account-type badge yet —
 * flow doc §10 asks for one.
 */
export function RoleBadge({
  className,
  role,
  variant = 'solid',
}: {
  readonly className?: string | undefined;
  readonly role: ApplicationRole;
  readonly variant?: 'outline' | 'solid' | undefined;
}) {
  const tone =
    variant === 'outline'
      ? 'border border-border-brand text-primary'
      : 'bg-primary [color:var(--color-primary-contrast)]';

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-md py-xs text-label-sm font-semibold uppercase ${tone} ${className ?? ''}`}
    >
      {ROLE_BADGE_LABELS[role]}
    </span>
  );
}
