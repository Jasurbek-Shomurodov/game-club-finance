import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** Any long random secret works: it is hashed into a 256-bit AES key. */
function keyFrom(secret: string) {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** AES-256-GCM, stored as `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

/** Returns null for a value that was not written with this secret. */
export function decryptToken(stored: string, secret: string): string | null {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
