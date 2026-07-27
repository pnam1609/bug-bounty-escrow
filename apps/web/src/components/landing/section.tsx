import type { ReactNode } from 'react';

/*
 * Shared geometry for the public landing page — Figma "Layout / Landing / Desktop" (node 55:3).
 *
 * The frame is 1440 wide with a 48px page inset, so the content column is 1344. Like the
 * 1440/1200/240 columns in `app-shell.tsx`, those are layout structure rather than spacing, which
 * is why they are written as explicit figures. Everything *inside* a section still uses the
 * spacing tokens from `theme.css`.
 *
 * The section rhythm is the other exception: Figma draws 64/72/80px block padding and a 40px
 * copy-to-content gap, all above the 48px ceiling of the spacing scale. Those figures are applied
 * from `lg` up and step down to `p-2xl`/`p-3xl` below it, so the frame reads correctly at 1440
 * without over-padding a 390 phone.
 */
export const LANDING_CONTAINER = 'mx-auto w-full max-w-[1344px] px-xl sm:px-2xl lg:px-3xl';

/** Eyebrow tone per section: mint for escrow guarantees, violet for product and brand. */
const EYEBROW_TONE = {
  escrow: 'text-escrow',
  primary: 'text-primary',
} as const;

export type SectionEyebrowTone = keyof typeof EYEBROW_TONE;

export interface SectionIntroProps {
  readonly align?: 'center' | 'start';
  readonly eyebrow: string;
  readonly headingId: string;
  readonly subtitle: string;
  readonly title: string;
  readonly tone: SectionEyebrowTone;
}

/**
 * Eyebrow / H2 / supporting line, the 8px-gap stack shared by Featured Programs (57:36),
 * How Escrow Works (57:125) and Why BountyEscrow (58:114). Only the alignment and the eyebrow
 * tone change between them.
 */
export function SectionIntro({
  align = 'center',
  eyebrow,
  headingId,
  subtitle,
  title,
  tone,
}: SectionIntroProps): ReactNode {
  const isCentered = align === 'center';

  return (
    <div
      className={`flex flex-col gap-sm ${isCentered ? 'items-center text-center' : 'items-start'}`}
    >
      <p className={`text-label-md uppercase ${EYEBROW_TONE[tone]}`}>{eyebrow}</p>
      <h2 className="text-h1 text-balance text-text" id={headingId}>
        {title}
      </h2>
      <p className="text-body-sm text-balance text-text-muted">{subtitle}</p>
    </div>
  );
}
