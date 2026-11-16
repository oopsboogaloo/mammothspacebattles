// Draws Mammoth Thrust's player ship, to scale and annotated with each part's size and mass, from
// the ship template in scenarios/thrust-1.json (the same in every Thrust level).
//   node scripts/thrustShipSvg.ts      writes docs/games/mammoth-thrust-ship.svg
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Vec = { x: number; y: number };
const repo = new URL("..", import.meta.url).pathname;
const out = join(repo, "docs", "games", "mammoth-thrust-ship.svg");
const sc = JSON.parse(readFileSync(join(repo, "scenarios", "thrust-1.json"), "utf8"));
interface Store { resource: string; mass: number }
interface Body {
  id: string; mass: number; position: Vec; angle?: number; contents?: Store[];
  shape: { kind: string; width: number; height: number; vertices: Vec[] };
  magazine?: { count: number; shell: { mass: number } };
  tractor?: { arc: number; origin: Vec }; shield?: { radius: number };
}
interface Joint { id: string; a: string; anchorA: Vec; limits: { tension: number } }
const ship = sc.world.thrust.ship as { bodies: Body[]; joints: Joint[] };

const rot = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
const f = (n: number, d = 2) => (Math.abs(n) < 5e-7 ? 0 : n).toFixed(d);
const fm = (n: number) => (Math.round(n * 1000) / 1000).toString();

// Names and roles, from scripts/asteroidShip.ts.
const INFO: Record<string, [string, string]> = {
  "tank-l": ["Fuel tank, left wing", "fuel"],
  "tank-r": ["Fuel tank, right wing", "fuel"],
  "gen-l": ["Generator, left", "power"],
  "gen-r": ["Generator, right", "power"],
  "mag-l": ["Magazine, left (1 kg charge)", "weapon"],
  "mag-r": ["Magazine, right (1 kg charge)", "weapon"],
  battery: ["Battery", "power"],
  hull: ["Cockpit (hull)", "hull"],
  gun: ["Railgun + 120 slugs", "weapon"],
  main: ["Main thruster head", "engine"],
  "main-wall-a": ["Main nozzle wall, left", "engine"],
  "main-wall-b": ["Main nozzle wall, right", "engine"],
  tractor: ["Tractor unit", "utility"],
  tether: ["Tether unit", "utility"],
  shield: ["Shield generator collar", "utility"],
};
for (const s of ["l", "r"]) {
  const side = s === "l" ? "left" : "right";
  INFO[`back-${s}`] = [`Back thruster head, ${side}`, "engine"];
  INFO[`front-${s}`] = [`Front thruster head, ${side}`, "engine"];
  for (const k of ["back", "front"]) {
    INFO[`${k}-${s}-wall-a`] = [`${k === "back" ? "Back" : "Front"} ${side} nozzle wall`, "engine"];
    INFO[`${k}-${s}-wall-b`] = [`${k === "back" ? "Back" : "Front"} ${side} nozzle wall`, "engine"];
  }
}
const COL: Record<string, [string, string]> = {
  hull: ["#cfd8e3", "#4a5a6e"],
  fuel: ["#ffd27a", "#a6741a"],
  power: ["#a9e3b5", "#2f7d43"],
  weapon: ["#f4a7a0", "#a33a2f"],
  engine: ["#b9c2ff", "#3b46a8"],
  utility: ["#e2b8f2", "#7b3a99"],
};

