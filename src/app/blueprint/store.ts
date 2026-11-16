// The designer's state (docs/blueprint/spec.md): the blueprints, the one open, the selection, undo,
// and the view. Kept in the browser (localStorage) on every change.
import { computed, signal } from "@preact/signals";
import { scenarioFile } from "../scenarios.ts";
import { thrustPreset, type Blueprint } from "./model.ts";

const KEY = "msb.blueprints.v1";

export type Selection = { type: "component"; id: string } | { type: "weld"; id: string } | null;

export const presets: Blueprint[] = (() => {
  const t1 = scenarioFile("thrust-1");
  return t1 ? [thrustPreset(t1 as Parameters<typeof thrustPreset>[0])] : [];
})();

interface Saved {
  mine: Blueprint[];
  current: string;
}

function load(): Saved {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.mine)) return s;
    }
  } catch {
    // A broken save starts afresh rather than leaving the page blank.
  }
  return { mine: [], current: presets[0]?.id ?? "" };
}

const saved = load();
export const mine = signal<Blueprint[]>(saved.mine);
const all = () => [...presets, ...mine.value];
const first = all().find((b) => b.id === saved.current) ?? presets[0];

/** The blueprint open, as edited. */
export const current = signal<Blueprint>(first);
/** It as it was when opened: the performance table shows changes against it. */
export const baseline = signal<Blueprint>(first);
export const selection = signal<Selection>(null);
export const mode = signal<"build" | "controls">("build");
export const drawerOpen = signal(false);
export const tryOut = signal(false);
export const toast = signal<string | null>(null);
export const overlays = signal({ com: true, thrust: true, welds: true, dims: false, snap: true });

const undoStack = signal<Blueprint[]>([]);
const redoStack = signal<Blueprint[]>([]);
export const canUndo = computed(() => undoStack.value.length > 0);
export const canRedo = computed(() => redoStack.value.length > 0);

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mine: mine.value, current: current.value.id }));
  } catch {
    toast.value = "Couldn't save in this browser: export the blueprint to keep it.";
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function say(text: string): void {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 4000);
}

function uniqueName(base: string): string {
  const names = new Set(all().map((b) => b.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

const newId = () => `bp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** A copy of a blueprint as one of the player's own. */
export function duplicate(bp: Blueprint, name = `${bp.name} COPY`): Blueprint {
  const copy: Blueprint = { ...structuredClone(bp), id: newId(), name: uniqueName(name), preset: undefined, rev: 1 };
  delete copy.preset;
  mine.value = [...mine.value, copy];
  return copy;
}

export function open(id: string): void {
  const bp = all().find((b) => b.id === id);
  if (!bp) return;
  current.value = bp;
  baseline.value = bp;
  selection.value = null;
  undoStack.value = [];
  redoStack.value = [];
  persist();
}

function store(bp: Blueprint): void {
  current.value = bp;
  if (!bp.preset) mine.value = mine.value.map((b) => (b.id === bp.id ? bp : b));
  persist();
}

/**
 * Applies an edit to the open blueprint. A preset can't change: the first edit makes a copy and
 * the edit goes to that (§8), and the page says so.
 */
export function edit(change: (bp: Blueprint) => Blueprint): void {
  let bp = current.value;
  if (bp.preset) {
    const copy = duplicate(bp);
    say(`${bp.name} is a preset, so you're now editing a copy: ${copy.name}.`);
    bp = copy;
    baseline.value = copy;
    undoStack.value = [];
  }
  const next = change(bp);
  next.rev = bp.rev + 1;
  undoStack.value = [...undoStack.value.slice(-199), bp];
  redoStack.value = [];
  store(next);
}

/** A gesture (a slider drag, a held stepper) is one undo step: `live` shows each change; `end` keeps it. */
let gestureBase: Blueprint | null = null;
export function live(change: (bp: Blueprint) => Blueprint): void {
  if (current.value.preset) return edit(change);
  gestureBase ??= current.value;
  current.value = change(gestureBase);
}
export function endGesture(): void {
  if (!gestureBase) return;
  const base = gestureBase;
  gestureBase = null;
  if (base === current.value) return;
  const next = { ...current.value, rev: base.rev + 1 };
  undoStack.value = [...undoStack.value.slice(-199), base];
  redoStack.value = [];
  store(next);
}

export function undo(): void {
  const prev = undoStack.value.at(-1);
  if (!prev) return;
  undoStack.value = undoStack.value.slice(0, -1);
  redoStack.value = [...redoStack.value, current.value];
  store(prev);
  fixSelection();
}

export function redo(): void {
  const next = redoStack.value.at(-1);
  if (!next) return;
  redoStack.value = redoStack.value.slice(0, -1);
  undoStack.value = [...undoStack.value, current.value];
  store(next);
  fixSelection();
}

function fixSelection(): void {
  const s = selection.value;
  if (s?.type === "component" && !current.value.components.some((c) => c.id === s.id)) selection.value = null;
}

export function rename(id: string, name: string): void {
  const n = name.trim().toUpperCase();
  if (!n) return;
  mine.value = mine.value.map((b) => (b.id === id ? { ...b, name: n } : b));
  if (current.value.id === id) current.value = { ...current.value, name: n };
  persist();
}

export function remove(id: string): void {
  mine.value = mine.value.filter((b) => b.id !== id);
  if (current.value.id === id) open(presets[0].id);
  persist();
}

export function newBlank(): void {
  const bp: Blueprint = { format: 1, id: newId(), name: uniqueName("NEW SHIP"), rev: 1, ship: { bodies: [], joints: [], links: [] }, components: [], mix: { rules: [], rows: [] } };
  mine.value = [...mine.value, bp];
  open(bp.id);
}

export function importBlueprint(text: string): string | null {
  try {
    const bp = JSON.parse(text) as Blueprint;
    if (bp.format !== 1 || !bp.ship || !Array.isArray(bp.components) || !bp.mix) return "That file isn't a blueprint.";
    const copy = { ...bp, id: newId(), name: uniqueName(bp.name || "IMPORTED"), preset: undefined };
    delete copy.preset;
    mine.value = [...mine.value, copy];
    open(copy.id);
    return null;
  } catch {
    return "That file isn't a blueprint (not JSON).";
  }
}

export const allBlueprints = () => all();
