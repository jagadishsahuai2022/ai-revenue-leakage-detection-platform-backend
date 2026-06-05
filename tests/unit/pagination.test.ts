// ─────────────────────────────────────────────────────────────────────────────
// Unit Tests: Pagination helpers
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  parsePagination,
  buildPaginatedResult,
  parseCursorPagination,
  buildCursorPaginatedResult,
} from '../../src/shared/utils/pagination';

describe('parsePagination', () => {
  it('returns defaults when no params', () => {
    const result = parsePagination({});
    expect(result).toEqual({ skip: 0, take: 20, page: 1, limit: 20 });
  });

  it('clamps limit to maxLimit (100)', () => {
    const result = parsePagination({ limit: 500 });
    expect(result.take).toBe(100);
    expect(result.limit).toBe(100);
  });

  it('clamps page to minimum 1', () => {
    const result = parsePagination({ page: -5 });
    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
  });

  it('computes skip correctly for page 3, limit 10', () => {
    const result = parsePagination({ page: 3, limit: 10 });
    expect(result.skip).toBe(20);
    expect(result.take).toBe(10);
  });

  it('handles string inputs', () => {
    const result = parsePagination({ page: '2', limit: '25' });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(25);
    expect(result.skip).toBe(25);
  });
});

describe('buildPaginatedResult', () => {
  it('builds correct meta for first page', () => {
    const result = buildPaginatedResult([1, 2, 3], 10, 1, 3);
    expect(result.meta).toEqual({
      total: 10,
      page: 1,
      limit: 3,
      totalPages: 4,
      hasNextPage: true,
      hasPrevPage: false,
    });
  });

  it('builds correct meta for last page', () => {
    const result = buildPaginatedResult([10], 10, 4, 3);
    expect(result.meta.hasNextPage).toBe(false);
    expect(result.meta.hasPrevPage).toBe(true);
  });
});

describe('parseCursorPagination', () => {
  it('returns take only when no cursor', () => {
    const result = parseCursorPagination({});
    expect(result).toEqual({ take: 20 });
  });

  it('clamps limit to maxLimit', () => {
    const result = parseCursorPagination({ limit: 999 });
    expect(result.take).toBe(100);
  });

  it('includes cursor and skip when cursor is provided', () => {
    const result = parseCursorPagination({ cursor: 'abc123', limit: 10 });
    expect(result).toEqual({ take: 10, cursor: { id: 'abc123' }, skip: 1 });
  });
});

describe('buildCursorPaginatedResult', () => {
  it('sets hasMore=true when data.length === limit', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = buildCursorPaginatedResult(items, 3);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextCursor).toBe('c');
  });

  it('sets hasMore=false when data.length < limit', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const result = buildCursorPaginatedResult(items, 5);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeNull();
  });

  it('handles empty results', () => {
    const result = buildCursorPaginatedResult([], 10);
    expect(result.meta.hasMore).toBe(false);
    expect(result.meta.nextCursor).toBeNull();
  });
});