// Each part: its corners in the ship's frame (origin at the cockpit's centroid, +y forward).
interface Part { n: number; key: string; name: string; role: string; poly: Vec[]; c: Vec; w: number; h: number; dry: number; extra: number; extraText: string; total: number; shape: string }
const parts: Part[] = ship.bodies.map((b) => {
  const key = b.id.replace("p{n}-", "");
  const a = b.angle ?? 0;
  const local: Vec[] = b.shape.kind === "box"
    ? [{ x: -b.shape.width / 2, y: -b.shape.height / 2 }, { x: b.shape.width / 2, y: -b.shape.height / 2 }, { x: b.shape.width / 2, y: b.shape.height / 2 }, { x: -b.shape.width / 2, y: b.shape.height / 2 }]
    : b.shape.vertices;
  const poly = local.map((v) => { const r = rot(v, a); return { x: b.position.x + r.x, y: b.position.y + r.y }; });
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  let extra = 0; const bits: string[] = [];
  for (const c of b.contents ?? []) if (c.mass > 0) { extra += c.mass; bits.push(`${fm(c.mass)} kg ${c.resource === "h2" ? "H₂" : "O₂"}`); }
  if (b.magazine) { const m = b.magazine.count * b.magazine.shell.mass; extra += m; bits.push(`${b.magazine.count} slugs × ${fm(b.magazine.shell.mass)} kg`); }
  const [name0, role] = INFO[key] ?? [key, "hull"];
  let name = name0;
  if (/^(back|front)-[lr]-wall/.test(key)) name += Math.abs(b.position.x) > 2.05 ? ", outer" : ", inner";
  const shape = b.shape.kind === "box" ? "box" : key === "hull" ? "hexagon" : "trapezoid, 0.10 m thick";
  return { n: 0, key, name, role, poly, c: { x: b.position.x, y: b.position.y }, w, h, dry: b.mass, extra, extraText: bits.join(" + "), total: b.mass + extra, shape };
});

const dry = parts.reduce((m, p) => m + p.dry, 0);
const total = parts.reduce((m, p) => m + p.total, 0);
const com = parts.reduce((c, p) => ({ x: c.x + (p.c.x * p.total) / total, y: c.y + (p.c.y * p.total) / total }), { x: 0, y: 0 });
const allX = parts.flatMap((p) => p.poly.map((v) => v.x)), allY = parts.flatMap((p) => p.poly.map((v) => v.y));
const ext = { x0: Math.min(...allX), x1: Math.max(...allX), y0: Math.min(...allY), y1: Math.max(...allY) };

// Layout.
const S = 150; // px per metre
const W = 1600;
const cx = W / 2;
const top = 150;
const shipTopPad = 90;
const oy = top + shipTopPad + ext.y1 * S; // screen y of ship y = 0
const X = (x: number) => cx + x * S;
const Y = (y: number) => oy - y * S;
const P = (v: Vec) => `${X(v.x).toFixed(1)},${Y(v.y).toFixed(1)}`;
const drawBottom = Y(ext.y0);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const o: string[] = [];

// Numbering: top to bottom, left to right.
const order = parts.slice().sort((a, b) => b.c.y - a.c.y || a.c.x - b.c.x);
order.forEach((p, i) => (p.n = i + 1));
const num = (p: Part) => p.n;

// Callouts: parts left of centre to the left column, right to the right; centre-line ones split.
const centre = order.filter((p) => Math.abs(p.c.x) < 1e-6);
const left = order.filter((p) => p.c.x < -1e-6);
const right = order.filter((p) => p.c.x > 1e-6);
centre.forEach((p, i) => (i % 2 === 0 ? left : right).push(p));
const colTop = top + 30, colBottom = drawBottom + 60;
const labelH = 46;
const anchorOf = (p: Part): Vec => {
  // Thin walls: aim at the middle of the wall's polygon.
  const a = p.poly.reduce((s, v) => ({ x: s.x + v.x / p.poly.length, y: s.y + v.y / p.poly.length }), { x: 0, y: 0 });
  if (p.key === "gun") return { x: p.c.x, y: p.c.y + 0.15 };
  if (p.key === "shield") return { x: p.c.x + 0.3, y: p.c.y };
  if (p.key === "hull") return { x: p.c.x - 0.25, y: p.c.y + 0.2 };
  if (p.key === "battery") return { x: p.c.x + 0.35, y: p.c.y };
  if (p.key === "main") return { x: p.c.x - 0.35, y: p.c.y };
  return a;
};
let lastLabel = 0;
const callouts = (list: Part[], side: -1 | 1) => {
  list.sort((a, b) => b.c.y - a.c.y || a.c.x - b.c.x);
  const ys = list.map((p) => Y(anchorOf(p).y));
  for (let it = 0; it < 200; it++) {
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] < labelH) { const d = (labelH - (ys[i] - ys[i - 1])) / 2; ys[i] += d; ys[i - 1] -= d; }
    if (ys[0] < colTop) { const d = colTop - ys[0]; for (let i = 0; i < ys.length; i++) ys[i] += d; }
  }
  const tx = side < 0 ? 30 : W - 30;
  const elbow = side < 0 ? 330 : W - 330;
  list.forEach((p, i) => {
    const ly = ys[i];
    const a = anchorOf(p);
    const [fill, stroke] = COL[p.role];
    o.push(`<polyline class="lead" points="${X(a.x).toFixed(1)},${Y(a.y).toFixed(1)} ${elbow},${ly.toFixed(1)} ${side < 0 ? 300 : W - 300},${ly.toFixed(1)}"/>`);
    o.push(`<circle cx="${X(a.x).toFixed(1)}" cy="${Y(a.y).toFixed(1)}" r="2.6" fill="${stroke}"/>`);
    const anchor = side < 0 ? "start" : "end";
    const bx = side < 0 ? tx : tx - 22;
    const textX = side < 0 ? tx + 30 : tx - 30;
    o.push(`<circle cx="${bx + 11}" cy="${(ly - 6).toFixed(1)}" r="11" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><text class="badge" x="${bx + 11}" y="${(ly - 2).toFixed(1)}">${num(p)}</text>`);
    o.push(`<text class="lbl" x="${textX}" y="${(ly - 8).toFixed(1)}" text-anchor="${anchor}">${esc(p.name)}</text>`);
    const sz = `${f(p.w)} × ${f(p.h)} m`;
    const ms = p.extra > 0 ? `${fm(p.total)} kg (${fm(p.dry)} dry)` : `${fm(p.total)} kg`;
    lastLabel = Math.max(lastLabel, ly + 14);
    o.push(`<text class="sub" x="${textX}" y="${(ly + 8).toFixed(1)}" text-anchor="${anchor}">${sz} · ${ms}</text>`);
  });
};

