export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

export class ManifestValidationError extends MigrationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ManifestValidationError';
  }
}

export class TargetNotCleanError extends MigrationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TargetNotCleanError';
  }
}

export class InvalidRecoveryKeyError extends MigrationError {
  constructor(
    message: string = 'Failed to decrypt recovery backup: invalid recovery key or corrupted authentication tag',
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'InvalidRecoveryKeyError';
  }
}

export class CorruptedBackupError extends MigrationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CorruptedBackupError';
  }
}
