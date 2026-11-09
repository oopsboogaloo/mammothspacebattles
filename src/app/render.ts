// Draws a world onto a 2D canvas context (TST-011): a pure function of
// world, camera and options, usable without the UI shell.
import { add, assemblyRoots, assemblyTotals, collectorMouth, tractorFrame, bodyMass, localVertices, massProps, rotate, scale, sinCos, SPECIES, temperatureOf, vesselShape, wispFade, wispRadius, type Body, type DustKind, type Parcel, type Vec2, type World } from "../core/index.ts";
import { toScreen, type Camera, type Viewport } from "./camera.ts";
import { sourceOf } from "./smooth.ts";

export type OverlayId = "velocity" | "com" | "contacts" | "forces" | "joints" | "links" | "damage" | "pilots" | "grid";

export const OVERLAYS: { id: OverlayId; label: string; key?: string; legend: string }[] = [
  { id: "velocity", label: "Velocity", legend: "solid blue arrow" },
  { id: "com", label: "Centre of mass", legend: "white circled cross per part; large yellow-and-black disc for each welded assembly" },
  { id: "contacts", label: "Contacts", legend: "orange dot, dashed line ∝ impulse" },
  { id: "forces", label: "Forces", legend: "purple dotted line (drags), arrow (gravity)" },
  { id: "joints", label: "Joint load", legend: "line thickens with load: blue < 50%, yellow < 80%, orange dashed ≥ 80% of the limit" },
  { id: "links", label: "Links", legend: "feed: purple dashed arrow · control: dotted line to the channel name" },
  { id: "damage", label: "Damage", legend: "bar over each damaged part: its integrity, blue > 50%, yellow > 20%, orange below; wreckage is dark with a cross; a thick orange stroke marks a leaking breach" },
  { id: "pilots", label: "AI plans", legend: "each AI pilot: dashed line to where it is going, its route's waypoints as rings, and a red ring round what it is steering past" },
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
  wreck: "#0C0F18",
  tractor: "#5CE1C6",
  gold: "#8A6A1F",
  goldStroke: "#F2C94C",
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

// ---------- The plume (SBX-035): soft glowing blobs, blurred together ----------

/** How gas is drawn: as a glowing plume of soft blobs (temperature colours), or as plain dots. */
export type GasStyle = "plume" | "dots";

/**
 * Flame colours by temperature, K: white-yellow at the hottest, through orange and red to a dull
 * ember, then grey smoke once the gas has cooled. Hot gas adds light; smoke is laid over.
 */
export const FLAME: readonly (readonly [number, string])[] = [
  [300, "#8a8d94"],
  [700, "#8a8d94"],
  [900, "#6e2a20"],
  [1200, "#c8442a"],
  [1600, "#ff8a2e"],
  [2100, "#ffc85a"],
  [2700, "#fff3cf"],
];
/** Below this the gas is smoke, drawn over what is behind it; above, it glows. */
export const GLOW_FROM = 800;

/** The plume's colour and opacity at temperature T. */
export function flameColour(T: number): { colour: string; alpha: number; glow: boolean } {
  const stops = FLAME;
  let rgb = hex(stops[0][1]);
  if (T >= stops[stops.length - 1][0]) rgb = hex(stops[stops.length - 1][1]);
  else
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (T < t1 && T >= t0) {
        const f = (T - t0) / (t1 - t0);
        const a = hex(c0);
        const b = hex(c1);
        rgb = [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)) as [number, number, number];
        break;
      }
    }
  const glow = T >= GLOW_FROM;
  // Smoke is faint; glow strengthens as the gas gets hotter.
  const alpha = glow ? Math.min(0.9, 0.35 + 0.55 * ((T - GLOW_FROM) / 1900)) : 0.22;
  return { colour: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, alpha, glow };
}

const PLUME_BUCKETS = 32;
/** A tail wisp's blob across as it leaves the gas, m (it grows from there). */
const WISP_SIZE = 0.8;
const PLUME_DOWN = 4; // the plume is drawn at a quarter of the resolution, then blurred up
const SPRITE = 32;
/** Temperature of plume bucket k, log-spaced from 150 K to 3,000 K. */
const bucketT = (k: number) => 150 * Math.pow(3000 / 150, k / (PLUME_BUCKETS - 1));
const bucketOf = (T: number) => Math.max(0, Math.min(PLUME_BUCKETS - 1, Math.round((Math.log(Math.max(T, 150) / 150) / Math.log(3000 / 150)) * (PLUME_BUCKETS - 1))));
let sprites: HTMLCanvasElement[] | null = null;
let buffer: HTMLCanvasElement | null = null;
let blurred: HTMLCanvasElement | null = null;