// Header.
o.push(`<text class="title" x="${cx}" y="46">Mammoth Thrust — the player's ship, to scale</text>`);
o.push(`<text class="subtitle" x="${cx}" y="74">${parts.length} parts · ${ship.joints.length} welds · ${fm(dry)} kg dry · ${fm(total)} kg at launch (8.1 kg propellant, 20.0 kg slugs) · overall ${f(ext.x1 - ext.x0)} m × ${f(ext.y1 - ext.y0)} m</text>`);
o.push(`<text class="note" x="${cx}" y="98">Geometry and masses read from the ship template in scenarios/thrust-1.json (identical in all Thrust levels), built by scripts/asteroidShip.ts with Thrust's tuning in scripts/thrust.ts.</text>`);
o.push(`<text class="note" x="${cx}" y="116">Origin = cockpit centroid; +y = forward (nose up). Sizes are each part's bounding box, width × height.</text>`);

// Grid (0.5 m) behind the ship.
const gx0 = Math.floor(ext.x0 * 2) / 2 - 0.5, gx1 = Math.ceil(ext.x1 * 2) / 2 + 0.5;
const gy0 = Math.floor(ext.y0 * 2) / 2 - 0.5, gy1 = Math.ceil(ext.y1 * 2) / 2 + 0.5;
for (let x = gx0; x <= gx1 + 1e-9; x += 0.5) o.push(`<line class="${Math.abs(x % 1) < 1e-9 ? "grid1" : "grid"}" x1="${X(x)}" y1="${Y(gy0)}" x2="${X(x)}" y2="${Y(gy1)}"/>`);
for (let y = gy0; y <= gy1 + 1e-9; y += 0.5) o.push(`<line class="${Math.abs(y % 1) < 1e-9 ? "grid1" : "grid"}" x1="${X(gx0)}" y1="${Y(y)}" x2="${X(gx1)}" y2="${Y(y)}"/>`);
for (let x = Math.ceil(gx0); x <= gx1; x += 1) o.push(`<text class="axis" x="${X(x)}" y="${Y(gy0) + 14}">${x} m</text>`);
for (let y = Math.ceil(gy0); y <= gy1; y += 1) o.push(`<text class="axis" x="${X(gx0) - 6}" y="${Y(y) + 4}" text-anchor="end">${y}</text>`);
o.push(`<line class="axis0" x1="${X(gx0)}" y1="${Y(0)}" x2="${X(gx1)}" y2="${Y(0)}"/><line class="axis0" x1="${X(0)}" y1="${Y(gy0)}" x2="${X(0)}" y2="${Y(gy1)}"/>`);

