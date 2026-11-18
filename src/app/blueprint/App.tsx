// The blueprint designer's page (docs/blueprint/spec.md): one screen that never scrolls as a whole.
import { useEffect, useState } from "preact/hooks";
import { addAtFreeSpot, BlueprintsDrawer, ComponentsPanel, PerformanceBox, PropertiesPanel } from "./Panels.tsx";
import { BlueprintView, view } from "./View.tsx";
import { removeComponent, removeWeld, KINDS } from "./model.ts";
import { canRedo, canUndo, current, drawerOpen, edit, mode, overlays, placing, preview, redo, rename, selection, toast, tryOut, undo } from "./store.ts";
import { TryOut, startTry } from "./TryOut.tsx";
import { playIn, type PlaytestGame } from "../playtest.ts";
import { layout, narrow, PanelToggle, setLayout, useNarrow } from "./Layout.tsx";
import { ControlsPanel, MixerTable, ResponseBox, testHeld, useTestKeys, WiringPanel } from "./Controls.tsx";
import { shown as show } from "./shown.ts";

type Toggle = keyof typeof overlays.value;
const TOGGLES: [Toggle, string, string, string, string][] = [
  ["com", "◉", "CoM", "Centre of mass", "C"],
  ["thrust", "↑", "Thrust", "Thrust arrows", "T"],
  ["welds", "•", "Welds", "Weld points", "W"],
  ["dims", "⟷", "Dims", "Dimensions on the selection", "D"],
];

function toggle(k: Toggle) {
  overlays.value = { ...overlays.value, [k]: !overlays.value[k] };
}

/** The blueprint's name: click to rename it. A preset is renamed as a copy (presets never change). */
function BlueprintName() {
  const bp = current.value;
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        class="tn rename"
        aria-label="Blueprint name"
        data-testid="drawing-name-input"
        value={bp.name}
        maxLength={40}
        ref={(el) => {
          if (el && document.activeElement !== el) {
            el.focus();
            el.select();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation(); // typing a name doesn't press the page's keys
        }}
        onBlur={(e) => {
          const name = (e.currentTarget as HTMLInputElement).value.trim();
          setEditing(false);
          if (!name || name.toUpperCase() === bp.name) return;
          if (current.value.preset) edit((b) => b); // the copy, which the name then goes to
          rename(current.value.id, name);
        }}
      />
    );
  return (
    <button class="tn tn-btn" data-testid="drawing-name" title={bp.preset ? "Rename (makes your own copy: presets never change)" : "Rename"} onClick={() => setEditing(true)}>
      {bp.name}
    </button>
  );
}

