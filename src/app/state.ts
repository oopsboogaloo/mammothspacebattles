// UI state (signals) and the action registry shared by buttons, keyboard
// shortcuts and the command palette (UX-002), so every action is reachable
// by keyboard (SBX-043) and labelled with its shortcut (UX-003).
import { signal } from "@preact/signals";
import { ScenarioError, type Command, type ValidationError } from "../core/index.ts";
import { fitBounds, worldBounds, type Camera, type Viewport } from "./camera.ts";
import { emptyScenario, Sandbox } from "./controller.ts";
import { loadPrefs, savePrefs } from "./prefs.ts";
import type { Prefab } from "./ports.ts";
import { withFreshChannels } from "./parts.ts";
import type { OverlayId } from "./render.ts";

export type ToolId = "select" | "move" | "spawn" | "attach" | "impulse" | "link" | "gas" | "probe" | "ruler";

export const TOOLS: { id: ToolId; label: string; key: string; hint: string; disabled?: string }[] = [
  { id: "select", label: "Select", key: "V", hint: "Click an object to select it. Shift-click adds to the selection. Drag empty space to pan." },
  { id: "move", label: "Move / rotate", key: "M", hint: "Drag a body to move it. Drag the round handle to rotate (Shift snaps to 15°). While running, dragging pulls with a spring." },
  { id: "spawn", label: "Spawn", key: "S", hint: "Pick a body from the palette, then click in the world. Drag while placing to give it a velocity." },
  { id: "attach", label: "Attach", key: "A", hint: "Pick a part, then point at a body: its nearest port glows. Click to weld the part there (blue = valid, orange dashed = blocked, with the reason). While paused you can also drag a free body onto a port." },
  { id: "impulse", label: "Impulse", key: "I", hint: "Drag from a point on a body. The preview shows the impulse, Δv and Δω; release to apply." },
  { id: "link", label: "Link", key: "L", hint: "Drag from a body with a store to another store: a feed link pumps the resource between them. Only compatible bodies light up." },
  { id: "gas", label: "Gas", key: "G", hint: "Drag a rectangle to fill it with gas at the temperature and density set in the panel. Switch to Clear to remove the gas in a rectangle." },
  { id: "probe", label: "Probe", key: "P", hint: "Click an object and choose a quantity. It is added to the graphs." },
  { id: "ruler", label: "Ruler", key: "R", hint: "Drag between two points to measure distance, relative velocity and closing speed." },
];

export type SpawnKind = "disc" | "box" | "plank" | "triangle" | "hexagon" | "wall" | "hull" | "tank";
/** What Spawn/Attach places: a primitive, the built-in engine assembly, or a saved prefab by index (SBX-021). */
export type PartChoice = SpawnKind | "engine" | `prefab:${number}`;

export interface DialogState {
  kind: "error" | "confirm" | "info";
  title: string;
  message?: string;
  errors?: ValidationError[];
  confirmLabel?: string;
  onConfirm?: () => void;
}

const prefs = loadPrefs();

export const sandbox = signal<Sandbox | null>(null);
/** Bumped when the world changes; panels re-render from it (throttled while playing, SBX-040). */
export const version = signal(0);
export const screen = signal<"picker" | "sandbox">("picker");
export const scenarioKey = signal<string>("");
export const playing = signal(false);
/** The game's normal pace, in game seconds a real second: 1× on the speed buttons is half real time,
 * the speed the game plays well at (and twice the step budget). */
