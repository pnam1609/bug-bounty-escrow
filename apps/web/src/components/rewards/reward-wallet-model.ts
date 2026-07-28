import {
  payoutWalletAddressSchema,
  type PayoutWallet,
} from '@bug-bounty-escrow/shared';

import { ApiClientError } from '@/lib/api-client';

export const PAYOUT_WALLET_PATH = '/api/rewards/payout-wallet';

export function normalizedWalletInput(value: string): string {
  return value.trim();
}

export function payoutWalletAddressError(value: string): string | null {
  const normalized = normalizedWalletInput(value);
  if (normalized === '') return 'Enter an EVM wallet address.';
  return payoutWalletAddressSchema.safeParse(normalized).success
    ? null
    : 'Enter a valid EVM address beginning with 0x and 40 hexadecimal characters.';
}

export function shouldConfirmPayoutWalletChange(
  wallet: PayoutWallet,
  nextAddress: string,
): boolean {
  return (
    wallet.changeConfirmationRequired &&
    wallet.address !== undefined &&
    wallet.address.toLowerCase() !== normalizedWalletInput(nextAddress).toLowerCase()
  );
}

export function payoutWalletSaveError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'wallet_change_confirmation_required') {
      return 'This reward became active while you were editing. Review and explicitly confirm the payout wallet change.';
    }
    if (error.code === 'payout_wallet_not_required') {
      return 'A payout wallet is not needed because no approved or pending reward is active.';
    }
    if (error.status === 403) {
      return 'Only the signed-in security researcher can update this payout destination.';
    }
  }

  return 'We could not save your payout wallet. Check the address and try again.';
}

export function isPayoutWalletConfirmationError(error: unknown): boolean {
  return (
    error instanceof ApiClientError && error.code === 'wallet_change_confirmation_required'
  );
}
