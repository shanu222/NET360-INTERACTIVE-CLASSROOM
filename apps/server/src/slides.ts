/**
 * Slide images, kept only in this server's memory while their meeting is live.
 * They are never written to disk, a database or cloud storage, and are erased
 * when the meeting ends (see dropSlides).
 */
const MEMORY_LIMIT = 600 * 1024 * 1024;
const memory = new Map<string, Buffer>();
let memoryBytes = 0;

export async function saveSlide(img: string, data: Buffer): Promise<void> {
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
  return memory.get(img) ?? null;
}

/** Erase every slide of a meeting. */
export function dropSlides(sessionId: string) {
  const prefix = `${sessionId}/`;
  for (const [k, v] of memory) {
    if (k.startsWith(prefix)) {
      memory.delete(k);
      memoryBytes -= v.length;
    }
  }
}