export const GAME_PACE = 0.5;
/** The chosen speed, as the buttons show it: 1 is normal pace (GAME_PACE of real time). */
export const timeScale = signal(1);
export const achieved = signal({ scale: 1, behind: false });
export const tool = signal<ToolId>("select");
export const selection = signal<string[]>([]);
export const hover = signal<string | null>(null);
export const overlays = signal<Set<OverlayId>>(new Set((prefs.overlays as OverlayId[]) ?? ["velocity", "contacts", "grid"]));
export const drawerOpen = signal(prefs.drawerOpen ?? true);
export const graphWindow = signal<number | "all">(prefs.graphWindow ?? 10);
export const visibleSeries = signal<string[]>([]);
export const spawnKind = signal<PartChoice>("disc");
/** Gas tool settings: fill or clear, and what a fill contains (GAS-001). */
export const gasOptions = signal<{ mode: "fill" | "clear"; temperature: number; density: number; spacing: number; species: string }>({
  mode: "fill",
  temperature: 300,
  density: 0.125, // kg/m²: 0.5 kg in a 2 m box, as in SC-02
  spacing: 0.1, // m between parcels
  species: "air",
});
/** How parcels are coloured (SBX-035). */
export const gasColour = signal<"temperature" | "composition">("temperature");
/** Gas drawn as a glowing plume, or as dots (SBX-035). */
export const gasStyle = signal<"plume" | "dots">("plume");
/** Keyboard key (lower case) → control channel (SBX-020). */
export const bindings = signal<Record<string, string>>(prefs.bindings ?? {});
/** Key waiting to be captured for a channel, while the user presses "Bind key". */
export const bindingFor = signal<string | null>(null);
export const prefabs = signal<Prefab[]>(prefs.prefabs ?? []);
export const camera = signal<Camera>({ x: 0, y: 0, zoom: 60 });
export const viewport = signal<Viewport>({ width: 800, height: 500 });
export const follow = signal(false);
/**
 * The body the camera follows while `follow` is on. It is kept apart from the selection, so tapping
 * empty space or another part doesn't lose the ship you're flying.
 */
export const followId = signal<string | null>(null);

/** Turns following on (for `id`, else the selection, else the last body followed) or off. */
export function setFollow(on: boolean, id: string | null = selection.value[0] ?? followId.value): void {
  if (on && !id) {
    follow.value = false;
    return;
  }
  if (on) followId.value = id;
  follow.value = on;
}
export const toggleFollow = (id?: string): void => setFollow(!follow.value, id);
export const dialog = signal<DialogState | null>(null);
export const cmdkOpen = signal(false);
export const shortcutsOpen = signal(false);
export const contextMenu = signal<{ x: number; y: number; bodyId: string } | null>(null);
export const probeMenu = signal<{ x: number; y: number; bodyId: string } | null>(null);
export const sheet = signal<"inspector" | "graphs" | null>(null);
export const toast = signal<string | null>(null);
export const collapsed = signal<Record<string, boolean>>(prefs.collapsed ?? {});
export const violationsOpen = signal(false);

export const bump = () => (version.value = version.value + 1);

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(text: string): void {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2500);
}

export function persist(): void {
  savePrefs({ overlays: [...overlays.value], drawerOpen: drawerOpen.value, collapsed: collapsed.value, graphWindow: graphWindow.value, bindings: bindings.value, prefabs: prefabs.value });
  const sb = sandbox.value;
  if (sb && sb.dirty) savePrefs({ lastExperiment: { title: String(sb.scenario.title ?? sb.scenario.name), json: JSON.stringify(sb.exportScenario()) } });
}

/** Runs an edit through the sandbox; reports errors instead of throwing. */
export function edit(commands: Command[], label: string, group?: number): boolean {
  const sb = sandbox.value;
  if (!sb) return false;
  try {
    sb.edit(commands, label, group);
    bump();
    return true;
  } catch (e) {
    showToast(`Not applied: ${(e as Error).message}`);
    return false;
  }
}

/** Asks before discarding unsaved edits (UX-007). */
export function confirmDiscard(then: () => void): void {
  if (!sandbox.value?.dirty) return then();
  dialog.value = {
    kind: "confirm",
    title: "Discard unsaved changes?",
    message: "This experiment has edits that are not saved as a scenario file. Save first (Ctrl+S) to keep them.",
    confirmLabel: "Discard",
    onConfirm: then,
  };
}

