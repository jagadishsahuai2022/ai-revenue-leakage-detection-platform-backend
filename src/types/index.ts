import { FastifyRequest } from 'fastify';
import { UserRole } from '@prisma/client';

// ── JWT Payload ───────────────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string;         // userId
  cid: string;         // companyId
  role: UserRole;
  email: string;
  iat?: number;
  exp?: number;
}

// ── Authenticated Request ─────────────────────────────────────────────────────
export interface AuthenticatedRequest extends FastifyRequest {
  userId: string;
  companyId: string;
  userRole: UserRole;
  userEmail: string;
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// ── API Response ──────────────────────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: Record<string, unknown>;
  /** UUID-v4 request trace ID — set by request-tracing plugin */
  requestId?: string;
  /** ISO-8601 timestamp of when the response was generated */
  timestamp?: string;
}

// ── Tenant Context ────────────────────────────────────────────────────────────
export interface TenantContext {
  companyId: string;
  userId: string;
  role: UserRole;
}
