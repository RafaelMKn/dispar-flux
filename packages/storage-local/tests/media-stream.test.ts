import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import {
  LocalStorageProvider,
  handleMediaRangeRequest,
  FileNotFoundError,
} from '../src/index.js';

describe('Storage-Local: HTTP Range Requests & Media Streaming (ADR 0012)', () => {
  let tempDir: string;
  let provider: LocalStorageProvider;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-media-stream-test-'));
    provider = new LocalStorageProvider({ mediaDir: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  it('serves entire media with status 200 when no Range header is provided', async () => {
    // 1000 bytes test buffer
    const testData = Buffer.alloc(1000);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i % 256;
    }

    const meta = await provider.put(testData, { contentType: 'audio/ogg; codecs=opus' });

    const result = await handleMediaRangeRequest({
      provider,
      key: meta.key,
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['Content-Type'], 'audio/ogg; codecs=opus');
    assert.equal(result.headers['Content-Length'], 1000);
    assert.equal(result.headers['Accept-Ranges'], 'bytes');
    assert.ok(result.stream);

    const received = await streamToBuffer(result.stream);
    assert.deepEqual(received, testData);
  });

  it('handles standard closed range request (bytes=0-499) with status 206 Partial Content', async () => {
    const testData = Buffer.alloc(1000);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i % 256;
    }

    const meta = await provider.put(testData, { contentType: 'audio/ogg; codecs=opus' });

    const result = await handleMediaRangeRequest({
      provider,
      key: meta.key,
      rangeHeader: 'bytes=0-499',
    });

    assert.equal(result.statusCode, 206);
    assert.equal(result.headers['Content-Range'], 'bytes 0-499/1000');
    assert.equal(result.headers['Content-Length'], 500);
    assert.equal(result.headers['Content-Type'], 'audio/ogg; codecs=opus');
    assert.equal(result.headers['Accept-Ranges'], 'bytes');
    assert.ok(result.stream);

    const received = await streamToBuffer(result.stream);
    assert.equal(received.length, 500);
    assert.deepEqual(received, testData.subarray(0, 500));
  });

  it('handles open-ended range request (bytes=700-) with status 206', async () => {
    const testData = Buffer.alloc(1000);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i % 256;
    }

    const meta = await provider.put(testData, { contentType: 'video/mp4' });

    const result = await handleMediaRangeRequest({
      provider,
      key: meta.key,
      rangeHeader: 'bytes=700-',
    });

    assert.equal(result.statusCode, 206);
    assert.equal(result.headers['Content-Range'], 'bytes 700-999/1000');
    assert.equal(result.headers['Content-Length'], 300);
    assert.equal(result.headers['Content-Type'], 'video/mp4');
    assert.ok(result.stream);

    const received = await streamToBuffer(result.stream);
    assert.equal(received.length, 300);
    assert.deepEqual(received, testData.subarray(700, 1000));
  });

  it('handles suffix range request (bytes=-250) for seeking last bytes with status 206', async () => {
    const testData = Buffer.alloc(1000);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i % 256;
    }

    const meta = await provider.put(testData, { contentType: 'audio/mp4' });

    const result = await handleMediaRangeRequest({
      provider,
      key: meta.key,
      rangeHeader: 'bytes=-250',
    });

    assert.equal(result.statusCode, 206);
    assert.equal(result.headers['Content-Range'], 'bytes 750-999/1000');
    assert.equal(result.headers['Content-Length'], 250);
    assert.ok(result.stream);

    const received = await streamToBuffer(result.stream);
    assert.equal(received.length, 250);
    assert.deepEqual(received, testData.subarray(750, 1000));
  });

  it('returns 416 Range Not Satisfiable when start byte exceeds resource size', async () => {
    const testData = Buffer.from('short audio voice note message');
    const meta = await provider.put(testData, { contentType: 'audio/ogg' });

    const result = await handleMediaRangeRequest({
      provider,
      key: meta.key,
      rangeHeader: 'bytes=5000-6000',
    });

    assert.equal(result.statusCode, 416);
    assert.equal(result.headers['Content-Range'], `bytes */${testData.length}`);
    assert.equal(result.stream, undefined);
  });

  it('returns 416 Range Not Satisfiable for malformed range headers', async () => {
    const testData = Buffer.from('voice note');
    const meta = await provider.put(testData);

    const malformedHeaders = ['invalid', 'items=0-10', 'bytes=-', 'bytes=abc-def', 'bytes=100-50'];

    for (const header of malformedHeaders) {
      const result = await handleMediaRangeRequest({
        provider,
        key: meta.key,
        rangeHeader: header,
      });
      assert.equal(result.statusCode, 416, `Header "${header}" should return 416`);
    }
  });

  it('throws FileNotFoundError when media key does not exist', async () => {
    await assert.rejects(
      async () => {
        await handleMediaRangeRequest({
          provider,
          key: 'med_nonexistentkey12345678901234',
          rangeHeader: 'bytes=0-100',
        });
      },
      (err: unknown) => err instanceof FileNotFoundError
    );
  });
});
