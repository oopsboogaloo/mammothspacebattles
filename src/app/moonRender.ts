// Moon Mammoth's drawing (docs/games/moon-mammoth-design.md §5.2): the whole frame turned so the
// mammoth is upright and the moon turns under it. After the turn everything is drawn in world metres.
import { localVertices, type Body, type Vec2, type World } from "../core/index.ts";
import type { Camera, Viewport } from "./camera.ts";
import { COLUMNS, FRAME, frameOf, ROWS, STAND_PX } from "./moon/sheet.ts";

/** What the page asks of the drawing: the title's view turns slowly by itself, about the moon's centre. */
export const moonView = { title: false };

const SKY = "#05060c";
const ROCK = "#8d93a3";
const ROCK_DEEP = "#565b6b";
const RIM = "#e6e9f2";
const SPIKE = "#e23b3b";
const GIRDER = "#6f7a8f";
const GIRDER_EDGE = "#c9d2e0";
const BOULDER = "#6b6258";
const BOULDER_EDGE = "#d8cfc0";
const FLAG_NEXT = "#ffd23f";
const FLAG_DONE = "#6c7180";
const FLAG_LATER = "#c9d2e0";

/** A number from 0 to 1 from two whole numbers: the same every time. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The sprite sheet, drawn once to a canvas when it has loaded (an SVG image is slow to draw from every frame). */
let sheet: HTMLCanvasElement | null = null;
let loading = false;
function loadSheet(): void {
  if (loading || typeof Image === "undefined") return;
  loading = true;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = COLUMNS * FRAME;
    cv.height = ROWS * FRAME;
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    sheet = cv;
  };
  img.src = new URL("./moon/mammoth.svg", import.meta.url).href;
}

/** The moon's outline as a path, kept while the outline is the same one. */
let moonPath: { outline: Vec2[]; path: Path2D; radius: number } | null = null;
function pathOf(outline: Vec2[], centre: Vec2): { path: Path2D; radius: number } {
  if (moonPath?.outline === outline) return moonPath;
  const path = new Path2D();
  let radius = 0;
  outline.forEach((p, i) => {
    if (i === 0) path.moveTo(p.x, p.y);
    else path.lineTo(p.x, p.y);
    radius = Math.max(radius, Math.hypot(p.x - centre.x, p.y - centre.y));
  });
  path.closePath();
  moonPath = { outline, path, radius };
  return moonPath;
}

