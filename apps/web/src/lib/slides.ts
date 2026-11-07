import { BOARD_H, BOARD_W, MAX_SLIDES } from '@net360/protocol';

export const SLIDE_TYPES = '.pdf,application/pdf,image/png,image/jpeg,image/webp';

/** Slides are stored at 1.5× the board size, so text stays sharp full screen. */
const OUT_W = BOARD_W * 1.5;
const OUT_H = BOARD_H * 1.5;

/**
 * Fit a page or picture onto a board-shaped slide, as large as it goes. If its shape
 * differs from the board (4:3 slides, portrait pages), the spare edges take the colour
 * of the slide's own border instead of white bars, so the slide reads edge to edge.
 */
function frame(src: CanvasImageSource, srcW: number, srcH: number) {
  const c = document.createElement('canvas');
  c.width = OUT_W;
  c.height = OUT_H;
  const ctx = c.getContext('2d')!;
  const k = Math.min(OUT_W / srcW, OUT_H / srcH);
  const w = srcW * k;
  const h = srcH * k;
  const x = (OUT_W - w) / 2;
  const y = (OUT_H - h) / 2;
  ctx.fillStyle = edgeColour(src, srcW, srcH, w < OUT_W - 1);
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h);
  return c;
}

/** The average colour along the sides that will meet the spare space (white if unsure). */
function edgeColour(src: CanvasImageSource, srcW: number, srcH: number, sides: boolean) {
  try {
    const n = 64;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, srcW, srcH, 0, 0, n, n);
    const px = ctx.getImageData(0, 0, n, n).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < n; i++) {
      for (const [x, y] of sides ? [[0, i], [n - 1, i]] : [[i, 0], [i, n - 1]]) {
        const o = (y * n + x) * 4;
        r += px[o];
        g += px[o + 1];
        b += px[o + 2];
        count++;
      }
    }
    return `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
  } catch {
    return '#ffffff';
  }
}

async function toJpeg(c: HTMLCanvasElement): Promise<Uint8Array> {
  for (const q of [0.88, 0.78, 0.66, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && (blob.size < 1_200_000 || q === 0.55)) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error('Could not prepare the slide.');
}

/**
 * Turn a PDF (e.g. PowerPoint → Save as PDF) or a picture into slide images, one per page.
 * Pages are rendered here in the browser, so the server only stores finished images.
 */
export async function makeSlides(file: File, progress: (done: number, total: number) => void): Promise<Uint8Array[]> {
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file);
    progress(1, 1);
    return [await toJpeg(frame(bmp, bmp.width, bmp.height))];
  }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    throw new Error('Please choose a PDF or a picture. In PowerPoint or Google Slides, use “Download / Save as PDF”.');
  }
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = Math.min(doc.numPages, MAX_SLIDES);
  const out: Uint8Array[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(OUT_W / base.width, OUT_H / base.height) * 1.25; // sharp text
    const vp = page.getViewport({ scale });
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(vp.width);
    tmp.height = Math.ceil(vp.height);
    await page.render({ canvasContext: tmp.getContext('2d')!, viewport: vp }).promise;
    out.push(await toJpeg(frame(tmp, tmp.width, tmp.height)));
    page.cleanup();
    progress(n, total);
  }
  void doc.destroy();
  return out;
}