// Tractor beam wedge (30°, down the tail), clipped short.
const hullB = ship.bodies.find((b) => b.id.endsWith("hull"))!;
const tr = hullB.tractor!;
const beamLen = 0.9;
const half = tr.arc / 2;
const bo = tr.origin as Vec;
o.push(`<path class="beam" d="M${P(bo)} L${P({ x: bo.x - Math.tan(half) * beamLen, y: bo.y - beamLen })} L${P({ x: bo.x + Math.tan(half) * beamLen, y: bo.y - beamLen })} Z"/>`);

// Exhaust direction arrows.
const arrow = (from: Vec, dir: Vec, len: number, cls: string) => {
  const to = { x: from.x + dir.x * len, y: from.y + dir.y * len };
  o.push(`<line class="${cls}" x1="${X(from.x)}" y1="${Y(from.y)}" x2="${X(to.x)}" y2="${Y(to.y)}" marker-end="url(#arr)"/>`);
};

// Parts.
for (const p of parts) {
  const [fill, stroke] = COL[p.role];
  o.push(`<polygon points="${p.poly.map(P).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"><title>${esc(p.name)} (p{n}-${p.key}): ${f(p.w)} × ${f(p.h)} m, ${fm(p.total)} kg</title></polygon>`);
}
// Exhaust arrows from each engine head's outlet.
for (const p of parts.filter((q) => ["main", "back-l", "back-r", "front-l", "front-r"].includes(q.key))) {
  const b = ship.bodies.find((q) => q.id.endsWith(`-${p.key}`))!;
  const d = rot({ x: 0, y: -1 }, b.angle ?? 0);
  const out0 = { x: p.c.x + d.x * 0.15, y: p.c.y + d.y * 0.15 };
  arrow(out0, d, p.key === "main" ? 0.75 : 0.45, "exh");
}
// Gun bore.
const gunB = parts.find((p) => p.key === "gun")!;
arrow({ x: 0, y: gunB.c.y + 0.35 }, { x: 0, y: 1 }, 0.35, "bore");

// Welds.
const byId = new Map(ship.bodies.map((b) => [b.id, b]));
for (const j of ship.joints) {
  const a = byId.get(j.a)!;
  const r = rot(j.anchorA, a.angle ?? 0);
  const w = { x: a.position.x + r.x, y: a.position.y + r.y };
  const strong = j.limits.tension > 30000;
  o.push(`<circle class="${strong ? "weld2" : "weld"}" cx="${X(w.x).toFixed(1)}" cy="${Y(w.y).toFixed(1)}" r="${strong ? 3.6 : 3}"><title>${j.id.replace("p{n}-", "")}</title></circle>`);
}
// Centre of mass at launch, and the cockpit origin.
o.push(`<g transform="translate(${X(com.x).toFixed(1)},${Y(com.y).toFixed(1)})"><circle r="9" fill="#fff" stroke="#111" stroke-width="1.5"/><path d="M0,-9 A9,9 0 0 1 9,0 L0,0 Z M0,9 A9,9 0 0 1 -9,0 L0,0 Z" fill="#111"/></g>`);
o.push(`<path d="M${X(0) - 6},${Y(0)} h12 M${X(0)},${Y(0) - 6} v12" stroke="#d00" stroke-width="2"/>`);

callouts(left, -1);
callouts(right, 1);

