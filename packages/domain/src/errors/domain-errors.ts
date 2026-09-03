export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SafetyFloorViolationError extends DomainError {
  constructor(message: string, public readonly rule: string) {
    super(message, 'SAFETY_FLOOR_VIOLATION');
  }
}

export class OptOutViolationError extends DomainError {
  constructor(message: string, public readonly phone: string) {
    super(message, 'OPT_OUT_VIOLATION');
  }
}

export class InvalidPhoneNumberError extends DomainError {
  constructor(message: string, public readonly rawPhone: string) {
    super(message, 'INVALID_PHONE_NUMBER');
  }
}

export class ReauthorizationError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_REAUTHORIZATION');
  }
}

export class InvariantViolationError extends DomainError {
  constructor(message: string) {
    super(message, 'INVARIANT_VIOLATION');
  }
}
