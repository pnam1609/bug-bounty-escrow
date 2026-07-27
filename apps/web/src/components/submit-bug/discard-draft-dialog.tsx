'use client';

/*
 * SR-10 — Discard local draft. The library's AlertDialog is exactly this pattern (its own doc
 * comment names "Discard local draft (researcher submit-bug, SR-10)"), so this is only the copy.
 *
 * The warning panel says what discarding does and, just as importantly, what it does not do:
 * nothing has been submitted to the program.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogWarning,
} from '@bug-bounty-escrow/ui';

export const DISCARD_DRAFT_TITLE = 'Discard this report draft?';
export const DISCARD_DRAFT_DESCRIPTION =
  'This removes the draft saved in this browser. Nothing has been submitted to the program.';

export interface DiscardDraftDialogProps {
  readonly onDiscard: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

export function DiscardDraftDialog({ onDiscard, onOpenChange, open }: DiscardDraftDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{DISCARD_DRAFT_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>{DISCARD_DRAFT_DESCRIPTION}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogWarning>
          <p className="text-label-lg font-semibold text-error">This cannot be undone</p>
          <p className="text-body-sm text-text-muted">
            The draft only exists here — there is no server copy to restore it from.
          </p>
        </AlertDialogWarning>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard} variant="destructive">
            Discard local draft
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface ChangeAssetTypeDialogProps {
  readonly nextAssetTypeLabel: string;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

/**
 * Asset-change confirmation from flow doc §8 SR-01. Changing to an asset of a *different* type
 * invalidates the impacts already picked, and the payload must never carry stale hidden ids — so
 * the clear is explicit rather than silent.
 */
export function ChangeAssetTypeDialog({
  nextAssetTypeLabel,
  onConfirm,
  onOpenChange,
  open,
}: ChangeAssetTypeDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Changing asset type will clear the selected impacts.</AlertDialogTitle>
          <AlertDialogDescription>
            {nextAssetTypeLabel} impacts are a different catalog, so the impacts you already picked
            no longer apply. Your report text, severity and attachment are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep current asset</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Change asset and clear impacts</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
