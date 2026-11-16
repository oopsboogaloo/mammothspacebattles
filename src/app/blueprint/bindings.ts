// The player's controls and their keys (docs/blueprint/spec.md §10, §14): one set for every ship,
// kept with the player's settings, not in a blueprint. A blueprint stores only its wiring.

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
  { id: "fire", name: "Fire", kind: "hold" },
  { id: "tractor", name: "Tractor", kind: "hold" },
  { id: "shield", name: "Shield", kind: "hold" },
];

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
  Space: "fire",
  KeyW: "fire",
  KeyZ: "tractor",
  Slash: "tractor",
  KeyX: "shield",
  Period: "shield",
};

const KEY = "msb.controls.v1";

export function loadKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as { keys?: Record<string, string> };
      if (s.keys && typeof s.keys === "object") return s.keys;
    }
  } catch {
    // Defaults below.
  }
  return { ...DEFAULT_KEYS };
}

/** How a key code reads on screen. */
export function keyLabel(code: string): string {
  const named: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl", Slash: "/", Period: "." };
  return named[code] ?? code.replace(/^Key|^Digit/, "");
}
