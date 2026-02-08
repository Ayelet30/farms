import crypto from 'crypto';

function getMasterKeyBytes(masterKey: string): Buffer {
  // masterKey חייב להיות base64 של 32 bytes
  const key = Buffer.from(masterKey, 'base64');
  if (key.length !== 32) throw new Error('GMAIL_MASTER_KEY must be 32 bytes base64');
  return key;
}

export function encryptRefreshToken(refreshToken: string, masterKeyBase64: string) {
  const key = getMasterKeyBytes(masterKeyBase64);
  const iv = crypto.randomBytes(12); // 96-bit for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const enc = Buffer.concat([cipher.update(refreshToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encBase64: enc.toString('base64'),
    ivBase64: iv.toString('base64'),
    tagBase64: tag.toString('base64'),
  };
}

export function decryptRefreshToken(
  encBase64: string,
  ivBase64: string,
  tagBase64: string,
  masterKeyBase64: string
) {
  const key = getMasterKeyBytes(masterKeyBase64);
  const iv = Buffer.from(ivBase64, 'base64');
  const tag = Buffer.from(tagBase64, 'base64');
  const enc = Buffer.from(encBase64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

// crypto-gmail.ts
export const encryptSecret = encryptRefreshToken;
export const decryptSecret = decryptRefreshToken;

