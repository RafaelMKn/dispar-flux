import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface TarEntry {
  name: string;
  data: Buffer;
  mode?: number;
  mtime?: number;
  isDir?: boolean;
}

/**
 * Creates a standard POSIX USTAR tar archive buffer from in-memory entries.
 */
export function packTar(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const isDir = entry.isDir || cleanName.endsWith('/');
    const data = entry.data || Buffer.alloc(0);
    const size = isDir ? 0 : data.length;
    const mode = entry.mode ?? (isDir ? 0o755 : 0o644);
    const mtime = entry.mtime ?? Math.floor(Date.now() / 1000);

    const header = Buffer.alloc(512);

    // Name (0-99)
    header.write(cleanName.slice(0, 100), 0, 100, 'utf8');

    // Mode (100-107): 7 octal digits + null
    header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii');

    // UID & GID (108-123)
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');

    // Size (124-135): 11 octal digits + null
    header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');

    // Mtime (136-147): 11 octal digits + null
    header.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');

    // Checksum placeholder (148-155): 8 spaces
    header.fill(0x20, 148, 156);

    // Typeflag (156): '0' for regular file, '5' for directory
    header.write(isDir ? '5' : '0', 156, 1, 'ascii');

    // Magic & version (257-264): "ustar\000"
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    // Calculate checksum
    let chksum = 0;
    for (let i = 0; i < 512; i++) {
      chksum += header[i]!;
    }

    // Write checksum (148-155): 6 octal digits + null + space
    header.write(chksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    chunks.push(header);

    if (size > 0) {
      chunks.push(data);
      const remainder = size % 512;
      if (remainder !== 0) {
        chunks.push(Buffer.alloc(512 - remainder));
      }
    }
  }

  // End of archive marker: two 512-byte zero blocks
  chunks.push(Buffer.alloc(1024));

  return Buffer.concat(chunks);
}

/**
 * Unpacks a USTAR tar (or gzip-compressed tar) buffer into in-memory entries.
 */
export function unpackTar(buffer: Buffer): TarEntry[] {
  let raw = buffer;
  // Detect gzip (magic bytes 0x1f 0x8b)
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    raw = zlib.gunzipSync(raw);
  }

  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);

    // Check for two consecutive empty blocks indicating end of tar
    let isAllZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        isAllZero = false;
        break;
      }
    }

    if (isAllZero) {
      break;
    }

    // Read name (0-100)
    let nullIdx = header.indexOf(0);
    if (nullIdx === -1 || nullIdx > 100) nullIdx = 100;
    const name = header.toString('utf8', 0, nullIdx).trim();

    if (!name) {
      offset += 512;
      continue;
    }

    // Read size (124-136)
    const sizeStr = header.toString('ascii', 124, 136).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Read typeflag (156)
    const typeflag = String.fromCharCode(header[156] || 48);
    const isDir = typeflag === '5' || name.endsWith('/');

    // Read mode
    const modeStr = header.toString('ascii', 100, 108).replace(/\0/g, '').trim();
    const mode = parseInt(modeStr, 8) || (isDir ? 0o755 : 0o644);

    // Read mtime
    const mtimeStr = header.toString('ascii', 136, 148).replace(/\0/g, '').trim();
    const mtime = parseInt(mtimeStr, 8) || Math.floor(Date.now() / 1000);

    offset += 512;

    let data = Buffer.alloc(0);
    if (!isDir && size > 0) {
      data = Buffer.from(raw.subarray(offset, offset + size));
      const remainder = size % 512;
      const padding = remainder === 0 ? 0 : 512 - remainder;
      offset += size + padding;
    }

    entries.push({
      name,
      data,
      mode,
      mtime,
      isDir,
    });
  }

  return entries;
}

/**
 * Traverses a directory recursively and packs all files into a tar buffer.
 */
export function packDirectory(dirPath: string, relativeRoot = ''): Buffer {
  const entries: TarEntry[] = [];

  function walk(currentDir: string, currentRel: string) {
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const relPath = currentRel ? `${currentRel}/${item}` : item;
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        entries.push({
          name: `${relPath}/`,
          data: Buffer.alloc(0),
          isDir: true,
          mode: stat.mode,
          mtime: Math.floor(stat.mtimeMs / 1000),
        });
        walk(fullPath, relPath);
      } else if (stat.isFile()) {
        const data = fs.readFileSync(fullPath);
        entries.push({
          name: relPath,
          data,
          isDir: false,
          mode: stat.mode,
          mtime: Math.floor(stat.mtimeMs / 1000),
        });
      }
    }
  }

  walk(dirPath, relativeRoot);
  return packTar(entries);
}

/**
 * Extracts a tar buffer into a target directory on disk.
 */
export function unpackToDirectory(tarBuffer: Buffer, targetDir: string): void {
  const entries = unpackTar(tarBuffer);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of entries) {
    // Prevent directory traversal vulnerabilities (zip slip)
    const normalized = path.normalize(entry.name).replace(/^(\.\.[\/\\])+/, '');
    const destPath = path.join(targetDir, normalized);

    if (entry.isDir) {
      fs.mkdirSync(destPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, entry.data);
    }
  }
}
