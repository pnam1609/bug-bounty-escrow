# BBE UI conventions

Read this before adding or changing anything in `packages/ui`.

## Source of truth

Figma file `PXhIUlWSb44xjonYNxviCN`, page **BBE Design System** (node `2:3`).

| Section | Node |
| --- | --- |
| 01 · Foundations | `31:3` |
| 02 · Design Tokens | `31:4` |
| 03 · Components | `31:5` |
| 04 · Variants & States | `31:6` |
| 05 · Patterns | `31:7` |
| 06 · Icons | `148:1837` |
| 07 · App Shell | `162:95` |

Pull a node with `get_design_context` / `get_screenshot` before building it. Do not guess spacing
or colour from the screenshot alone when a variable exists.

## Tokens

All tokens live in `src/theme.css` as a Tailwind v4 `@theme` block. **Never write a raw hex, px
radius, or px spacing value in a component.** Use the utility that maps to the token:

| Concern | Utilities |
| --- | --- |
| Surfaces | `bg-background` `bg-surface` `bg-surface-raised` `bg-ambient` |
| Lines | `border-border` `border-border-brand` |
| Text | `text-text` `text-text-muted` `text-text-disabled` |
| Brand | `bg-primary` `hover:bg-primary-hover` `text-primary-contrast` |
| Semantic | `text-escrow` `text-success` `text-error` `text-usdc` |
| Severity | `text-critical` `text-high` `text-medium` `text-low` `text-informational` |
| Spacing | `p-xs p-sm p-md p-lg p-xl p-2xl p-3xl` (4/8/12/16/24/32/48) and the `gap-*`, `m-*` equivalents |
| Radius | `rounded-sm` (6) `rounded-md` (10) `rounded-lg` (14) `rounded-full` |
| Elevation | `shadow-subtle` `shadow-elevated` `shadow-overlay` |
| Type | `text-h1 text-h2 text-h3 text-body text-body-sm text-label-lg text-label-md text-label-sm` |

Mint (`escrow`) is reserved for escrow and completed states. Violet (`primary`) is the current or
primary action. Red is error and destructive only.

## Component rules

1. **shadcn shape, BBE skin.** Build on the Radix primitive the way shadcn does — `forwardRef`,
   `cva` for variants, `cn()` to merge a caller's `className` last so overrides win.
2. `'use client'` at the top of any file that uses hooks, Radix, or event handlers. The package is
   consumed through `transpilePackages`, so the directive survives.
3. Export every component and its props type. One component family per file.
4. Do not add a component to `src/index.ts` — the barrel is maintained centrally to avoid
   collisions. Just create the file.
5. Props extend the underlying element's props (`ComponentPropsWithoutRef<'button'>` etc.) so
   callers keep `aria-*`, `data-*` and native handlers.
6. No `any`. No default exports.

## Accessibility, not optional

- Every interactive target is at least 44×44 CSS pixels, or has padding that reaches it.
- Focus is handled globally in `theme.css` (`:focus-visible`). Do not remove the outline; if a
  component needs a different treatment, use `focus-visible:ring-*` **in addition**.
- State is never colour alone: pair a severity or status colour with text or an icon.
- Errors are linked to their field with `aria-describedby` and announced.
- Respect `prefers-reduced-motion` on anything animated.

## Form field anatomy

From `03 · Components → Form field anatomy & spacing`:

```text
label      → control          8px   (gap-sm)
control    → helper / error   8px   (gap-sm)
field      → next field      32px   (gap-2xl)
subtitle   → stepper         32–48px
stepper    → content surface 32px
last field → action row      32px   (never overlay; keep actions in flow)

nested surface inset          24px  (left, right, bottom)
action → following annotation 24px
action → parent bottom border 32px, never below 24px
```

## Verify before finishing

```bash
pnpm --filter @bug-bounty-escrow/ui typecheck
pnpm --filter @bug-bounty-escrow/ui lint
```
