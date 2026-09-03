export class InstallationLockedError extends Error {
  readonly pid?: number;
  readonly hostname?: string;
  readonly lockPath?: string;

  constructor(
    message: string,
    options?: { pid?: number; hostname?: string; lockPath?: string }
  ) {
    super(message);
    this.name = 'InstallationLockedError';
    this.pid = options?.pid;
    this.hostname = options?.hostname;
    this.lockPath = options?.lockPath;
  }
}

export class MigrationError extends Error {
  readonly migrationName?: string;

  constructor(message: string, options?: { migrationName?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'MigrationError';
    this.migrationName = options?.migrationName;
  }
}

export class DatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'DatabaseError';
  }
}
