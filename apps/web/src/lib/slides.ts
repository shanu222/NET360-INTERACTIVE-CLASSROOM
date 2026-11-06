import { BOARD_H, BOARD_W, MAX_SLIDES } from '@net360/protocol';

export const SLIDE_TYPES = '.pdf,application/pdf,image/png,image/jpeg,image/webp';

/** Draw a page or picture onto a board-sized white slide, fitted and centred. */
function frame(draw: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void, srcW: number, srcH: number) {
  const c = document.createElement('canvas');
  c.width = BOARD_W;
  c.height = BOARD_H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  const k = Math.min(BOARD_W / srcW, BOARD_H / srcH);
  const w = srcW * k;
  const h = srcH * k;
  draw(ctx, (BOARD_W - w) / 2, (BOARD_H - h) / 2, w, h);
  return c;
}

async function toJpeg(c: HTMLCanvasElement): Promise<Uint8Array> {
  for (const q of [0.86, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && (blob.size < 1_200_000 || q === 0.6)) return new Uint8Array(await blob.arrayBuffer());
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
    return [await toJpeg(frame((ctx, x, y, w, h) => ctx.drawImage(bmp, x, y, w, h), bmp.width, bmp.height))];
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
    const scale = Math.min(BOARD_W / base.width, BOARD_H / base.height) * 1.5; // sharp text
    const vp = page.getViewport({ scale });
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(vp.width);
    tmp.height = Math.ceil(vp.height);
    await page.render({ canvasContext: tmp.getContext('2d')!, viewport: vp }).promise;
    out.push(await toJpeg(frame((ctx, x, y, w, h) => ctx.drawImage(tmp, x, y, w, h), tmp.width, tmp.height)));
    page.cleanup();
    progress(n, total);
  }
  void doc.destroy();
  return out;
}
