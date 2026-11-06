import { r2Enabled } from './config.ts';
import { getObject, putObject } from './storage.ts';

/**
 * Slide images. With R2 configured they're stored there (they survive restarts);
 * otherwise they're kept in memory, up to a limit.
 */
const MEMORY_LIMIT = 400 * 1024 * 1024;
const memory = new Map<string, Buffer>();
let memoryBytes = 0;

const key = (img: string) => `slides/${img}`;

export async function saveSlide(img: string, data: Buffer): Promise<void> {
  if (r2Enabled) {
    await putObject(key(img), data, 'image/jpeg');
    return;
  }
  if (memoryBytes + data.length > MEMORY_LIMIT) {
    // Forget the oldest slides to make room.
    for (const [k, v] of memory) {
      memory.delete(k);
      memoryBytes -= v.length;
      if (memoryBytes + data.length <= MEMORY_LIMIT) break;
    }
  }
  memory.set(img, data);
  memoryBytes += data.length;
}

export async function loadSlide(img: string): Promise<Buffer | null> {
  const m = memory.get(img);
  if (m) return m;
  if (!r2Enabled) return null;
  return getObject(key(img));
}
