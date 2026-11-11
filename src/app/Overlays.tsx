import { openLander } from "./Lander.tsx";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { parseScenario, initialWorld } from "../core/index.ts";
import { fitBounds, worldBounds } from "./camera.ts";
import { renderFrame } from "./render.ts";
import { BUILT_INS } from "./scenarios.ts";
import { savePrefab } from "./Panels.tsx";
import { loadPrefs } from "./prefs.ts";
import {
  ACTIONS,
  bump,
  cmdkOpen,
  confirmDiscard,
  contextMenu,
  deleteSelection,
  dialog,
  duplicateSelection,
  edit,
  follow,
  toggleFollow,
  jumpTo,
  openEmpty,
  openFile,
  openScenario,
  probeMenu,
  sandbox,
  selection,
  shortcutsOpen,
  toast,
  version,
  violationsOpen,
  visibleSeries,
} from "./state.ts";

function Thumb({ raw }: { raw: Record<string, unknown> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const w = c.clientWidth || 240;
    const h = c.clientHeight || 120;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const world = initialWorld(parseScenario(raw));
    renderFrame(ctx, world, fitBounds(worldBounds(world), { width: w, height: h }, 14), { width: w, height: h }, { overlays: new Set(["velocity"]), selection: new Set(), hover: null, labels: false });
  }, [raw]);
  return <canvas ref={ref} aria-hidden="true" />;
}

/** First screen: starter scenarios first, then references (UX-001). */
export function Picker() {
  const last = loadPrefs().lastExperiment;
  return (
    <main class="picker" data-testid="picker">
      <div class="wrap">
        <div class="mono muted" style={{ fontSize: "12px", letterSpacing: "0.08em" }}>
          MAMMOTH SPACE BATTLES · PHYSICS SANDBOX
        </div>
        <h1>Choose a starting scenario</h1>
        <p class="muted" style={{ margin: 0, maxWidth: "640px" }}>
          Each one is a small experiment with a known correct answer, and opens with the right graphs switched on. Everything is editable once it's loaded.
        </p>
      </div>
      <div class="cards">
        {BUILT_INS.map((s) => (
          <button key={s.file} class="card" onClick={() => openScenario(s.raw, s.file)} data-testid={`pick-${s.file}`}>
            <Thumb raw={s.raw} />
            <div class="text">
              <span class="id">{s.id}</span>
              <span class="name">{s.title}</span>
              <span class="blurb">{s.blurb}</span>
            </div>
          </button>
        ))}
        <button class="card" onClick={openEmpty} data-testid="pick-empty">
          <canvas aria-hidden="true" />
          <div class="text">
            <span class="id">NEW</span>
            <span class="name">Empty world</span>
            <span class="blurb">Start from nothing and spawn your own bodies.</span>
          </div>
        </button>
      </div>
      <div class="wrap" style={{ flexDirection: "row", gap: "8px", flexWrap: "wrap" }}>
        <button class="btn primary" onClick={openLander} data-testid="open-lander">
          Play Mammoth Lander
        </button>
        {/* The game's own page (asteroids.html): it has no way back, so this is a plain link. */}
        <a class="btn primary" href="asteroids.html" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} data-testid="open-asteroids">
          Play Mammoth Asteroids
        </a>
        <button class="btn" onClick={openFile} data-testid="open-file">
          Open scenario file…
        </button>
        {last && (
          <button
            class="btn"
            onClick={() => {
              try {
                openScenario(JSON.parse(last.json), "resume", {}, { keepOverlays: true });
              } catch {
                /* corrupt preference: ignore */
              }
            }}
            data-testid="resume"
          >
            Resume unsaved: {last.title}
          </button>
        )}
      </div>
    </main>
  );
}