// Legend + scale bar under the drawing.
let ly = Math.max(colBottom, Y(gy0) + 20, lastLabel) + 40;
const legend: [string, string][] = [["hull", "Cockpit"], ["engine", "Engines"], ["fuel", "Fuel"], ["power", "Power"], ["weapon", "Weapons"], ["utility", "Tractor / tether / shield"]];
let lx = 190;
for (const [r, t] of legend) {
  const [fill, stroke] = COL[r];
  o.push(`<rect x="${lx}" y="${ly - 11}" width="16" height="14" fill="${fill}" stroke="${stroke}"/><text class="sub" x="${lx + 22}" y="${ly}">${t}</text>`);
  lx += t.length * 7.4 + 54;
}
o.push(`<circle class="weld" cx="${lx + 6}" cy="${ly - 4}" r="3"/><text class="sub" x="${lx + 16}" y="${ly}">weld</text>`);
lx += 62;
o.push(`<circle class="weld2" cx="${lx + 6}" cy="${ly - 4}" r="3.6"/><text class="sub" x="${lx + 16}" y="${ly}">gun weld (2× strength)</text>`);
ly += 26;
lx = 190;
o.push(`<g transform="translate(${lx + 9},${ly - 4})"><circle r="7" fill="#fff" stroke="#111" stroke-width="1.3"/><path d="M0,-7 A7,7 0 0 1 7,0 L0,0 Z M0,7 A7,7 0 0 1 -7,0 L0,0 Z" fill="#111"/></g><text class="sub" x="${lx + 22}" y="${ly}">centre of mass at launch (${f(com.x)}, ${f(com.y)}) m</text>`);
lx += 330;
o.push(`<path d="M${lx},${ly - 4} h12 M${lx + 6},${ly - 10} v12" stroke="#d00" stroke-width="2"/><text class="sub" x="${lx + 18}" y="${ly}">origin (cockpit centroid)</text>`);
lx += 220;
o.push(`<line class="exh" x1="${lx}" y1="${ly - 4}" x2="${lx + 26}" y2="${ly - 4}" marker-end="url(#arr)"/><text class="sub" x="${lx + 34}" y="${ly}">exhaust direction</text>`);
lx += 170;
o.push(`<rect x="${lx}" y="${ly - 11}" width="18" height="14" class="beam"/><text class="sub" x="${lx + 24}" y="${ly}">tractor beam, 30° wedge (40 m range; drawn short)</text>`);
ly += 34;
o.push(`<line x1="190" y1="${ly}" x2="${190 + S}" y2="${ly}" stroke="#111" stroke-width="2"/><line x1="190" y1="${ly - 5}" x2="190" y2="${ly + 5}" stroke="#111" stroke-width="2"/><line x1="${190 + S}" y1="${ly - 5}" x2="${190 + S}" y2="${ly + 5}" stroke="#111" stroke-width="2"/><text class="sub" x="${200 + S}" y="${ly + 4}">1 m (scale ${S} px/m; grid 0.5 m)</text>`);

