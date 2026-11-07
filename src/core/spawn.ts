// Ships added at the press of a button (a scenario's `ui.spawn`, the stress test). A template is a
// ship as plain scenario data, laid out round the origin, with `{n}` in every id, control channel and
// pilot side: each copy replaces it with its number, so copies never share an id or a channel (a
// pilot drives only channels that lead into its own ship) and each is its own side.
import type { Vec2 } from "./math.ts";
import { rotate, sinCos } from "./math.ts";
import type { Command } from "./world.ts";

export interface ShipTemplate {
  /** The button's label. */
  label: string;
  bodies: { id: string; position: Vec2; [k: string]: unknown }[];
  joints?: Record<string, unknown>[];
  links?: Record<string, unknown>[];
  /** How far from the centre copies appear, m (default 60). */
  radius?: number;
}

const GOLDEN_ANGLE = 2.399963229728653; // rad: copies spread round the circle without lining up

/** The commands that add copy number `n` of `t`, on a circle round `centre`, facing it. */
export function spawnCommands(t: ShipTemplate, n: number, centre: Vec2): Command[] {
  const copy = JSON.parse(JSON.stringify({ bodies: t.bodies, joints: t.joints ?? [], links: t.links ?? [] }).replaceAll("{n}", String(n))) as {
    bodies: ShipTemplate["bodies"];
    joints: Record<string, unknown>[];
    links: Record<string, unknown>[];
  };
  const a = n * GOLDEN_ANGLE;
  const r = t.radius ?? 60;
  const at = { x: centre.x + r * sinCos(a).c, y: centre.y + r * sinCos(a).s };
  // Turned so its nose (up, +y, in the template) points at the centre.
  const turn = sinCos(a + Math.PI / 2);
  const out: Command[] = [];
  for (const b of copy.bodies) {
    const p = rotate(turn, b.position);
    out.push({ type: "body.add", body: { ...b, position: { x: at.x + p.x, y: at.y + p.y }, angle: ((b.angle as number) ?? 0) + a + Math.PI / 2 } as never });
  }
  for (const j of copy.joints) out.push({ type: "joint.add", joint: j as never });
  for (const l of copy.links) out.push({ type: "link.add", link: l as never });
  return out;
}
