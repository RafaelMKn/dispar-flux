import crypto from 'node:crypto';
import { WeakPasswordError } from '../errors.js';

export interface PasswordHasherOptions {
  iterations?: number;
  keyLength?: number;
  digest?: 'sha512';
}

const DEFAULT_ITERATIONS = 100_000;
const DEFAULT_KEY_LENGTH = 64;
const DEFAULT_DIGEST = 'sha512';
const MIN_PASSWORD_LENGTH = 8;

export class PasswordHasher {
  private readonly iterations: number;
  private readonly keyLength: number;
  private readonly digest: 'sha512';

  constructor(options: PasswordHasherOptions = {}) {
    this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
    this.keyLength = options.keyLength ?? DEFAULT_KEY_LENGTH;
    this.digest = options.digest ?? DEFAULT_DIGEST;
  }

  /**
   * Validates password strength according to Dispar Flux baseline security policies.
   */
  validateStrength(password: string): void {
    if (!password || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new WeakPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    }
  }

  /**
   * Hashes a plain password using PBKDF2 with SHA-512 and a unique cryptographic salt.
   * Returns formatted string: $pbkdf2$sha512$i=<iterations>$<saltHex>$<hashHex>
   */
  hash(password: string): string {
    this.validateStrength(password);
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.pbkdf2Sync(
      password,
      salt,
      this.iterations,
      this.keyLength,
      this.digest
    );

    return `$pbkdf2$${this.digest}$i=${this.iterations}$${salt}$${derived.toString('hex')}`;
  }

  /**
   * Hashes a plain password using scrypt and a unique cryptographic salt.
   * Returns formatted string: $scrypt$n=<cost>,r=<blockSize>,p=<parallelization>$<saltHex>$<hashHex>
   */
  hashScrypt(password: string, cost = 16384, blockSize = 8, parallelization = 1): string {
    this.validateStrength(password);
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, this.keyLength, {
      N: cost,
      r: blockSize,
      p: parallelization,
    });

    return `$scrypt$n=${cost},r=${blockSize},p=${parallelization}$${salt}$${derived.toString('hex')}`;
  }

  /**
   * Verifies a plain password against an encoded hash ($pbkdf2$... or $scrypt$...).
   * Uses timing-safe constant-time comparison to prevent timing side-channel attacks.
   */
  verify(password: string, encodedHash: string): boolean {
    if (!password || !encodedHash || typeof encodedHash !== 'string') {
      return false;
    }

    const parts = encodedHash.split('$');
    // Format: ["", "pbkdf2", "sha512", "i=100000", "<salt>", "<hash>"]
    if (parts.length === 6 && parts[1] === 'pbkdf2') {
      const digest = parts[2] as 'sha512';
      const iterMatch = parts[3]?.match(/^i=(\d+)$/);
      if (!iterMatch || !iterMatch[1]) return false;

      const iterations = parseInt(iterMatch[1], 10);
      const salt = parts[4];
      const expectedHashHex = parts[5];

      if (!salt || !expectedHashHex) return false;

      const expectedBuffer = Buffer.from(expectedHashHex, 'hex');
      const actualBuffer = crypto.pbkdf2Sync(
        password,
        salt,
        iterations,
        expectedBuffer.length,
        digest
      );

      if (expectedBuffer.length !== actualBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    }

    // Format: ["", "scrypt", "n=16384,r=8,p=1", "<salt>", "<hash>"]
    if (parts.length === 5 && parts[1] === 'scrypt') {
      const params = parts[2];
      const nMatch = params?.match(/n=(\d+)/);
      const rMatch = params?.match(/r=(\d+)/);
      const pMatch = params?.match(/p=(\d+)/);

      if (!nMatch || !rMatch || !pMatch || !nMatch[1] || !rMatch[1] || !pMatch[1]) {
        return false;
      }

      const N = parseInt(nMatch[1], 10);
      const r = parseInt(rMatch[1], 10);
      const p = parseInt(pMatch[1], 10);
      const salt = parts[3];
      const expectedHashHex = parts[4];

      if (!salt || !expectedHashHex) return false;

      const expectedBuffer = Buffer.from(expectedHashHex, 'hex');
      const actualBuffer = crypto.scryptSync(password, salt, expectedBuffer.length, {
        N,
        r,
        p,
      });

      if (expectedBuffer.length !== actualBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    }

    return false;
  }
}

export const defaultPasswordHasher = new PasswordHasher();
