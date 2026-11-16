// The blueprint designer's page (docs/blueprint/spec.md): one screen that never scrolls as a whole.
import { useEffect, useState } from "preact/hooks";
import { BlueprintsDrawer, ComponentsPanel, PerformanceBox, PropertiesPanel } from "./Panels.tsx";
import { BlueprintView, view } from "./View.tsx";
import { removeComponent, removeWeld, KINDS } from "./model.ts";
import { canRedo, canUndo, current, drawerOpen, edit, overlays, redo, selection, toast, tryOut, undo } from "./store.ts";
import { TryOut, startTry } from "./TryOut.tsx";

type Toggle = keyof typeof overlays.value;
const TOGGLES: [Toggle, string, string, string][] = [
  ["com", "◉ CoM", "Centre of mass", "C"],
  ["thrust", "↑ Thrust", "Thrust arrows", "T"],
  ["welds", "• Welds", "Weld points", "W"],
  ["dims", "⟷ Dims", "Dimensions on the selection", "D"],
];

function toggle(k: Toggle) {
  overlays.value = { ...overlays.value, [k]: !overlays.value[k] };
}

function TopBar() {
  const bp = current.value;
  return (
    <header class="top">
      <button class="ib bp-menu" title="Blueprints: new, open, duplicate, import, export (O)" onClick={() => (drawerOpen.value = true)} data-testid="open-drawer">
        ☰ <span>BLUEPRINTS</span>
      </button>
      <div class="title">
        <span class="tl">DRAWING</span>
        <span class="tn" data-testid="drawing-name">
          {bp.name}
        </span>
        {bp.preset ? <span class="badge">PRESET</span> : <span class="badge edit">EDITING</span>}
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
        {TOGGLES.map(([k, label, title, key]) => (
          <button key={k} class={`ib${overlays.value[k] ? " on" : ""}`} aria-pressed={overlays.value[k]} title={`${title} (${key})`} onClick={() => toggle(k)}>
            {label}
          </button>
        ))}
      </div>
      <div class="spacer" />
      <button class="ib" title="Show the whole ship (Z)" onClick={() => view.fit()}>
        ⤢ Fit
      </button>
      <button class="try" title="Fly it in the sandbox (Enter)" onClick={startTry} data-testid="try-it" disabled={!bp.ship.bodies.length}>
        ▶ TRY IT
      </button>
    </header>
  );
}

function hint(): string {
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
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (mod) return;
      else if (e.key === "Escape") {
        if (drawerOpen.value) drawerOpen.value = false;
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
      else if (e.key === "[") setKind((x) => (x + KINDS.length - 1) % KINDS.length);
      else if (e.key === "]") setKind((x) => (x + 1) % KINDS.length);
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

  if (tryOut.value) return <TryOut />;
  const bp = current.value;
  return (
    <div class="bpapp">
      <div class="grid">
        <TopBar />
        <ComponentsPanel kindIndex={kind} setKind={setKind} />
        <main class="canvas">
          <BlueprintView onZoom={setZoom} />
          <PerformanceBox />
          <div class="tblock">
            <div>
              <small>DRAWING</small>
              <b>{bp.name}</b>
            </div>
            <div>
              <small>GRID</small>
              <b>1 m · {zoom > 40 ? "0.2 m" : "1 m"}</b>
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
            <button aria-label="Zoom in" onClick={() => (view as { zoomBy?: (k: number) => void }).zoomBy?.(1.25)}>
              ＋
            </button>
            <div class="zl">{Math.round(zoom)} px/m</div>
            <button aria-label="Zoom out" onClick={() => (view as { zoomBy?: (k: number) => void }).zoomBy?.(0.8)}>
              −
            </button>
          </div>
          {!bp.ship.bodies.length && <div class="emptyhint">An empty blueprint. Parts can be added in the next build stage; open THRUST 1 from ☰ BLUEPRINTS meanwhile.</div>}
        </main>
        <PropertiesPanel />
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
