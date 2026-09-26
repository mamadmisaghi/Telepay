import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function key(value) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32) throw new Error('KEY_ENCRYPTION_KEY must be 32 random bytes, encoded as base64');
  return bytes;
}
export function encrypt(bytes, encryptionKey, context) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(encryptionKey), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
export function decrypt(value, encryptionKey, context) {
  const [iv, tag, data] = value.split('.').map(b => Buffer.from(b, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(encryptionKey), iv);
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
