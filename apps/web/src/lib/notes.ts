import { useState } from 'react';
import { loadSlides, pagesWithInk, renderPage } from '@net360/board-engine';
import type { BoardState, SessionInfo } from '@net360/protocol';

export type NotesResult = 'saved' | 'empty' | 'cancelled' | 'error';

type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{
  createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

/**
 * Save every page with writing (and every slide) as a landscape PDF.
 *
 * Must be called straight from a click: where the browser offers a real "Save as"
 * window (Chrome, Edge), it opens first and the PDF is written straight into the
 * chosen file. Elsewhere the PDF downloads as a normal file.
 */
export async function saveNotesPdf(state: BoardState, info: SessionInfo | undefined): Promise<NotesResult> {
  const pages = pagesWithInk(state);
  if (!pages.length) return 'empty';
  const date = new Date().toISOString().slice(0, 10);
  const title = [info?.subject, info?.topic, date].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').trim();
  const fileName = `Meeto360 ${title || 'Notes'}.pdf`;

  // Ask where to save before the work starts (the click still counts as the user's choice).
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  let handle: Awaited<ReturnType<Picker>> | null = null;
  if (picker && window.isSecureContext && window.self === window.top) {
    try {
      handle = await picker({ suggestedName: fileName, types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }] });
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      handle = null; // not allowed here: fall back to a download
    }
  }

  try {
    const [{ jsPDF }] = await Promise.all([import('jspdf'), loadSlides(state)]);
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1600, 900], hotfixes: ['px_scaling'], compress: true });
    pdf.setProperties({ title: title || 'Meeto360 notes', creator: 'Meeto360' });
    pages.forEach((pg, i) => {
      if (i > 0) pdf.addPage([1600, 900], 'landscape');
      pdf.addImage(pageImage(state, pg), 'JPEG', 0, 0, 1600, 900);
    });
    const blob = pdf.output('blob');

    if (handle) {
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return 'saved';
    }
    download(blob, fileName);
    return 'saved';
  } catch (e) {
    console.error('[notes]', e);
    return 'error';
  }
}

/** One page as a JPEG. If a slide picture can't be copied, the page is saved without it. */
function pageImage(state: BoardState, pg: number): string {
  try {
    return renderPage(state, pg, 2000).toDataURL('image/jpeg', 0.9);
  } catch {
    const bare: BoardState = { ...state, bg: {} };
    return renderPage(bare, pg, 2000).toDataURL('image/jpeg', 0.9);
  }
}

/** A plain file download that stays valid until the browser has finished writing it. */
function download(blob: Blob, fileName: string) {
  const file = new Blob([blob], { type: 'application/pdf' });
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Keep the file around long enough for slow disks and virus scanners.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 5 * 60_000);
}

const SAID: Record<Exclude<NotesResult, 'cancelled'>, string> = {
  saved: 'Notes saved as PDF',
  empty: 'Nothing written yet',
  error: 'Couldn’t save the PDF. Please try again.',
};

/** A Save notes button's state: busy while the PDF is made, then a short message. */
export function useSaveNotes(get: () => { state: BoardState; info: SessionInfo | undefined }, say: (msg: string) => void) {
  const [busy, setBusy] = useState(false);
  const save = () => {
    if (busy) return;
    setBusy(true);
    const { state, info } = get();
    void saveNotesPdf(state, info)
      .then((r) => r !== 'cancelled' && say(SAID[r]))
      .finally(() => setBusy(false));
  };
  return { save, busy };
}
