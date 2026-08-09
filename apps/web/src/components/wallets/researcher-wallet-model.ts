import type { PayoutWalletChallenge, ResearcherPayoutWallet } from '@bug-bounty-escrow/shared';

import { ApiClientError } from '@/lib/api-client';

export const PAYOUT_WALLETS_PATH = '/api/rewards/payout-wallets';
export const PAYOUT_WALLET_CHALLENGES_PATH = '/api/rewards/payout-wallet-challenges';

export function payoutWalletChallengePath(id: string): string {
  return `${PAYOUT_WALLET_CHALLENGES_PATH}/${encodeURIComponent(id)}/verify`;
}

export function selectedVerifiedWallet(
  wallets: readonly ResearcherPayoutWallet[],
  walletId: string,
): ResearcherPayoutWallet | undefined {
  return wallets.find((wallet) => wallet.id === walletId);
}

export function payoutWalletSelectionError(
  wallets: readonly ResearcherPayoutWallet[],
  walletId: string,
): string | null {
  if (walletId === '') return 'Select a verified reward wallet before continuing.';
  return selectedVerifiedWallet(wallets, walletId) === undefined
    ? 'This wallet is no longer available. Select another verified wallet.'
    : null;
}

export function challengeStillMatches(challenge: PayoutWalletChallenge, address: string): boolean {
  return challenge.address.toLowerCase() === address.toLowerCase();
}

export function describeWalletVerificationError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message === 'wallet_account_changed') {
      return 'The active wallet changed. Verify the currently connected address again.';
    }
    if (error.message === 'wallet_chain_changed') {
      return 'The wallet left Arc Testnet. Switch back before verifying.';
    }
    if (error.message === 'wallet_signature_invalid') {
      return 'The wallet did not return a valid verification signature.';
    }
  }

  if (error instanceof ApiClientError) {
    if (
      [
        'wallet_verification_challenge_expired',
        'wallet_verification_challenge_consumed',
        'wallet_verification_challenge_invalidated',
      ].includes(error.code)
    ) {
      return 'The verification request expired. Verify again to receive a new request.';
    }
    if (error.status === 401) return 'Your session expired. Sign in again to continue.';
    if (error.status === 429) return 'Too many verification attempts. Wait a moment and try again.';
    if (error.status === 403) return 'Only the signed-in researcher can add this wallet.';
  }

  return 'We could not verify this wallet. Check the connection and try again.';
}

export function reportWalletUpdateError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'report_payout_wallet_version_conflict') {
      return 'The wallet selection changed in another session. Reload the report and try again.';
    }
    if (error.code === 'report_payout_wallet_not_accessible') {
      return 'This report is no longer available for wallet changes.';
    }
    if (
      [
        'report_payout_wallet_report_closed',
        'report_payout_wallet_program_ended',
        'report_payout_wallet_settlement_started',
      ].includes(error.code)
    ) {
      return 'This report can no longer change its reward wallet.';
    }
    if (
      ['researcher_payout_wallet_not_accessible', 'researcher_payout_wallet_not_verified'].includes(
        error.code,
      )
    ) {
      return 'That wallet is no longer available. Select another verified wallet.';
    }
    if (error.status === 401) return 'Your session expired. Sign in again to continue.';
  }
  return 'We could not update this report’s reward wallet. Nothing was changed.';
}
