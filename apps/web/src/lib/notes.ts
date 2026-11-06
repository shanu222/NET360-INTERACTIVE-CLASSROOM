import { pagesWithInk, renderPage } from '@net360/board-engine';
import type { BoardState, SessionInfo } from '@net360/protocol';

/** Save every page with writing as a landscape PDF, one board page per PDF page. */
export async function saveNotesPdf(state: BoardState, info: SessionInfo | undefined) {
  const pages = pagesWithInk(state);
  if (!pages.length) return false;
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1600, 900], hotfixes: ['px_scaling'] });
  pages.forEach((pg, i) => {
    if (i > 0) pdf.addPage([1600, 900], 'landscape');
    const img = renderPage(state, pg, 2000).toDataURL('image/jpeg', 0.92);
    pdf.addImage(img, 'JPEG', 0, 0, 1600, 900);
  });
  const date = new Date().toISOString().slice(0, 10);
  const name = [info?.subject, info?.topic, date].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '');
  pdf.save(`NET360 ${name || 'Notes'}.pdf`);
  return true;
}
