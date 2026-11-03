// The sandbox's model of an experiment: a scenario plus a timeline of user
// edits. Every edit is a core command recorded at the tick it was made
// (SBX-013), so the run can be replayed, undone (SBX-019) and exported as a
// scenario (SCN-006). No DOM here: this is unit-tested headless.

import {
  applyCommands,
  getProfile,
  initialWorld,
  parseScenario,
  resolveProbe,
  stepInPlace,
  timelineByStep,
  type Command,
  type Profile,
  type Scenario,
  type World,
} from "../core/index.ts";

export interface Edit {
  tick: number;
  commands: Command[];
}

interface UndoEntry {
  label: string;
  group?: number;
  added: Edit[];
  removed: Edit[];
  /** World just before this entry, if nothing has been stepped since: undo restores it directly. */
  before?: World;
  tick: number;
}

export interface Series {
  id: string;
  label: string;
  unit: string;
  path: string;
}

const SNAPSHOT_EVERY = 60;
const MAX_SNAPSHOTS = 600;
const MAX_UNDO = 500;

export const LEDGER_SERIES: Series[] = [
  { id: "ledger.px", label: "Momentum x", unit: "kg·m/s", path: "ledger.totals.momentum.x" },
  { id: "ledger.py", label: "Momentum y", unit: "kg·m/s", path: "ledger.totals.momentum.y" },
  { id: "ledger.L", label: "Angular momentum", unit: "kg·m²/s", path: "ledger.totals.angularMomentum" },
  { id: "ledger.ke", label: "Kinetic energy", unit: "J", path: "ledger.totals.energy.kinetic" },
  { id: "ledger.pe", label: "Potential energy", unit: "J", path: "ledger.totals.energy.potential" },
  { id: "ledger.heat", label: "Heat", unit: "J", path: "ledger.thermal" },
  { id: "ledger.total", label: "Total energy", unit: "J", path: "ledger.totals.energy.total" },
];

export class Sandbox {
  readonly raw: Record<string, unknown>;
  readonly scenario: Scenario;
  readonly profile: Profile;
  world: World;
  edits: Edit[] = [];
  /** Furthest tick simulated since the last edit; history is valid up to here. */
  maxTick = 0;
  dirty = false;
  series: Series[];
  /** history[seriesId][tick] */
  history: Record<string, number[]> = {};
  private timeline: Map<number, Command[]>;
  private snapshots = new Map<number, World>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  /** Throws ScenarioError if the input is invalid (UX-006); nothing is changed then. */
  constructor(raw: unknown, values: Record<string, number> = {}) {
    this.scenario = parseScenario(raw, values);
    this.raw = structuredClone(raw) as Record<string, unknown>;
    this.profile = getProfile(this.scenario.profile);
    this.timeline = timelineByStep(this.scenario);
    this.series = [
      ...this.scenario.probes.map((p) => ({ id: p.id, label: p.id, unit: "", path: p.path })),
      ...LEDGER_SERIES,
    ];
    this.world = initialWorld(this.scenario);
    this.snapshots.set(0, structuredClone(this.world));
    for (const s of this.series) this.history[s.id] = [];
    this.sample();
  }

