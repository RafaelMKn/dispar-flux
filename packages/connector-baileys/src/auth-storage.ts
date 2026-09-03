import fs from 'node:fs';
import path from 'node:path';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { AuthStorageError } from './errors.js';

export interface AuthStateResult {
  state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'];
  saveCreds: () => Promise<void>;
  authDir: string;
}

export interface AuthStorageOptions {
  dataDir?: string;
  authDir?: string;
  authStateFactory?: (dir: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
}

/**
 * Validates connectionId to prevent directory traversal and invalid characters.
 */
export function validateConnectionId(connectionId: string): void {
  if (!connectionId || typeof connectionId !== 'string') {
    throw new AuthStorageError('Connection ID must be a non-empty string');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(connectionId)) {
    throw new AuthStorageError(`Invalid connection ID: '${connectionId}'. Must contain only alphanumeric characters, underscores, or hyphens.`);
  }
}

/**
 * Resolves the absolute path for wa-auth storage: ${DATA_DIR}/wa-auth/${connectionId}
 */
export function resolveAuthDir(connectionId: string, options?: { dataDir?: string; authDir?: string }): string {
  validateConnectionId(connectionId);
  if (options?.authDir) {
    return path.resolve(options.authDir);
  }
  const baseDataDir = options?.dataDir || process.env['DATA_DIR'] || './data';
  return path.resolve(baseDataDir, 'wa-auth', connectionId);
}

/**
 * Restricts directory permissions to 0o700 (owner only rwx)
 * and contained files to 0o600 (owner only rw) on POSIX platforms.
 */
export function securePermissions(targetPath: string): void {
  try {
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      if (process.platform !== 'win32') {
        fs.chmodSync(targetPath, 0o700);
      }
      const entries = fs.readdirSync(targetPath);
      for (const entry of entries) {
        securePermissions(path.join(targetPath, entry));
      }
    } else if (stat.isFile()) {
      if (process.platform !== 'win32') {
        fs.chmodSync(targetPath, 0o600);
      }
    }
  } catch (err: unknown) {
    // If permissions cannot be changed (e.g. read-only filesystem or specialized windows env), log or ignore
  }
}

/**
 * Ensures the wa-auth directory exists with restricted access permissions.
 * Keeps auth credentials completely separated from primary SQLite database.
 */
export function ensureSecureAuthDir(authDir: string): string {
  const resolved = path.resolve(authDir);
  try {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
    securePermissions(resolved);
    return resolved;
  } catch (err: unknown) {
    throw new AuthStorageError(`Failed to create secure auth directory at '${resolved}': ${(err as Error).message}`, err);
  }
}

/**
 * Checks whether credentials already exist in the auth directory.
 */
export function hasExistingAuth(connectionId: string, options?: AuthStorageOptions): boolean {
  const authDir = resolveAuthDir(connectionId, options);
  const credsFile = path.join(authDir, 'creds.json');
  return fs.existsSync(credsFile);
}

/**
 * Initializes MultiFileAuthState in ${DATA_DIR}/wa-auth/${connectionId}.
 */
export async function initAuthState(connectionId: string, options?: AuthStorageOptions): Promise<AuthStateResult> {
  const authDir = resolveAuthDir(connectionId, options);
  ensureSecureAuthDir(authDir);

  const factory = options?.authStateFactory || useMultiFileAuthState;
  try {
    const { state, saveCreds } = await factory(authDir);

    const wrappedSaveCreds = async () => {
      await saveCreds();
      // Enforce file permissions on newly created or modified credential files
      securePermissions(authDir);
    };

    return {
      state,
      saveCreds: wrappedSaveCreds,
      authDir,
    };
  } catch (err: unknown) {
    throw new AuthStorageError(`Failed to initialize MultiFileAuthState at '${authDir}': ${(err as Error).message}`, err);
  }
}

/**
 * Clears all auth session data from disk on logout or reset.
 */
export async function clearAuthDir(authDir: string): Promise<void> {
  const resolved = path.resolve(authDir);
  if (!fs.existsSync(resolved)) {
    return;
  }

  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err: unknown) {
    throw new AuthStorageError(`Failed to clean auth directory at '${resolved}': ${(err as Error).message}`, err);
  }
}
