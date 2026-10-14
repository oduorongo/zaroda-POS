import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Encrypts a tenant-supplied third-party credential (e.g. a business's own
 * TUMA API key) before it's written to the database, so a leaked backup or
 * a stray SELECT doesn't hand out working payment credentials. AES-256-GCM:
 * authenticated, so a tampered ciphertext fails to decrypt rather than
 * silently producing garbage.
 *
 * The key comes from SECRETS_ENCRYPTION_KEY (32 random bytes, base64) - see
 * .env.example. Stored format is versioned ("v1:iv:tag:ciphertext", each
 * part base64) so a future key rotation can tell old rows from new ones.
 */
const VERSION = 'v1';
const IV_BYTES = 12;

export function parseEncryptionKey(base64Key: string | undefined): Buffer {
  if (!base64Key) {
    throw new Error(
      'SECRETS_ENCRYPTION_KEY is not set - required to store third-party credentials',
    );
  }
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('SECRETS_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognized encrypted secret format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
