// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM Credential Encryption / Decryption
//
// Used to encrypt sensitive fields (accessToken, refreshToken, apiKey,
// clientSecret) at rest in the ProviderConnection table.
//
// Encryption key is sourced from the CONNECTOR_ENCRYPTION_KEY env variable
// (64 hex chars = 32 bytes = 256 bits).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { env } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
const ENCODING = 'hex' as const;

/**
 * Derive the 32-byte encryption key from the environment variable.
 * Cached after first call for performance.
 */
let _cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;

  const keyHex = env.CONNECTOR_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'CONNECTOR_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  _cachedKey = Buffer.from(keyHex, 'hex');
  return _cachedKey;
}

/**
 * Encrypt a plaintext credential string using AES-256-GCM.
 *
 * Output format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * @param plaintext  The credential value to encrypt
 * @returns          Encrypted string in the format `iv:authTag:ciphertext`
 */
export function encryptCredential(plaintext: string): string {
  if (!plaintext) return '';

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', ENCODING);
  encrypted += cipher.final(ENCODING);

  const authTag = cipher.getAuthTag();

  return `${iv.toString(ENCODING)}:${authTag.toString(ENCODING)}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted credential string.
 *
 * @param encryptedValue  String in the format `iv:authTag:ciphertext`
 * @returns               Original plaintext credential
 * @throws                Error if the value is tampered with or key is wrong
 */
export function decryptCredential(encryptedValue: string): string {
  if (!encryptedValue) return '';

  const parts = encryptedValue.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format. Expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, ENCODING);
  const authTag = Buffer.from(authTagHex, ENCODING);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, ENCODING, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypt multiple credential fields at once.
 * Returns a new object with only the specified fields encrypted (others untouched).
 */
export function encryptCredentialFields<T extends Record<string, unknown>>(
  data: T,
  fields: (keyof T)[],
): T {
  const result = { ...data };
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      (result as Record<string, unknown>)[field as string] = encryptCredential(value);
    }
  }
  return result;
}

/**
 * Decrypt multiple credential fields at once.
 */
export function decryptCredentialFields<T extends Record<string, unknown>>(
  data: T,
  fields: (keyof T)[],
): T {
  const result = { ...data };
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      (result as Record<string, unknown>)[field as string] = decryptCredential(value);
    }
  }
  return result;
}

/**
 * Reset the cached key (useful for testing).
 */
export function _resetKeyCache(): void {
  _cachedKey = null;
}
