// HTTP status codes as a const enum for clarity
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
} as const;

export type HttpStatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];

export class AppError extends Error {
  public readonly statusCode: HttpStatusCode;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: HttpStatusCode = HttpStatus.INTERNAL,
    code = "INTERNAL_ERROR",
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  static badRequest(message: string, details?: unknown) {
    return new AppError(
      message,
      HttpStatus.BAD_REQUEST,
      "BAD_REQUEST",
      details,
    );
  }

  static unauthorized(message = "Unauthorized") {
    return new AppError(message, HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
  }

  static forbidden(message = "Forbidden") {
    return new AppError(message, HttpStatus.FORBIDDEN, "FORBIDDEN");
  }

  static notFound(resource: string) {
    return new AppError(
      `${resource} not found`,
      HttpStatus.NOT_FOUND,
      "NOT_FOUND",
    );
  }

  static paymentRequired(message: string) {
    return new AppError(
      message,
      HttpStatus.PAYMENT_REQUIRED,
      "QUOTA_EXHAUSTED",
    );
  }

  static conflict(message: string) {
    return new AppError(message, HttpStatus.CONFLICT, "CONFLICT");
  }

  static unprocessable(message: string, details?: unknown) {
    return new AppError(
      message,
      HttpStatus.UNPROCESSABLE,
      "VALIDATION_ERROR",
      details,
    );
  }

  static internal(message = "Internal server error") {
    return new AppError(
      message,
      HttpStatus.INTERNAL,
      "INTERNAL_ERROR",
      undefined,
      false,
    );
  }

  /** Thrown when a user tries to self-approve their own double-approval request. */
  static selfApprovalForbidden() {
    return new AppError(
      "Self-approval is not permitted. A different user must provide the second approval.",
      HttpStatus.BAD_REQUEST,
      "SELF_APPROVAL_FORBIDDEN",
    );
  }

  /** Thrown when AIPolicyEngine returns DENY for a proposal. */
  static policyDeny(message: string, details?: unknown) {
    return new AppError(message, HttpStatus.FORBIDDEN, "POLICY_DENY", details);
  }

  /** Thrown when a high-risk action is intercepted and requires double-approval before execution. */
  static approvalRequired(approvalId: string, proposalId: string) {
    return new AppError(
      "This action requires double-approval before it can be executed.",
      HttpStatus.BAD_REQUEST,
      "APPROVAL_REQUIRED",
      { approvalId, proposalId },
    );
  }
}
