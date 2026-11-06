import { createHmac } from 'node:crypto';

/** The writing-pad key for a class: anyone holding it may write on the board as the teacher. */
export function padKeyFor(boardKey: string) {
  return createHmac('sha256', boardKey).update('writing-pad').digest('base64url').slice(0, 24);
}