/** Loads a scenario; on failure shows its errors and keeps the current world (UX-006). */
export function openScenario(raw: unknown, key: string, values: Record<string, number> = {}, opts: { keepOverlays?: boolean } = {}): boolean {
  let sb: Sandbox;
  try {
    sb = new Sandbox(raw, values);
  } catch (e) {
    dialog.value =
      e instanceof ScenarioError
        ? { kind: "error", title: "This scenario could not be loaded", message: "Nothing was changed. Fix these problems and try again:", errors: e.errors }
        : { kind: "error", title: "This file could not be read", message: (e as Error).message };
    return false;
  }
  sandbox.value = sb;
  scenarioKey.value = key;
  playing.value = false;
  selection.value = [];
  follow.value = false;
  followId.value = null;
  const ui = sb.scenario.ui;
  if (ui?.overlays && !opts.keepOverlays) overlays.value = new Set([...(ui.overlays as OverlayId[]), "grid"]);
  visibleSeries.value = ui?.graphs?.length ? ui.graphs.filter((g) => sb.series.some((s) => s.id === g)) : ["ledger.px", "ledger.ke"];
  camera.value = ui?.camera ?? fitBounds(worldBounds(sb.world), viewport.value);
  if (ui?.keys) {
    // The scenario's suggested keys win for their channels; other bindings stay.
    const channels = new Set(Object.values(ui.keys));
    bindings.value = { ...Object.fromEntries(Object.entries(bindings.value).filter(([k, c]) => !channels.has(c) && !(k in ui.keys!))), ...ui.keys };
  }
  if (ui?.follow) {
    selection.value = [ui.follow];
    setFollow(true, ui.follow);
  }
  screen.value = "sandbox";
  bump();
  return true;
}

export function openEmpty(): void {
  openScenario(emptyScenario(), "empty");
}

/** Rebuilds the current scenario with new parameter values (SCN-008). */
export function setParameter(id: string, value: number): void {
  const sb = sandbox.value;
  if (!sb) return;
  const apply = () => {
    const values = { ...sb.scenario.values, [id]: value };
    const cam = camera.value;
    const series = visibleSeries.value;
    if (openScenario(sb.raw, scenarioKey.value, values)) {
      camera.value = cam;
      visibleSeries.value = series;
    }
  };
  confirmDiscard(apply);
}

export function downloadScenario(): void {
  const sb = sandbox.value;
  if (!sb) return;
  const json = JSON.stringify(sb.exportScenario(), null, 2) + "\n";
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sb.scenario.name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  sb.markSaved();
  persist();
  showToast(`Saved ${a.download}`);
  bump();
}

export function openFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.dataset.testid = "file-input";
  input.style.display = "none";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch (e) {
      dialog.value = { kind: "error", title: "This file is not valid JSON", message: (e as Error).message };
      return;
    }
    confirmDiscard(() => openScenario(raw, `file:${file.name}`));
  });
  document.body.appendChild(input);
  input.click();
}

export function jumpTo(tick: number, select?: string[]): void {
  const sb = sandbox.value;
  if (!sb) return;
  playing.value = false;
  sb.goTo(tick);
  if (select) selection.value = select.filter((id) => sb.world.bodies.some((b) => b.id === id));
  bump();
}

export function fitView(): void {
  const sb = sandbox.value;
  if (!sb) return;
  // Fitting the whole world means no longer following one body.
  follow.value = false;
  camera.value = fitBounds(worldBounds(sb.world), viewport.value);
}

// Speeds as shown, 1 being normal pace: 1/8× to 16× is 1/16 to 8 times real time (SBX-002).
const SCALES = [1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 1.25, 1.5, 2, 4, 8, 16];
export const SCALE_BUTTONS = [1 / 8, 1 / 2, 3 / 4, 1, 1.25, 2, 8, 16];
/** Fractions as single characters, so the speed buttons fit the top bar. */
const FRACTIONS: Record<string, string> = { "0.125": "⅛", "0.25": "¼", "0.5": "½", "0.75": "¾", "1.25": "1¼", "1.5": "1½" };
export function scaleLabel(s: number): string {
  return `${FRACTIONS[String(s)] ?? s}×`;
}

