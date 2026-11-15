// Moon Mammoth's page, the parts with no DOM shell (unit-tested): where the view looks, how a time
// reads, and the best time kept on the device.
import type { World } from "../core/index.ts";
import type { Viewport } from "./camera.ts";

/** How much of the moon the screen shows: this many metres top to bottom, and at least this many across. */
export const VIEW_HEIGHT = 20;
export const VIEW_WIDTH = 24;
/** The mammoth stands this share of the screen's height below its middle. */
export const LOWER = 0.05;
/** How quickly the view's height follows the mammoth's, s (real): slowly, so a jump doesn't bob the view. */
const EASE = 0.35;
/** A jump in the mammoth's height larger than this is a move to a flag, m: the view goes with it at once. */
const SNAP = 8;

/** What the view remembers between frames: how far from the moon's centre it looks. */
export interface MoonCam {
  radius: number;
}

export const zoomFor = (vp: Viewport): number => Math.min(vp.height / VIEW_HEIGHT, vp.width / VIEW_WIDTH);

/**
 * Where the view looks (MMN-060): on the line from the moon's centre through the mammoth, as it is
 * drawn `ahead` game seconds on, so the drawing's turn puts the mammoth straight below the screen's
 * middle; at a height that eases after the mammoth's.
 */
export function cameraFor(world: World, ahead: number, vp: Viewport, was: MoonCam | null, dt: number): { x: number; y: number; zoom: number; cam: MoonCam; below: number } | null {
  const game = world.moon;
  const m = game && world.bodies.find((b) => b.id === game.spec.mammoth);
  if (!game || !m) return null;
  const c = game.spec.centre;
  const dx = m.position.x + m.velocity.x * ahead - c.x;
  const dy = m.position.y + m.velocity.y * ahead - c.y;
  const r = Math.hypot(dx, dy) || 1;
  const radius = !was || Math.abs(r - was.radius) > SNAP ? r : was.radius + (r - was.radius) * (1 - Math.exp(-dt / EASE));
  const zoom = zoomFor(vp);
  const look = radius + (LOWER * vp.height) / zoom;
  // The mammoth is drawn straight under the view's middle, by how much nearer the moon's centre it is.
  return { x: c.x + (dx / r) * look, y: c.y + (dy / r) * look, zoom, cam: { radius }, below: (look - r) * zoom };
}

/** The levels the title offers, in order. */
export const LEVELS: readonly { n: number; name: string }[] = [
  { n: 1, name: "moon-1" },
  { n: 2, name: "moon-2" },
];

/**
 * The aim a pointer gives (MMN-103): the angle from where the mammoth is drawn (under the view's
 * middle by `below` px) to the pointer, in the mammoth's own frame: 0 to its right, a quarter turn
 * up. The view is upright, so that is the screen's own right and up.
 */
export function aimFrom(pointer: { x: number; y: number }, vp: Viewport, below: number): number {
  return Math.atan2(vp.height / 2 + below - pointer.y, pointer.x - vp.width / 2);
}

/** An aim brought to the nearest hundredth of a radian, within a turn: the aim is sent to the game only when it has changed by that. */
export function snapAim(angle: number): number {
  const turn = 2 * Math.PI;
  const a = angle - turn * Math.round(angle / turn);
  return Math.round(a * 100) / 100;
}

/** A time as the HUD shows it: 1:07.3, or 42.5 under a minute. */
export function clock(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = t - 60 * m;
  return m ? `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}` : s.toFixed(1);
}

const KEY = "moon-mammoth-best";
type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The best time on this device for a level, s, or null (MMN-055). */
export function bestTime(level: string, from: Store | null = store()): number | null {
  try {
    const all = JSON.parse(from?.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const t = all[level];
    return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null;
  } catch {
    return null;
  }
}

/** Keeps a time if it is the best yet for its level. Returns whether it was. */
export function saveBest(level: string, seconds: number, to: Store | null = store()): boolean {
  const was = bestTime(level, to);
  if (!(seconds > 0) || (was !== null && was <= seconds)) return false;
  try {
    const all = JSON.parse(to?.getItem(KEY) ?? "{}") as Record<string, unknown>;
    to?.setItem(KEY, JSON.stringify({ ...all, [level]: seconds }));
  } catch {
    return false;
  }
  return true;
}
