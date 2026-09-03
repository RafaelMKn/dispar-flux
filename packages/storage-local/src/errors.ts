export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export class FileNotFoundError extends StorageError {
  public readonly key: string;

  constructor(key: string) {
    super(`Media file not found for key "${key}"`);
    this.name = 'FileNotFoundError';
    this.key = key;
  }
}

export class InvalidStorageKeyError extends StorageError {
  public readonly key: string;

  constructor(key: string, reason?: string) {
    super(`Invalid opaque storage key "${key}"${reason ? `: ${reason}` : ''}`);
    this.name = 'InvalidStorageKeyError';
    this.key = key;
  }
}

export class UnauthorizedMediaAccessError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedMediaAccessError';
  }
}

export class InvalidRangeError extends StorageError {
  public readonly rangeHeader: string;

  constructor(rangeHeader: string, message?: string) {
    super(message || `Invalid or unsatisfiable HTTP Range header: "${rangeHeader}"`);
    this.name = 'InvalidRangeError';
    this.rangeHeader = rangeHeader;
  }
}
