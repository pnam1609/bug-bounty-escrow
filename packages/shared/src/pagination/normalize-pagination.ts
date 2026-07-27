import { DEFAULT_PAGE_NUMBER, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.js';
import type { NormalizedPagination, PaginationInput } from '../types/api.js';

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const integer = Math.trunc(value);

  return integer > 0 ? integer : fallback;
}

export function normalizePagination(input: PaginationInput = {}): NormalizedPagination {
  const page = normalizePositiveInteger(input.page, DEFAULT_PAGE_NUMBER);
  const requestedLimit = normalizePositiveInteger(input.limit, DEFAULT_PAGE_SIZE);

  return {
    page,
    limit: Math.min(requestedLimit, MAX_PAGE_SIZE),
  };
}
