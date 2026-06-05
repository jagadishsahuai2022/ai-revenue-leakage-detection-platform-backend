import { UserRole } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    redis?: Redis;
  }

  interface FastifyRequest {
    userId: string;
    companyId: string;
    userRole: UserRole;
    userEmail: string;
    /** UUID-v4 request trace ID — set by request-tracing plugin */
    requestId: string;
  }
}
