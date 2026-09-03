import { isValidIanaTimezone, InvariantViolationError } from '@dispar-flux/domain';

export interface OperationalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ...
}

export interface OperationalDayBounds {
  startOfDay: Date; // 00:00:00.000 in operational timezone expressed as UTC Date
  endOfDay: Date;   // 23:59:59.999 in operational timezone expressed as UTC Date
}

/**
 * Validates that an IANA timezone string is valid.
 */
export function validateTimezone(tz: string): void {
  if (!isValidIanaTimezone(tz)) {
    throw new InvariantViolationError(`Invalid operational timezone: "${tz}"`);
  }
}

/**
 * Extracts local date parts for a Date in the given timezone.
 */
export function getOperationalDateParts(date: Date, timezone: string): OperationalDateParts {
  validateTimezone(timezone);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let dayOfWeek = 0;

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    else if (part.type === 'month') month = parseInt(part.value, 10);
    else if (part.type === 'day') day = parseInt(part.value, 10);
    else if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    else if (part.type === 'minute') minute = parseInt(part.value, 10);
    else if (part.type === 'second') second = parseInt(part.value, 10);
    else if (part.type === 'weekday') {
      const w = part.value.toLowerCase();
      if (w.startsWith('sun')) dayOfWeek = 0;
      else if (w.startsWith('mon')) dayOfWeek = 1;
      else if (w.startsWith('tue')) dayOfWeek = 2;
      else if (w.startsWith('wed')) dayOfWeek = 3;
      else if (w.startsWith('thu')) dayOfWeek = 4;
      else if (w.startsWith('fri')) dayOfWeek = 5;
      else if (w.startsWith('sat')) dayOfWeek = 6;
    }
  }

  return { year, month, day, hour, minute, second, dayOfWeek };
}

/**
 * Formats a Date using the Organization's Operational Timezone.
 */
export function formatInOperationalTimezone(
  date: Date,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  validateTimezone(timezone);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options,
  };
  return new Intl.DateTimeFormat('pt-BR', opts).format(date);
}

/**
 * Returns the ISO date string YYYY-MM-DD for a Date in the operational timezone.
 */
export function getOperationalDateString(date: Date, timezone: string): string {
  const parts = getOperationalDateParts(date, timezone);
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converts local (year, month, day, hour, minute, second, ms) in a specific timezone into the exact UTC Date.
 */
function localTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timezone: string
): Date {
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  const parts = getOperationalDateParts(utc, timezone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const diffMs = localAsUtc - targetAsUtc;
  utc = new Date(utc.getTime() - diffMs);
  return utc;
}

/**
 * Calculates startOfDay (00:00:00.000) and endOfDay (23:59:59.999) in the Organization's Operational Timezone (ADR 0019).
 * Returns exact UTC Dates representing those boundary moments.
 */
export function getOperationalDayBounds(date: Date, timezone: string): OperationalDayBounds {
  const parts = getOperationalDateParts(date, timezone);
  const startOfDay = localTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, 0, timezone);
  const endOfDay = localTimeToUtc(parts.year, parts.month, parts.day, 23, 59, 59, 999, timezone);

  return { startOfDay, endOfDay };
}

/**
 * Determines whether two dates fall on the same calendar day in the Operational Timezone.
 */
export function isSameOperationalDay(a: Date, b: Date, timezone: string): boolean {
  return getOperationalDateString(a, timezone) === getOperationalDateString(b, timezone);
}

/**
 * Checks if a given time falls within operational daily business hours (default 08:00 to 18:00) in the Operational Timezone.
 */
export function isWithinBusinessHours(
  date: Date,
  timezone: string,
  startHour = 8,
  endHour = 18
): boolean {
  const parts = getOperationalDateParts(date, timezone);
  // Exclude Sunday (0) and Saturday (6) if standard business hours
  if (parts.dayOfWeek === 0 || parts.dayOfWeek === 6) {
    return false;
  }
  return parts.hour >= startHour && parts.hour < endHour;
}
