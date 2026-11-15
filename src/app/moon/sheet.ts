// The mammoth's sprite sheet (docs/games/moon-mammoth-design.md §4.2): one SVG, a grid of square
// frames, a row for each thing the mammoth does. The mammoth faces right in every frame. The circle
// it collides as, standing, is centred in the frame and `STAND_PX` in radius, so art and physics line
// up; ducked, the art is drawn smaller about the same centre. New art with other frame counts or
// rates is a change to this table and nothing else.
import type { MoonAction } from "../../core/index.ts";

/** A frame's side, px, and how many frames across the sheet. */
export const FRAME = 256;
export const COLUMNS = 8;
/** The standing mammoth's collision circle in a frame: its radius, px. */
export const STAND_PX = 100;

export interface Strip {
  row: number;
  frames: number;
  /** Frames a game second (the page runs the game at one in two of the player's seconds). */
  rate: number;
  /** Plays round and round, or once and holds its last frame. */
  loop: boolean;
}

export const SHEET: Record<MoonAction, Strip> = {
  idle: { row: 0, frames: 2, rate: 2.5, loop: true },
  walk: { row: 1, frames: 8, rate: 28, loop: true },
  turn: { row: 2, frames: 3, rate: 30, loop: false },
  // Rising, the top, falling: by its speed up or down, not by time (frameOf).
  jump: { row: 3, frames: 3, rate: 0, loop: false },
  fall: { row: 3, frames: 3, rate: 0, loop: false },
  // One frame, turned by the body's angle.
  roll: { row: 4, frames: 1, rate: 0, loop: false },
  sit: { row: 5, frames: 2, rate: 24, loop: false },
  slide: { row: 6, frames: 2, rate: 16, loop: true },
};
export const ROWS = 7;

/** Slower than this up or down, m/s, a jump shows its top. */
const TOP = 7;

/** The frame to draw: its column and row in the sheet. `rise` is the mammoth's speed away from the moon. */
export function frameOf(action: MoonAction, since: number, time: number, rise: number): { col: number; row: number } {
  const strip = SHEET[action];
  if (action === "jump" || action === "fall") return { col: Math.abs(rise) < TOP ? 1 : rise > 0 ? 0 : 2, row: strip.row };
  const k = Math.max(0, Math.floor((time - since) * strip.rate));
  return { col: strip.loop ? k % strip.frames : Math.min(k, strip.frames - 1), row: strip.row };
}
