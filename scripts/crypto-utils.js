const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;
const ITERATIONS = 100000;
const DIGEST = 'sha256';

/**
 * Derives a 256-bit key from a password and salt using PBKDF2.
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST);
}

/**
 * Encrypts a string or object using AES-256-GCM.
 * Output format is JSON containing base64 encoded salt, iv, tag, and ciphertext.
 * This is 100% compatible with Web Crypto API in browsers.
 */
function encrypt(data, password) {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2',
    iterations: ITERATIONS,
    digest: DIGEST,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

/**
 * Decrypts an encrypted payload using AES-256-GCM.
 */
function decrypt(payload, password) {
  if (!payload || !payload.salt || !payload.iv || !payload.tag || !payload.data) {
    throw new Error('Invalid encrypted payload format');
  }

  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.data, 'base64');

  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const decoded = decrypted.toString('utf8');

  try {
    return JSON.parse(decoded);
  } catch (e) {
    return decoded;
  }
}

module.exports = {
  encrypt,
  decrypt
};
