// The world view: render loop, fixed-step clock, and direct manipulation for each tool.
import { useEffect, useRef, useState } from "preact/hooks";
import {
  add,
  advanceStepper,
  containsPoint,
  createStepper,
  cross,
  invRotate,
  length,
  massProps,
  normalizeBody,
  rotate,
  scale,
  sinCos,
  sub,
  type Body,
  type BodyInput,
  type Vec2,
} from "../core/index.ts";
import { panBy, toScreen, toWorld, zoomAt } from "./camera.ts";
import { fmt } from "./format.ts";
import { COLORS, OVERLAYS, renderFrame, type Preview, type RulerView } from "./render.ts";
import {
  achieved,
  bump,
  camera,
  contextMenu,
  edit,
  follow,
  freshId,
  hover,
  overlays,
  playing,
  probeMenu,
  sandbox,
  selection,
  showToast,
  spawnKind,
  timeScale,
  toggleOverlay,
  tool,
  version,
  viewport,
  type SpawnKind,
} from "./state.ts";

export function spawnBody(kind: SpawnKind, id: string, at: Vec2, velocity: Vec2): BodyInput {
  const base = { id, position: at, velocity, angle: 0, angularVelocity: 0 };
  switch (kind) {
    case "disc":
      return { ...base, shape: { kind: "disc", radius: 0.5 }, mass: 1 };
    case "box":
      return { ...base, shape: { kind: "box", width: 1, height: 1 }, mass: 1 };
    case "plank":
      return { ...base, shape: { kind: "box", width: 3, height: 0.2 }, mass: 2 };
    case "triangle":
      return { ...base, shape: { kind: "polygon", vertices: [{ x: -0.6, y: -0.4 }, { x: 0.6, y: -0.4 }, { x: 0, y: 0.6 }] }, mass: 1 };
    case "hexagon": {
      const vertices = Array.from({ length: 6 }, (_, i) => {
        const q = sinCos((i * Math.PI) / 3);
        return { x: 0.55 * q.c, y: 0.55 * q.s };
      });
      return { ...base, shape: { kind: "polygon", vertices }, mass: 1.5 };
    }
    case "wall":
      return { ...base, velocity: { x: 0, y: 0 }, shape: { kind: "box", width: 4, height: 0.4 }, mass: 1, fixed: true };
  }
}

type Gesture =
  | { kind: "pan"; last: Vec2 }
  | { kind: "box"; start: Vec2; now: Vec2 }
  | { kind: "move"; id: string; grab: Vec2; original: Vec2; running: false }
  | { kind: "drag"; id: string; anchor: Vec2; group: number; running: true }
  | { kind: "rotate"; id: string; centre: Vec2; startAngle: number; original: number }
  | { kind: "spawn"; start: Vec2; now: Vec2 }
  | { kind: "impulse"; id: string; point: Vec2; now: Vec2 }
  | { kind: "ruler"; a: Anchor; now: Vec2 };

interface Anchor {
  id?: string;
  local: Vec2; // body-local if id, else world
}

const anchorWorld = (bodies: Body[], a: Anchor): Vec2 => {
  if (!a.id) return a.local;
  const b = bodies.find((x) => x.id === a.id);
  return b ? add(b.position, rotate(sinCos(b.angle), a.local)) : a.local;
};

const anchorVelocity = (bodies: Body[], a: Anchor): Vec2 => {
  if (!a.id) return { x: 0, y: 0 };
  const b = bodies.find((x) => x.id === a.id);
  if (!b) return { x: 0, y: 0 };
  const r = rotate(sinCos(b.angle), a.local);
  return add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
};

let gestureGroup = 1000;

