// A ship's wiring (docs/blueprint/spec.md §10): how the player's controls drive its engines and
// devices. A general form of Mammoth Asteroids' and Thrust's fixed steering mix (arcade.ts,
// SteerMix): rows of lines, as a model radio transmitter's mixer. Each step, before the physics,
// every row's channel is set from the controls held (each 0 to 1). Pure and deterministic.

/** One line of a row: a control, scaled, optionally eased by another control. */
export interface MixerLine {
  /** The control read (a channel the player's keys or stick set). */
  control: string;
  /** How much of it, 0 to 1. */
  weight: number;
  /** Eased by another control: the line is multiplied by (1 − amount × that control). */
  ease?: { control: string; amount: number };
}

/** What a driven channel takes from its lines: the largest (default), their sum (up to 1), or the least. */
export type MixerCombine = "max" | "sum" | "min";

export interface MixerRow {
  /** The channel driven: an engine's injector, a gun, a tractor, a shield. */
  channel: string;
  lines: MixerLine[];
  combine?: MixerCombine;
  /** The most this channel is ever set to, 0 to 1 (default 1). */
  limit?: number;
}

/**
 * Two controls that are opposites (turn left and turn right): held together they cancel, each
 * leaving only what it has more than the other, and what they share counts as `both` (forward), if
 * given. Applied in order, before the rows read the controls.
 */
export interface MixerRule {
  opposites: [string, string];
  both?: string;
}

export interface Mixer {
  rules?: MixerRule[];
  rows: MixerRow[];
}

const unit = (x: number | undefined) => Math.max(0, Math.min(1, x ?? 0));

/** The controls as the rows see them: each 0 to 1, after the rules. */
export function mixerInputs(m: Mixer, controls: Record<string, number>): Record<string, number> {
  const c: Record<string, number> = {};
  const read = (k: string) => (k in c ? c[k] : unit(controls[k]));
  for (const rule of m.rules ?? []) {
    const [a, b] = rule.opposites;
    const va = read(a);
    const vb = read(b);
    const shared = Math.min(va, vb);
    c[a] = va - shared;
    c[b] = vb - shared;
    if (rule.both) c[rule.both] = Math.max(read(rule.both), shared);
  }
  for (const row of m.rows) {
    for (const l of row.lines) {
      if (!(l.control in c)) c[l.control] = unit(controls[l.control]);
      if (l.ease && !(l.ease.control in c)) c[l.ease.control] = unit(controls[l.ease.control]);
    }
  }
  return c;
}

/** Each driven channel's value, 0 to 1, from the controls held. */
export function mixerValues(m: Mixer, controls: Record<string, number>): Record<string, number> {
  const c = mixerInputs(m, controls);
  const out: Record<string, number> = {};
  for (const row of m.rows) {
    const vals = row.lines.map((l) => {
      const ease = l.ease ? 1 - unit(l.ease.amount) * c[l.ease.control] : 1;
      return Math.max(0, c[l.control] * unit(l.weight) * ease);
    });
    let v = 0;
    if (vals.length) {
      const combine = row.combine ?? "max";
      v = combine === "sum" ? vals.reduce((a, b) => a + b, 0) : combine === "min" ? Math.min(...vals) : Math.max(...vals);
    }
    out[row.channel] = Math.min(unit(v), row.limit === undefined ? 1 : unit(row.limit));
  }
  return out;
}

/** Sets the world's driven channels from its mixer and the controls held: once a step, before the physics. */
export function applyMixer(world: { mix?: Mixer; controls: Record<string, number> }): void {
  if (!world.mix) return;
  let next: Record<string, number> | null = null;
  for (const [channel, value] of Object.entries(mixerValues(world.mix, world.controls))) {
    if (Math.abs((world.controls[channel] ?? 0) - value) > 1e-12) (next ??= { ...world.controls })[channel] = value;
  }
  if (next) world.controls = next;
}

/**
 * Mammoth Asteroids' and Thrust's steering mix (arcade.ts, SteerMix, MAS-054) as mixer lines: the
 * wiring the designer's Thrust 1 preset starts with. Gives the same values as `steerValues`.
 */
export function steerMixer(m: { forward: string; left: string; right: string; reverse: string; main: string; backLeft: string; backRight: string; frontLeft: string; frontRight: string; frontTurn: number }): Mixer {
  const line = (control: string, ease?: { control: string; amount: number }): MixerLine => (ease ? { control, weight: 1, ease } : { control, weight: 1 });
  return {
    rules: [{ opposites: [m.left, m.right], both: m.forward }],
    rows: [
      { channel: m.main, lines: [line(m.forward)] },
      { channel: m.backLeft, lines: [line(m.right), line(m.forward, { control: m.left, amount: 1 })] },
      { channel: m.backRight, lines: [line(m.left), line(m.forward, { control: m.right, amount: 1 })] },
      { channel: m.frontLeft, lines: [line(m.reverse), line(m.left, { control: m.forward, amount: m.frontTurn })] },
      { channel: m.frontRight, lines: [line(m.reverse), line(m.right, { control: m.forward, amount: m.frontTurn })] },
    ],
  };
}
