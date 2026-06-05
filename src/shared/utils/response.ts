import type { ApiResponse } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Envelope helpers – every response now includes requestId + timestamp.
// The requestId is injected by the request-tracing plugin on each request.
// ─────────────────────────────────────────────────────────────────────────────

export function successResponse<T>(
  data: T,
  message?: string,
  requestId?: string,
): ApiResponse<T> {
  return {
    success: true,
    data,
    ...(message ? { message } : {}),
    requestId: requestId ?? '',
    timestamp: new Date().toISOString(),
  };
}

export function errorResponse(
  error: string,
  code?: string,
  requestId?: string,
): ApiResponse {
  return {
    success: false,
    error,
    ...(code ? { meta: { code } } : {}),
    requestId: requestId ?? '',
    timestamp: new Date().toISOString(),
  };
}

export function createdResponse<T>(
  data: T,
  message = 'Created successfully',
  requestId?: string,
): ApiResponse<T> {
  return {
    success: true,
    data,
    message,
    requestId: requestId ?? '',
    timestamp: new Date().toISOString(),
  };
}
