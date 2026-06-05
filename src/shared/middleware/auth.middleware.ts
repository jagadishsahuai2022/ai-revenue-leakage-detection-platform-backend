import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError';
import { JwtPayload } from '../../types';

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();
    request.userId = payload.sub;
    request.companyId = payload.cid;
    request.userRole = payload.role;
    request.userEmail = payload.email;
  } catch {
    throw AppError.unauthorized('Invalid or expired token');
  }
}

export async function optionalAuthenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    const payload = await request.jwtVerify<JwtPayload>();
    request.userId = payload.sub;
    request.companyId = payload.cid;
    request.userRole = payload.role;
    request.userEmail = payload.email;
  } catch {
    // no-op – optional auth
  }
}
