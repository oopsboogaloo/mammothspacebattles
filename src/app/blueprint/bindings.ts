// The player's controls and their keys (docs/blueprint/spec.md §10, §14): one set for every ship,
// kept with the player's settings, not in a blueprint. A blueprint stores only its wiring.
import { signal } from "@preact/signals";

export interface PlayerControl {
  id: string;
  name: string;
  kind: "analog" | "hold";
}

export const DEFAULT_CONTROLS: PlayerControl[] = [
  { id: "forward", name: "Forward", kind: "analog" },
  { id: "reverse", name: "Reverse", kind: "analog" },
  { id: "left", name: "Turn left", kind: "analog" },
  { id: "right", name: "Turn right", kind: "analog" },
  { id: "action-a", name: "Action A", kind: "hold" },
  { id: "action-b", name: "Action B", kind: "hold" },
  { id: "action-c", name: "Action C", kind: "hold" },
];

/** The movement controls; the rest are actions, which each ship wires to what it carries. */
export const MOVEMENT = new Set(["forward", "reverse", "left", "right"]);

/** Keys as Mammoth Thrust's (src/app/Thrust.tsx), by KeyboardEvent.code. */
export const DEFAULT_KEYS: Record<string, string> = {
  KeyQ: "left",
  ArrowLeft: "left",
  ShiftLeft: "left",
  ControlLeft: "left",
  KeyE: "right",
  ArrowRight: "right",
  ShiftRight: "right",
  ControlRight: "right",
  ArrowUp: "forward",
  KeyS: "reverse",
  ArrowDown: "reverse",
  Space: "action-a",
  KeyW: "action-a",
  KeyZ: "action-b",
  Slash: "action-b",
  KeyX: "action-c",
  Period: "action-c",
};

const KEY = "msb.controls.v2";
/** Before the actions were named A, B and C, they were Fire, Tractor and Shield. */
const OLD_KEY = "msb.controls.v1";
const RENAMED: Record<string, string> = { fire: "action-a", tractor: "action-b", shield: "action-c" };

interface Saved {
  controls: PlayerControl[];
  keys: Record<string, string>;
}

function load(): Saved {
  try {
    const old = typeof localStorage !== "undefined" && !localStorage.getItem(KEY) ? localStorage.getItem(OLD_KEY) : null;
    if (old) {
      // Keep the player's keys, moved onto the renamed actions.
      const s = JSON.parse(old) as Partial<Saved>;
      const keys = Object.fromEntries(Object.entries(s.keys ?? {}).map(([k, c]) => [k, RENAMED[c] ?? c]));
      const extra = (s.controls ?? []).filter((c) => !DEFAULT_CONTROLS.some((d) => d.id === c.id) && !RENAMED[c.id]);
      localStorage.setItem(KEY, JSON.stringify({ controls: [...DEFAULT_CONTROLS, ...extra], keys }));
    }
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) {
      const s = JSON.parse(raw) as Partial<Saved>;
      const controls = Array.isArray(s.controls) && s.controls.length ? s.controls : DEFAULT_CONTROLS;
      if (s.keys && typeof s.keys === "object") return { controls, keys: s.keys };
    }
  } catch {
    // Defaults below.
  }
  return { controls: [...DEFAULT_CONTROLS], keys: { ...DEFAULT_KEYS } };
}

const first = load();
/** The player's controls, shared by every ship. */
export const playerControls = signal<PlayerControl[]>(first.controls);
/** Key code → control id, shared by every ship. */
export const playerKeys = signal<Record<string, string>>(first.keys);

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ controls: playerControls.value, keys: playerKeys.value }));
  } catch {
    // Kept for this visit only.
  }
}

export function loadKeys(): Record<string, string> {
  return playerKeys.value;
}

/** Binds a key to a control (taking it from any other), for every ship. */
export function bindKey(code: string, control: string): void {
  playerKeys.value = { ...playerKeys.value, [code]: control };
  save();
}

export function unbindKey(code: string): void {
  const k = { ...playerKeys.value };
  delete k[code];
  playerKeys.value = k;
  save();
}

/** A new control for every ship (a ship that doesn't wire it ignores it). */
export function addControl(name: string, kind: PlayerControl["kind"] = "hold"): PlayerControl {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "control";
  const used = new Set(playerControls.value.map((c) => c.id));
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  const c = { id, name: name.trim() || "Control", kind };
  playerControls.value = [...playerControls.value, c];
  save();
  return c;
}

export function resetBindings(): void {
  playerControls.value = [...DEFAULT_CONTROLS];
  playerKeys.value = { ...DEFAULT_KEYS };
  save();
}

export function keysFor(control: string): string[] {
  return Object.entries(playerKeys.value)
    .filter(([, c]) => c === control)
    .map(([k]) => k);
}

export const controlName = (id: string) => playerControls.value.find((c) => c.id === id)?.name ?? id;

/** How a key code reads on screen. */
export function keyLabel(code: string): string {
  const named: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl", Slash: "/", Period: ".", Comma: ",", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backquote: "`", Minus: "-", Equal: "=" };
  return named[code] ?? code.replace(/^Key|^Digit/, "");
}
