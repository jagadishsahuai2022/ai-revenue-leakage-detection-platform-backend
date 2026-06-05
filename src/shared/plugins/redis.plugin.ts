import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '../../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis?: Redis;
  }
}

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  if (!env.REDIS_ENABLED) {
    fastify.log.warn('Redis is disabled (REDIS_ENABLED=false). Skipping Redis connection.');
    return;
  }

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (err) => fastify.log.error({ err }, 'Redis error'));
  redis.on('connect', () => fastify.log.info('✅ Redis connected'));

  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
    fastify.log.info('Redis disconnected');
  });
}

export default fp(redisPlugin, { name: 'redis' });
