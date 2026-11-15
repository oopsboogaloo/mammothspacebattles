// Moon Mammoth's drawing (docs/games/moon-mammoth-design.md §5.2): the whole frame turned so the
// mammoth is upright and the moon turns under it. After the turn everything is drawn in world metres.
import { gravityAt, localVertices, MOON_SHOT, moonAim, moonRope, type Body, type Vec2, type World } from "../core/index.ts";
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
const BLOCK = "#b9783f";
const BLOCK_EDGE = "#f0c896";
const ROPE = "#e3d2ae";
const SHOT = "#fff2a8";
const AIM = "#7fe9ff";
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

/**
 * Where a thing thrown from the mammoth along its aim would go (MMN-102): points along its path
 * under the moon's gravity, `every` m apart, out to `reach` m of path. The aim's line on the screen.
 */
export function aimPath(world: World, speed: number, reach: number, every: number): Vec2[] {
  const aim = moonAim(world);
  const m = world.moon && world.bodies.find((b) => b.id === world.moon!.spec.mammoth);
  if (!aim || !m) return [];
  const p = { x: aim.from.x, y: aim.from.y };
  const v = { x: m.velocity.x + aim.dir.x * speed, y: m.velocity.y + aim.dir.y * speed };
  const out: Vec2[] = [];
  const dt = Math.min(every / 8, 0.25) / speed;
  let gone = 0;
  let next = every;
  while (gone < reach) {
    const g = gravityAt(world, p);
    v.x += g.x * dt;
    v.y += g.y * dt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    gone += Math.hypot(v.x, v.y) * dt;
    if (gone >= next) {
      out.push({ x: p.x, y: p.y });
      next += every;
    }
  }
  return out;
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

  // Dust: what a shot or a broken block leaves, for its first few seconds.
  for (const d of world.dust ?? []) {
    if (d.age > 3) continue;
    ctx.globalAlpha = 0.5 * (1 - d.age / 3);
    ctx.fillStyle = "#cdb89a";
    ctx.beginPath();
    ctx.arc(d.position.x, d.position.y, Math.max(d.size, 1.5 * px), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Spikes, girders, blocks, shots and the rocks that fall: from their bodies.
  const falls = new Set((spec.rocks ?? []).map((r) => r.id));
  const breakable = spec.tools?.breakable;
  for (const b of world.bodies) {
    if (breakable && b.id.startsWith(breakable)) {
      // A block the rifle breaks: darker, and cracked, as it is hurt.
      bodyPath(ctx, b);
      ctx.fillStyle = BLOCK;
      ctx.fill();
      ctx.fillStyle = `rgba(0,0,0,${(0.55 * (1 - b.integrity)).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = BLOCK_EDGE;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      if (b.integrity < 0.99 && b.shape.kind === "box") {
        const c = Math.cos(b.angle);
        const sn = Math.sin(b.angle);
        const at = (x: number, y: number) => ({ x: b.position.x + c * x - sn * y, y: b.position.y + sn * x + c * y });
        const w = b.shape.width / 2;
        const h = b.shape.height / 2;
        const cracks = b.integrity < 0.4 ? 3 : b.integrity < 0.7 ? 2 : 1;
        ctx.strokeStyle = "#2a1608";
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        for (let k = 0; k < cracks; k++) {
          const y0 = h * (0.6 - 0.6 * k);
          const pts = [at(-w, y0), at(-w * 0.3, y0 - 0.25 * h), at(w * 0.2, y0 + 0.1 * h), at(w, y0 - 0.2 * h)];
          pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        }
        ctx.stroke();
      }
      continue;
    }
    if (b.id.startsWith(MOON_SHOT)) {
      // A shot: a bright dot with a short streak behind it.
      const speed = Math.hypot(b.velocity.x, b.velocity.y) || 1;
      const tail = Math.min(1.6, speed * 0.004);
      ctx.strokeStyle = SHOT;
      ctx.lineWidth = Math.max(3 * px, 0.14);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(b.position.x - (b.velocity.x / speed) * tail, b.position.y - (b.velocity.y / speed) * tail);
      ctx.lineTo(b.position.x, b.position.y);
      ctx.stroke();
      ctx.lineCap = "butt";
      continue;
    }
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

  // The rope (MMN-120): from its far end through each of its points to the mammoth, and its hook.
  const rope = moonRope(world);
  const holder = world.bodies.find((b) => b.id === spec.mammoth);
  if (rope && holder) {
    ctx.strokeStyle = ROPE;
    ctx.lineWidth = Math.max(2 * px, 0.09);
    ctx.lineJoin = "round";
    ctx.beginPath();
    rope.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.lineTo(holder.position.x, holder.position.y);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(rope.points[0].x, rope.points[0].y, Math.max(3.5 * px, 0.16), 0, Math.PI * 2);
    ctx.fill();
  }

  // The aim (MMN-102): dots along the path a shot would take, bending with the moon's gravity,
  // and a ring where the hook's reach ends.
  const tools = spec.tools;
  if (tools && state.phase !== "won" && !moonView.title) {
    const dots = aimPath(world, tools.rifle.speed, 26, 1.3);
    ctx.fillStyle = AIM;
    dots.forEach((q, i) => {
      if (i < 1) return;
      ctx.globalAlpha = 0.85 * (1 - i / dots.length);
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(1.6 * px, 0.07), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 0.8;
    const reach = aimPath(world, tools.hook.speed, tools.hook.range, tools.hook.range).pop();
    if (reach && !rope) {
      ctx.strokeStyle = AIM;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.arc(reach.x, reach.y, Math.max(5 * px, 0.28), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
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
