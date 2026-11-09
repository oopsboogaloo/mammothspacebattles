// A picture of a Mammoth Lander level for its mission card: the level's own world, drawn by the
// game's renderer as it looks at the start (ground, pads, stars, the ship), framed to take in its
// pads and the start. Made from the scenario itself, so it stays right as the levels change.
import { getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../core/index.ts";
import { renderFrame, type Ctx } from "./render.ts";

export const PREVIEW = { width: 640, height: 360 };

/** What a level's picture frames: its pads and start, with an asteroid's whole round body. */
export function previewCamera(world: World, vp: { width: number; height: number }): { x: number; y: number; zoom: number } {
  const spec = world.lander!.spec;
  const pts = spec.pads.map((p) => world.bodies.find((b) => b.id === p.id)?.position).filter((p): p is { x: number; y: number } => !!p);
  pts.push(spec.start.position);
  // An asteroid: the whole rock, as far out as its farthest pad.
  const rock = world.bodies.find((b) => b.gravity && b.gravity.mu > 0);
  if (rock) {
    const r = Math.max(...pts.map((p) => Math.hypot(p.x - rock.position.x, p.y - rock.position.y)));
    pts.push({ x: rock.position.x - r, y: rock.position.y - r }, { x: rock.position.x + r, y: rock.position.y + r });
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  // A margin all round, and a little more below for the ground under the pads.
  const w = (maxX - minX) * 1.15 + 20;
  const h = (maxY - minY) * 1.25 + 30;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 - h * 0.05, zoom: Math.min(vp.width / w, vp.height / h) };
}

const cache = new Map<string, string>();

/** The picture as an image URL (made once per level), or null without a canvas (tests). */
export function levelPreview(key: string, raw: unknown): string | null {
  const kept = cache.get(key);
  if (kept) return kept;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW.width;
  canvas.height = PREVIEW.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const s = parseScenario(raw);
  const world = initialWorld(s);
  stepInPlace(world, [], getProfile(s.profile)); // the first ship arrives
  renderFrame(ctx as unknown as Ctx, world, previewCamera(world, PREVIEW), PREVIEW, { overlays: new Set(), selection: new Set(), hover: null, groundLine: true, stars: true, labels: false });
  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}
