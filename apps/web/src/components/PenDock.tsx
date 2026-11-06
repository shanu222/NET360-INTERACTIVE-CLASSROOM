import { useState } from 'react';
import { INK, type PenSettings } from '@net360/board-engine';
import { Icon } from './Icons.tsx';

const COLORS: [string, string][] = [
  [INK.chalk, 'Chalk white'],
  [INK.amber, 'Amber'],
  [INK.sky, 'Sky blue'],
  [INK.mint, 'Mint'],
  [INK.coral, 'Coral'],
];
const WIDTHS: [number, string][] = [[2.6, 'Fine'], [4.4, 'Medium'], [8, 'Bold']];
const SHAPES = ['line', 'arrow', 'rect', 'circle'] as const;

/**
 * The teacher's pen dock: one slim column at the board's edge.
 * It fades while the pen is writing so nothing competes with the lesson.
 */
export function PenDock({
  pen,
  setPen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  quiet,
}: {
  pen: PenSettings;
  setPen: (p: PenSettings) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  quiet: boolean;
}) {
  const [shapesOpen, setShapesOpen] = useState(false);
  const isShape = (SHAPES as readonly string[]).includes(pen.tool);
  const ShapeIcon = isShape ? Icon[pen.tool as (typeof SHAPES)[number]] : Icon.shapes;
  const tool = (t: PenSettings['tool']) => setPen({ ...pen, tool: t });

  return (
    <nav className={`dock ${quiet ? 'dock--quiet' : ''}`} aria-label="Pen tools">
      <div className="dock__group">
        <button className={`dock__btn ${pen.tool === 'pen' ? 'is-on' : ''}`} onClick={() => tool('pen')} title="Pen (P)" aria-label="Pen">
          <Icon.pen />
        </button>
        <button className={`dock__btn ${pen.tool === 'highlighter' ? 'is-on' : ''}`} onClick={() => tool('highlighter')} title="Highlighter (H)" aria-label="Highlighter">
          <Icon.highlighter />
        </button>
        <div className="dock__flyout-wrap">
          <button className={`dock__btn ${isShape ? 'is-on' : ''}`} onClick={() => setShapesOpen((o) => !o)} title="Shapes (L, A, R, C)" aria-label="Shapes" aria-expanded={shapesOpen}>
            <ShapeIcon />
          </button>
          {shapesOpen && (
            <div className="dock__flyout" role="menu">
              {SHAPES.map((s) => {
                const I = Icon[s];
                return (
                  <button key={s} className={`dock__btn ${pen.tool === s ? 'is-on' : ''}`} onClick={() => { tool(s); setShapesOpen(false); }} aria-label={s} title={s}>
                    <I />
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button className={`dock__btn ${pen.tool === 'eraser' ? 'is-on' : ''}`} onClick={() => tool('eraser')} title="Eraser (E)" aria-label="Eraser">
          <Icon.eraser />
        </button>
      </div>

      <div className="dock__group">
        {COLORS.map(([c, name], i) => (
          <button
            key={c}
            className={`dock__swatch ${pen.color === c ? 'is-on' : ''}`}
            style={{ ['--sw' as string]: c }}
            onClick={() => setPen({ ...pen, color: c, tool: pen.tool === 'eraser' ? 'pen' : pen.tool })}
            title={`${name} (${i + 1})`}
            aria-label={name}
          />
        ))}
      </div>

      <div className="dock__group">
        {WIDTHS.map(([w, name]) => (
          <button key={w} className={`dock__btn dock__width ${pen.width === w ? 'is-on' : ''}`} onClick={() => setPen({ ...pen, width: w })} title={name} aria-label={`${name} line`}>
            <span style={{ width: 4 + w * 1.6, height: 4 + w * 1.6 }} />
          </button>
        ))}
      </div>

      <div className="dock__group">
        <button className="dock__btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <Icon.undo />
        </button>
        <button className="dock__btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <Icon.redo />
        </button>
        <button className="dock__btn" onClick={onClear} title="Clear page" aria-label="Clear page">
          <Icon.clear />
        </button>
      </div>
    </nav>
  );
}
