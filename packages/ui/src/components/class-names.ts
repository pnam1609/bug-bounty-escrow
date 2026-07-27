import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to be taught the BBE scales, because both of ours are named rather than
 * numeric and its stock config guesses wrong in two ways that silently corrupt output:
 *
 *   - `text-body-sm` looks like a text *colour*, so `cn('text-body-sm', 'text-text')` returned
 *     just `text-text` and dropped the font size. Registering the names under the `text` theme
 *     key files them as font sizes instead.
 *   - `p-md` matches no numeric or arbitrary padding value, so `cn('p-md', 'p-xl')` kept both and
 *     let stylesheet order decide — meaning a caller's override did not reliably win, which is
 *     the entire point of merging. Registering the `spacing` names fixes every scale derived
 *     from it: padding, margin, gap, inset, size, translate.
 *
 * These lists must stay in sync with the `--text-*` and `--spacing-*` tokens in `theme.css`.
 */
const BBE_TEXT_SCALE = [
  'h1',
  'h2',
  'h3',
  'body',
  'body-sm',
  'label-lg',
  'label-md',
  'label-sm',
] as const;

const BBE_SPACING_SCALE = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...BBE_TEXT_SCALE],
      spacing: [...BBE_SPACING_SCALE],
    },
  },
});

/**
 * Merge Tailwind classes so a caller's override wins over a component's default.
 * Always pass the caller's `className` last.
 */
export function cn(...values: ClassValue[]): string {
  return merge(clsx(values));
}