export function View() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Vec2>());
  const pinch = useRef<{ dist: number; mid: Vec2 } | null>(null);
  const [ruler, setRuler] = useState<{ a: Anchor; b: Anchor } | null>(null);
  const rulerRef = useRef(ruler);
  rulerRef.current = ruler;
  const [hoverPos, setHoverPos] = useState<Vec2 | null>(null);
  const [lookForHidden, setLookForHidden] = useState(false);
  const [rulerLabel, setRulerLabel] = useState<string | null>(null);
  const rulerLabelRef = useRef<string | null>(null);
  const preview = useRef<Preview | null>(null);
  void version.value;

  // Resize the canvas to its box at device pixel ratio.
  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      viewport.value = { width: Math.max(1, r.width), height: Math.max(1, r.height) };
      const dpr = window.devicePixelRatio || 1;
      canvas.current!.width = Math.round(r.width * dpr);
      canvas.current!.height = Math.round(r.height * dpr);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Render loop and fixed-step clock (ARC-006, SBX-002, SBX-005).
  useEffect(() => {
    const stepper = createStepper();
    let last = performance.now();
    let lastBump = 0;
    let smoothed = 1;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const sb = sandbox.value;
      const ctx = canvas.current?.getContext("2d");
      if (!sb || !ctx) return;
      const realDt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (playing.value) {
        const r = advanceStepper(stepper, realDt, { timestep: sb.profile.timestep, timeScale: timeScale.value, maxStepsPerFrame: 64 });
        if (r.steps) sb.step(r.steps);
        smoothed = smoothed * 0.9 + r.achievedScale * 0.1;
        if (now - lastBump > 100) {
          achieved.value = { scale: smoothed, behind: r.fellBehind || smoothed < timeScale.value * 0.95 };
          bump();
          lastBump = now;
        }
      } else {
        stepper.accumulator = 0;
        smoothed = timeScale.value;
      }
      if (follow.value && selection.value.length) {
        const b = sb.world.bodies.find((x) => x.id === selection.value[0]);
        if (b) camera.value = { ...camera.value, x: b.position.x, y: b.position.y };
      }
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bodies = sb.world.bodies;
      let rulerView: RulerView | null = null;
      const r = rulerRef.current;
      const g = gesture.current;
      const ra = g?.kind === "ruler" ? g.a : r?.a;
      const rbPoint = g?.kind === "ruler" ? g.now : r ? anchorWorld(bodies, r.b) : null;
      if (ra && rbPoint) {
        const pa = anchorWorld(bodies, ra);
        const d = sub(rbPoint, pa);
        const dist = length(d);
        const rel = sub(r && g?.kind !== "ruler" ? anchorVelocity(bodies, r.b) : { x: 0, y: 0 }, anchorVelocity(bodies, ra));
        const closing = dist > 0 ? -(d.x * rel.x + d.y * rel.y) / dist : 0;
        rulerView = { a: pa, b: rbPoint, label: `${fmt(dist, "m")} · Δv ${fmt(length(rel), "m/s")} · closing ${fmt(closing, "m/s")}` };
      }
      const label = rulerView?.label ?? null;
      if (label !== rulerLabelRef.current) {
        rulerLabelRef.current = label;
        setRulerLabel(label);
      }
      renderFrame(ctx, sb.world, camera.value, viewport.value, {
        overlays: overlays.value,
        selection: new Set(selection.value),
        hover: hover.value,
        ruler: rulerView,
        preview: preview.current,
      });
      // Rotate handle for a single selected body with the Move tool.
      const handle = rotateHandle();
      if (handle) {
        ctx.strokeStyle = COLORS.selected;
        ctx.fillStyle = COLORS.background;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (g?.kind === "box") {
        const a = toScreen(camera.value, viewport.value, g.start);
        const b = toScreen(camera.value, viewport.value, g.now);
        ctx.strokeStyle = COLORS.hover;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        ctx.setLineDash([]);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const local = (e: PointerEvent | MouseEvent | WheelEvent): Vec2 => {
    const r = wrap.current!.getBoundingClientRect();
    // Keep the viewport in step with the element before mapping, so a click that lands
    // before the resize observer fires still hits what's under the pointer.
    if (r.width !== viewport.value.width || r.height !== viewport.value.height) viewport.value = { width: Math.max(1, r.width), height: Math.max(1, r.height) };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const worldAt = (s: Vec2) => toWorld(camera.value, viewport.value, s);

  const hit = (p: Vec2): Body | null => {
    const sb = sandbox.value;
    if (!sb) return null;
    const minR = 6 / camera.value.zoom;
    for (let i = sb.world.bodies.length - 1; i >= 0; i--) {
      const b = sb.world.bodies[i];
      if (containsPoint({ shape: b.shape, position: b.position, rot: sinCos(b.angle) }, p)) return b;
      if (length(sub(p, b.position)) < minR) return b;
    }
    return null;
  };

  function rotateHandle(): Vec2 | null {
    const sb = sandbox.value;
    if (!sb || tool.value !== "move" || selection.value.length !== 1) return null;
    const b = sb.world.bodies.find((x) => x.id === selection.value[0]);
    if (!b || b.fixed) return null;
    const r = massProps(b.shape, b.mass).boundingRadius;
    const s = toScreen(camera.value, viewport.value, b.position);
    return { x: s.x, y: s.y - r * camera.value.zoom - 22 };
  }

  const impulseFor = (b: Body, point: Vec2, to: Vec2) => {
    const J = scale(sub(to, point), 2 * b.mass); // 2 m/s of Δv per metre dragged
    const I = massProps(b.shape, b.mass).inertia;
    return { J, dv: length(J) / b.mass, dw: cross(sub(point, b.position), J) / I };
  };

  const onPointerDown = (e: PointerEvent) => {
    const sb = sandbox.value;
    if (!sb) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    contextMenu.value = null;
    probeMenu.value = null;
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinch.current = { dist: length(sub(p1, p2)), mid: scale(add(p1, p2), 0.5) };
      gesture.current = null;
      preview.current = null;
      return;
    }
    if (e.button === 2) {
      // Open the context menu on press: not every engine fires `contextmenu` reliably for every right-click.
      openContextMenu(e);
      return;
    }
    const p = worldAt(s);
    const body = hit(p);
    const t = tool.value;
    if (e.button === 1 || (t === "select" && !body && !e.shiftKey)) {
      gesture.current = { kind: "pan", last: s };
      if (t === "select" && e.button === 0) selection.value = [];
      bump();
      return;
    }
    switch (t) {
      case "select":
        if (!body) gesture.current = { kind: "box", start: p, now: p };
        else if (e.shiftKey) selection.value = selection.value.includes(body.id) ? selection.value.filter((x) => x !== body.id) : [...selection.value, body.id];
        else selection.value = [body.id];
        bump();
        return;
      case "move": {
        const h = rotateHandle();
        if (h && length(sub(h, s)) < 12) {
          const b = sb.world.bodies.find((x) => x.id === selection.value[0])!;
          if (playing.value) {
            showToast("Pause to rotate: while running, rotation comes from forces and contacts.");
            return;
          }
          gesture.current = { kind: "rotate", id: b.id, centre: b.position, startAngle: Math.atan2(p.y - b.position.y, p.x - b.position.x), original: b.angle };
          return;
        }
        if (!body) {
          gesture.current = { kind: "pan", last: s };
          return;
        }
        selection.value = [body.id];
        if (body.fixed && playing.value) {
          showToast("Fixed bodies can only be moved while paused.");
          return;
        }
        if (playing.value) {
          const anchor = invRotate(sinCos(body.angle), sub(p, body.position));
          const group = ++gestureGroup;
          edit([{ type: "drag.set", id: body.id, anchor, target: p }], `Drag ${body.id}`, group);
          gesture.current = { kind: "drag", id: body.id, anchor, group, running: true };
        } else {
          gesture.current = { kind: "move", id: body.id, grab: sub(p, body.position), original: { ...body.position }, running: false };
        }
        bump();
        return;
      }
      case "spawn":
        gesture.current = { kind: "spawn", start: p, now: p };
        return;
      case "impulse":
        if (!body) return;
        if (body.fixed) {
          showToast("Fixed bodies don't move; pick a free body.");
          return;
        }
        selection.value = [body.id];
        gesture.current = { kind: "impulse", id: body.id, point: p, now: p };
        return;
      case "probe":
        if (body) probeMenu.value = { x: e.clientX, y: e.clientY, bodyId: body.id };
        return;
      case "ruler": {
        const a: Anchor = body ? { id: body.id, local: invRotate(sinCos(body.angle), sub(p, body.position)) } : { local: p };
        gesture.current = { kind: "ruler", a, now: p };
        setRuler(null);
        return;
      }
      default:
        return;
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const sb = sandbox.value;
    if (!sb) return;
    const s = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, s);
    if (pinch.current && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = length(sub(p1, p2));
      const mid = scale(add(p1, p2), 0.5);
      let c = panBy(camera.value, mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y);
      c = zoomAt(c, viewport.value, mid, dist / Math.max(1, pinch.current.dist));
      camera.value = c;
      pinch.current = { dist, mid };
      return;
    }
    const p = worldAt(s);
    const g = gesture.current;
    if (!g) {
      const b = hit(p);
      if ((b?.id ?? null) !== hover.value) hover.value = b?.id ?? null;
      setHoverPos(b ? s : null);
      return;
    }
    setHoverPos(null);
    switch (g.kind) {
      case "pan":
        camera.value = panBy(camera.value, s.x - g.last.x, s.y - g.last.y);
        g.last = s;
        follow.value = false;
        return;
      case "box":
        g.now = p;
        return;
      case "move": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (b) b.position = sub(p, g.grab); // display only; committed as one command on release
        return;
      }
      case "drag":
        edit([{ type: "drag.set", id: g.id, anchor: g.anchor, target: p }], `Drag ${g.id}`, g.group);
        return;
      case "rotate": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        let a = g.original + Math.atan2(p.y - g.centre.y, p.x - g.centre.x) - g.startAngle;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        b.angle = a;
        return;
      }
      case "spawn": {
        g.now = p;
        const v = scale(sub(p, g.start), 2);
        preview.current = { kind: "arrow", from: g.start, to: p, label: `v ${fmt(length(v), "m/s")}`, body: normalizeBody(spawnBody(spawnKind.value, "preview", g.start, v)) };
        return;
      }
      case "impulse": {
        g.now = p;
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        const { J, dv, dw } = impulseFor(b, g.point, p);
        preview.current = { kind: "arrow", from: g.point, to: p, label: `J ${fmt(length(J), "N·s")} · Δv ${fmt(dv, "m/s")} · Δω ${dw.toFixed(2)} rad/s` };
        return;
      }
      case "ruler":
        g.now = p;
        return;
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const sb = sandbox.value;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const g = gesture.current;
    gesture.current = null;
    preview.current = null;
    if (!sb || !g) return;
    const p = worldAt(local(e));
    switch (g.kind) {
      case "box": {
        const minX = Math.min(g.start.x, g.now.x);
        const maxX = Math.max(g.start.x, g.now.x);
        const minY = Math.min(g.start.y, g.now.y);
        const maxY = Math.max(g.start.y, g.now.y);
        selection.value = sb.world.bodies.filter((b) => b.position.x >= minX && b.position.x <= maxX && b.position.y >= minY && b.position.y <= maxY).map((b) => b.id);
        bump();
        return;
      }
      case "move": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        const final = { ...b.position };
        b.position = g.original; // restore, then apply as a recorded command so the ledger sees it
        if (length(sub(final, g.original)) > 1e-9) edit([{ type: "body.set", id: g.id, patch: { position: final } }], `Move ${g.id}`);
        bump();
        return;
      }
      case "drag":
        edit([{ type: "drag.clear", id: g.id }], `Drag ${g.id}`, g.group);
        return;
      case "rotate": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        const final = b.angle;
        b.angle = g.original;
        if (final !== g.original) edit([{ type: "body.set", id: g.id, patch: { angle: final } }], `Rotate ${g.id}`);
        return;
      }
      case "spawn": {
        const id = freshId(spawnKind.value);
        const v = scale(sub(g.now, g.start), 2);
        if (edit([{ type: "body.add", body: spawnBody(spawnKind.value, id, g.start, v) }], `Spawn ${id}`)) selection.value = [id];
        return;
      }
      case "impulse": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        const { J } = impulseFor(b, g.point, p);
        if (length(J) > 1e-9) edit([{ type: "body.impulse", id: g.id, impulse: J, point: g.point }], `Impulse on ${g.id}`);
        return;
      }
      case "ruler": {
        const b = hit(p);
        const end: Anchor = b ? { id: b.id, local: invRotate(sinCos(b.angle), sub(p, b.position)) } : { local: p };
        setRuler({ a: g.a, b: end });
        return;
      }
      default:
        return;
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    camera.value = zoomAt(camera.value, viewport.value, local(e), Math.exp(-e.deltaY * 0.0015));
  };

  function openContextMenu(e: MouseEvent) {
    const body = hit(worldAt(local(e)));
    if (!body) return;
    if (!selection.value.includes(body.id)) selection.value = [body.id];
    contextMenu.value = { x: e.clientX, y: e.clientY, bodyId: body.id };
    bump();
  }
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (!contextMenu.value) openContextMenu(e);
  };

  useEffect(() => {
    const el = wrap.current!;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (tool.value !== "ruler") setRuler(null);
  }, [tool.value]);

  const sb = sandbox.value;
  const hb = hover.value && sb ? sb.world.bodies.find((b) => b.id === hover.value) : null;
  const lookFor = sb?.scenario.ui?.lookFor;
  const active = OVERLAYS.filter((o) => overlays.value.has(o.id) && o.id !== "grid");

  return (
    <div
      class="view"
      ref={wrap}
      data-testid="view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!gesture.current) {
          hover.value = null;
          setHoverPos(null);
        }
      }}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvas} role="img" aria-label="Simulation view" data-testid="canvas" />
      {sb && sb.world.bodies.length === 0 && (
        <div class="empty-hint">
          <div>
            <div style={{ fontSize: "18px", color: "var(--text)" }}>Empty world</div>
            Press <b>S</b> or pick Spawn in the tool rail, choose a body, then click here.
          </div>
        </div>
      )}
      {lookFor && !lookForHidden && (
        <div class="lookfor" data-testid="look-for">
          <strong>What to look for</strong>
          {lookFor}
          <div>
            <button class="btn ghost small" onPointerDown={(e) => e.stopPropagation()} onClick={() => setLookForHidden(true)} data-testid="hide-look-for">
              Hide
            </button>
          </div>
        </div>
      )}
      {hb && hoverPos && (
        <div class="hovercard" data-testid="hovercard" style={{ left: `${hoverPos.x + 14}px`, top: `${hoverPos.y + 14}px` }}>
          {hb.id} · {hb.shape.kind}
          {hb.fixed ? " (fixed)" : ""} · {fmt(hb.mass, "kg")} · {fmt(length(hb.velocity), "m/s")} · {hb.angularVelocity.toFixed(2)} rad/s
        </div>
      )}
      {rulerLabel && (
        <div class="hovercard" style={{ left: "12px", bottom: "12px" }} role="status" data-testid="ruler-readout">
          Ruler: {rulerLabel}
        </div>
      )}
      {active.length > 0 && (
        <div class="legend" aria-label="Overlay legend">
          {active.map((o) => (
            <div key={o.id}>
              <b>{o.label}</b>: {o.legend}
            </div>
          ))}
        </div>
      )}
      <div class="overlay-bar" role="group" aria-label="Overlays" onPointerDown={(e) => e.stopPropagation()}>
        {OVERLAYS.map((o) => (
          <button key={o.id} class={`btn small ${overlays.value.has(o.id) ? "on" : ""}`} aria-pressed={overlays.value.has(o.id)} data-testid={`overlay-${o.id}`} onClick={() => toggleOverlay(o.id)}>
            {o.label}
          </button>
        ))}
        <button class="btn small" disabled title="Joint load overlay arrives in M2">
          Joint load
        </button>
        <button class="btn small" disabled title="Link path overlay arrives in M2">
          Links
        </button>
      </div>
    </div>
  );
}
