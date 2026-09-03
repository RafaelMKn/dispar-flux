import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PasswordHasher } from '../src/password/password-hasher.js';
import { WeakPasswordError } from '../src/errors.js';

describe('Password & Secret Security (PBKDF2 & scrypt)', () => {
  const hasher = new PasswordHasher();

  it('hashes password with PBKDF2-SHA512 and unique salt per hash', () => {
    const password = 'StrongPassword123!';
    const hash1 = hasher.hash(password);
    const hash2 = hasher.hash(password);

    assert.ok(hash1.startsWith('$pbkdf2$sha512$i=100000$'));
    assert.ok(hash2.startsWith('$pbkdf2$sha512$i=100000$'));

    // Unique salts ensure hashes of identical passwords are distinct
    assert.notEqual(hash1, hash2);

    // Both hashes verify successfully
    assert.equal(hasher.verify(password, hash1), true);
    assert.equal(hasher.verify(password, hash2), true);
  });

  it('rejects incorrect passwords with timing-safe comparison', () => {
    const password = 'CorrectPassword456!';
    const hash = hasher.hash(password);

    assert.equal(hasher.verify('WrongPassword789!', hash), false);
    assert.equal(hasher.verify('correctpassword456!', hash), false); // case sensitivity
    assert.equal(hasher.verify('', hash), false);
  });

  it('hashes and verifies using scrypt', () => {
    const password = 'ScryptPassword2026!';
    const hash = hasher.hashScrypt(password);

    assert.ok(hash.startsWith('$scrypt$n=16384,r=8,p=1$'));
    assert.equal(hasher.verify(password, hash), true);
    assert.equal(hasher.verify('WrongScryptPassword!', hash), false);
  });

  it('enforces minimum 8-character password strength floor', () => {
    assert.throws(
      () => hasher.hash('short7'),
      (err: unknown) => err instanceof WeakPasswordError
    );

    assert.throws(
      () => hasher.hash(''),
      (err: unknown) => err instanceof WeakPasswordError
    );

    // Exactly 8 chars succeeds
    const hash8 = hasher.hash('12345678');
    assert.equal(hasher.verify('12345678', hash8), true);
  });
});
