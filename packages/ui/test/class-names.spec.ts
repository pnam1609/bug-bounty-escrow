import { describe, expect, it } from 'vitest';

import { cn } from '../src/components/class-names.js';

/*
 * These lock the two ways the stock tailwind-merge config corrupts BBE class output. Both bugs
 * were silent — nothing threw, the class just vanished or failed to override — so a test is the
 * only thing that keeps them fixed.
 */
describe('cn', () => {
  it('keeps a BBE type token and a colour together', () => {
    // Stock config reads `text-body-sm` as a colour and drops it in favour of `text-text`.
    expect(cn('text-body-sm', 'text-text')).toBe('text-body-sm text-text');
    expect(cn('text-h3', 'text-text-muted')).toBe('text-h3 text-text-muted');
    expect(cn('text-label-lg', 'text-error')).toBe('text-label-lg text-error');
  });

  it('still collapses two font sizes, and two colours, down to the last one', () => {
    expect(cn('text-body', 'text-body-sm')).toBe('text-body-sm');
    expect(cn('text-text', 'text-error')).toBe('text-error');
  });

  it('lets a caller override named spacing', () => {
    // Stock config cannot parse `p-md`, so it kept both and let stylesheet order decide.
    expect(cn('p-md', 'p-xl')).toBe('p-xl');
    expect(cn('gap-sm', 'gap-2xl')).toBe('gap-2xl');
    expect(cn('px-md', 'px-xl')).toBe('px-xl');
    expect(cn('mt-lg', 'mt-3xl')).toBe('mt-3xl');
  });

  it('leaves the numeric scales and the other token groups working', () => {
    expect(cn('size-4', 'size-11')).toBe('size-11');
    expect(cn('rounded-md', 'rounded-lg')).toBe('rounded-lg');
    expect(cn('shadow-subtle', 'shadow-overlay')).toBe('shadow-overlay');
  });

  it('drops falsy values so conditional classes stay readable at call sites', () => {
    expect(cn('p-md', false, undefined, null, 'text-text')).toBe('p-md text-text');
  });
});
