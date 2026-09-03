import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InstallationLockedError } from './errors.js';

export interface InstallationLockInfo {
  pid: number;
  hostname: string;
  startedAt: string;
}

export class InstallationLock {
  private static activeLocks = new Map<string, InstallationLock>();

  private isReleased = false;
  private readonly exitHandler: () => void;

  private constructor(
    public readonly dataDir: string,
    public readonly lockPath: string,
    private readonly lockInfo: InstallationLockInfo
  ) {
    this.exitHandler = () => {
      this.cleanupOnExit();
    };
    process.on('exit', this.exitHandler);
  }

  /**
   * Checks whether a process with the given PID is currently running.
   */
  static isProcessAlive(pid: number): boolean {
    if (pid <= 0 || !Number.isInteger(pid)) return false;
    try {
      // Signal 0 tests for process existence without killing it
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ESRCH') {
        // No such process
        return false;
      }
      // EPERM means process exists but we lack permission to signal it -> definitely alive
      return error.code === 'EPERM';
    }
  }

  /**
   * Checks the lock status of a data directory without modifying it.
   */
  static inspect(dataDir: string): { isLocked: boolean; info?: InstallationLockInfo } {
    const resolvedDataDir = path.resolve(dataDir);
    const lockPath = path.join(resolvedDataDir, 'instance.lock');

    if (!fs.existsSync(lockPath)) {
      return { isLocked: false };
    }

    try {
      const raw = fs.readFileSync(lockPath, 'utf-8');
      const info = JSON.parse(raw) as InstallationLockInfo;
      if (info && typeof info.pid === 'number' && InstallationLock.isProcessAlive(info.pid)) {
        return { isLocked: true, info };
      }
    } catch {
      // Corrupt lock file
    }

    return { isLocked: false };
  }

  /**
   * Acquires the exclusive installation lock for the specified data directory.
   * Throws InstallationLockedError if another active runtime holds the lock.
   */
  static acquire(dataDir: string): InstallationLock {
    const resolvedDataDir = path.resolve(dataDir);
    const lockPath = path.join(resolvedDataDir, 'instance.lock');

    // Ensure data directory exists
    fs.mkdirSync(resolvedDataDir, { recursive: true });

    if (fs.existsSync(lockPath)) {
      let existing: InstallationLockInfo | null = null;
      try {
        const content = fs.readFileSync(lockPath, 'utf-8');
        existing = JSON.parse(content) as InstallationLockInfo;
      } catch {
        // Stale or corrupted file
      }

      if (existing && typeof existing.pid === 'number') {
        if (InstallationLock.isProcessAlive(existing.pid)) {
          throw new InstallationLockedError(
            `Another Dispar Flux runtime (PID ${existing.pid}) is already active on this data directory.`,
            {
              pid: existing.pid,
              hostname: existing.hostname,
              lockPath,
            }
          );
        }
      }

      // If we got here, the previous owning PID is dead -> clean up stale lock
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Ignored if already removed
      }
    }

    const lockInfo: InstallationLockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
    };

    // Write lock file
    fs.writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2), {
      flag: 'w',
      encoding: 'utf-8',
    });

    const lock = new InstallationLock(resolvedDataDir, lockPath, lockInfo);
    InstallationLock.activeLocks.set(resolvedDataDir, lock);
    return lock;
  }

  private cleanupOnExit(): void {
    try {
      if (fs.existsSync(this.lockPath)) {
        const raw = fs.readFileSync(this.lockPath, 'utf-8');
        const parsed = JSON.parse(raw) as InstallationLockInfo;
        if (parsed.pid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch {
      // Best effort cleanup during process exit
    }
  }

  /**
   * Releases the lock, removing the instance.lock file and unregistering exit listeners.
   */
  release(): void {
    if (this.isReleased) return;
    this.isReleased = true;

    process.removeListener('exit', this.exitHandler);
    InstallationLock.activeLocks.delete(this.dataDir);

    try {
      if (fs.existsSync(this.lockPath)) {
        const raw = fs.readFileSync(this.lockPath, 'utf-8');
        const parsed = JSON.parse(raw) as InstallationLockInfo;
        if (parsed.pid === process.pid) {
          fs.unlinkSync(this.lockPath);
        }
      }
    } catch {
      // Best effort removal
    }
  }

  getLockInfo(): InstallationLockInfo {
    return { ...this.lockInfo };
  }

  get isHeld(): boolean {
    return !this.isReleased && fs.existsSync(this.lockPath);
  }
}
