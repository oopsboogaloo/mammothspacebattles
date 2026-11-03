// World ↔ screen transforms. World y points up; screen y points down.
import type { Vec2, World } from "../core/index.ts";
import { massProps } from "../core/index.ts";

export interface Camera {
  x: number; // world point at the centre of the view, m
  y: number;
  zoom: number; // pixels per metre
}

export interface Viewport {
  width: number; // CSS px
  height: number;
}

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 4000;

export function toScreen(c: Camera, vp: Viewport, p: Vec2): Vec2 {
  return { x: vp.width / 2 + (p.x - c.x) * c.zoom, y: vp.height / 2 - (p.y - c.y) * c.zoom };
}

export function toWorld(c: Camera, vp: Viewport, s: Vec2): Vec2 {
  return { x: c.x + (s.x - vp.width / 2) / c.zoom, y: c.y - (s.y - vp.height / 2) / c.zoom };
}

/** Zooms by `factor` keeping the world point under `screen` fixed (SBX-030). */
export function zoomAt(c: Camera, vp: Viewport, screen: Vec2, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
  const before = toWorld(c, vp, screen);
  const next = { ...c, zoom };
  const after = toWorld(next, vp, screen);
  return { x: next.x + before.x - after.x, y: next.y + before.y - after.y, zoom };
}

export function panBy(c: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...c, x: c.x - dxScreen / c.zoom, y: c.y + dyScreen / c.zoom };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function worldBounds(world: World, ids?: ReadonlySet<string>): Bounds | null {
  let b: Bounds | null = null;
  for (const body of world.bodies) {
    if (ids && !ids.has(body.id)) continue;
    const r = massProps(body.shape, body.mass).boundingRadius;
    const p = body.position;
    b = b
      ? { minX: Math.min(b.minX, p.x - r), minY: Math.min(b.minY, p.y - r), maxX: Math.max(b.maxX, p.x + r), maxY: Math.max(b.maxY, p.y + r) }
      : { minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r };
  }
  return b;
}

/** Camera that shows `b` with `padding` px around it. */
export function fitBounds(b: Bounds | null, vp: Viewport, padding = 48): Camera {
  if (!b) return { x: 0, y: 0, zoom: 60 };
  const w = Math.max(b.maxX - b.minX, 0.5);
  const h = Math.max(b.maxY - b.minY, 0.5);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((vp.width - 2 * padding) / w, (vp.height - 2 * padding) / h)));
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom };
}
