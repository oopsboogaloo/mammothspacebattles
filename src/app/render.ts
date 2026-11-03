// Draws a world onto a 2D canvas context (TST-011): a pure function of
// world, camera and options, usable without the UI shell.
import { add, localVertices, massProps, mixture, rotate, scale, sinCos, SPECIES, type Body, type Parcel, type Vec2, type World } from "../core/index.ts";
import { toScreen, type Camera, type Viewport } from "./camera.ts";

export type OverlayId = "velocity" | "com" | "contacts" | "forces" | "joints" | "links" | "grid";

export const OVERLAYS: { id: OverlayId; label: string; key?: string; legend: string }[] = [
  { id: "velocity", label: "Velocity", legend: "solid blue arrow" },
  { id: "com", label: "Centre of mass", legend: "white circled cross" },
  { id: "contacts", label: "Contacts", legend: "orange dot, dashed line ∝ impulse" },
  { id: "forces", label: "Forces", legend: "purple dotted line (drags), arrow (gravity)" },
  { id: "joints", label: "Joint load", legend: "line thickens with load: blue < 50%, yellow < 80%, orange dashed ≥ 80% of the limit" },
  { id: "links", label: "Links", legend: "feed: purple dashed arrow · control: dotted line to the channel name" },
  { id: "grid", label: "Grid & axes", legend: "1 m grid, origin axes" },
];

/** Colour-blind-safe palette (blue/orange/yellow/purple with distinct lightness), with shape and dash redundancy (SBX-038). */
export const COLORS = {
  background: "#070B16",
  grid: "#111A2E",
  axes: "#2A3654",
  body: "#24304C",
  bodyStroke: "#9AA7C2",
  fixed: "#151C2E",
  fixedStroke: "#5B6680",
  selected: "#F2F5FA",
  hover: "#7DBBFF",
  velocity: "#5AA9FF",
  contact: "#FF9F43",
  force: "#C9A0FF",
  com: "#F2F5FA",
  preview: "#F2C94C",
  label: "#E6EAF2",
} as const;

export interface RulerView {
  a: Vec2;
  b: Vec2;
  label: string;
}

export interface Preview {
  kind: "arrow" | "ghost" | "line";
  from: Vec2;
  to: Vec2;
  label?: string;
  body?: Body;
  /** For attach ghosts: green-blue solid when valid, orange dashed when blocked. */
  valid?: boolean;
}

export interface PortMarker {
  point: Vec2;
  state: "idle" | "valid" | "invalid";
}

// ---------- Gas colours (SBX-035) ----------

/** Temperature scale: logarithmic from T_MIN to T_MAX, so 300 K and 3,000 K gas both read. */
export const T_MIN = 50;
export const T_MAX = 3000;
/**
 * Stops of a perceptually ordered, colour-blind-safe ramp (after matplotlib's "inferno",
 * lifted off black so cold gas shows on the dark background).
 */
export const T_RAMP = ["#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"] as const;

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const RAMP_RGB = T_RAMP.map(hex);

/** Position of a temperature on the scale, 0–1. */
export function temperatureFraction(T: number): number {
  if (!(T > T_MIN)) return 0;
  if (T >= T_MAX) return 1;
  return Math.log(T / T_MIN) / Math.log(T_MAX / T_MIN);
}

