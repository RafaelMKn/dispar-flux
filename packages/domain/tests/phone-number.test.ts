import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneNumber,
  formatE164,
  isValidPhoneNumber,
  VALID_BRAZILIAN_DDDS,
  InvalidPhoneNumberError,
} from '../src/index.js';

describe('Phone Number Normalization & Brazilian Rules', () => {
  describe('Brazilian Mobile Numbers (9th digit rule)', () => {
    it('normalizes 11-digit mobile number with DDD and 9', () => {
      const res = normalizePhoneNumber('11987654321');
      assert.equal(res.isValid, true);
      assert.equal(res.e164, '+5511987654321');
      assert.equal(res.isBrazilian, true);
      assert.equal(res.isMobile, true);
      assert.equal(res.areaCode, '11');
      assert.equal(res.nationalNumber, '987654321');
    });

    it('automatically adds 9th digit to 10-digit mobile number (DDD + 8 digits starting with 6-9)', () => {
      // DDD 11, starts with 8 -> mobile missing 9th digit
      const res = normalizePhoneNumber('1187654321');
      assert.equal(res.isValid, true);
      assert.equal(res.e164, '+5511987654321');
      assert.equal(res.isMobile, true);
      assert.equal(res.nationalNumber, '987654321');

      // DDD 21, starts with 9 -> mobile missing 9th digit
      const res2 = normalizePhoneNumber('2198887766');
      assert.equal(res2.isValid, true);
      assert.equal(res2.e164, '+5521998887766');

      // DDD 31, starts with 7
      const res3 = normalizePhoneNumber('3171234567');
      assert.equal(res3.isValid, true);
      assert.equal(res3.e164, '+5531971234567');
    });

    it('normalizes 12-digit number with DDI 55 missing the 9th digit', () => {
      const res = normalizePhoneNumber('551187654321');
      assert.equal(res.isValid, true);
      assert.equal(res.e164, '+5511987654321');
      assert.equal(res.isMobile, true);
    });

    it('normalizes 13-digit number with DDI 55 and 9th digit', () => {
      const res = normalizePhoneNumber('+5511987654321');
      assert.equal(res.isValid, true);
      assert.equal(res.e164, '+5511987654321');
      assert.equal(res.isMobile, true);
    });

    it('handles formatted input with parenthesis, spaces, and hyphens', () => {
      const inputs = [
        '(11) 98765-4321',
        '+55 (11) 98765-4321',
        '+55 11 98765 4321',
        '  (11) 8765-4321  ',
      ];

      for (const input of inputs) {
        const res = normalizePhoneNumber(input);
        assert.equal(res.isValid, true, `Failed for input: ${input}`);
        assert.equal(res.e164, '+5511987654321');
      }
    });

    it('strips trunk zero prefix (e.g. 011...)', () => {
      const res = normalizePhoneNumber('011987654321');
      assert.equal(res.isValid, true);
      assert.equal(res.e164, '+5511987654321');
    });
  });

  describe('Brazilian Landline Numbers', () => {
    it('normalizes landline numbers starting with 2, 3, 4, 5 without inserting 9', () => {
      const res = normalizePhoneNumber('1134567890');
      assert.equal(res.isValid, true);
      assert.equal(res.e164, '+551134567890');
      assert.equal(res.isMobile, false);
      assert.equal(res.nationalNumber, '34567890');

      const res2 = normalizePhoneNumber('+55 (21) 2345-6789');
      assert.equal(res2.isValid, true);
      assert.equal(res2.e164, '+552123456789');
      assert.equal(res2.isMobile, false);
    });
  });

  describe('Brazilian DDD Validation', () => {
    it('verifies all valid Anatel DDDs exist in lookup set', () => {
      assert.ok(VALID_BRAZILIAN_DDDS.has('11'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('21'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('31'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('41'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('51'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('61'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('71'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('81'));
      assert.ok(VALID_BRAZILIAN_DDDS.has('91'));
    });

    it('rejects numbers with non-existent Brazilian DDDs', () => {
      // 05, 23, 25, 26, 29, 36, 39, 52 are not valid DDDs in Brazil
      const invalidDDDs = ['23', '26', '36', '39', '52', '72', '76'];
      for (const ddd of invalidDDDs) {
        const res = normalizePhoneNumber(`${ddd}987654321`);
        assert.equal(res.isValid, false, `Expected DDD ${ddd} to be invalid`);
        assert.match(res.error ?? '', /Invalid Brazilian area code/);
      }
    });
  });

  describe('International Numbers', () => {
    it('normalizes valid international numbers conforming to ITU-T E.164', () => {
      // US (+1)
      const us = normalizePhoneNumber('+14155552671');
      assert.equal(us.isValid, true);
      assert.equal(us.e164, '+14155552671');
      assert.equal(us.isBrazilian, false);

      // Portugal (+351)
      const pt = normalizePhoneNumber('+351912345678');
      assert.equal(pt.isValid, true);
      assert.equal(pt.e164, '+351912345678');
      assert.equal(pt.isBrazilian, false);

      // Argentina (+54)
      const ar = normalizePhoneNumber('+5491123456789');
      assert.equal(ar.isValid, true);
      assert.equal(ar.e164, '+5491123456789');
    });

    it('rejects international numbers with invalid lengths (<7 or >15 digits)', () => {
      const tooShort = normalizePhoneNumber('+12345');
      assert.equal(tooShort.isValid, false);

      const tooLong = normalizePhoneNumber('+12345678901234567');
      assert.equal(tooLong.isValid, false);
    });
  });

  describe('Validation & Formatting Helpers', () => {
    it('rejects dummy repeated numbers and empty strings', () => {
      assert.equal(isValidPhoneNumber('00000000000'), false);
      assert.equal(isValidPhoneNumber('11111111111'), false);
      assert.equal(isValidPhoneNumber(''), false);
      assert.equal(isValidPhoneNumber('abc'), false);
    });

    it('formatE164 returns valid E.164 string or throws InvalidPhoneNumberError', () => {
      assert.equal(formatE164('11 98765-4321'), '+5511987654321');
      assert.throws(() => formatE164('invalid-number'), InvalidPhoneNumberError);
    });
  });
});
