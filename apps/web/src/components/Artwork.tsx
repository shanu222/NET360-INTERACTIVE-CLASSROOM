import type { ReactNode } from 'react';

/**
 * Framed scientific plates for the classroom walls — engraved line art in
 * sepia on an ivory mat, the way a university hallway hangs its history.
 */

const INKC = '#5A4836';
const MAT = '#F3EDE1';

function Plate({ children, caption, w = 180, h = 140 }: { children: ReactNode; caption: string; w?: number; h?: number }) {
  return (
    <figure className="plate">
      <svg viewBox={`0 0 ${w} ${h + 26}`} role="img" aria-label={caption}>
        <rect width={w} height={h + 26} fill={MAT} />
        <g transform="translate(0 4)">{children}</g>
        <text x={w / 2} y={h + 18} textAnchor="middle" fontSize="7.5" letterSpacing="2.2" fill={INKC} opacity="0.75" fontFamily="Inter, sans-serif">
          {caption}
        </text>
      </svg>
    </figure>
  );
}

export function MaxwellPlate() {
  const t = { fontFamily: 'Fraunces, Georgia, serif', fontStyle: 'italic' as const, fill: INKC };
  return (
    <Plate caption="MAXWELL · 1865">
      <line x1="30" x2="150" y1="22" y2="22" stroke={INKC} strokeWidth="0.6" opacity="0.5" />
      <text x="90" y="46" textAnchor="middle" fontSize="13" {...t}>∇ · E = ρ / ε₀</text>
      <text x="90" y="70" textAnchor="middle" fontSize="13" {...t}>∇ · B = 0</text>
      <text x="90" y="94" textAnchor="middle" fontSize="13" {...t}>∇ × E = − ∂B/∂t</text>
      <text x="90" y="118" textAnchor="middle" fontSize="12" {...t}>∇ × B = μ₀J + μ₀ε₀ ∂E/∂t</text>
      <line x1="30" x2="150" y1="130" y2="130" stroke={INKC} strokeWidth="0.6" opacity="0.5" />
    </Plate>
  );
}

export function EulerPlate() {
  return (
    <Plate caption="EULER · 1748">
      <g stroke={INKC} fill="none" strokeWidth="0.8">
        <line x1="40" x2="140" y1="66" y2="66" opacity="0.6" />
        <line x1="90" x2="90" y1="16" y2="116" opacity="0.6" />
        <circle cx="90" cy="66" r="40" />
        <line x1="90" y1="66" x2="118.3" y2="37.7" />
        <path d="M104 66 A14 14 0 0 0 99.9 56.1" />
        <circle cx="118.3" cy="37.7" r="2" fill={INKC} />
      </g>
      <text x="122" y="32" fontSize="9" fontStyle="italic" fontFamily="Fraunces, serif" fill={INKC}>e^iθ</text>
      <text x="90" y="134" textAnchor="middle" fontSize="13" fontStyle="italic" fontFamily="Fraunces, serif" fill={INKC}>
        e<tspan dy="-6" fontSize="9">iπ</tspan>
        <tspan dy="6"> + 1 = 0</tspan>
      </text>
    </Plate>
  );
}

export function SpiralPlate() {
  const sq: [number, number, number][] = [[0, 0, 89], [89, 0, 55], [110, 55, 34], [89, 68, 21], [89, 55, 13], [102, 55, 8], [105, 63, 5], [102, 65, 3]];
  return (
    <Plate caption="φ = 1.618…" w={180} h={120}>
      <g transform="translate(18 10)" stroke={INKC} fill="none">
        <rect width="144" height="89" strokeWidth="0.9" />
        {sq.map(([x, y, s]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={s} height={s} strokeWidth="0.45" opacity="0.6" />
        ))}
        <path
          d="M0 89 A89 89 0 0 1 89 0 A55 55 0 0 1 144 55 A34 34 0 0 1 110 89 A21 21 0 0 1 89 68 A13 13 0 0 1 102 55 A8 8 0 0 1 110 63 A5 5 0 0 1 105 68 A3 3 0 0 1 102 65"
          strokeWidth="1.2"
        />
      </g>
    </Plate>
  );
}

