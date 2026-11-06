import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { EulerPlate, LensPlate, MaxwellPlate, Plant, Shelf, SpiralPlate } from './Artwork.tsx';

/**
 * The classroom around the board: plaster walls, warm light, oak wainscot,
 * framed scientific plates, a plant and a shelf. Decoration appears only where
 * there is room beside the board — on phones it collapses to a warm vignette.
 */
export function Environment({ children, variant = 'full', entering = false }: { children: ReactNode; variant?: 'full' | 'console' | 'display'; entering?: boolean }) {
  return (
    <div className={`room room--${variant}`}>
      <div className="room__wall" />
      <div className="room__light" />
      <div className="room__wainscot" />
      <aside className="room__art room__art--left" aria-hidden="true">
        <MaxwellPlate />
        <SpiralPlate />
      </aside>
      <aside className="room__art room__art--right" aria-hidden="true">
        <EulerPlate />
        <LensPlate />
      </aside>
      <div className="room__plant">
        <Plant />
      </div>
      <div className="room__shelf">
        <Shelf />
      </div>
      <motion.main
        className="room__stage"
        initial={entering ? { scale: 0.82, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.main>
      <div className="room__desk" />
    </div>
  );
}
