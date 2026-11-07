import { classSize } from '@net360/protocol';
import { lazy } from 'react';

/** The 3D classroom loads separately, so sign-in and the board appear instantly. */
export const Classroom3D = lazy(() => import('../three/Classroom3D.tsx'));

let cached: boolean | null = null;
/** Whether this device can draw the 3D classroom. */
export function can3d(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement('canvas');
    cached = Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    cached = false;
  }
  return cached;
}

/** Phones held upright show the flat board by default (it's larger that way). */
export function prefers3d(): boolean {
  if (!can3d()) return false;
  const portraitPhone = window.innerWidth < 700 && window.innerHeight > window.innerWidth;
  return !portraitPhone;
}

/** Seats the 3D room is set out for: the class size chosen, or more if more students came. */
export function roomStudents(size: number | undefined, people: { seat: number }[]): number {
  let seated = 0;
  for (const p of people) seated = Math.max(seated, p.seat + 1);
  return classSize(size, seated);
}