/** For debugging designs (Chloe, 16 November 2026): play a game with this ship; the game's menus lead back. */
function PlayIn({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const games: [PlaytestGame, string][] = [
    ["thrust", "Mammoth Thrust"],
    ["asteroids", "Mammoth Asteroids"],
    ["lander", "Mammoth Lander"],
  ];
  return (
    <div class="playin">
      <button class="ib" disabled={disabled} title={disabled ? "It needs a cockpit to fly" : "Play a game with this ship (for testing)"} onClick={() => setOpen(!open)} data-testid="play-in">
        ⇱<span class="lbl"> Play in…</span>
      </button>
      {open && (
        <div class="playin-menu" role="menu" onMouseLeave={() => setOpen(false)}>
          {games.map(([g, name]) => (
            <button key={g} role="menuitem" onClick={() => playIn(g, current.value)} data-testid={`play-in-${g}`}>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const bp = current.value;
  return (
    <header class="top">
      <PanelToggle side="left" />
      <button class="ib bp-menu" title="Blueprints: new, open, duplicate, import, export (O)" onClick={() => (drawerOpen.value = true)} data-testid="open-drawer">
        ☰ <span>BLUEPRINTS</span>
      </button>
      <div class="title">
        <span class="tl">DRAWING</span>
        <BlueprintName />
        {bp.preset ? <span class="badge">PRESET</span> : <span class="badge edit">EDITING</span>}
      </div>
      <div class="modes" role="tablist">
        <button role="tab" aria-selected={mode.value === "build"} class={mode.value === "build" ? "on" : ""} title="Build: place and shape parts (B)" onClick={() => (mode.value = "build")} data-testid="mode-build">
          BUILD
        </button>
        <button role="tab" aria-selected={mode.value === "controls"} class={mode.value === "controls" ? "on" : ""} title="Controls: wire your controls to the engines and devices (K)" onClick={() => (mode.value = "controls")} data-testid="mode-controls">
          CONTROLS
        </button>
      </div>
      <div class="grp">
        <button class="ib" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo.value} onClick={undo}>
          ↶
        </button>
        <button class="ib" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo.value} onClick={redo}>
          ↷
        </button>
      </div>
      <div class="grp tog">
        {TOGGLES.map(([k, icon, label, title, key]) => (
          <button key={k} class={`ib${overlays.value[k] ? " on" : ""}`} aria-pressed={overlays.value[k]} aria-label={title} title={`${title} (${key})`} onClick={() => toggle(k)}>
            {icon}
            <span class="lbl"> {label}</span>
          </button>
        ))}
      </div>
      <div class="spacer" />
      <button class="ib fitbtn" title="Show the whole ship (Z)" onClick={() => view.fit()}>
        ⤢<span class="lbl"> Fit</span>
      </button>
      <PlayIn disabled={!bp.components.some((c) => c.kind === "cockpit")} />
      <button class="try" title="Fly it in the sandbox (Enter)" onClick={startTry} data-testid="try-it" disabled={!bp.ship.bodies.length}>
        ▶<span class="lbl"> TRY IT</span>
      </button>
      <PanelToggle side="right" />
    </header>
  );
}

function hint(): string {
  if (mode.value === "controls") return "Controls · click a cell to wire a control to a part · hold a control's key to test it · B: back to Build";
  const pl = placing.value;
  if (pl?.at) return pl.at.overlap ? "Red: it would overlap a part · move it clear · Esc: cancel" : pl.at.touches.length ? "Green: it will weld there · release to place · Shift: no snapping · Esc: cancel" : "Blue: it won't touch the ship, so it won't be welded · Shift: no snapping · Esc: cancel";
  const s = selection.value;
  if (s?.type === "component") return "Part selected · change it on the right · Del removes it · Tab: next part · Esc: deselect";
  if (s?.type === "weld") return "Weld selected · click a part's name to go to it · Del removes the weld · Esc: deselect";
  return "Click a part or a weld point · drag the grid to look around · wheel or pinch to zoom · Enter: Try it";
}

export function BlueprintApp() {
  const [kind, setKind] = useState(1);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tryOut.value) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "d") {
        e.preventDefault();
        const s = selection.value;
        if (s?.type === "component") addAtFreeSpot(current.value, s.id);
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod) return;
      else if (e.key === "Escape") {
        if (placing.value) {
          placing.value = null;
          preview.value = null;
        } else if (drawerOpen.value) drawerOpen.value = false;
        else selection.value = null;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const s = selection.value;
        if (!s) return;
        e.preventDefault();
        edit((b) => (s.type === "component" ? removeComponent(b, s.id) : removeWeld(b, s.id)));
        selection.value = null;
      } else if (e.key === "Tab") {
        const cs = current.value.components;
        if (!cs.length) return;
        e.preventDefault();
        const s = selection.value;
        const i = s?.type === "component" ? cs.findIndex((c) => c.id === s.id) : -1;
        const next = cs[(i + (e.shiftKey ? cs.length - 1 : 1) + cs.length) % cs.length];
        selection.value = { type: "component", id: next.id };
      } else if (e.key === "Enter") startTry();
      else if (e.key === "\\") {
        const any = layout.value.left || layout.value.right;
        setLayout({ left: !any, right: !any });
      } else if (k === "k") mode.value = "controls";
      else if (k === "b") mode.value = "build";
      else if (e.key === "[") setKind((x) => (x + KINDS.length - 1) % KINDS.length);
      else if (e.key === "]") setKind((x) => (x + 1) % KINDS.length);
      else if (mode.value === "controls") return;
      else if (k === "z") view.fit();
      else if (k === "o") drawerOpen.value = true;
      else if (k === "c") toggle("com");
      else if (k === "t") toggle("thrust");
      else if (k === "w") toggle("welds");
      else if (k === "d") toggle("dims");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useTestKeys();
  useNarrow();
  useEffect(() => {
    if (mode.value === "build") testHeld.value = {};
  }, [mode.value]);
  if (tryOut.value) return <TryOut />;
  const controls = mode.value === "controls";
  const bp = current.value;
  return (
    <div class="bpapp">
      <div class={`grid${narrow.value ? " narrow" : ""}${layout.value.left && !narrow.value ? "" : " lclosed"}${layout.value.right && !narrow.value ? "" : " rclosed"}`}>
        <TopBar />
        {!layout.value.left ? null : controls ? <ControlsPanel /> : <ComponentsPanel kindIndex={kind} setKind={setKind} />}
        <main class={`canvas${controls ? " ctlmode" : ""}`}>
          <div class="ctltop">
          <BlueprintView onZoom={setZoom} />
          {controls ? <ResponseBox /> : <PerformanceBox />}
          <div class="tblock">
            <div>
              <small>DRAWING</small>
              <b>{bp.name}</b>
            </div>
            <div>
              <small>GRID</small>
              <b>{show(1, "m")} m · {zoom > 40 ? `${show(0.2, "m")} m` : `${show(1, "m")} m`}</b>
            </div>
            <div>
              <small>REV</small>
              <b>{bp.rev}</b>
            </div>
            <div>
              <small>DESIGNER</small>
              <b>MAMMOTH YARD</b>
            </div>
          </div>
          <div class="zoom">
            <button aria-label="Zoom in" onClick={() => view.zoomBy?.(1.25)}>
              ＋
            </button>
            <div class="zl">{Math.round(zoom / show(1, "m"))} px/m</div>
            <button aria-label="Zoom out" onClick={() => view.zoomBy?.(0.8)}>
              −
            </button>
          </div>
          </div>
          {controls && <MixerTable />}
          {!bp.ship.bodies.length && <div class="emptyhint">An empty blueprint. Start with a cockpit: drag one in from the left (Cockpits), double-click it, or press its ＋.</div>}
        </main>
        {!layout.value.right ? null : controls ? <WiringPanel /> : <PropertiesPanel />}
        <footer class="status">{hint()}</footer>
      </div>
      {drawerOpen.value && <BlueprintsDrawer />}
      {toast.value && (
        <div class="toast" role="status" data-testid="toast">
          {toast.value}
        </div>
      )}
    </div>
  );
}
