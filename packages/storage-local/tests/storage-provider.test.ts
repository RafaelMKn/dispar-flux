import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import {
  LocalStorageProvider,
  FileNotFoundError,
  InvalidStorageKeyError,
  generateAuthorizedMediaUrl,
  assertAuthorizedMediaAccess,
  isAuthorizedMediaAccess,
  UnauthorizedMediaAccessError,
} from '../src/index.js';

describe('Storage-Local: LocalStorageProvider (ADR 0012)', () => {
  let tempDir: string;
  let provider: LocalStorageProvider;
  const TEST_SECRET = 'super-secret-operational-key-256';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-storage-test-'));
    provider = new LocalStorageProvider({ mediaDir: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores binary data with hashed opaque identifier and retrieves it intact', async () => {
    const content = Buffer.from('Audio voice note data simulation 1234567890');
    const meta = await provider.put(content, {
      contentType: 'audio/ogg; codecs=opus',
      filename: 'original_voice_note.ogg',
    });

    // Verify opaque key format
    assert.ok(meta.key.startsWith('med_'), 'Key should start with opaque prefix med_');
    assert.match(meta.key, /^med_[a-f0-9]{32}$/, 'Key must be a safe alphanumeric opaque hash');
    assert.equal(meta.size, content.length);
    assert.equal(meta.contentType, 'audio/ogg; codecs=opus');
    assert.equal(meta.originalFilename, 'original_voice_note.ogg');
    assert.ok(meta.sha256.length === 64, 'Must compute valid SHA-256 digest');

    // Retrieve via get
    const retrieved = await provider.get(meta.key);
    assert.deepEqual(retrieved, content);

    // Retrieve metadata
    const fetchedMeta = await provider.getMetadata(meta.key);
    assert.ok(fetchedMeta);
    assert.equal(fetchedMeta.key, meta.key);
    assert.equal(fetchedMeta.size, meta.size);
    assert.equal(fetchedMeta.contentType, meta.contentType);
    assert.equal(fetchedMeta.sha256, meta.sha256);
  });

  it('stores data from a Readable stream', async () => {
    const rawData = 'Streaming video test chunk payload data';
    const stream = Readable.from([Buffer.from(rawData)]);

    const meta = await provider.put(stream, {
      contentType: 'video/mp4',
      filename: 'sample_video.mp4',
    });

    assert.ok(meta.key);
    assert.equal(meta.size, Buffer.byteLength(rawData));

    const retrieved = await provider.get(meta.key);
    assert.equal(retrieved.toString(), rawData);
  });

  it('deletes stored media and its sidecar metadata', async () => {
    const meta = await provider.put(Buffer.from('temporary data to delete'));
    assert.ok(await provider.getMetadata(meta.key));

    const deleted = await provider.delete(meta.key);
    assert.equal(deleted, true);

    const afterMeta = await provider.getMetadata(meta.key);
    assert.equal(afterMeta, null);

    await assert.rejects(
      async () => provider.get(meta.key),
      (err: unknown) => err instanceof FileNotFoundError
    );

    // Repeated delete returns false
    const deletedAgain = await provider.delete(meta.key);
    assert.equal(deletedAgain, false);
  });

  it('enforces ADR 0012: never leaks server paths and blocks directory traversal attempts', async () => {
    const maliciousKeys = [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      '/var/log/syslog',
      'C:\\sensitive\\passwords.txt',
      'foo/bar/baz',
      'test..key',
      'short',
    ];

    for (const badKey of maliciousKeys) {
      await assert.rejects(
        async () => provider.get(badKey),
        (err: unknown) => err instanceof InvalidStorageKeyError,
        `Expected bad key "${badKey}" to be rejected with InvalidStorageKeyError`
      );
      await assert.rejects(
        async () => provider.getStream(badKey),
        (err: unknown) => err instanceof InvalidStorageKeyError
      );
      await assert.rejects(
        async () => provider.delete(badKey),
        (err: unknown) => err instanceof InvalidStorageKeyError
      );
    }
  });

  it('generates authorized, short-lived media URLs with HMAC verification', async () => {
    const meta = await provider.put(Buffer.from('media content for authorized url test'));

    const url = generateAuthorizedMediaUrl({
      key: meta.key,
      secret: TEST_SECRET,
      expiresInSeconds: 60,
      memberId: 'mem_123',
      purpose: 'stream',
    });

    assert.ok(url.startsWith('/api/v1/media/' + meta.key));
    const parsedUrl = new URL(url, 'http://localhost');
    const token = parsedUrl.searchParams.get('token');
    const expires = parseInt(parsedUrl.searchParams.get('expires') || '0', 10);
    const purpose = parsedUrl.searchParams.get('purpose') || '';
    const memberId = parsedUrl.searchParams.get('memberId') || '';

    assert.ok(token);
    assert.ok(expires > Math.floor(Date.now() / 1000));

    // Valid access verification
    assert.doesNotThrow(() => {
      assertAuthorizedMediaAccess({
        key: meta.key,
        token: token!,
        expires,
        secret: TEST_SECRET,
        purpose,
        memberId,
      });
    });
    assert.equal(
      isAuthorizedMediaAccess({
        key: meta.key,
        token: token!,
        expires,
        secret: TEST_SECRET,
        purpose,
        memberId,
      }),
      true
    );

    // Rejects tampered token
    assert.throws(
      () => {
        assertAuthorizedMediaAccess({
          key: meta.key,
          token: 'tampered-token-1234567890abcdef',
          expires,
          secret: TEST_SECRET,
          purpose,
          memberId,
        });
      },
      (err: unknown) => err instanceof UnauthorizedMediaAccessError
    );

    // Rejects tampered key
    assert.throws(
      () => {
        assertAuthorizedMediaAccess({
          key: 'med_differentopaqueidentifier123456',
          token: token!,
          expires,
          secret: TEST_SECRET,
          purpose,
          memberId,
        });
      },
      (err: unknown) => err instanceof UnauthorizedMediaAccessError
    );

    // Rejects expired token
    const pastExpires = Math.floor(Date.now() / 1000) - 10;
    assert.throws(
      () => {
        assertAuthorizedMediaAccess({
          key: meta.key,
          token: token!,
          expires: pastExpires,
          secret: TEST_SECRET,
          purpose,
          memberId,
        });
      },
      (err: unknown) => err instanceof UnauthorizedMediaAccessError && err.message.includes('expired')
    );
  });
});
