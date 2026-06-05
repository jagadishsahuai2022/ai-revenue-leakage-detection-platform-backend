import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./AppError";

/**
 * Helper: build the common envelope fields (requestId + timestamp)
 */
function envelope(request: FastifyRequest) {
  return {
    requestId: request.requestId ?? "",
    timestamp: new Date().toISOString(),
  };
}

export function errorHandler(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const log = request.log;
  const env = envelope(request);

  // ── Zod validation errors ─────────────────────────────────────────────────
  if (error instanceof ZodError) {
    reply.status(422).send({
      success: false,
      error: "Validation Error",
      code: "VALIDATION_ERROR",
      details: error.flatten().fieldErrors,
      ...env,
    });
    return;
  }

  // ── Our custom AppError ───────────────────────────────────────────────────
  if (error instanceof AppError) {
    if (!error.isOperational) {
      log.error({ err: error }, "Non-operational error");
    }
    reply.status(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
      ...env,
    });
    return;
  }

  // ── Fastify validation errors (ajv) ───────────────────────────────────────
  if ("validation" in error && error.validation) {
    reply.status(400).send({
      success: false,
      error: "Request Validation Failed",
      code: "BAD_REQUEST",
      details: error.validation,
      ...env,
    });
    return;
  }

  // ── JWT errors ────────────────────────────────────────────────────────────
  if (
    error.message?.includes("Unauthorized") ||
    error.message?.includes("jwt")
  ) {
    reply.status(401).send({
      success: false,
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      ...env,
    });
    return;
  }

  // ── Prisma errors ──────────────────────────────────────────────────────────
  if ("code" in error) {
    const prismaError = error as {
      code: string;
      meta?: { target?: string[]; modelName?: string; table?: string };
    };
    if (prismaError.code === "P2002") {
      reply.status(409).send({
        success: false,
        error: `Duplicate value for: ${prismaError.meta?.target?.join(", ") ?? "field"}`,
        code: "CONFLICT",
        ...env,
      });
      return;
    }
    if (prismaError.code === "P2025") {
      reply.status(404).send({
        success: false,
        error: "Record not found",
        code: "NOT_FOUND",
        ...env,
      });
      return;
    }
    // Table does not exist (migration not applied)
    if (prismaError.code === "P2021") {
      log.error(
        { err: error, table: prismaError.meta?.table },
        "Table does not exist — run prisma migrate deploy",
      );
      reply.status(503).send({
        success: false,
        error: `Database table missing: ${prismaError.meta?.table ?? "unknown"}. Migration may not have been applied.`,
        code: "SERVICE_UNAVAILABLE",
        ...env,
      });
      return;
    }
    // Column does not exist (schema drift)
    if (prismaError.code === "P2022") {
      log.error(
        { err: error },
        "Column does not exist — schema drift detected",
      );
      reply.status(503).send({
        success: false,
        error: "Database schema drift detected. A migration may be pending.",
        code: "SERVICE_UNAVAILABLE",
        ...env,
      });
      return;
    }
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  const errMsg = error instanceof Error ? error.message : String(error);
  log.error({ err: error, message: errMsg }, "Unhandled error");
  reply.status(500).send({
    success: false,
    error: "Internal Server Error",
    code: "INTERNAL_ERROR",
    // Include error hint in non-production or when the error is a known safe type
    ...(process.env.NODE_ENV !== "production" ? { detail: errMsg } : {}),
    ...env,
  });
}
