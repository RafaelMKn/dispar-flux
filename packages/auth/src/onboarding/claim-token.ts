import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CLAIM_TOKEN_FILENAME = 'claim.token';

/**
 * Generates a high-entropy, human-readable claim token.
 * Format: FLUX-XXXX-XXXX-XXXX
 */
export function generateClaimToken(): string {
  const bytes = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `FLUX-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}`;
}

/**
 * Gets or creates the claim token file on first boot.
 * If the file already exists, returns its content.
 * Otherwise, generates a new token and writes it with restricted file permissions (0600).
 */
export function getOrCreateClaimToken(dataDir: string): string {
  const filePath = path.join(dataDir, CLAIM_TOKEN_FILENAME);

  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8').trim();
    if (existing) {
      return existing;
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const token = generateClaimToken();

  try {
    fs.writeFileSync(filePath, token, { mode: 0o600, encoding: 'utf-8' });
  } catch {
    // Fallback if mode not supported on OS
    fs.writeFileSync(filePath, token, { encoding: 'utf-8' });
  }

  return token;
}

/**
 * Reads the claim token from the file if it exists, or returns null.
 */
export function readClaimToken(dataDir: string): string | null {
  const filePath = path.join(dataDir, CLAIM_TOKEN_FILENAME);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  return content || null;
}

/**
 * Verifies if the provided code matches the stored claim token using constant-time comparison.
 */
export function verifyClaimToken(dataDir: string, code: string): boolean {
  const currentToken = readClaimToken(dataDir);
  if (!currentToken || !code) {
    return false;
  }

  const cleanProvided = code.trim().toUpperCase();
  const cleanStored = currentToken.trim().toUpperCase();

  const bufProvided = Buffer.from(cleanProvided);
  const bufStored = Buffer.from(cleanStored);

  if (bufProvided.length !== bufStored.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufProvided, bufStored);
}

/**
 * Destroys the claim token file immediately after successful claiming.
 */
export function destroyClaimToken(dataDir: string): void {
  const filePath = path.join(dataDir, CLAIM_TOKEN_FILENAME);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Overwrite first if unlink fails
      fs.writeFileSync(filePath, '');
      fs.unlinkSync(filePath);
    }
  }
}