function bodyPath(ctx: CanvasRenderingContext2D, b: Body): void {
  ctx.beginPath();
  if (b.shape.kind === "disc") {
    ctx.arc(b.position.x, b.position.y, b.shape.radius, 0, Math.PI * 2);
    return;
  }
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  localVertices(b.shape).forEach((v, i) => {
    const x = b.position.x + c * v.x - s * v.y;
    const y = b.position.y + s * v.x + c * v.y;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** How far the view is turned, rad clockwise from the world's up: the mammoth's place round the moon, or the title's slow turn. */
export function moonTurn(world: World, now: number): number {
  const game = world.moon;
  if (!game) return 0;
  if (moonView.title) return now * 0.00005;
  const m = world.bodies.find((b) => b.id === game.spec.mammoth);
  if (!m) return 0;
  return Math.atan2(m.position.x - game.spec.centre.x, m.position.y - game.spec.centre.y);
}

export function drawMoon(ctx: CanvasRenderingContext2D, world: World, c: Camera, vp: Viewport): void {
  const game = world.moon;
  if (!game) return;
  const { spec, state } = game;
  loadSheet();
  const turn = moonTurn(world, typeof performance !== "undefined" ? performance.now() : 0);
  const px = 1 / c.zoom; // a screen pixel, m

  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, vp.width, vp.height);
  ctx.save();
  ctx.translate(vp.width / 2, vp.height / 2);
  // The world's up at the mammoth is `turn` clockwise of the screen's: turned back.
  ctx.rotate(-turn);

  // Stars: fixed in the sky, so they wheel round as the view turns. Far enough out to cover the corners.
  const reach = Math.hypot(vp.width, vp.height) / 2;
  for (let k = 0; k < 140; k++) {
    const x = (hash(k, 1) * 2 - 1) * reach;
    const y = (hash(k, 2) * 2 - 1) * reach;
    const size = 0.6 + 1.6 * hash(k, 3);
    ctx.globalAlpha = 0.35 + 0.6 * hash(k, 4);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;

  // From here on, world metres with y up.
  ctx.scale(c.zoom, -c.zoom);
  ctx.translate(-c.x, -c.y);

  // The moon.
  const outline = spec.view?.outline;
  if (outline) {
    const { path, radius } = pathOf(outline, spec.centre);
    const g = ctx.createRadialGradient(spec.centre.x, spec.centre.y, radius * 0.75, spec.centre.x, spec.centre.y, radius);
    g.addColorStop(0, ROCK_DEEP);
    g.addColorStop(1, ROCK);
    ctx.fillStyle = g;
    ctx.fill(path);
    // Old craters in the rock: darker rounds a little under the surface, the same every frame.
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = "#00000022";
    const count = Math.round(radius * 0.9);
    for (let k = 0; k < count; k++) {
      const a = hash(k, 11) * Math.PI * 2;
      const r = radius - 2 - hash(k, 12) * 14;
      const size = 0.5 + 2.2 * hash(k, 13);
      ctx.beginPath();
      ctx.arc(spec.centre.x + r * Math.cos(a), spec.centre.y + r * Math.sin(a), size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = RIM;
    ctx.lineWidth = 2.5 * px;
    ctx.lineJoin = "round";
    ctx.stroke(path);
  }

  // Flags: a pole up from the ground at each, its pennant by whether it is reached, next or still to come.
  spec.flags.forEach((f, i) => {
    const d = { x: f.at.x - spec.centre.x, y: f.at.y - spec.centre.y };
    const len = Math.hypot(d.x, d.y) || 1;
    const up = { x: d.x / len, y: d.y / len };
    const right = { x: up.y, y: -up.x };
    const foot = { x: f.at.x - up.x * spec.size.stand, y: f.at.y - up.y * spec.size.stand };
    const at = (along: number, high: number) => ({ x: foot.x + right.x * along + up.x * high, y: foot.y + right.y * along + up.y * high });
    const top = at(0, 3.4);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(2 * px, 0.08);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const last = i === spec.flags.length - 1;
    if (last) {
      // The finish: chequered.
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 2; b++) {
          const q = [at(0.5 * a, 3.4 - 0.5 * b), at(0.5 * a + 0.5, 3.4 - 0.5 * b), at(0.5 * a + 0.5, 2.9 - 0.5 * b), at(0.5 * a, 2.9 - 0.5 * b)];
          ctx.fillStyle = (a + b) % 2 ? "#111" : "#fff";
          ctx.beginPath();
          q.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
          ctx.closePath();
          ctx.fill();
        }
    } else {
      const tip = at(1.5, 2.9);
      const low = at(0, 2.4);
      ctx.fillStyle = i <= state.flag ? FLAG_DONE : i === state.flag + 1 ? FLAG_NEXT : FLAG_LATER;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(low.x, low.y);
      ctx.closePath();
      ctx.fill();
    }
  });

  // Spikes, girders and the rocks that fall: from their bodies.
  const falls = new Set((spec.rocks ?? []).map((r) => r.id));
  for (const b of world.bodies) {
    if (b.id.startsWith(spec.spikes)) {
      bodyPath(ctx, b);
      ctx.fillStyle = SPIKE;
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
    } else if (b.id.startsWith("girder-")) {
      bodyPath(ctx, b);
      ctx.fillStyle = GIRDER;
      ctx.fill();
      ctx.strokeStyle = GIRDER_EDGE;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    } else if (falls.has(b.id)) {
      bodyPath(ctx, b);
      ctx.fillStyle = BOULDER;
      ctx.fill();
      ctx.strokeStyle = BOULDER_EDGE;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
  }

  // The mammoth: its frame from the sheet, upright at the body's place, flipped by the way it faces,
  // and turned by the body's angle while it rolls.
  const m = world.bodies.find((b) => b.id === spec.mammoth);
  if (m) {
    const d = { x: m.position.x - spec.centre.x, y: m.position.y - spec.centre.y };
    const len = Math.hypot(d.x, d.y) || 1;
    const up = { x: d.x / len, y: d.y / len };
    const lean = Math.atan2(up.x, up.y);
    const rise = m.velocity.x * up.x + m.velocity.y * up.y;
    const side = (FRAME / STAND_PX) * spec.size.stand;
    ctx.save();
    ctx.translate(m.position.x, m.position.y);
    ctx.rotate(-lean + (state.action === "roll" ? m.angle : 0));
    if (sheet) {
      const f = frameOf(state.action, state.since, world.time, rise);
      // The sheet's y runs down and the mammoth faces right in it.
      ctx.scale(state.facing, -1);
      ctx.drawImage(sheet, f.col * FRAME, f.row * FRAME, FRAME, FRAME, -side / 2, -side / 2, side, side);
    } else {
      // Until the sheet has loaded: its circle.
      ctx.fillStyle = "#8a5a3c";
      ctx.beginPath();
      ctx.arc(0, 0, m.shape.kind === "disc" ? m.shape.radius : spec.size.stand, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}
