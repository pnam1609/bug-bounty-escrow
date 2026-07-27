import { cva } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from './class-names.js';

export const CARD_VARIANTS = Object.freeze(['default', 'subtle', 'elevated'] as const);
export type CardVariant = (typeof CARD_VARIANTS)[number];

export const CARD_PADDINGS = Object.freeze(['none', 'sm', 'md', 'lg'] as const);
export type CardPadding = (typeof CARD_PADDINGS)[number];

/**
 * Shared surface recipe. Exported so domain surfaces built on the same geometry — Bounty Card, for
 * one — inherit radius, border and elevation instead of restating them.
 *
 * Every variant carries the full set of properties it touches: two utilities for the same CSS
 * property in one class list would leave the winner up to stylesheet order, not to intent.
 */
export const cardVariants = cva('flex flex-col gap-lg rounded-lg border border-border', {
  variants: {
    padding: {
      none: 'p-none',
      sm: 'p-md',
      md: 'p-xl',
      lg: 'p-2xl',
    },
    variant: {
      default: 'bg-surface shadow-subtle',
      subtle: 'bg-surface-raised',
      elevated: 'bg-surface shadow-elevated',
    },
  },
  defaultVariants: {
    padding: 'md',
    variant: 'default',
  },
});

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  variant?: CardVariant;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, padding = 'md', variant = 'default', ...cardProps },
  ref,
) {
  return (
    <div
      {...cardProps}
      ref={ref}
      data-padding={padding}
      data-variant={variant}
      className={cn(cardVariants({ padding, variant }), className)}
    />
  );
});

export type CardHeaderProps = HTMLAttributes<HTMLDivElement>;

/**
 * Sets the header's base type size so `CardDescription` only has to declare its colour: a size
 * token and a colour token cannot share one merged class list without the colour eating the size.
 */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, ...headerProps },
  ref,
) {
  return (
    <div
      {...headerProps}
      ref={ref}
      className={cn('flex flex-col gap-xs text-body-sm', className)}
    />
  );
});

export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>;

export const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, ...titleProps },
  ref,
) {
  return <h3 {...titleProps} ref={ref} className={cn('text-h3', className)} />;
});

export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  function CardDescription({ className, ...descriptionProps }, ref) {
    return <p {...descriptionProps} ref={ref} className={cn('text-text-muted', className)} />;
  },
);

export type CardContentProps = HTMLAttributes<HTMLDivElement>;

export const CardContent = forwardRef<HTMLDivElement, CardContentProps>(function CardContent(
  { className, ...contentProps },
  ref,
) {
  return <div {...contentProps} ref={ref} className={cn('flex flex-col gap-md', className)} />;
});

export type CardFooterProps = HTMLAttributes<HTMLDivElement>;

/** Actions stay in document flow — the spacing contract forbids overlaying the last field. */
export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { className, ...footerProps },
  ref,
) {
  return (
    <div
      {...footerProps}
      ref={ref}
      className={cn('flex flex-wrap items-center gap-md', className)}
    />
  );
});