export function temperatureColour(T: number): string {
  const f = temperatureFraction(T) * (RAMP_RGB.length - 1);
  const i = Math.min(RAMP_RGB.length - 2, Math.floor(f));
  const t = f - i;
  const a = RAMP_RGB[i];
  const b = RAMP_RGB[i + 1];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** The species with the largest mass fraction gives a parcel's colour in composition view. */
export function compositionColour(p: Parcel): string {
  let best = "";
  let y = -1;
  for (const [k, v] of Object.entries(p.composition)) if (v > y) [best, y] = [k, v];
  return SPECIES[best]?.colour ?? COLORS.label;
}

export const SPECIES_LIST = Object.entries(SPECIES).map(([id, sp]) => ({ id, colour: sp.colour }));

const BUCKETS = 32;

function drawGas(ctx: Ctx, world: World, c: Camera, vp: Viewport, mode: "temperature" | "composition"): void {
  const parcels = world.gas.parcels;
  if (!parcels.length) return;
  // Batch parcels by colour so each colour is one path (2,000 parcels per frame stay cheap).
  const groups = new Map<string, Parcel[]>();
  const left = -20;
  const right = vp.width + 20;
  for (const p of parcels) {
    const s = toScreen(c, vp, p.position);
    if (s.x < left || s.x > right || s.y < -20 || s.y > vp.height + 20) continue;
    let key: string;
    if (mode === "composition") key = compositionColour(p);
    else {
      const T = p.thermal / (p.mass * mixture(p.composition).cv);
      key = temperatureColour(T_MIN * Math.pow(T_MAX / T_MIN, Math.round(temperatureFraction(T) * (BUCKETS - 1)) / (BUCKETS - 1)));
    }
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  ctx.globalAlpha = 0.85;
  for (const [colour, ps] of groups) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (const p of ps) {
      const s = toScreen(c, vp, p.position);
      const r = Math.max(1.5, p.radius * c.zoom);
      ctx.moveTo(s.x + r, s.y);
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface RenderOptions {
  overlays: ReadonlySet<OverlayId>;
  selection: ReadonlySet<string>;
  hover: string | null;
  ruler?: RulerView | null;
  preview?: Preview | null;
  ports?: PortMarker[];
  /** Bodies to outline as compatible link ends while dragging a link. */
  highlight?: ReadonlySet<string>;
  /** Draw body ids (default true). */
  labels?: boolean;
  /** Scale for velocity arrows, seconds: an arrow shows where the body will be after this long. */
  velocityScale?: number;
  /** How to colour gas parcels (default temperature). */
  gasColour?: "temperature" | "composition";
}

/** The subset of CanvasRenderingContext2D used, so tests can pass a recorder. */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "closePath"
  | "fill"
  | "stroke"
  | "save"
  | "restore"
  | "setLineDash"
  | "fillText"
  | "strokeStyle"
  | "fillStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
>;

function bodyPath(ctx: Ctx, c: Camera, vp: Viewport, b: Body): void {
  ctx.beginPath();
  if (b.shape.kind === "disc") {
    const s = toScreen(c, vp, b.position);
    ctx.arc(s.x, s.y, Math.max(1, b.shape.radius * c.zoom), 0, Math.PI * 2);
    return;
  }
  const q = sinCos(b.angle);
  localVertices(b.shape).forEach((v, i) => {
    const s = toScreen(c, vp, add(b.position, rotate(q, v)));
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

const MAX_ARROW = 240; // px; very fast bodies get a capped arrow instead of a line across the screen

function arrow(ctx: Ctx, from: Vec2, rawTo: Vec2, color: string, dash: number[] = []): void {
  let dx = rawTo.x - from.x;
  let dy = rawTo.y - from.y;
  let len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return;
  if (len > MAX_ARROW) {
    dx *= MAX_ARROW / len;
    dy *= MAX_ARROW / len;
    len = MAX_ARROW;
  }
  const to = { x: from.x + dx, y: from.y + dy };
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(10, len / 2);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - ux * head * 0.6, to.y - uy * head * 0.6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ux * head - uy * head * 0.5, to.y - uy * head + ux * head * 0.5);
  ctx.lineTo(to.x - ux * head + uy * head * 0.5, to.y - uy * head - ux * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

function drawGrid(ctx: Ctx, c: Camera, vp: Viewport): void {
  // Grid spacing: a power of ten metres that is at least 24 px apart.
  let step = 1;
  while (step * c.zoom < 24) step *= 10;
  while (step * c.zoom > 240) step /= 10;
  const left = c.x - vp.width / 2 / c.zoom;
  const right = c.x + vp.width / 2 / c.zoom;
  const bottom = c.y - vp.height / 2 / c.zoom;
  const top = c.y + vp.height / 2 / c.zoom;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
    const s = toScreen(c, vp, { x, y: 0 });
    ctx.moveTo(s.x, 0);
    ctx.lineTo(s.x, vp.height);
  }
  for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
    const s = toScreen(c, vp, { x: 0, y });
    ctx.moveTo(0, s.y);
    ctx.lineTo(vp.width, s.y);
  }
  ctx.stroke();
  const o = toScreen(c, vp, { x: 0, y: 0 });
  ctx.strokeStyle = COLORS.axes;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(o.x, 0);
  ctx.lineTo(o.x, vp.height);
  ctx.moveTo(0, o.y);
  ctx.lineTo(vp.width, o.y);
  ctx.stroke();
}

export function renderFrame(ctx: Ctx, world: World, c: Camera, vp: Viewport, opts: RenderOptions): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, vp.width, vp.height);
  if (opts.overlays.has("grid")) drawGrid(ctx, c, vp);
  // Gas under bodies, so walls stay crisp.
  drawGas(ctx, world, c, vp, opts.gasColour ?? "temperature");

  for (const b of world.bodies) {
    const selected = opts.selection.has(b.id);
    const hover = opts.hover === b.id;
    bodyPath(ctx, c, vp, b);
    ctx.fillStyle = b.fixed ? COLORS.fixed : COLORS.body;
    ctx.fill();
    ctx.lineWidth = selected ? 3 : hover ? 2 : 1.25;
    ctx.strokeStyle = selected ? COLORS.selected : hover ? COLORS.hover : b.fixed ? COLORS.fixedStroke : COLORS.bodyStroke;
    ctx.setLineDash(b.fixed && !selected ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // Orientation mark: centre to the body's local +x edge, so rotation is visible.
    const q = sinCos(b.angle);
    const reach = b.shape.kind === "disc" ? b.shape.radius : b.shape.kind === "box" ? b.shape.width / 2 : massProps(b.shape, b.mass).boundingRadius;
    const s0 = toScreen(c, vp, b.position);
    const s1 = toScreen(c, vp, add(b.position, rotate(q, { x: reach, y: 0 })));
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.bodyStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    ctx.lineTo(s1.x, s1.y);
    ctx.stroke();
    // Id label when the body is big enough on screen to carry one.
    if (opts.labels !== false && reach * c.zoom > 18) {
      ctx.fillStyle = selected ? COLORS.selected : COLORS.label;
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(b.id, s0.x, s0.y + Math.max(8, reach * c.zoom * 0.35));
    }
  }

  if (opts.overlays.has("com")) {
    for (const b of world.bodies) {
      const s = toScreen(c, vp, b.position);
      ctx.strokeStyle = COLORS.com;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.moveTo(s.x - 7, s.y);
      ctx.lineTo(s.x + 7, s.y);
      ctx.moveTo(s.x, s.y - 7);
      ctx.lineTo(s.x, s.y + 7);
      ctx.stroke();
    }
  }

  if (opts.overlays.has("velocity")) {
    const k = opts.velocityScale ?? 0.5;
    for (const b of world.bodies) {
      if (b.fixed) continue;
      arrow(ctx, toScreen(c, vp, b.position), toScreen(c, vp, add(b.position, scale(b.velocity, k))), COLORS.velocity);
    }
  }

  if (opts.overlays.has("contacts")) {
    for (const ct of world.contacts) {
      if (ct.normalImpulse <= 0) continue;
      const s = toScreen(c, vp, ct.point);
      ctx.fillStyle = COLORS.contact;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // 40 px per N·s, capped, so both gentle and violent contacts read.
      const len = Math.min(80, 6 + ct.normalImpulse * 40);
      const e = { x: s.x + ct.normal.x * len, y: s.y - ct.normal.y * len };
      ctx.strokeStyle = COLORS.contact;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (opts.overlays.has("forces")) {
    for (const d of world.drags) {
      const b = world.bodies.find((x) => x.id === d.id);
      if (!b) continue;
      const anchor = add(b.position, rotate(sinCos(b.angle), d.anchor));
      const a = toScreen(c, vp, anchor);
      const t = toScreen(c, vp, d.target);
      ctx.strokeStyle = COLORS.force;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const g = world.gravity;
    if (g.x !== 0 || g.y !== 0) {
      const gl = Math.sqrt(g.x * g.x + g.y * g.y);
      const from = { x: vp.width - 40, y: 40 };
      arrow(ctx, from, { x: from.x + (g.x / gl) * 28, y: from.y - (g.y / gl) * 28 }, COLORS.force);
      ctx.fillStyle = COLORS.force;
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(`g ${gl.toFixed(2)} m/s²`, vp.width - 52, 24);
    }
  }

  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  if (opts.overlays.has("joints")) {
    for (const j of world.joints) {
      const A = byId.get(j.a);
      const B = byId.get(j.b);
      if (!A || !B) continue;
      const pa = toScreen(c, vp, A.position);
      const pj = toScreen(c, vp, add(A.position, rotate(sinCos(A.angle), j.anchorA)));
      const pb = toScreen(c, vp, B.position);
      const f = j.load.fraction;
      ctx.strokeStyle = f >= 0.8 ? COLORS.contact : f >= 0.5 ? COLORS.preview : COLORS.velocity;
      ctx.lineWidth = 2 + 4 * Math.min(1, f);
      ctx.setLineDash(f >= 0.8 ? [6, 3] : []);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pj.x, pj.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(pj.x, pj.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (opts.overlays.has("links")) {
    for (const l of world.links) {
      const to = byId.get(l.to);
      if (!to) continue;
      const pt = toScreen(c, vp, to.position);
      if (l.kind === "feed") {
        const from = byId.get(l.from);
        if (!from) continue;
        arrow(ctx, toScreen(c, vp, from.position), pt, COLORS.force, [6, 4]);
      } else {
        const tag = { x: pt.x + 26, y: pt.y - 26 };
        ctx.strokeStyle = COLORS.force;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(tag.x, tag.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS.force;
        ctx.font = "11px 'IBM Plex Mono', monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(`${l.channel} ${(world.controls[l.channel] ?? 0).toFixed(2)}`, tag.x + 2, tag.y);
      }
    }
  }

  if (opts.highlight) {
    for (const id of opts.highlight) {
      const b = byId.get(id);
      if (!b) continue;
      bodyPath(ctx, c, vp, b);
      ctx.strokeStyle = COLORS.force;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  for (const m of opts.ports ?? []) {
    const s = toScreen(c, vp, m.point);
    ctx.lineWidth = 2;
    ctx.strokeStyle = m.state === "valid" ? COLORS.velocity : m.state === "invalid" ? COLORS.contact : COLORS.bodyStroke;
    ctx.setLineDash(m.state === "invalid" ? [3, 2] : []);
    ctx.beginPath();
    ctx.arc(s.x, s.y, m.state === "idle" ? 4 : 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const p = opts.preview;
  if (p) {
    if (p.body) {
      ctx.globalAlpha = 0.45;
      bodyPath(ctx, c, vp, p.body);
      ctx.fillStyle = p.valid === false ? COLORS.contact : p.valid === true ? COLORS.velocity : COLORS.preview;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (p.valid !== undefined) {
        ctx.strokeStyle = p.valid ? COLORS.velocity : COLORS.contact;
        ctx.lineWidth = 2;
        ctx.setLineDash(p.valid ? [] : [6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const a = toScreen(c, vp, p.from);
    const b = toScreen(c, vp, p.to);
    if (p.kind === "arrow") arrow(ctx, a, b, COLORS.preview);
    if (p.kind === "line") {
      ctx.strokeStyle = COLORS.force;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (p.label) {
      ctx.fillStyle = COLORS.preview;
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(p.label, b.x + 10, b.y - 6);
    }
  }

  const r = opts.ruler;
  if (r) {
    const a = toScreen(c, vp, r.a);
    const b = toScreen(c, vp, r.b);
    ctx.strokeStyle = COLORS.preview;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const s of [a, b]) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.preview;
    ctx.font = "12px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(r.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 8);
  }
}
