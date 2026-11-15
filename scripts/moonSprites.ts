// The placeholder sprite sheet for Moon Mammoth (docs/games/moon-mammoth-design.md §4.2): a round
// woolly mammoth in a glass helmet, from a few shapes moved per frame. Real art replaces the file it
// writes; the layout is src/app/moon/sheet.ts.
//   node scripts/moonSprites.ts            writes src/app/moon/mammoth.svg
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLUMNS, FRAME, ROWS, SHEET, STAND_PX } from "../src/app/moon/sheet.ts";

const root = new URL("..", import.meta.url).pathname;
const WOOL = "#8a5a3c";
const WOOL_DARK = "#6b4229";
const WOOL_LIGHT = "#a8744f";
const TUSK = "#fff4d6";
const n = (x: number) => Math.round(x * 10) / 10;

interface Pose {
  /** Each leg's shift: along, and up off the ground, px. Back to front. */
  legs: [number, number][];
  /** The body's lift, px, and how far the trunk is raised, 0 to 1. */
  bob: number;
  trunk: number;
  /** The whole mammoth scaled across and up about the frame's middle, and turned, degrees. */
  sx: number;
  sy: number;
  lean: number;
  /** Curled up in a ball: no legs. */
  ball?: boolean;
  /** Speed lines behind it, shifted by this, px. */
  lines?: number;
}
const STILL: Pose = { legs: [[0, 0], [0, 0], [0, 0], [0, 0]], bob: 0, trunk: 0, sx: 1, sy: 1, lean: 0 };

function mammoth(p: Pose): string {
  const c = FRAME / 2;
  const R = STAND_PX;
  const out: string[] = [];
  // Speed lines, behind.
  if (p.lines !== undefined) for (let k = 0; k < 3; k++) out.push(`<line x1="${n(14 + p.lines + 10 * k)}" y1="${c - 30 + 30 * k}" x2="${n(54 + p.lines + 10 * k)}" y2="${c - 30 + 30 * k}" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.6"/>`);
  out.push(`<g transform="translate(${c} ${c}) rotate(${p.lean}) scale(${p.sx} ${p.sy}) translate(${-c} ${-c - p.bob})">`);
  // Tail.
  out.push(`<path d="M ${c - R + 14} ${c + 6} q -20 4 -16 26" fill="none" stroke="${WOOL_DARK}" stroke-width="7" stroke-linecap="round"/>`);
  // Legs: stubby, their feet on the bottom of the circle.
  if (!p.ball) {
    const xs = [c - 54, c - 22, c + 18, c + 50];
    xs.forEach((x, i) => {
      const [dx, dy] = p.legs[i];
      out.push(`<rect x="${n(x - 13 + dx)}" y="${n(c + R - 46 - dy + p.bob)}" width="26" height="46" rx="11" fill="${i % 2 ? WOOL : WOOL_DARK}"/>`);
      out.push(`<rect x="${n(x - 13 + dx)}" y="${n(c + R - 12 - dy + p.bob)}" width="26" height="12" rx="6" fill="#3b2415"/>`);
    });
  }
  // Body: a round ball of wool, with tufts along its top and a lighter belly.
  out.push(`<circle cx="${c - 8}" cy="${c + 4}" r="${R - 14}" fill="${WOOL}"/>`);
  for (let k = 0; k < 7; k++) {
    const a = Math.PI * (1.05 + 0.13 * k);
    out.push(`<circle cx="${n(c - 8 + (R - 16) * Math.cos(a))}" cy="${n(c + 4 + (R - 16) * Math.sin(a))}" r="15" fill="${WOOL}"/>`);
  }
  out.push(`<path d="M ${c - 70} ${c + 40} q 60 40 124 0 q -60 62 -124 0 z" fill="${WOOL_LIGHT}" opacity="0.7"/>`);
  for (let k = 0; k < 5; k++) out.push(`<path d="M ${c - 62 + 26 * k} ${c - 20 + (k % 2) * 16} q 8 12 16 0" fill="none" stroke="${WOOL_DARK}" stroke-width="4" stroke-linecap="round" opacity="0.6"/>`);
  // Head, ear and eye.
  const hx = c + 46;
  const hy = c - 26;
  out.push(`<circle cx="${hx}" cy="${hy}" r="46" fill="${WOOL}"/>`);
  out.push(`<circle cx="${hx - 4}" cy="${hy - 42}" r="14" fill="${WOOL}"/>`);
  out.push(`<ellipse cx="${hx - 26}" cy="${hy + 2}" rx="13" ry="20" fill="${WOOL_DARK}"/>`);
  out.push(`<circle cx="${hx + 16}" cy="${hy - 8}" r="8" fill="#fff"/><circle cx="${hx + 18}" cy="${hy - 8}" r="4" fill="#1b1b1b"/>`);
  // Trunk: down and curled, or raised.
  const tip = { x: hx + 36 + 8 * p.trunk, y: hy + 74 - 96 * p.trunk };
  out.push(`<path d="M ${hx + 34} ${hy + 10} Q ${n(hx + 56)} ${n(hy + 40 - 30 * p.trunk)} ${n(tip.x)} ${n(tip.y)}" fill="none" stroke="${WOOL_DARK}" stroke-width="17" stroke-linecap="round"/>`);
  // Tusks.
  out.push(`<path d="M ${hx + 18} ${hy + 26} q 26 22 44 -8" fill="none" stroke="${TUSK}" stroke-width="8" stroke-linecap="round"/>`);
  // The helmet: a glass bubble round the head.
  out.push(`<circle cx="${hx + 4}" cy="${hy - 2}" r="60" fill="#9fd8ff" fill-opacity="0.16" stroke="#e8f6ff" stroke-width="4" stroke-opacity="0.85"/>`);
  out.push(`<path d="M ${hx - 34} ${hy - 30} q 14 -26 40 -32" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity="0.7"/>`);
  out.push(`</g>`);
  return out.join("");
}

