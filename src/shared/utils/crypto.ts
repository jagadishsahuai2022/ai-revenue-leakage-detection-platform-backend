import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { env } from '../../config/env';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `rg_${generateSecureToken(24)}`;
  const hash = hashToken(raw);
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