export interface Action {
  id: string;
  label: string;
  keys?: string;
  run: () => void;
  enabled?: () => boolean;
}

const inSandbox = () => screen.value === "sandbox" && !!sandbox.value;
const hasSelection = () => inSandbox() && selection.value.length > 0;

let nextId = 1;
function freshId(prefix: string): string {
  const sb = sandbox.value!;
  let id: string;
  do id = `${prefix}-${nextId++}`;
  while (sb.world.bodies.some((b) => b.id === id));
  return id;
}

export function duplicateSelection(): void {
  const sb = sandbox.value;
  if (!sb) return;
  const cmds: Command[] = [];
  const ids: string[] = [];
  // Copied engines get their own channels, so they don't answer the original's key (SBX-025).
  const copies = withFreshChannels(sb.world, selection.value.map((id) => sb.world.bodies.find((x) => x.id === id)).filter((b): b is NonNullable<typeof b> => !!b));
  for (const b of copies) {
    const nid = freshId(b.id.replace(/-\d+$/, ""));
    ids.push(nid);
    cmds.push({ type: "body.add", body: { ...structuredClone(b), id: nid, position: { x: b.position.x + 0.5, y: b.position.y + 0.5 } } });
  }
  if (cmds.length && edit(cmds, "Duplicate")) selection.value = ids;
}

export function detachSelection(): void {
  const sb = sandbox.value;
  if (!sb) return;
  const ids = selection.value.filter((id) => sb.world.joints.some((j) => j.a === id || j.b === id));
  if (!ids.length) return showToast("Nothing to detach: the selection has no joints.");
  edit(ids.map((id) => ({ type: "body.detach", id })), ids.length > 1 ? `Detach ${ids.length} parts` : `Detach ${ids[0]}`);
}

export function deleteSelection(): void {
  const ids = selection.value;
  if (!ids.length) return;
  if (edit(ids.map((id) => ({ type: "body.remove", id })), ids.length > 1 ? `Delete ${ids.length} bodies` : `Delete ${ids[0]}`)) selection.value = [];
}

export { freshId };

