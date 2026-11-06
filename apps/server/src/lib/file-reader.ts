import { open } from 'node:fs/promises';
import type { ByteReader } from '@conbert/core';

/** Random access to a file on disk for the workshop code (closed afterwards). */
export async function withFileReader<T>(
  filePath: string,
  use: (reader: ByteReader) => Promise<T>,
): Promise<T> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const reader: ByteReader = {
      size,
      read: async (offset, length) => {
        const start = Math.max(0, Math.min(size, offset));
        const wanted = Math.max(0, Math.min(length, size - start));
        const buffer = Buffer.alloc(wanted);
        const { bytesRead } = await handle.read(buffer, 0, wanted, start);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      },
    };
    return await use(reader);
  } finally {
    await handle.close();
  }
}
