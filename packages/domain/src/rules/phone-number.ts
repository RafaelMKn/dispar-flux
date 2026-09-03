import { InvalidPhoneNumberError } from '../errors/domain-errors.js';

/**
 * Valid Brazilian Area Codes (DDDs) according to Anatel.
 */
export const VALID_BRAZILIAN_DDDS = new Set<string>([
  // SP
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  // RJ / ES
  '21', '22', '24', '27', '28',
  // MG
  '31', '32', '33', '34', '35', '37', '38',
  // PR / SC
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  // RS
  '51', '53', '54', '55',
  // DF / GO / TO / MT / MS / AC / RO
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  // BA / SE
  '71', '73', '74', '75', '77', '79',
  // PE / AL / PB / RN / CE / PI
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  // PA / AM / AP / RR / MA
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export interface NormalizedPhoneNumber {
  raw: string;
  e164: string; // e.g. "+5511987654321"
  digits: string; // e.g. "5511987654321"
  countryCode: string;
  areaCode?: string;
  nationalNumber: string;
  isBrazilian: boolean;
  isMobile?: boolean;
  isValid: boolean;
  error?: string;
}

/**
 * Normalizes any phone number input to canonical E.164 format.
 * Implements Brazilian Anatel 9th digit rules:
 * - Mobile numbers with 8 digits (missing 9th digit) are automatically normalized with the leading '9'.
 * - Area codes (DDD) are strictly verified against valid Anatel DDDs.
 * - Landlines (starting with 2, 3, 4, 5) are identified.
 * - International numbers (E.164, 7-15 digits) are preserved and validated.
 */
export function normalizePhoneNumber(
  rawInput: string,
  defaultCountryCode = '55'
): NormalizedPhoneNumber {
  const raw = rawInput ? String(rawInput).trim() : '';

  if (!raw) {
    return {
      raw,
      e164: '',
      digits: '',
      countryCode: '',
      nationalNumber: '',
      isBrazilian: false,
      isValid: false,
      error: 'Phone number cannot be empty',
    };
  }

  // Strip non-digit characters except potential leading plus sign
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');

  // Strip international dialing prefixes: 00XX or single leading 0 if local
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Check for repeated dummy numbers (e.g. 0000000000, 11111111111)
  if (/^(\d)\1{7,}$/.test(digits)) {
    return {
      raw,
      e164: '',
      digits,
      countryCode: '',
      nationalNumber: '',
      isBrazilian: false,
      isValid: false,
      error: 'Repeated sequential digits are not valid phone numbers',
    };
  }

  // Determine if it's Brazilian
  let isBrazilian = false;
  let countryCode = defaultCountryCode;

  if (hasPlus) {
    if (digits.startsWith('55')) {
      isBrazilian = true;
      countryCode = '55';
    } else {
      isBrazilian = false;
    }
  } else if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    // Starts with 55 and length matches BR (55 + 2 DDD + 8 or 9)
    isBrazilian = true;
    countryCode = '55';
  } else if (digits.startsWith('0') && digits.length >= 11 && digits.length <= 12) {
    // Strip leading 0 from trunk prefix (e.g. 011987654321 -> 11987654321)
    digits = digits.slice(1);
    isBrazilian = true;
    countryCode = '55';
  } else if (defaultCountryCode === '55' && (digits.length === 10 || digits.length === 11)) {
    isBrazilian = true;
    countryCode = '55';
  }

  if (isBrazilian) {
    return normalizeBrazilianPhone(raw, digits);
  }

  return normalizeInternationalPhone(raw, digits, hasPlus);
}

function normalizeBrazilianPhone(raw: string, digitsInput: string): NormalizedPhoneNumber {
  let digits = digitsInput;

  // Remove leading 55 if present to inspect DDD and local number
  if (digits.startsWith('55') && digits.length > 10) {
    digits = digits.slice(2);
  }

  // Now digits should be 10 (DDD + 8) or 11 (DDD + 9)
  if (digits.length !== 10 && digits.length !== 11) {
    return {
      raw,
      e164: '',
      digits: digitsInput,
      countryCode: '55',
      nationalNumber: digits,
      isBrazilian: true,
      isValid: false,
      error: `Invalid Brazilian phone length (${digits.length} digits). Expected 10 or 11 digits with DDD.`,
    };
  }

  const ddd = digits.slice(0, 2);
  if (!VALID_BRAZILIAN_DDDS.has(ddd)) {
    return {
      raw,
      e164: '',
      digits: digitsInput,
      countryCode: '55',
      areaCode: ddd,
      nationalNumber: digits.slice(2),
      isBrazilian: true,
      isValid: false,
      error: `Invalid Brazilian area code (DDD): ${ddd}`,
    };
  }

  let localNumber = digits.slice(2);
  let isMobile = false;

  if (localNumber.length === 8) {
    const firstDigit = localNumber[0]!;
    if (['6', '7', '8', '9'].includes(firstDigit)) {
      // Mobile missing the 9th digit! Add it.
      localNumber = `9${localNumber}`;
      isMobile = true;
    } else if (['2', '3', '4', '5'].includes(firstDigit)) {
      // Landline
      isMobile = false;
    } else {
      return {
        raw,
        e164: '',
        digits: digitsInput,
        countryCode: '55',
        areaCode: ddd,
        nationalNumber: localNumber,
        isBrazilian: true,
        isValid: false,
        error: `Invalid first digit for 8-digit number: ${firstDigit}`,
      };
    }
  } else if (localNumber.length === 9) {
    if (localNumber[0] !== '9') {
      return {
        raw,
        e164: '',
        digits: digitsInput,
        countryCode: '55',
        areaCode: ddd,
        nationalNumber: localNumber,
        isBrazilian: true,
        isValid: false,
        error: `Brazilian 9-digit mobile numbers must start with 9, got ${localNumber[0]}`,
      };
    }
    isMobile = true;
  }

  const finalDigits = `55${ddd}${localNumber}`;
  const e164 = `+${finalDigits}`;

  return {
    raw,
    e164,
    digits: finalDigits,
    countryCode: '55',
    areaCode: ddd,
    nationalNumber: localNumber,
    isBrazilian: true,
    isMobile,
    isValid: true,
  };
}

function normalizeInternationalPhone(
  raw: string,
  digits: string,
  _hasPlus: boolean
): NormalizedPhoneNumber {
  // ITU-T E.164: standard numbers have between 7 and 15 digits
  if (digits.length < 7 || digits.length > 15) {
    return {
      raw,
      e164: '',
      digits,
      countryCode: '',
      nationalNumber: digits,
      isBrazilian: false,
      isValid: false,
      error: `Invalid E.164 phone length (${digits.length} digits). ITU standard requires 7 to 15 digits.`,
    };
  }

  const e164 = `+${digits}`;

  return {
    raw,
    e164,
    digits,
    countryCode: digits.slice(0, 1), // Approximate leading country code
    nationalNumber: digits.slice(1),
    isBrazilian: false,
    isValid: true,
  };
}

/**
 * Normalizes input to canonical E.164 or throws InvalidPhoneNumberError.
 */
export function formatE164(raw: string, defaultCountryCode = '55'): string {
  const result = normalizePhoneNumber(raw, defaultCountryCode);
  if (!result.isValid) {
    throw new InvalidPhoneNumberError(result.error ?? 'Invalid phone number', raw);
  }
  return result.e164;
}

/**
 * Quick boolean check if a phone number is valid.
 */
export function isValidPhoneNumber(raw: string, defaultCountryCode = '55'): boolean {
  return normalizePhoneNumber(raw, defaultCountryCode).isValid;
}