export const ACTIONS: Action[] = [
  { id: "play", label: "Play / pause", keys: "Space", run: () => (playing.value = !playing.value), enabled: inSandbox },
  { id: "step", label: "Step one tick", keys: ".", run: () => { playing.value = false; sandbox.value?.step(1); bump(); }, enabled: inSandbox },
  { id: "step10", label: "Step 10 ticks", keys: "Shift+.", run: () => { playing.value = false; sandbox.value?.step(10); bump(); }, enabled: inSandbox },
  { id: "reset", label: "Reset to start", keys: "Home", run: () => { playing.value = false; sandbox.value?.reset(); bump(); }, enabled: inSandbox },
  { id: "slower", label: "Slower time scale", keys: "[", run: () => { const i = SCALES.indexOf(timeScale.value); timeScale.value = SCALES[Math.max(0, i - 1)]; }, enabled: inSandbox },
  { id: "faster", label: "Faster time scale", keys: "]", run: () => { const i = SCALES.indexOf(timeScale.value); timeScale.value = SCALES[Math.min(SCALES.length - 1, i + 1)]; }, enabled: inSandbox },
  ...TOOLS.map((t) => ({ id: `tool.${t.id}`, label: `Tool: ${t.label}`, keys: t.key, run: () => (tool.value = t.id), enabled: () => inSandbox() && !t.disabled })),
  { id: "undo", label: "Undo", keys: "Ctrl+Z", run: () => { sandbox.value?.undo(); bump(); }, enabled: () => !!sandbox.value?.canUndo },
  { id: "redo", label: "Redo", keys: "Ctrl+Shift+Z", run: () => { sandbox.value?.redo(); bump(); }, enabled: () => !!sandbox.value?.canRedo },
  { id: "duplicate", label: "Duplicate selection", keys: "Ctrl+D", run: duplicateSelection, enabled: hasSelection },
  { id: "delete", label: "Delete selection", keys: "Delete", run: deleteSelection, enabled: hasSelection },
  { id: "follow", label: "Follow selection", keys: "F", run: () => toggleFollow(), enabled: () => hasSelection() || follow.value },
  { id: "fit", label: "Zoom to fit", keys: "Z", run: fitView, enabled: inSandbox },
  { id: "save", label: "Save scenario file", keys: "Ctrl+S", run: downloadScenario, enabled: inSandbox },
  { id: "open", label: "Open scenario file…", keys: "Ctrl+O", run: openFile },
  { id: "scenarios", label: "Back to scenarios", run: () => confirmDiscard(() => { playing.value = false; screen.value = "picker"; }), enabled: inSandbox },
  { id: "empty", label: "New empty world", run: () => confirmDiscard(openEmpty) },
  { id: "drawer", label: "Show / hide graphs", run: () => { drawerOpen.value = !drawerOpen.value; persist(); }, enabled: inSandbox },
  { id: "overlay.velocity", label: "Overlay: velocity", run: () => toggleOverlay("velocity"), enabled: inSandbox },
  { id: "overlay.com", label: "Overlay: centres of mass", run: () => toggleOverlay("com"), enabled: inSandbox },
  { id: "overlay.contacts", label: "Overlay: contacts", run: () => toggleOverlay("contacts"), enabled: inSandbox },
  { id: "overlay.forces", label: "Overlay: forces", run: () => toggleOverlay("forces"), enabled: inSandbox },
  { id: "overlay.joints", label: "Overlay: joint load", run: () => toggleOverlay("joints"), enabled: inSandbox },
  { id: "overlay.links", label: "Overlay: links", run: () => toggleOverlay("links"), enabled: inSandbox },
  { id: "overlay.pilots", label: "Overlay: AI plans", run: () => toggleOverlay("pilots"), enabled: inSandbox },
  { id: "detach", label: "Detach selection from its assembly", run: () => detachSelection(), enabled: hasSelection },
  { id: "overlay.grid", label: "Overlay: grid & axes", run: () => toggleOverlay("grid"), enabled: inSandbox },
  { id: "palette", label: "Command palette", keys: "Ctrl+K", run: () => (cmdkOpen.value = true) },
  { id: "shortcuts", label: "Keyboard shortcuts", keys: "?", run: () => (shortcutsOpen.value = true) },
  { id: "escape", label: "Back to Select / close", keys: "Esc", run: () => { tool.value = "select"; contextMenu.value = null; probeMenu.value = null; } },
];

export function toggleOverlay(id: OverlayId): void {
  const next = new Set(overlays.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  overlays.value = next;
  persist();
}

export const action = (id: string) => ACTIONS.find((a) => a.id === id)!;

/** Maps a keyboard event to an action id, or null. */
export function keyToAction(e: KeyboardEvent): string | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key;
  if (ctrl) {
    if (k === "k" || k === "K") return "palette";
    if ((k === "z" || k === "Z") && e.shiftKey) return "redo";
    if (k === "z" || k === "Z") return "undo";
    if (k === "y" || k === "Y") return "redo";
    if (k === "d" || k === "D") return "duplicate";
    if (k === "s" || k === "S") return "save";
    if (k === "o" || k === "O") return "open";
    return null;
  }
  if (e.altKey) return null;
  if (k === " ") return "play";
  if (k === ">" || (k === "." && e.shiftKey)) return "step10";
  if (k === ".") return "step";
  if (k === "Home") return "reset";
  if (k === "[") return "slower";
  if (k === "]") return "faster";
  if (k === "Delete" || k === "Backspace") return "delete";
  if (k === "Escape") return "escape";
  if (k === "?") return "shortcuts";
  const upper = k.toUpperCase();
  if (upper === "F") return "follow";
  if (upper === "Z") return "fit";
  const t = TOOLS.find((x) => x.key === upper);
  return t ? `tool.${t.id}` : null;
}