export function LensPlate() {
  return (
    <Plate caption="OPTICS · THIN LENS" w={180} h={120}>
      <g stroke={INKC} fill="none" strokeWidth="0.8">
        <line x1="12" x2="168" y1="62" y2="62" opacity="0.5" strokeDasharray="3 3" />
        <ellipse cx="90" cy="62" rx="7" ry="44" />
        <line x1="36" x2="36" y1="62" y2="34" strokeWidth="1.4" />
        <path d="M32 38 L36 32 L40 38" />
        <line x1="36" y1="34" x2="90" y2="34" />
        <line x1="90" y1="34" x2="150" y2="96" />
        <line x1="36" y1="34" x2="150" y2="96" />
        <line x1="138" x2="138" y1="62" y2="84" strokeWidth="1.4" />
        <path d="M134 80 L138 86 L142 80" />
        <circle cx="62" cy="62" r="1.6" fill={INKC} />
        <circle cx="118" cy="62" r="1.6" fill={INKC} />
      </g>
      <text x="62" y="74" fontSize="7" textAnchor="middle" fontStyle="italic" fontFamily="Fraunces, serif" fill={INKC}>F</text>
      <text x="118" y="54" fontSize="7" textAnchor="middle" fontStyle="italic" fontFamily="Fraunces, serif" fill={INKC}>F′</text>
    </Plate>
  );
}

/** A tall potted plant, softly out of focus. */
export function Plant() {
  return (
    <svg viewBox="0 0 160 300" aria-hidden="true">
      <defs>
        <linearGradient id="leafA" x1="0" x2="1">
          <stop offset="0" stopColor="#2F4A33" />
          <stop offset="1" stopColor="#4C6B45" />
        </linearGradient>
        <linearGradient id="leafB" x1="0" x2="1">
          <stop offset="0" stopColor="#3B5A3A" />
          <stop offset="1" stopColor="#628455" />
        </linearGradient>
        <linearGradient id="pot" x1="0" x2="1">
          <stop offset="0" stopColor="#CFC4B3" />
          <stop offset="0.6" stopColor="#E8E0D3" />
          <stop offset="1" stopColor="#B5A994" />
        </linearGradient>
      </defs>
      <g>
        <path d="M80 220 C60 160 30 120 18 40 C46 100 70 150 84 214Z" fill="url(#leafA)" />
        <path d="M82 220 C84 150 96 90 120 20 C112 90 98 160 88 220Z" fill="url(#leafB)" />
        <path d="M78 222 C52 190 22 170 6 120 C38 160 62 184 84 216Z" fill="url(#leafB)" opacity="0.9" />
        <path d="M86 222 C112 186 134 160 152 104 C138 160 116 196 92 224Z" fill="url(#leafA)" />
        <path d="M80 222 C76 160 66 100 70 8 C82 90 90 160 88 222Z" fill="url(#leafA)" opacity="0.95" />
        <path d="M86 224 C104 200 128 196 150 170 C134 204 108 214 90 228Z" fill="url(#leafB)" opacity="0.85" />
      </g>
      <path d="M44 218 H116 L108 292 H52Z" fill="url(#pot)" />
      <rect x="40" y="212" width="80" height="10" rx="3" fill="#DCD3C5" />
    </svg>
  );
}

/** A low oak credenza with books. */
export function Shelf() {
  const books: [number, number, string][] = [
    [0, 74, '#6E3B2E'], [13, 66, '#2E4057'], [24, 78, '#8C6A3F'], [38, 70, '#3F5A45'],
    [50, 62, '#A0855B'], [61, 76, '#4B3B5C'], [75, 68, '#7A2E2E'], [88, 72, '#2E4A57'],
  ];
  return (
    <svg viewBox="0 0 220 150" aria-hidden="true">
      <g transform="translate(18 0)">
        {books.map(([x, h, c]) => (
          <rect key={x} x={x} y={88 - h} width={x === 50 ? 10 : 12} height={h} rx="1.5" fill={c} />
        ))}
        <rect x="104" y="40" width="58" height="48" fill="none" />
        <path d="M118 88 L132 40 L146 88Z" fill="#B8A88E" opacity="0.8" />
        <circle cx="160" cy="76" r="12" fill="#C9B79A" opacity="0.7" />
      </g>
      <rect x="0" y="88" width="220" height="62" rx="4" fill="#6B4E35" />
      <rect x="0" y="88" width="220" height="6" fill="#8A6747" />
      <line x1="110" x2="110" y1="96" y2="146" stroke="#4E3826" strokeWidth="1.5" />
    </svg>
  );
}
