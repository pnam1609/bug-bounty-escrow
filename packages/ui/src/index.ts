/*
 * Public entry point for @bug-bounty-escrow/ui.
 *
 * Design tokens are not exported as JavaScript: `theme.css` is the single source of truth and
 * components consume them through Tailwind utilities. Importing hex values into TS would let a
 * second copy of the palette drift away from Figma.
 */

export * from './components/index.js';
