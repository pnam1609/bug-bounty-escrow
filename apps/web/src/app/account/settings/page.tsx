import type { Metadata } from 'next';

import {
  AccountLoadFailure,
  AccountSettings,
  AccountSettingsLoading,
} from '@/components/account/account-settings';
import { RoleGuard } from '@/components/role-guard';

export const metadata: Metadata = {
  title: 'Account settings · BountyEscrow',
  description: 'Your profile details and the account type your workspace is based on.',
};

/*
 * `/account/settings` — ACC-01 (282:1949). The route named in
 * docs/flow/account-settings-researcher-flow-for-figma.md §2; it replaced `/settings`, which no
 * longer exists, rather than standing beside it (§2: "không tự tạo hai route settings song song").
 *
 * Every role has an account, so the guard admits all three — it is here for the session,
 * onboarding and profile checks, not to narrow the audience. Nothing below it renders until
 * `GET /api/me` has answered, which is what keeps settings content from flashing (§4.10).
 *
 * The two waiting states are this screen's own, because §8 pins their copy and their layout:
 * ACC-00's skeleton of the title, profile card and side rail, and the ACC-05/ACC-06 pair that
 * `AccountLoadFailure` chooses between from the reason the profile call failed. Both render the
 * identity-free header, so a previous visitor's name is never on screen while the current one is
 * unconfirmed (§8 ACC-00, ACC-05).
 */
export default function AccountSettingsPage() {
  return (
    <RoleGuard
      allow={['owner', 'researcher', 'reviewer']}
      fallback={{ loading: <AccountSettingsLoading />, profileError: <AccountLoadFailure /> }}
    >
      <AccountSettings />
    </RoleGuard>
  );
}