/** A soft round blob per bucket colour: opaque in the middle, fading smoothly to nothing. */
function plumeSprites(): HTMLCanvasElement[] {
  if (sprites) return sprites;
  sprites = [];
  for (let k = 0; k < PLUME_BUCKETS; k++) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = SPRITE;
    const g = cv.getContext("2d")!;
    const { colour } = flameColour(bucketT(k));
    const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    const [r, gg, b] = colour.slice(4, -1).split(",").map(Number);
    for (const [at, a] of [
      [0, 1],
      [0.3, 0.75],
      [0.6, 0.3],
      [0.85, 0.08],
      [1, 0],
    ])
      grad.addColorStop(at, `rgba(${r},${gg},${b},${a})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE, SPRITE);
    sprites.push(cv);
  }
  return sprites;
}

/** Can this context draw the plume (a real canvas, not a test recorder)? */
function canPlume(ctx: Ctx): ctx is Ctx & CanvasRenderingContext2D {
  return typeof document !== "undefined" && typeof (ctx as Partial<CanvasRenderingContext2D>).drawImage === "function";
}

/**
 * The gas as a plume: each parcel a soft blob about its smoothing length across, at a third of the
 * resolution, smoke laid down first and hot gas added as light, then blurred up over the scene.
 */
function drawPlume(ctx: CanvasRenderingContext2D, world: World, c: Camera, vp: Viewport): void {
  const parcels = world.gas.parcels;
  const wisps = world.wisps ?? [];
  if (!parcels.length && !wisps.length) return;
  const w = Math.max(1, Math.ceil(vp.width / PLUME_DOWN));
  const h = Math.max(1, Math.ceil(vp.height / PLUME_DOWN));
  buffer ??= document.createElement("canvas");
  if (buffer.width !== w || buffer.height !== h) {
    buffer.width = w;
    buffer.height = h;
  }
  const b = buffer.getContext("2d")!;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = "source-over";
  b.globalAlpha = 1;
  b.clearRect(0, 0, w, h);
  const sp = plumeSprites();
  const scale = world.gas.scale ?? 1;
  const buckets = parcels.map((p) => bucketOf(temperatureOf(p, scale)));
  // Each blob covers the space its parcel has: the area per parcel around it, from a count on a coarse
  // grid (its cell and the 8 around it). Gas that has spread out gets bigger, fainter blobs.
  const cell = 0.4;
  const count = new Map<number, number>();
  const key = (cx: number, cy: number) => (cx + 1048576) * 2097152 + (cy + 1048576);
  const cells = parcels.map((p) => [Math.floor(p.position.x / cell), Math.floor(p.position.y / cell)] as const);
  for (const [cx, cy] of cells) count.set(key(cx, cy), (count.get(key(cx, cy)) ?? 0) + 1);
  const size = cells.map(([cx, cy], i) => {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) n += count.get(key(cx + dx, cy + dy)) ?? 0;
    const spacing = Math.sqrt((9 * cell * cell) / n);
    return Math.min(1.6, Math.max(3 * parcels[i].radius, 1.05 * spacing));
  });
  for (const glow of [false, true]) {
    b.globalCompositeOperation = glow ? "lighter" : "source-over";
    parcels.forEach((p, i) => {
      const k = buckets[i];
      const f = flameColour(bucketT(k));
      if (f.glow !== glow) return;
      const s = toScreen(c, vp, p.position);
      // At least the smoothing length across (6 radii), and as wide as the space between parcels,
      // so neighbours overlap into one body of gas.
      const R = Math.max(1.5, size[i] * c.zoom) / PLUME_DOWN;
      const x = s.x / PLUME_DOWN;
      const y = s.y / PLUME_DOWN;
      if (x < -R || y < -R || x > w + R || y > h + R) return;
      // Thinner where it has spread: the same gas over a larger area.
      b.globalAlpha = f.alpha * Math.min(1, Math.max(0.35, (0.5 / Math.max(size[i], 0.5)) ** 0.5));
      b.drawImage(sp[k], x - R, y - R, 2 * R, 2 * R);
    });
    // The tail (GAS-011): gas gone from the gas model cools, grows and fades out.
    for (const wp of wisps) {
      const fade = wispFade(wp);
      const k = bucketOf(wp.temperature * (1 - 0.7 * fade));
      const f = flameColour(bucketT(k));
      if (f.glow !== glow) continue;
      const s = toScreen(c, vp, wp.position);
      const R = Math.max(1.5, WISP_SIZE * (wispRadius(wp) / wp.radius) * c.zoom) / PLUME_DOWN;
      const x = s.x / PLUME_DOWN;
      const y = s.y / PLUME_DOWN;
      if (x < -R || y < -R || x > w + R || y > h + R) continue;
      b.globalAlpha = 0.6 * f.alpha * (1 - fade);
      b.drawImage(sp[k], x - R, y - R, 2 * R, 2 * R);
    }
  }
  // Blur at the small size (cheap), then let the stretch up smooth it further.
  let out: HTMLCanvasElement = buffer;
  if ("filter" in b) {
    blurred ??= document.createElement("canvas");
    if (blurred.width !== w || blurred.height !== h) {
      blurred.width = w;
      blurred.height = h;
    }
    const g = blurred.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.filter = "blur(1px)";
    g.drawImage(buffer, 0, 0);
    g.filter = "none";
    out = blurred;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  ctx.drawImage(out, 0, 0, vp.width, vp.height);
  ctx.restore();
}

/** Gas held in engine chambers (§10.1): each chamber filled in its gas's colour. */
function drawChambers(ctx: Ctx, world: World, c: Camera, vp: Viewport, mode: "temperature" | "composition", style: GasStyle = "dots"): void {
  // Shapes from the world as stepped, which its caches know, drawn where the shown copy has moved them.
  const src = sourceOf(world);
  world.bodies.forEach((b, i) => {
    const v = b.injector?.vessel;
    if (!v || !(v.mass > 0)) return;
    const shape = vesselShape(src, src.bodies[i]);
    if (!shape) return;
    const gas = { ...v, id: 0, position: b.position, velocity: b.velocity, radius: 0 } as Parcel;
    const T = temperatureOf(gas, world.gas.scale ?? 1);
    ctx.fillStyle = mode === "composition" ? compositionColour(gas) : style === "plume" ? flameColour(T).colour : temperatureColour(T);
    const q = sinCos(b.angle);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    shape.outline.forEach((p, i) => {
      const s = toScreen(c, vp, add(b.position, rotate(q, p)));
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawGas(ctx: Ctx, world: World, c: Camera, vp: Viewport, mode: "temperature" | "composition", style: GasStyle = "dots"): void {
  const plume = style === "plume" && mode === "temperature" && canPlume(ctx);
  drawChambers(ctx, world, c, vp, mode, plume ? "plume" : "dots");
  if (plume) return drawPlume(ctx, world, c, vp);
  // The tail (GAS-011) as fading dots.
  for (const wp of world.wisps ?? []) {
    const s = toScreen(c, vp, wp.position);
    if (s.x < -20 || s.x > vp.width + 20 || s.y < -20 || s.y > vp.height + 20) continue;
    ctx.globalAlpha = 0.6 * (1 - wispFade(wp));
    ctx.fillStyle = temperatureColour(wp.temperature * (1 - 0.7 * wispFade(wp)));
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(1.5, wispRadius(wp) * c.zoom), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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
      const T = temperatureOf(p, world.gas.scale ?? 1);
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
  /** Draw gas as a glowing plume (default) or as dots. The plume needs a real canvas; recorders get dots. */
  gasStyle?: GasStyle;
  /** A landing pad to mark (FLT-009). */
  pad?: string;
  /** Draw fixed bodies as plain ground with a single surface line (Mammoth Lander). */
  groundLine?: boolean;
}

/** The subset of CanvasRenderingContext2D used, so tests can pass a recorder. */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "strokeRect"
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

/**
 * Offsets (one world width or height, or both) of the copies of a wrapped world that the view
 * overlaps, not counting the world itself (FLT-012).
 */
export function wrapImages(world: World, c: Camera, vp: Viewport): [number, number][] {
  const b = world.bounds;
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  const halfW = vp.width / 2 / c.zoom;
  const halfH = vp.height / 2 / c.zoom;
  const out: [number, number][] = [];
  for (const i of [-1, 0, 1])
    for (const j of [-1, 0, 1]) {
      if (i === 0 && j === 0) continue;
      const x0 = b.min.x + i * w;
      const y0 = b.min.y + j * h;
      if (x0 + w < c.x - halfW || x0 > c.x + halfW || y0 + h < c.y - halfH || y0 > c.y + halfH) continue;
      out.push([i * w, j * h]);
    }
  return out;
}

/** The edges of a wrapped world, faint and dashed, so you can see where it wraps. */
function drawSeam(ctx: Ctx, world: World, c: Camera, vp: Viewport): void {
  const b = world.bounds;
  const corners = [b.min, { x: b.max.x, y: b.min.y }, b.max, { x: b.min.x, y: b.max.y }].map((p) => toScreen(c, vp, p));
  ctx.strokeStyle = COLORS.axes;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (const p of corners.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Centre of mass of each free welded assembly (two or more bodies), propellant in stores included:
 * the same mass-weighted mean the physics uses.
 */
export function assemblyCentres(world: World): Vec2[] {
  if (!world.joints.length) return [];
  const roots = assemblyRoots(world);
  const sums = new Map<string, { m: number; x: number; y: number; n: number; fixed: boolean }>();
  for (const b of world.bodies) {
    const r = roots.get(b.id) ?? b.id;
    const s = sums.get(r) ?? { m: 0, x: 0, y: 0, n: 0, fixed: false };
    const m = bodyMass(b);
    s.m += m;
    s.x += m * b.position.x;
    s.y += m * b.position.y;
    s.n += 1;
    s.fixed ||= b.fixed;
    sums.set(r, s);
  }
  const out: Vec2[] = [];
  for (const s of sums.values()) if (s.n > 1 && !s.fixed && s.m > 0) out.push({ x: s.x / s.m, y: s.y / s.m });
  return out;
}

/** The usual centre-of-mass symbol, large: a disc in yellow and black quarters with a white ring. */
function drawAssemblyCom(ctx: Ctx, s: Vec2): void {
  const r = 10;
  for (let q = 0; q < 4; q++) {
    ctx.fillStyle = q % 2 === 0 ? COLORS.preview : COLORS.background;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.arc(s.x, s.y, r, (q * Math.PI) / 2, ((q + 1) * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = COLORS.selected;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Marks a landing pad: a bright top edge with end posts, so it stands out from the ground. */
function drawPad(ctx: Ctx, world: World, c: Camera, vp: Viewport, id: string, label = "PAD", used = false): void {
  const b = world.bodies.find((x) => x.id === id);
  if (!b || b.shape.kind === "disc") return;
  const q = sinCos(b.angle);
  const vs = localVertices(b.shape).map((v) => add(b.position, rotate(q, v)));
  const top = Math.max(...vs.map((v) => v.y));
  const edge = vs.filter((v) => v.y > top - 1e-6).sort((u, v) => u.x - v.x);
  if (edge.length < 2) return;
  const a = toScreen(c, vp, edge[0]);
  const z = toScreen(c, vp, edge[edge.length - 1]);
  // A used pad (Mammoth Lander, LND-012) is dim, its label struck out.
  ctx.globalAlpha = used ? 0.35 : 1;
  ctx.strokeStyle = COLORS.preview;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(z.x, z.y);
  for (const p of [a, z]) {
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - 12);
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.preview;
  ctx.font = "12px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const mid = (a.x + z.x) / 2;
  ctx.fillText(label, mid, a.y - 4);
  if (used) {
    const w = 7.5 * label.length; // the 12px mono font's advance, near enough
    ctx.fillRect(mid - w / 2 - 2, a.y - 10, w + 4, 1.5);
  }
  ctx.globalAlpha = 1;
}

function drawGroundLine(ctx: Ctx, world: World, c: Camera, vp: Viewport): void {
  const fixed = world.bodies.filter((b) => b.fixed && b.shape.kind !== "disc");
  ctx.fillStyle = "#05070d";
  for (const b of fixed) {
    bodyPath(ctx, c, vp, b);
    ctx.fill();
  }
  ctx.strokeStyle = "#cfd8ea";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Lines the scenario draws itself (a cave's floor and roof).
  const lines = world.lander?.spec.lines;
  if (lines) {
    for (const l of lines)
      l.forEach((p, i) => {
        const s = toScreen(c, vp, p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
    ctx.stroke();
    return;
  }
  for (const b of fixed) {
    const q = sinCos(b.angle);
    const vs = localVertices(b.shape).map((v) => add(b.position, rotate(q, v)));
    const bottom = Math.min(...vs.map((v) => v.y));
    vs.forEach((v, i) => {
      const w = vs[(i + 1) % vs.length];
      if (v.y <= bottom + 1e-6 || w.y <= bottom + 1e-6) return; // a side or the bottom
      const a = toScreen(c, vp, v);
      const z = toScreen(c, vp, w);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(z.x, z.y);
    });
  }
  ctx.stroke();
}

/** Tractor beams as a faint wedge, and tethers as a line that warms from teal to red as it nears breaking (TRC). */
function drawTractors(ctx: Ctx, world: World, c: Camera, vp: Viewport): void {
  // A base's collector: a thin dashed line from its cup to what it is reeling in (BAS).
  for (const b of world.bodies) {
    const col = b.collector;
    if (!col?.cargo) continue;
    const cargo = world.bodies.find((x) => x.id === col.cargo);
    if (!cargo) continue;
    const m = toScreen(c, vp, collectorMouth(b));
    const p = toScreen(c, vp, cargo.position);
    ctx.strokeStyle = COLORS.goldStroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const b of world.bodies) {
    const t = b.tractor;
    if (!t || t.mode === "off") continue;
    const { origin, axis } = tractorFrame(b);
    const o = toScreen(c, vp, origin);
    if (t.mode === "beam") {
      const a0 = Math.atan2(axis.y, axis.x);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      const n = 16;
      for (let i = 0; i <= n; i++) {
        const a = a0 - t.arc / 2 + (t.arc * i) / n;
        const p = toScreen(c, vp, { x: origin.x + t.range * Math.cos(a), y: origin.y + t.range * Math.sin(a) });
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(92, 225, 198, 0.12)";
      ctx.fill();
      ctx.strokeStyle = "rgba(92, 225, 198, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      continue;
    }
    const cargo = world.bodies.find((x) => x.id === t.cargo);
    if (!cargo) continue;
    // The tether runs between the two centres of mass (TRC-004).
    const ends = [assemblyTotals(world, b.id), assemblyTotals(world, cargo.id)];
    if (!ends[0] || !ends[1]) continue;
    const o2 = toScreen(c, vp, ends[0].centre);
    const p = toScreen(c, vp, ends[1].centre);
    const f = Math.min(1, Math.abs(t.tension) / t.tether.maxTension);
    // Teal (slack or light) through amber to red (about to break).
    const r = Math.round(92 + f * (255 - 92));
    const gr = Math.round(225 - f * (225 - 80));
    const bl = Math.round(198 - f * (198 - 70));
    ctx.strokeStyle = `rgb(${r}, ${gr}, ${bl})`;
    ctx.lineWidth = 2;
    ctx.setLineDash(t.tension < 0 ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(o2.x, o2.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const q of [o2, p]) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.tractor;
      ctx.fill();
    }
  }
}

/** Strokes a body's edges except those on a hidden seam, which are painted over in its fill so the fragment reads as one. */
function strokeOutline(ctx: Ctx, c: Camera, vp: Viewport, b: Body, anchors: Vec2[], fill: string): void {
  const q = sinCos(b.angle);
  const vs = localVertices(b.shape);
  const onSeam = (p: Vec2, r: Vec2) => {
    const d = { x: r.x - p.x, y: r.y - p.y };
    const l2 = d.x * d.x + d.y * d.y;
    return anchors.some((a) => {
      const t = Math.max(0, Math.min(1, ((a.x - p.x) * d.x + (a.y - p.y) * d.y) / l2));
      return Math.hypot(p.x + t * d.x - a.x, p.y + t * d.y - a.y) < 1e-3 * Math.sqrt(l2) + 1e-6;
    });
  };
  const stroke = ctx.strokeStyle;
  const width = ctx.lineWidth;
  for (const hide of [true, false]) {
    ctx.beginPath();
    vs.forEach((v, i) => {
      const w = vs[(i + 1) % vs.length];
      if (onSeam(v, w) !== hide) return;
      const s0 = toScreen(c, vp, add(b.position, rotate(q, v)));
      const s1 = toScreen(c, vp, add(b.position, rotate(q, w)));
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
    });
    ctx.strokeStyle = hide ? fill : stroke;
    ctx.lineWidth = hide ? 2 : width;
    ctx.stroke();
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
}

/** AI pilots' plans (AIP-017): route waypoints, the line to the current target, and what it is steering round. */
function drawPilots(ctx: Ctx, world: World, c: Camera, vp: Viewport): void {
  for (const b of world.bodies) {
    const plan = b.pilot?.plan;
    if (!plan) continue;
    const from = toScreen(c, vp, b.position);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = COLORS.tractor;
    for (const w of plan.route ?? []) {
      const p = toScreen(c, vp, w);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (plan.target) {
      const p = toScreen(c, vp, plan.target);
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.tractor;
      ctx.fill();
    }
    ctx.strokeStyle = COLORS.contact;
    for (const o of plan.avoiding ?? []) {
      const p = toScreen(c, vp, o);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Dust colours by what it came from (DMG-007): rock, gold, hull metal. Hot for the first half second. */
const DUST: Record<DustKind, [number, number, number]> = { rock: [138, 128, 112], gold: [242, 201, 76], metal: [154, 167, 194] };
const HOT: [number, number, number] = [255, 170, 80];

/** Destroyed bodies' dust (DMG-007): glowing as it bursts, then drifting and fading out. */
function drawDust(ctx: Ctx, world: World, c: Camera, vp: Viewport): void {
  const list = world.dust;
  if (!list?.length) return;
  for (const d of list) {
    const s = toScreen(c, vp, d.position);
    if (s.x < -10 || s.x > vp.width + 10 || s.y < -10 || s.y > vp.height + 10) continue;
    const hot = Math.max(0, 1 - d.age / 0.6);
    const base = DUST[d.kind];
    const rgb = base.map((v, k) => Math.round(v + (HOT[k] - v) * hot));
    // Full for most of its life, fading over the last third.
    const left = 1 - d.age / d.life;
    ctx.globalAlpha = Math.min(1, 3 * left) * (0.55 + 0.45 * hot);
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    const r = Math.max(1, d.size * c.zoom);
    ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
  }
  ctx.globalAlpha = 1;
}

export function renderFrame(ctx: Ctx, world: World, c: Camera, vp: Viewport, opts: RenderOptions): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, vp.width, vp.height);
  if (opts.overlays.has("grid")) drawGrid(ctx, c, vp);
  // A wrapped world (FLT-012): its neighbouring copies first, plain, so the seam doesn't show.
  if (world.bounds.wrap) {
    for (const [ox, oy] of wrapImages(world, c, vp)) {
      const ci = { ...c, x: c.x - ox, y: c.y - oy };
      drawGas(ctx, world, ci, vp, opts.gasColour ?? "temperature", opts.gasStyle ?? "plume");
      for (const b of world.bodies) {
        bodyPath(ctx, ci, vp, b);
        ctx.fillStyle = b.fixed ? COLORS.fixed : COLORS.body;
        ctx.fill();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = b.fixed ? COLORS.fixedStroke : COLORS.bodyStroke;
        ctx.stroke();
      }
    }
    drawSeam(ctx, world, c, vp);
  }
  // Gas under bodies, so walls stay crisp.
  drawGas(ctx, world, c, vp, opts.gasColour ?? "temperature", opts.gasStyle ?? "plume");
  drawDust(ctx, world, c, vp);

  // Hidden seams of larger asteroid fragments (AST-007): where each weld sits on its bodies.
  const seams = new Map<string, Vec2[]>();
  for (const j of world.joints) {
    if (!j.hidden) continue;
    seams.set(j.a, [...(seams.get(j.a) ?? []), j.anchorA]);
    seams.set(j.b, [...(seams.get(j.b) ?? []), j.anchorB]);
  }
  // Ground as a single line (Mammoth Lander): fixed bodies filled plainly, with only the edges along
  // the surface drawn, not the sides and bottoms where the pieces meet.
  if (opts.groundLine) drawGroundLine(ctx, world, c, vp);
  for (const b of world.bodies) {
    if (opts.groundLine && b.fixed) continue;
    const selected = opts.selection.has(b.id);
    const hover = opts.hover === b.id;
    // Gold shows once it can be seen: not while hidden inside a larger fragment (AST-006).
    const gold = b.mineral === "gold" && !b.compound;
    const fill = b.integrity <= 0 ? COLORS.wreck : gold ? COLORS.gold : b.fixed ? COLORS.fixed : COLORS.body;
    bodyPath(ctx, c, vp, b);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = selected ? 3 : hover ? 2 : 1.25;
    ctx.strokeStyle = selected ? COLORS.selected : hover ? COLORS.hover : gold ? COLORS.goldStroke : b.fixed ? COLORS.fixedStroke : COLORS.bodyStroke;
    ctx.setLineDash(b.fixed && !selected ? [6, 4] : []);
    const hidden = seams.get(b.id);
    if (hidden && b.shape.kind !== "disc" && !selected) strokeOutline(ctx, c, vp, b, hidden, fill);
    else ctx.stroke();
    ctx.setLineDash([]);
    if (b.compound && !selected) continue; // no orientation mark or label to give its pieces away
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
  drawTractors(ctx, world, c, vp);
  // Several pads, each with its multiplier (Mammoth Lander, LND-010); or the one pad.
  const goal = world.challenge?.goal;
  if (goal?.pads) for (const p of goal.pads) drawPad(ctx, world, c, vp, p.id, `×${p.multiplier}`, goal.used?.includes(p.id));
  else if (opts.pad) drawPad(ctx, world, c, vp, opts.pad);
  drawDamage(ctx, world, c, vp, opts.overlays.has("damage"));

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
    for (const p of assemblyCentres(world)) drawAssemblyCom(ctx, toScreen(c, vp, p));
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

  if (opts.overlays.has("pilots")) drawPilots(ctx, world, c, vp);

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

/** Wreckage gets a cross (DMG-003). With the damage overlay, every part that can be damaged gets an integrity bar. */
function drawDamage(ctx: Ctx, world: World, c: Camera, vp: Viewport, bars: boolean): void {
  const taken: { x: number; y: number }[] = []; // bar + label boxes drawn so far, 76 × 12 px
  for (const b of world.bodies) {
    if (b.compound) continue; // a larger fragment's pieces stay hidden until its seams show (AST-007)
    const s = toScreen(c, vp, b.position);
    const r = Math.max(6, (b.shape.kind === "disc" ? b.shape.radius : massProps(b.shape, b.mass).boundingRadius) * c.zoom * 0.5);
    if (b.integrity <= 0) {
      ctx.strokeStyle = COLORS.contact;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - r * 0.5, s.y - r * 0.5);
      ctx.lineTo(s.x + r * 0.5, s.y + r * 0.5);
      ctx.moveTo(s.x + r * 0.5, s.y - r * 0.5);
      ctx.lineTo(s.x - r * 0.5, s.y + r * 0.5);
      ctx.stroke();
    }
    if (!bars) continue;
    // The breach a damaged store leaks through (DMG-004): a short orange stroke out of the surface.
    if (b.breach && b.integrity < 1) {
      const q = sinCos(b.angle);
      const at = toScreen(c, vp, add(b.position, rotate(q, b.breach.point)));
      const out = toScreen(c, vp, add(b.position, rotate(q, add(b.breach.point, { x: b.breach.normal.x * 0.15, y: b.breach.normal.y * 0.15 }))));
      ctx.strokeStyle = COLORS.contact;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(out.x, out.y);
      ctx.stroke();
    }
    // Only damaged parts get a bar: a whole ship of 19 parts at 100% stacked into a tower of bars.
    if (b.integrity >= 1) continue;
    const w = 36;
    let y = s.y - r - 12;
    // Neighbours (armour on its tank) would draw over each other: lift a bar until it's clear.
    while (taken.some((t) => Math.abs(t.x - s.x) < 76 && Math.abs(t.y - y) < 12)) y -= 12;
    taken.push({ x: s.x, y });
    ctx.fillStyle = COLORS.wreck;
    ctx.fillRect(s.x - w / 2, y, w, 5);
    ctx.fillStyle = b.integrity > 0.5 ? COLORS.velocity : b.integrity > 0.2 ? COLORS.preview : COLORS.contact;
    ctx.fillRect(s.x - w / 2, y, w * Math.max(0, b.integrity), 5);
    ctx.strokeStyle = COLORS.bodyStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x - w / 2, y, w, 5);
    ctx.fillStyle = COLORS.label;
    ctx.font = "11px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(b.integrity * 100)}%`, s.x + w / 2 + 4, y + 2.5);
  }
}