export function CommandPalette() {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const items = useMemo(() => ACTIONS.filter((a) => a.id !== "palette" && a.label.toLowerCase().includes(q.toLowerCase())), [q]);
  const close = () => (cmdkOpen.value = false);
  const run = (i: number) => {
    const a = items[i];
    if (!a || (a.enabled && !a.enabled())) return;
    close();
    a.run();
  };
  return (
    <div class="backdrop" onClick={close}>
      <div class="dialog cmdk" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()} data-testid="cmdk">
        <input
          ref={input}
          placeholder="Type a command…"
          aria-label="Search commands"
          value={q}
          onInput={(e) => {
            setQ((e.currentTarget as HTMLInputElement).value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") setIndex((i) => Math.min(items.length - 1, i + 1));
            if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1));
            if (e.key === "Enter") run(index);
          }}
          data-testid="cmdk-input"
        />
        <ul role="listbox">
          {items.map((a, i) => {
            const enabled = !a.enabled || a.enabled();
            return (
              <li key={a.id}>
                <button role="option" aria-selected={i === index} disabled={!enabled} onClick={() => run(i)} onMouseEnter={() => setIndex(i)}>
                  <span class={enabled ? "" : "muted"}>{a.label}</span>
                  {a.keys && <span class="kbd">{a.keys}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function Shortcuts() {
  const close = () => (shortcutsOpen.value = false);
  return (
    <div class="backdrop" onClick={close}>
      <div class="dialog" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        {ACTIONS.filter((a) => a.keys).map((a) => (
          <div class="row" key={a.id}>
            <span>{a.label}</span>
            <span class="kbd">{a.keys}</span>
          </div>
        ))}
        <div class="row">
          <span>Pan</span>
          <span class="kbd">drag empty space / middle-drag</span>
        </div>
        <div class="row">
          <span>Zoom</span>
          <span class="kbd">wheel / pinch</span>
        </div>
        <div class="actions">
          <button class="btn primary" onClick={close} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const PROBES: { q: string; label: string; unit: string; path: (id: string) => string }[] = [
  { q: "speed.x", label: "velocity x", unit: "m/s", path: (id) => `bodies[id=${id}].velocity.x` },
  { q: "speed.y", label: "velocity y", unit: "m/s", path: (id) => `bodies[id=${id}].velocity.y` },
  { q: "spin", label: "spin", unit: "rad/s", path: (id) => `bodies[id=${id}].angularVelocity` },
  { q: "x", label: "position x", unit: "m", path: (id) => `bodies[id=${id}].position.x` },
  { q: "y", label: "position y", unit: "m", path: (id) => `bodies[id=${id}].position.y` },
  { q: "angle", label: "angle", unit: "rad", path: (id) => `bodies[id=${id}].angle` },
];

function Menu({ x, y, title, children, onClose }: { x: number; y: number; title: string; children: preact.ComponentChildren; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (ref.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
    const off = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", off);
    return () => window.removeEventListener("pointerdown", off);
  }, []);
  return (
    <div
      class="menu"
      role="menu"
      ref={ref}
      style={{ left: `${Math.min(x, window.innerWidth - 220)}px`, top: `${Math.min(y, window.innerHeight - 280)}px` }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        e.stopPropagation();
      }}
      data-testid="menu"
    >
      <div class="title">{title}</div>
      {children}
    </div>
  );
}

export function ProbeMenu() {
  const m = probeMenu.value!;
  const close = () => (probeMenu.value = null);
  return (
    <Menu x={m.x} y={m.y} title={`Probe ${m.bodyId}`} onClose={close}>
      {PROBES.map((p) => (
        <button
          key={p.q}
          role="menuitem"
          onClick={() => {
            const id = `${m.bodyId}.${p.q}`;
            sandbox.value?.addProbe(id, `${m.bodyId} ${p.label}`, p.unit, p.path(m.bodyId));
            if (!visibleSeries.value.includes(id)) visibleSeries.value = [...visibleSeries.value, id];
            close();
            bump();
          }}
          data-testid={`probe-${p.q}`}
        >
          {p.label}
        </button>
      ))}
    </Menu>
  );
}

/** Right-click menu for a body (SBX-022). */
export function ContextMenu() {
  const m = contextMenu.value!;
  const close = () => (contextMenu.value = null);
  const sb = sandbox.value!;
  const b = sb.world.bodies.find((x) => x.id === m.bodyId);
  if (!b) return null;
  const item = (label: string, keys: string | undefined, run: () => void, testid: string) => (
    <button
      role="menuitem"
      onClick={() => {
        close();
        run();
      }}
      data-testid={`ctx-${testid}`}
    >
      <span>{label}</span>
      {keys && <span class="kbd">{keys}</span>}
    </button>
  );
  return (
    <Menu x={m.x} y={m.y} title={b.id} onClose={close}>
      {item("Probe…", "P", () => (probeMenu.value = { x: m.x, y: m.y, bodyId: b.id }), "probe")}
      {item(follow.value ? "Stop following" : "Follow", "F", () => toggleFollow(b.id), "follow")}
      {item("Duplicate", "Ctrl+D", duplicateSelection, "duplicate")}
      {item(b.fixed ? "Make free" : "Make fixed", undefined, () => edit([{ type: "body.set", id: b.id, patch: { fixed: !b.fixed } }], b.fixed ? "Make free" : "Make fixed"), "fixed")}
      {item("Stop (zero velocity)", undefined, () => edit([{ type: "body.set", id: b.id, patch: { velocity: { x: 0, y: 0 }, angularVelocity: 0 } }], `Stop ${b.id}`), "stop")}
      {sb.world.joints.some((j) => j.a === b.id || j.b === b.id) && item("Detach from assembly", undefined, () => edit([{ type: "body.detach", id: b.id }], `Detach ${b.id}`), "detach")}
      {sb.world.joints.some((j) => j.a === b.id || j.b === b.id) && item("Save assembly as prefab", undefined, () => savePrefab(b.id), "prefab")}
      {item("Delete", "Del", deleteSelection, "delete")}
    </Menu>
  );
}

/** Violations list; each entry jumps to its step and selects the bodies involved (SBX-034). */
export function ViolationsPopover() {
  void version.value;
  const sb = sandbox.value!;
  const list = sb.world.events.filter((e) => e.type === "violation");
  const close = () => (violationsOpen.value = false);
  return (
    <div class="backdrop" onClick={close}>
      <div class="dialog" role="dialog" aria-label="Conservation violations" onClick={(e) => e.stopPropagation()} data-testid="violations-list">
        <h2>Conservation violations</h2>
        {list.length === 0 ? (
          <p class="muted">None. Every change to mass, momentum, angular momentum and energy so far is accounted for.</p>
        ) : (
          <p class="muted">The ledger couldn't attribute these changes to any source. Pick one to jump to that step.</p>
        )}
        {list.slice(-50).map((e, i) => (
          <button
            key={i}
            class="btn"
            onClick={() => {
              close();
              jumpTo(e.tick, String(e.data.entities ?? "").split(",").filter(Boolean));
            }}
            data-testid="violation-entry"
          >
            <span class="mono">t={(e.tick * sb.profile.timestep).toFixed(3)} s</span>
            <span>
              {String(e.data.quantity)} off by {Number(e.data.magnitude).toExponential(2)} (tolerance {Number(e.data.tolerance).toExponential(0)})
            </span>
            {e.data.entities ? <span class="muted">· {String(e.data.entities)}</span> : null}
          </button>
        ))}
        <div class="actions">
          <button class="btn primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function Dialog() {
  const d = dialog.value!;
  const close = () => (dialog.value = null);
  return (
    <div class="backdrop" onClick={close}>
      <div class="dialog" role="alertdialog" aria-label={d.title} onClick={(e) => e.stopPropagation()} data-testid={`dialog-${d.kind}`}>
        <h2>{d.title}</h2>
        {d.message && <p style={{ margin: 0 }}>{d.message}</p>}
        {d.errors && (
          <ul data-testid="dialog-errors">
            {d.errors.map((e, i) => (
              <li key={i}>
                <code>{e.path}</code> {e.message}
              </li>
            ))}
          </ul>
        )}
        <div class="actions">
          {d.kind === "confirm" ? (
            <>
              <button class="btn" onClick={close} autoFocus data-testid="dialog-cancel">
                Cancel
              </button>
              <button
                class="btn primary"
                onClick={() => {
                  close();
                  d.onConfirm?.();
                }}
                data-testid="dialog-ok"
              >
                {d.confirmLabel ?? "OK"}
              </button>
            </>
          ) : (
            <button class="btn primary" onClick={close} autoFocus data-testid="dialog-close">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  return toast.value ? (
    <div class="toast" role="status" data-testid="toast">
      {toast.value}
    </div>
  ) : null;
}

export { confirmDiscard, selection };
