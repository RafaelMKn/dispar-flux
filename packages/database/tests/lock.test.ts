import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InstallationLock, InstallationLockedError, InstallationLockInfo } from '../src/index.js';

describe('Database: Installation Lock (ADR 0004 & ADR 0010)', () => {
  const tempDirs: string[] = [];

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-lock-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
    tempDirs.length = 0;
  });

  it('acquires lock, writes instance.lock with PID, hostname, and startedAt', () => {
    const dir = createTempDir();
    const lock = InstallationLock.acquire(dir);

    try {
      assert.equal(lock.isHeld, true);
      const lockPath = path.join(dir, 'instance.lock');
      assert.ok(fs.existsSync(lockPath), 'instance.lock file must exist on disk');

      const content = fs.readFileSync(lockPath, 'utf-8');
      const info = JSON.parse(content) as InstallationLockInfo;

      assert.equal(info.pid, process.pid);
      assert.equal(info.hostname, os.hostname());
      assert.ok(info.startedAt, 'startedAt timestamp must be set');
      assert.ok(!isNaN(Date.parse(info.startedAt)), 'startedAt must be valid ISO date string');

      // In-memory lockInfo matches
      assert.deepEqual(lock.getLockInfo(), info);
    } finally {
      lock.release();
    }
  });

  it('throws InstallationLockedError when attempting to acquire a second lock on the same directory', () => {
    const dir = createTempDir();
    const lock1 = InstallationLock.acquire(dir);

    try {
      assert.throws(
        () => {
          InstallationLock.acquire(dir);
        },
        (err: unknown) => {
          assert.ok(err instanceof InstallationLockedError, 'Must be instance of InstallationLockedError');
          assert.equal(err.name, 'InstallationLockedError');
          assert.equal(err.pid, process.pid);
          assert.equal(err.hostname, os.hostname());
          assert.equal(
            err.message,
            `Another Dispar Flux runtime (PID ${process.pid}) is already active on this data directory.`
          );
          return true;
        }
      );
    } finally {
      lock1.release();
    }
  });

  it('allows new acquisition after the first lock is released', () => {
    const dir = createTempDir();
    const lock1 = InstallationLock.acquire(dir);
    assert.equal(lock1.isHeld, true);

    lock1.release();
    assert.equal(lock1.isHeld, false);
    assert.ok(!fs.existsSync(path.join(dir, 'instance.lock')), 'Lock file must be deleted on release');

    // Acquiring again should now succeed without error
    const lock2 = InstallationLock.acquire(dir);
    try {
      assert.equal(lock2.isHeld, true);
      assert.ok(fs.existsSync(path.join(dir, 'instance.lock')));
    } finally {
      lock2.release();
    }
  });

  it('cleans up stale lock file when previous owning PID is no longer alive', () => {
    const dir = createTempDir();
    const lockPath = path.join(dir, 'instance.lock');

    // Choose a PID that is definitely not running (e.g. 9999999 or find an inactive pid)
    let deadPid = 999999;
    while (deadPid > 100000) {
      if (!InstallationLock.isProcessAlive(deadPid)) {
        break;
      }
      deadPid--;
    }

    const staleInfo: InstallationLockInfo = {
      pid: deadPid,
      hostname: 'previous-crashed-host',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
    };

    fs.writeFileSync(lockPath, JSON.stringify(staleInfo), 'utf-8');
    assert.ok(fs.existsSync(lockPath));

    // Inspect should report NOT locked because owning PID is dead
    const inspection = InstallationLock.inspect(dir);
    assert.equal(inspection.isLocked, false);

    // Acquire should detect dead process, clear stale lock, and acquire successfully
    const lock = InstallationLock.acquire(dir);
    try {
      assert.equal(lock.isHeld, true);
      const content = fs.readFileSync(lockPath, 'utf-8');
      const info = JSON.parse(content) as InstallationLockInfo;
      assert.equal(info.pid, process.pid, 'Lock file should now belong to current process PID');
    } finally {
      lock.release();
    }
  });

  it('isProcessAlive accurately detects current process and non-existent processes', () => {
    assert.equal(InstallationLock.isProcessAlive(process.pid), true, 'Current process must be alive');
    assert.equal(InstallationLock.isProcessAlive(-1), false, 'Negative PID must be false');
    assert.equal(InstallationLock.isProcessAlive(0), false, 'PID 0 must be false');
  });

  it('inspect returns locked status and lock info for an active lock', () => {
    const dir = createTempDir();
    const lock = InstallationLock.acquire(dir);

    try {
      const inspection = InstallationLock.inspect(dir);
      assert.equal(inspection.isLocked, true);
      assert.equal(inspection.info?.pid, process.pid);
      assert.equal(inspection.info?.hostname, os.hostname());
    } finally {
      lock.release();
    }

    const postReleaseInspection = InstallationLock.inspect(dir);
    assert.equal(postReleaseInspection.isLocked, false);
  });
});