const walk = (k: number): Pose => {
  const leg = (phase: number): [number, number] => {
    const a = (2 * Math.PI * k) / 8 + phase;
    return [14 * Math.sin(a), Math.max(0, 12 * Math.cos(a))];
  };
  return { ...STILL, legs: [leg(0), leg(Math.PI), leg(Math.PI / 2), leg((3 * Math.PI) / 2)], bob: 3 * Math.abs(Math.sin((2 * Math.PI * k) / 8)) };
};

/** Every frame, by row: as the table in src/app/moon/sheet.ts. */
const rows: Pose[][] = [];
rows[SHEET.idle.row] = [STILL, { ...STILL, bob: 3, trunk: 0.08 }];
rows[SHEET.walk.row] = Array.from({ length: 8 }, (_, k) => walk(k));
rows[SHEET.turn.row] = [{ ...STILL, sx: 0.7 }, { ...STILL, sx: 0.3 }, { ...STILL, sx: 0.7 }];
rows[SHEET.jump.row] = [
  { ...STILL, legs: [[-10, 10], [-8, 12], [8, 12], [10, 10]], trunk: 0.9, sy: 1.06, sx: 0.96, lean: -8 },
  { ...STILL, legs: [[-16, 16], [-8, 18], [8, 18], [16, 16]], trunk: 0.6 },
  { ...STILL, legs: [[-6, 4], [-2, 6], [10, 6], [16, 4]], trunk: 1, sy: 1.04, lean: 8 },
];
rows[SHEET.roll.row] = [{ ...STILL, ball: true, trunk: 0.15 }];
rows[SHEET.sit.row] = [
  { ...STILL, sx: 0.86, sy: 0.78 },
  { ...STILL, sx: 0.72, sy: 0.6 },
];
rows[SHEET.slide.row] = [
  { ...STILL, sx: 0.72, sy: 0.6, lean: -6, legs: [[10, 0], [12, 0], [14, 0], [16, 0]], lines: 0 },
  { ...STILL, sx: 0.72, sy: 0.6, lean: -4, legs: [[10, 0], [12, 0], [14, 0], [16, 0]], lines: 12 },
];

const frames: string[] = [];
rows.forEach((row, r) => {
  row.forEach((pose, col) => frames.push(`<g transform="translate(${col * FRAME} ${r * FRAME})">${mammoth(pose)}</g>`));
});
const w = COLUMNS * FRAME;
const h = ROWS * FRAME;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<!-- Moon Mammoth's placeholder sprite sheet: written by scripts/moonSprites.ts. Layout: src/app/moon/sheet.ts. -->\n${frames.join("\n")}\n</svg>\n`;
const file = join(root, "src", "app", "moon", "mammoth.svg");
writeFileSync(file, svg);
console.log(`wrote ${file}`);
