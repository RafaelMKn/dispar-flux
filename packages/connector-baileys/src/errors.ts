export class ConnectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectorError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ADR 0010: Exclusive socket ownership per connection.
 * Thrown when attempting to open a duplicate socket for an existing connectionId
 * without explicit replacement.
 */
export class DuplicateConnectionError extends ConnectorError {
  constructor(public readonly connectionId: string) {
    super(`An active or pending socket already exists for connection '${connectionId}' (ADR 0010 exclusive ownership)`);
    this.name = 'DuplicateConnectionError';
  }
}

export class ConnectionNotFoundError extends ConnectorError {
  constructor(public readonly connectionId: string) {
    super(`Connection '${connectionId}' not found or not initialized`);
    this.name = 'ConnectionNotFoundError';
  }
}

export class NotConnectedError extends ConnectorError {
  constructor(public readonly connectionId: string, public readonly currentStatus: string) {
    super(`Cannot send message on connection '${connectionId}': current status is '${currentStatus}' (expected 'connected')`);
    this.name = 'NotConnectedError';
  }
}

export class MessageDeliveryError extends ConnectorError {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'MessageDeliveryError';
  }
}

export class AuthStorageError extends ConnectorError {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'AuthStorageError';
  }
}