// Table.
ly += 50;
o.push(`<text class="h2" x="40" y="${ly}">Component schedule</text>`);
ly += 26;
const cols = [40, 80, 420, 585, 720, 860, 960, 1060, 1560];
const heads = ["#", "Component (template id)", "Shape", "Size w × h (m)", "Centre x, y (m)", "Dry (kg)", "Load (kg)", "Total (kg)", ""];
o.push(`<rect x="34" y="${ly - 16}" width="${W - 68}" height="24" fill="#e9edf2"/>`);
heads.forEach((h, i) => o.push(`<text class="th" x="${cols[i]}" y="${ly}">${h}</text>`));
o.push(`<text class="th" x="${cols[7] + 100}" y="${ly}">Load carried</text>`);
ly += 24;
for (const p of order) {
  const [fill, stroke] = COL[p.role];
  if (num(p) % 2 === 0) o.push(`<rect x="34" y="${ly - 15}" width="${W - 68}" height="22" fill="#f6f8fa"/>`);
  o.push(`<rect x="${cols[0]}" y="${ly - 11}" width="12" height="12" fill="${fill}" stroke="${stroke}"/><text class="td" x="${cols[0] + 18}" y="${ly}">${num(p)}</text>`);
  o.push(`<text class="td" x="${cols[1]}" y="${ly}">${esc(p.name)} <tspan class="id">(p{n}-${p.key})</tspan></text>`);
  o.push(`<text class="td" x="${cols[2]}" y="${ly}">${p.shape}</text>`);
  o.push(`<text class="td" x="${cols[3]}" y="${ly}">${f(p.w)} × ${f(p.h)}</text>`);
  o.push(`<text class="td" x="${cols[4]}" y="${ly}">${f(p.c.x)}, ${f(p.c.y)}</text>`);
  o.push(`<text class="td num" x="${cols[5] + 50}" y="${ly}">${p.dry.toFixed(2)}</text>`);
  o.push(`<text class="td num" x="${cols[6] + 50}" y="${ly}">${p.extra ? p.extra.toFixed(2) : "–"}</text>`);
  o.push(`<text class="td num b" x="${cols[7] + 50}" y="${ly}">${p.total.toFixed(2)}</text>`);
  o.push(`<text class="td" x="${cols[7] + 100}" y="${ly}">${esc(p.extraText)}</text>`);
  ly += 22;
}
o.push(`<line x1="34" y1="${ly - 14}" x2="${W - 34}" y2="${ly - 14}" stroke="#333"/>`);
ly += 4;
o.push(`<text class="td b" x="${cols[1]}" y="${ly}">Whole ship at launch</text>`);
o.push(`<text class="td" x="${cols[3]}" y="${ly}">${f(ext.x1 - ext.x0)} × ${f(ext.y1 - ext.y0)}</text>`);
o.push(`<text class="td num b" x="${cols[5] + 50}" y="${ly}">${dry.toFixed(2)}</text><text class="td num b" x="${cols[6] + 50}" y="${ly}">${(total - dry).toFixed(2)}</text><text class="td num b" x="${cols[7] + 50}" y="${ly}">${total.toFixed(2)}</text>`);
o.push(`<text class="td" x="${cols[7] + 100}" y="${ly}">8.10 kg propellant (0.90 H₂ + 7.20 O₂) + 20.00 kg slugs</text>`);
ly += 34;
const notes = [
  "Not drawn: the shield's field, a 2 kg body that exists only while the shield is up — radius " + f(ship.bodies.find((b) => b.id.endsWith("shield"))!.shield!.radius) + " m round the dry centre of mass; it adds 2 kg then.",
  "Engines hold no propellant at rest (their 20 ms chamber store fills when firing). Each tank feeds its own wing's two small thrusters, and both tanks feed the main thruster.",
  "Thrust: main 7.776 kg/s propellant flow; small thrusters 1.45 kg/s each. Railgun: 144 m/s, one slug every 0.125 s. Tether 12 m. Pod 34 kg (not part of the ship).",
  "Mass rule: a body's mass = its dry mass + its stores + shells in its magazine (src/core/bodies.ts, bodyMass). The design doc's 69 kg predates halving the fuel load (thrust.ts: fuel 0.5).",
];
for (const n of notes) { o.push(`<text class="note l" x="40" y="${ly}">• ${esc(n)}</text>`); ly += 20; }
const H = ly + 20;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">
<defs>
<marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#e0662b"/></marker>
<style>
.title{font-size:28px;font-weight:700;text-anchor:middle;fill:#111}
.subtitle{font-size:15px;text-anchor:middle;fill:#222}
.note{font-size:12.5px;text-anchor:middle;fill:#555}
.note.l{text-anchor:start}
.h2{font-size:18px;font-weight:700;fill:#111}
.grid{stroke:#eef1f4;stroke-width:1}
.grid1{stroke:#dde2e8;stroke-width:1}
.axis0{stroke:#c0c7d0;stroke-width:1;stroke-dasharray:4 3}
.axis{font-size:11px;fill:#8a94a0;text-anchor:middle}
.lead{fill:none;stroke:#8a94a0;stroke-width:0.9}
.badge{font-size:11px;font-weight:700;text-anchor:middle;fill:#111}
.lbl{font-size:13.5px;font-weight:600;fill:#111}
.sub{font-size:12.5px;fill:#333}
.weld{fill:#111;stroke:#fff;stroke-width:1}
.weld2{fill:#c0392b;stroke:#fff;stroke-width:1}
.exh{stroke:#e0662b;stroke-width:2.2}
.bore{stroke:#e0662b;stroke-width:2.2;stroke-dasharray:4 2}
.beam{fill:#c58be0;fill-opacity:0.18;stroke:#9b59b6;stroke-dasharray:5 3}
.th{font-size:12.5px;font-weight:700;fill:#111}
.td{font-size:12.5px;fill:#222}
.td.num{text-anchor:end}
.b{font-weight:700}
.id{fill:#888;font-size:11px}
</style>
</defs>
<rect width="100%" height="100%" fill="#fff"/>
${o.join("\n")}
</svg>
`;
writeFileSync(out, svg);
console.log(`wrote ${out}: ${parts.length} parts, ${ship.joints.length} welds, dry ${dry.toFixed(3)} kg, total ${total.toFixed(3)} kg, CoM ${com.x.toFixed(3)},${com.y.toFixed(3)}, extent ${ext.x0},${ext.x1},${ext.y0},${ext.y1}`);
