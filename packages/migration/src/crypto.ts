import crypto from 'node:crypto';
import fs from 'node:fs';
import { InvalidRecoveryKeyError, CorruptedBackupError } from './errors.js';

export const MAGIC_HEADER = Buffer.from('DFBK', 'ascii'); // Dispar Flux BacKup
export const FORMAT_VERSION = 1;
export const PBKDF2_ITERATIONS = 100_000;
export const KEY_LENGTH = 32; // 256 bits for AES-256-GCM
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12; // 96 bits standard for GCM
export const TAG_LENGTH = 16; // 128 bits tag

/**
 * Calculates the SHA-256 hash of a buffer or string.
 */
export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Calculates the SHA-256 hash of a file on disk.
 */
export function sha256File(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return sha256(fileBuffer);
}

/**
 * Derives a 256-bit symmetric encryption key from a Recovery Key using PBKDF2.
 */
export function deriveKey(recoveryKey: string, salt: Buffer): Buffer {
  const secret = recoveryKey.trim();
  if (!secret) {
    throw new InvalidRecoveryKeyError('Recovery key cannot be empty');
  }
  return crypto.pbkdf2Sync(secret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypts a plaintext payload using AES-256-GCM and the derived Recovery Key.
 * Returns the serialized binary payload with embedded header, salt, IV, and auth tag.
 */
export function encryptBackupPayload(plaintext: Buffer, recoveryKey: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(recoveryKey, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Header layout:
  // [4 bytes: MAGIC 'DFBK']
  // [1 byte: Version]
  // [1 byte: Salt Length (16)]
  // [16 bytes: Salt]
  // [1 byte: IV Length (12)]
  // [12 bytes: IV]
  // [1 byte: Tag Length (16)]
  // [16 bytes: Tag]
  // [Ciphertext bytes...]
  const header = Buffer.alloc(4 + 1 + 1 + SALT_LENGTH + 1 + IV_LENGTH + 1 + TAG_LENGTH);
  let offset = 0;

  MAGIC_HEADER.copy(header, offset);
  offset += MAGIC_HEADER.length;

  header.writeUInt8(FORMAT_VERSION, offset++);

  header.writeUInt8(SALT_LENGTH, offset++);
  salt.copy(header, offset);
  offset += SALT_LENGTH;

  header.writeUInt8(IV_LENGTH, offset++);
  iv.copy(header, offset);
  offset += IV_LENGTH;

  header.writeUInt8(TAG_LENGTH, offset++);
  tag.copy(header, offset);
  offset += TAG_LENGTH;

  return Buffer.concat([header, encrypted]);
}

/**
 * Decrypts an encrypted backup buffer using the provided Recovery Key.
 * Throws InvalidRecoveryKeyError if key is incorrect or tag verification fails.
 */
export function decryptBackupPayload(encryptedBuffer: Buffer, recoveryKey: string): Buffer {
  const minHeaderLen = 4 + 1 + 1 + SALT_LENGTH + 1 + IV_LENGTH + 1 + TAG_LENGTH;
  if (encryptedBuffer.length < minHeaderLen) {
    throw new CorruptedBackupError('Backup payload is too small to be a valid Dispar Flux backup artifact');
  }

  // Check magic header
  const magic = encryptedBuffer.subarray(0, 4);
  if (!magic.equals(MAGIC_HEADER)) {
    throw new CorruptedBackupError('Invalid backup file format: missing DFBK magic header');
  }

  let offset = 4;
  const version = encryptedBuffer.readUInt8(offset++);
  if (version !== FORMAT_VERSION) {
    throw new CorruptedBackupError(`Unsupported backup format version: ${version} (expected ${FORMAT_VERSION})`);
  }

  const saltLen = encryptedBuffer.readUInt8(offset++);
  if (saltLen !== SALT_LENGTH) {
    throw new CorruptedBackupError(`Invalid salt length: ${saltLen}`);
  }
  const salt = encryptedBuffer.subarray(offset, offset + saltLen);
  offset += saltLen;

  const ivLen = encryptedBuffer.readUInt8(offset++);
  if (ivLen !== IV_LENGTH) {
    throw new CorruptedBackupError(`Invalid IV length: ${ivLen}`);
  }
  const iv = encryptedBuffer.subarray(offset, offset + ivLen);
  offset += ivLen;

  const tagLen = encryptedBuffer.readUInt8(offset++);
  if (tagLen !== TAG_LENGTH) {
    throw new CorruptedBackupError(`Invalid Auth Tag length: ${tagLen}`);
  }
  const tag = encryptedBuffer.subarray(offset, offset + tagLen);
  offset += tagLen;

  const ciphertext = encryptedBuffer.subarray(offset);
  const key = deriveKey(recoveryKey, salt);

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted;
  } catch (err) {
    throw new InvalidRecoveryKeyError(
      'Failed to decrypt recovery backup: invalid recovery key or corrupted authentication tag',
      { cause: err }
    );
  }
}
