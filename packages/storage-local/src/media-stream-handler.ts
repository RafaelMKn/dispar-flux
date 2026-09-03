import type { StorageProvider, StreamRangeResult } from './types.js';
import { FileNotFoundError, InvalidRangeError } from './errors.js';

export interface HandleMediaRangeRequestOptions {
  provider: StorageProvider;
  key: string;
  rangeHeader?: string;
  contentTypeOverride?: string;
}

/**
 * Handles HTTP Range requests and streaming for voice notes, audio, and video (ADR 0012).
 * Conforms to RFC 7233 / RFC 9110 HTTP Range specifications.
 */
export async function handleMediaRangeRequest(
  options: HandleMediaRangeRequestOptions
): Promise<StreamRangeResult> {
  const { provider, key, rangeHeader, contentTypeOverride } = options;

  const metadata = await provider.getMetadata(key);
  if (!metadata) {
    throw new FileNotFoundError(key);
  }

  const contentType = contentTypeOverride || metadata.contentType || 'application/octet-stream';
  const totalSize = metadata.size;

  // Case 1: No Range header - return full resource (200 OK)
  if (!rangeHeader || !rangeHeader.trim()) {
    const stream = await provider.getStream(key);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': totalSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      },
      stream,
    };
  }

  // Case 2: Parse and process Range header
  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith('bytes=')) {
    return {
      statusCode: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    };
  }

  const rangeSpec = trimmed.slice(6).trim();
  // We handle single-range requests (standard for audio and video streaming)
  const match = /^(\d*)-(\d*)$/.exec(rangeSpec);
  if (!match) {
    return {
      statusCode: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    };
  }

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';

  let start: number;
  let end: number;

  if (rawStart === '' && rawEnd !== '') {
    // Suffix range: bytes=-500 (last 500 bytes)
    const suffixLength = parseInt(rawEnd, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      return {
        statusCode: 416,
        headers: {
          'Content-Range': `bytes */${totalSize}`,
          'Accept-Ranges': 'bytes',
        },
      };
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (rawStart !== '' && rawEnd === '') {
    // Prefix range: bytes=1000- (from offset 1000 to end)
    start = parseInt(rawStart, 10);
    end = totalSize - 1;
  } else if (rawStart !== '' && rawEnd !== '') {
    // Closed range: bytes=0-499
    start = parseInt(rawStart, 10);
    end = parseInt(rawEnd, 10);
  } else {
    // bytes=- is invalid
    return {
      statusCode: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    };
  }

  // Range validation according to RFC 7233
  if (
    isNaN(start) ||
    isNaN(end) ||
    start < 0 ||
    start >= totalSize ||
    end < start
  ) {
    return {
      statusCode: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Accept-Ranges': 'bytes',
      },
    };
  }

  // Clamp end to totalSize - 1
  end = Math.min(end, totalSize - 1);
  const chunkSize = end - start + 1;

  const stream = await provider.getStream(key, { start, end });

  return {
    statusCode: 206,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    },
    stream,
  };
}
