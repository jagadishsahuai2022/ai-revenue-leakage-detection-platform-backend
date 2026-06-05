import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { registerTenantMiddleware } from './tenant-enforcement.plugin';
import { registerSlowQueryMiddleware } from './slow-query-monitor';

async function prismaPlugin(fastify: FastifyInstance): Promise<void> {
  const prisma = new PrismaClient({
    log: process.env['NODE_ENV'] === 'development'
      ? ['query', 'warn', 'error']
      : ['warn', 'error'],
  });

  // ── Register Prisma middleware stack ─────────────────────────────────────
  // ORDER MATTERS: tenant enforcement runs first, then slow query monitor
  // wraps around it to include enforcement overhead in timing.
  registerTenantMiddleware(prisma);
  registerSlowQueryMiddleware(prisma, fastify.log);

  await prisma.$connect();
  fastify.log.info('✅ Prisma connected to PostgreSQL (tenant enforcement + slow query monitoring active)');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
    fastify.log.info('Prisma disconnected');
  });
}

export default fp(prismaPlugin, { name: 'prisma' });
