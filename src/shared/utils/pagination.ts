import { PAGINATION_DEFAULTS } from '../../config/constants';
import type { PaginatedResult, PaginationQuery } from '../../types';

export interface PaginationOptions {
  page?: number | string;
  limit?: number | string;
}

/**
 * Parse & clamp page-based pagination parameters.
 * Enforces a hard ceiling of PAGINATION_DEFAULTS.maxLimit (100).
 */
export function parsePagination(query: PaginationOptions): { skip: number; take: number; page: number; limit: number } {
  const page = Math.max(1, Number(query.page) || PAGINATION_DEFAULTS.page);
  const limit = Math.min(
    PAGINATION_DEFAULTS.maxLimit,
    Math.max(1, Number(query.limit) || PAGINATION_DEFAULTS.limit),
  );
  const skip = (page - 1) * limit;
  return { skip, take: limit, page, limit };
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

export function parseSortOrder(
  sortOrder?: string,
): 'asc' | 'desc' {
  return sortOrder === 'desc' ? 'desc' : 'asc';
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor-based pagination (for large datasets)
// ─────────────────────────────────────────────────────────────────────────────

export interface CursorPaginationOptions {
  cursor?: string;
  limit?: number | string;
}

export interface CursorPaginationParams {
  take: number;
  cursor?: { id: string };
  skip?: number; // 1 when cursor is present (skip the cursor itself)
}

/**
 * Parse cursor-based pagination parameters for Prisma `findMany`.
 * If `cursor` is provided, the query resumes after that record.
 * Hard limit ceiling is enforced identically to page-based pagination.
 */
export function parseCursorPagination(query: CursorPaginationOptions): CursorPaginationParams {
  const limit = Math.min(
    PAGINATION_DEFAULTS.maxLimit,
    Math.max(1, Number(query.limit) || PAGINATION_DEFAULTS.limit),
  );

  if (query.cursor) {
    return { take: limit, cursor: { id: query.cursor }, skip: 1 };
  }

  return { take: limit };
}

export interface CursorPaginatedResult<T extends { id: string }> {
  data: T[];
  meta: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

/**
 * Build a cursor-paginated result envelope.
 * `hasMore` is true when the returned data length equals the requested limit.
 */
export function buildCursorPaginatedResult<T extends { id: string }>(
  data: T[],
  limit: number,
): CursorPaginatedResult<T> {
  const hasMore = data.length === limit;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;
  return {
    data,
    meta: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}
