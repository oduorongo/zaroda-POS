import { randomBytes } from 'crypto';
import { decryptSecret, encryptSecret, parseEncryptionKey } from './secret-box';

describe('secret-box', () => {
  const key = randomBytes(32);

  it('round-trips a secret', () => {
    const stored = encryptSecret('tuma-api-key-123', key);
    expect(stored).not.toContain('tuma-api-key-123');
    expect(decryptSecret(stored, key)).toBe('tuma-api-key-123');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('refuses to decrypt with the wrong key', () => {
    const stored = encryptSecret('secret', key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });

  it('refuses a tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptSecret('secret', key).split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'), key)).toThrow();
  });

  it('rejects a missing or wrong-length key', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/not set/);
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseEncryptionKey(key.toString('base64')).equals(key)).toBe(true);
  });
});