  get tick(): number {
    return this.world.tick;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  private editsAt(tick: number): Command[] {
    return this.edits.filter((e) => e.tick === tick).flatMap((e) => e.commands);
  }

  private sample(): void {
    const t = this.world.tick;
    for (const s of this.series) {
      const v = resolveProbe(this.world, s.path);
      const arr = (this.history[s.id] ??= []);
      arr[t] = typeof v === "number" ? v : NaN;
      arr.length = Math.max(arr.length, t + 1);
    }
  }

  /** Advances n fixed steps. */
  step(n = 1): void {
    if (n > 0) for (const e of this.undoStack) if (e.tick <= this.world.tick) e.before = undefined;
    for (let i = 0; i < n; i++) {
      stepInPlace(this.world, this.timeline.get(this.world.tick) ?? [], this.profile);
      const t = this.world.tick;
      if (t % SNAPSHOT_EVERY === 0) this.saveSnapshot(t);
      const pending = this.editsAt(t);
      if (pending.length) applyCommands(this.world, pending, this.profile);
      this.sample();
      this.maxTick = Math.max(this.maxTick, t);
    }
  }

  private saveSnapshot(t: number): void {
    this.snapshots.set(t, structuredClone(this.world));
    if (this.snapshots.size > MAX_SNAPSHOTS) {
      const oldest = [...this.snapshots.keys()].filter((k) => k !== 0).sort((a, b) => a - b)[0];
      this.snapshots.delete(oldest);
    }
  }

  private invalidateAfter(tick: number): void {
    for (const k of [...this.snapshots.keys()]) if (k > tick) this.snapshots.delete(k);
    for (const id of Object.keys(this.history)) this.history[id].length = Math.min(this.history[id].length, tick + 1);
    this.maxTick = Math.min(this.maxTick, tick);
  }

  /** Moves the cursor to `tick` by replaying from the nearest snapshot (SBX-003, SBX-034 jump). */
  goTo(tick: number): void {
    const target = Math.max(0, Math.floor(tick));
    const start = Math.max(...[...this.snapshots.keys()].filter((k) => k <= target));
    const keepMax = this.maxTick;
    this.world = structuredClone(this.snapshots.get(start)!);
    const pending = this.editsAt(start);
    if (pending.length) applyCommands(this.world, pending, this.profile);
    while (this.world.tick < target) this.step(1);
    this.maxTick = Math.max(keepMax, target);
    this.sample();
  }

  reset(): void {
    this.goTo(0);
  }

  /**
   * Applies commands now and records them at the current tick. Editing while
   * scrubbed back discards the recorded future first (SBX-004).
   * Commands with the same `group` merge into one undo step (e.g. a drag).
   * Throws if a command is invalid for the current world; nothing changes then.
   */
  edit(commands: Command[], label: string, group?: number): void {
    const t = this.world.tick;
    const before = structuredClone(this.world);
    try {
      applyCommands(this.world, commands, this.profile);
    } catch (e) {
      this.world = before; // invalid for this world: nothing is recorded or changed
      throw e;
    }
    const removed = this.edits.filter((e) => e.tick > t);
    this.edits = this.edits.filter((e) => e.tick <= t);
    this.invalidateAfter(t);
    // The first edit at a tick snapshots the untouched state, so undo replays from here, not from far back.
    if (!this.edits.some((e) => e.tick === t) && !this.snapshots.has(t)) this.snapshots.set(t, structuredClone(before));
    const last = this.undoStack.at(-1);
    let edit = this.edits.find((e) => e.tick === t && last?.group !== undefined && last.group === group && last.added.includes(e));
    if (edit) edit.commands.push(...structuredClone(commands));
    else {
      edit = { tick: t, commands: structuredClone(commands) };
      this.edits.push(edit);
    }
    if (last && group !== undefined && last.group === group) {
      if (!last.added.includes(edit)) last.added.push(edit);
      last.removed.push(...removed);
    } else {
      this.undoStack.push({ label, group, added: [edit], removed, before, tick: t });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.redoStack = [];
    this.dirty = true;
    this.sample();
  }

  private rebuildFrom(tick: number): void {
    const now = this.world.tick;
    this.invalidateAfter(tick);
    this.goTo(now);
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.edits = this.edits.filter((e) => !entry.added.includes(e)).concat(entry.removed);
    this.redoStack.push(entry);
    this.dirty = true;
    if (entry.before && entry.removed.length === 0 && this.world.tick === entry.tick && this.maxTick <= entry.tick) {
      // Nothing has been simulated since this edit: put the world back as it was.
      this.world = structuredClone(entry.before);
      this.invalidateAfter(entry.tick);
      this.sample();
      return;
    }
    this.rebuildFrom(Math.min(...[...entry.added, ...entry.removed].map((e) => e.tick)));
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.edits = this.edits.filter((e) => !entry.removed.includes(e)).concat(entry.added);
    this.undoStack.push(entry);
    this.dirty = true;
    this.rebuildFrom(Math.min(...[...entry.added, ...entry.removed].map((e) => e.tick)));
  }

  addProbe(id: string, label: string, unit: string, path: string): void {
    if (this.series.some((s) => s.id === id)) return;
    this.series.push({ id, label, unit, path });
    this.history[id] = [];
    this.sample();
    this.dirty = true;
  }

  /**
   * The experiment as a scenario file: the original scenario with parameter
   * defaults set to the current values, user edits merged into the timeline
   * (before the scenario's own commands at the same step, matching live order),
   * and user probes added (SCN-006).
   */
  exportScenario(): Record<string, unknown> {
    const out = structuredClone(this.raw);
    if (Array.isArray(out.parameters)) {
      out.parameters = (out.parameters as Record<string, unknown>[]).map((p) => ({ ...p, default: this.scenario.values[p.id as string] ?? p.default }));
    }
    const timeline: { step: number; commands: Command[] }[] = [];
    const steps = new Set<number>([...this.edits.map((e) => e.tick), ...((out.timeline as { step: number }[]) ?? []).map((e) => e.step)]);
    const rawTimeline = (out.timeline as { step: number; commands: Command[] }[]) ?? [];
    for (const s of [...steps].sort((a, b) => a - b)) {
      const commands = [...this.editsAt(s), ...rawTimeline.filter((e) => e.step === s).flatMap((e) => e.commands)];
      if (commands.length) timeline.push({ step: s, commands });
    }
    out.timeline = timeline;
    const probeIds = new Set(this.scenario.probes.map((p) => p.id));
    const extra = this.series.filter((s) => !probeIds.has(s.id) && !s.id.startsWith("ledger.")).map((s) => ({ id: s.id, path: s.path }));
    out.probes = [...((out.probes as unknown[]) ?? []), ...extra];
    const end = (out.end as { steps: number } | undefined)?.steps ?? 0;
    const lastEdit = Math.max(0, ...this.edits.map((e) => e.tick));
    out.end = { steps: Math.max(end, this.maxTick, lastEdit + 1) };
    return out;
  }

  markSaved(): void {
    this.dirty = false;
  }
}

/** A blank scenario for "Empty world". */
export function emptyScenario(): Record<string, unknown> {
  return {
    schema: 1,
    name: "untitled",
    title: "Empty world",
    description: "Nothing here yet.",
    profile: "sandbox",
    seed: 1,
    world: { bodies: [] },
    timeline: [],
    end: { steps: 0 },
    probes: [],
    assertions: [],
    ui: { lookFor: "Press S (Spawn), pick a body, then click in the world. Drag while placing to give it a velocity.", overlays: ["velocity", "grid"], graphs: ["ledger.ke"] },
  };
}
