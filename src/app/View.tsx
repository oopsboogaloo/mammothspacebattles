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
  temperatureOf,
  type Body,
  type Parcel,
  type BodyInput,
  type Vec2,
  pilotChannels,
} from "../core/index.ts";
import { panBy, toScreen, toWorld, zoomAt } from "./camera.ts";
import { SimClient } from "./simClient.ts";
import { fmt } from "./format.ts";
import { assemblyIds, attachCommands, attachPrefabCommands, nearestPort, place, ports, prefabCommands, usedPorts, worldPort, type Placement } from "./ports.ts";
import { ENGINE, engineFor, HULL, TANK, withFreshChannels } from "./parts.ts";
import { COLORS, FLAME, GLOW_FROM, OVERLAYS, renderFrame, SPECIES_LIST, T_MAX, T_MIN, T_RAMP, temperatureFraction, type PortMarker, type Preview, type RulerView } from "./render.ts";
import {
  achieved,
  bump,
  openScenario,
  scenarioKey,
  camera,
  contextMenu,
  edit,
  follow,
  followId,
  freshId,
  gasColour,
  gasStyle,
  gasOptions,
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
  bindings,
  prefabs,
  type PartChoice,
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
    case "hull":
      return { ...structuredClone(HULL), ...base };
    case "tank":
      return { ...structuredClone(TANK), ...base };
  }
}

type Gesture =
  | { kind: "pan"; last: Vec2; start: Vec2; moved: boolean }
  | { kind: "box"; start: Vec2; now: Vec2 }
  | { kind: "move"; id: string; grab: Vec2; original: Vec2; running: false }
  | { kind: "drag"; id: string; anchor: Vec2; group: number; running: true }
  | { kind: "rotate"; id: string; centre: Vec2; startAngle: number; original: number }
  | { kind: "spawn"; start: Vec2; now: Vec2 }
  | { kind: "impulse"; id: string; point: Vec2; now: Vec2 }
  | { kind: "ruler"; a: Anchor; now: Vec2 }
  | { kind: "attachDrag"; id: string; grab: Vec2; original: Vec2; originalAngle: number }
  | { kind: "link"; from: string; now: Vec2 }
  | { kind: "gas"; start: Vec2; now: Vec2 };

/** Frame budget for simulation steps, ms: heavy scenes run in slow motion instead of freezing the page. */
const STEP_BUDGET_MS = 12;
/** How long the worker steps before sending what it has, ms: about two frames. */
const WORKER_BUDGET_MS = 30;
export const sim = new SimClient();
/** How far a press must move before it counts as a pan rather than a tap. */
const PAN_SLOP_PX = 8;

/** The fill (or clear) a gas-tool rectangle makes, from the tool settings. */
export function gasRect(a: Vec2, b: Vec2): { min: Vec2; max: Vec2; area: number; count: number; mass: number } {
  const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
  const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  const area = (max.x - min.x) * (max.y - min.y);
  const o = gasOptions.value;
  return { min, max, area, count: Math.max(1, Math.round(area / (o.spacing * o.spacing))), mass: o.density * area };
}

const isPrefab = (c: PartChoice): c is `prefab:${number}` => c.startsWith("prefab:");
/** The engine is an assembly; Attach welds it by its mount body (SBX-014, W3). */
const isEngine = (c: PartChoice): c is "engine" => c === "engine";

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
  const portMarkers = useRef<PortMarker[]>([]);
  const highlight = useRef<Set<string> | null>(null);
  const attach = useRef<Placement | null>(null);
  const [attachText, setAttachText] = useState<string | null>(null);
  const [hoverParcel, setHoverParcel] = useState<Parcel | null>(null);
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
    // When the run last fell behind; the "slow" mark stays on a second after, so it doesn't flicker.
    let behindAt = -Infinity;
    let smoothed = 1;
    let raf = 0;
    // Steps owed to the worker, and steps it has delivered since the last frame.
    let owed = 0;
    let taken = 0;
    sim.onRun = (steps, verdict) => {
      taken += steps;
      if (verdict) {
        // A landing verdict (FLT-009) pauses the run, so the moment it happened stays on screen.
        playing.value = false;
        bump();
        return;
      }
      // Keep the worker busy: start on what is owed straight away rather than at the next frame.
      const sb = sandbox.value;
      if (sb && playing.value && owed > 0 && !sim.stale(sb)) {
        sim.request(sb, Math.min(owed, 256), WORKER_BUDGET_MS);
        owed = 0;
      }
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const sb = sandbox.value;
      const ctx = canvas.current?.getContext("2d");
      if (!sb || !ctx) return;
      const realDt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (playing.value) {
        const r = advanceStepper(stepper, realDt, { timestep: sb.profile.timestep, timeScale: timeScale.value, maxStepsPerFrame: 64 });
        let done = 0;
        let cut = false;
        if (sim.available && !sim.stale(sb)) {
          // The worker steps (§10.1): ask for what is owed, and take results as they come, so the
          // page draws at full rate however heavy the physics. What it can't keep up with is dropped,
          // so a heavy scene runs in smooth slow motion.
          owed += r.steps;
          done = taken;
          taken = 0;
          if (!sim.inFlight && owed > 0) {
            sim.request(sb, Math.min(owed, 256), WORKER_BUDGET_MS);
            owed = 0;
          } else if (owed > 4 * 64) {
            owed = 0;
            cut = true;
          }
        } else {
          // On the page: within the frame budget, at least one step a frame. What doesn't fit is
          // dropped, so a heavy scene (gas) runs in smooth slow motion rather than stalling the page.
          const t0 = performance.now();
          while (done < r.steps) {
            // A landing verdict (FLT-009) pauses the run, so the moment it happened stays on screen.
            if (sb.step(1, true)) {
              done++;
              playing.value = false;
              bump();
              break;
            }
            done++;
            if (performance.now() - t0 > STEP_BUDGET_MS) break;
          }
          cut = done < r.steps;
        }
        if (cut) stepper.accumulator = 0;
        const scaleNow = realDt > 0 ? (done * sb.profile.timestep) / realDt : 0;
        smoothed = smoothed * 0.9 + scaleNow * 0.1;
        if (now - lastBump > 100) {
          if (r.fellBehind || cut || smoothed < timeScale.value * 0.95) behindAt = now;
          achieved.value = { scale: smoothed, behind: now - behindAt < 1000 };
          bump();
          lastBump = now;
        }
      } else {
        stepper.accumulator = 0;
        smoothed = timeScale.value;
        owed = 0;
        taken = 0;
        sim.cancel();
      }
      if (follow.value && followId.value) {
        const b = sb.world.bodies.find((x) => x.id === followId.value);
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
        ports: portMarkers.current,
        highlight: highlight.current ?? undefined,
        gasColour: gasColour.value,
        gasStyle: gasStyle.value,
        pad: sb.world.challenge?.goal.pad,
        // In a challenge the parts' ids are clutter: the pad is marked instead.
        labels: !sb.world.challenge && sb.scenario.ui?.labels !== false,
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
      if (g?.kind === "box" || g?.kind === "gas") {
        const a = toScreen(camera.value, viewport.value, g.start);
        const b = toScreen(camera.value, viewport.value, g.now);
        const clear = g.kind === "gas" && gasOptions.value.mode === "clear";
        ctx.strokeStyle = g.kind === "gas" ? (clear ? COLORS.contact : COLORS.preview) : COLORS.hover;
        ctx.lineWidth = g.kind === "gas" ? 2 : 1;
        ctx.setLineDash(clear ? [6, 4] : [4, 3]);
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        ctx.setLineDash([]);
        if (g.kind === "gas") {
          const f = gasRect(g.start, g.now);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = "12px 'IBM Plex Mono', monospace";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(clear ? "clear gas" : `≈ ${f.count} parcels · ${fmt(f.mass, "kg")} · ${gasOptions.value.temperature} K`, Math.max(a.x, b.x) + 8, Math.min(a.y, b.y) - 4);
        }
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

  /** The parcel under the pointer, if any (for the hover readout, SBX-036). */
  const parcelAt = (p: Vec2): Parcel | null => {
    const sb = sandbox.value;
    if (!sb) return null;
    const minR = 4 / camera.value.zoom;
    let best: Parcel | null = null;
    let bestD = Infinity;
    for (const q of sb.world.gas.parcels) {
      const d = Math.hypot(q.position.x - p.x, q.position.y - p.y);
      if (d < Math.max(q.radius, minR) && d < bestD) [best, bestD] = [q, d];
    }
    return best;
  };

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

  /** Updates the attach preview for a part at the pointer: nearest port, ghost, reason (SBX-014). */
  const showAttach = (p: Vec2, part: { id: string; shape: Body["shape"] } | null, exclude?: string): Placement | null => {
    const sb = sandbox.value;
    portMarkers.current = [];
    attach.current = null;
    if (!sb || !part) {
      preview.current = null;
      setAttachText(null);
      return null;
    }
    const near = nearestPort(sb.world, p, Math.max(0.6, 24 / camera.value.zoom), exclude);
    if (!near) {
      preview.current = null;
      setAttachText("Point at a body: the nearest port lights up");
      return null;
    }
    const pl = place(sb.world, part, near.body, near.port, sb.profile.tol.penetration / 2);
    const used = usedPorts(sb.world, near.body.id);
    portMarkers.current = ports(near.body.shape)
      .filter((q) => !used.has(q.index))
      .map((q) => ({ point: worldPort(near.body, q).point, state: q.index === near.port.index ? (pl.valid ? "valid" : "invalid") : "idle" }));
    if (used.has(near.port.index)) portMarkers.current.push({ point: worldPort(near.body, near.port).point, state: "invalid" });
    preview.current = { kind: "ghost", from: pl.position, to: pl.position, valid: pl.valid, body: { ...normalizeBody({ id: part.id, shape: part.shape, mass: 1, position: pl.position, velocity: { x: 0, y: 0 }, angle: pl.angle, angularVelocity: 0 }) } };
    attach.current = pl;
    setAttachText(pl.reason);
    return pl;
  };

  const ghostPart = (): { id: string; shape: Body["shape"] } | null => {
    const k = spawnKind.value;
    if (isPrefab(k)) return null;
    if (isEngine(k)) return { id: "new part", shape: ENGINE.bodies.find((b) => b.id === ENGINE.mount)!.shape };
    const b = spawnBody(k, "new part", { x: 0, y: 0 }, { x: 0, y: 0 });
    return { id: b.id, shape: normalizeBody(b).shape };
  };

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
      gesture.current = { kind: "pan", last: s, start: s, moved: false };
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
          gesture.current = { kind: "pan", last: s, start: s, moved: false };
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
      case "gas":
        gesture.current = { kind: "gas", start: p, now: p };
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
      case "attach": {
        const k = spawnKind.value;
        if (body && !body.fixed && assemblyIds(sb.world, body.id).length === 1) {
          if (playing.value) {
            showToast("Pause to move an existing body onto a port. New parts can be attached while running.");
            return;
          }
          gesture.current = { kind: "attachDrag", id: body.id, grab: sub(p, body.position), original: { ...body.position }, originalAngle: body.angle };
          selection.value = [body.id];
          return;
        }
        if (isPrefab(k)) {
          showToast("Prefabs are placed with the Spawn tool.");
          return;
        }
        const pl = attach.current ?? showAttach(p, ghostPart());
        if (!pl) {
          showToast("Point at a body: attach the part to one of its ports.");
          return;
        }
        if (!pl.valid) {
          showToast(pl.reason);
          return;
        }
        if (isEngine(k)) {
          const { commands, mountId } = attachPrefabCommands(sb.world, engineFor(sb.world), pl, freshId);
          if (edit(commands, `Attach engine to ${pl.target}`)) selection.value = [mountId];
          showAttach(p, ghostPart());
          return;
        }
        const id = freshId(k);
        if (edit(attachCommands(sb.world, spawnBody(k, id, pl.position, { x: 0, y: 0 }), pl, freshId("joint"), true), `Attach ${id} to ${pl.target}`)) selection.value = [id];
        showAttach(p, ghostPart());
        return;
      }
      case "link": {
        if (!body) return;
        if (!body.contents?.length) {
          showToast("Start a feed link on a body with a store: add one in the inspector's Contents section.");
          return;
        }
        const resources = new Set(body.contents.map((s) => s.resource));
        highlight.current = new Set(sb.world.bodies.filter((b) => b.id !== body.id && b.contents?.some((s) => resources.has(s.resource))).map((b) => b.id));
        gesture.current = { kind: "link", from: body.id, now: p };
        return;
      }
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
      const parcel = b ? null : parcelAt(p);
      setHoverParcel(parcel);
      setHoverPos(b || parcel ? s : null);
      if (tool.value === "attach") showAttach(p, ghostPart());
      return;
    }
    setHoverPos(null);
    switch (g.kind) {
      case "pan":
        // A finger wobbles when it taps: only a real drag pans (and so stops following).
        if (!g.moved && length(sub(s, g.start)) < PAN_SLOP_PX) return;
        g.moved = true;
        camera.value = panBy(camera.value, s.x - g.last.x, s.y - g.last.y);
        g.last = s;
        follow.value = false;
        return;
      case "box":
      case "gas":
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
        const k = spawnKind.value;
        preview.current = { kind: "arrow", from: g.start, to: p, label: `v ${fmt(length(v), "m/s")}`, body: isPrefab(k) || isEngine(k) ? undefined : normalizeBody(spawnBody(k, "preview", g.start, v)) };
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
      case "attachDrag": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        b.position = sub(p, g.grab); // display only
        showAttach(p, b, b.id);
        return;
      }
      case "link": {
        g.now = p;
        const from = sb.world.bodies.find((x) => x.id === g.from);
        if (from) preview.current = { kind: "line", from: from.position, to: p, label: "feed link" };
        return;
      }
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
        const k = spawnKind.value;
        if (isEngine(k)) {
          edit(prefabCommands(engineFor(sb.world), g.start, freshId), "Spawn engine");
          return;
        }
        if (isPrefab(k)) {
          const pf = prefabs.value[Number(k.slice(7))];
          if (pf) edit(prefabCommands({ ...pf, bodies: withFreshChannels(sb.world, pf.bodies) }, g.start, freshId), `Spawn ${pf.name}`);
          return;
        }
        const id = freshId(k);
        const v = scale(sub(g.now, g.start), 2);
        if (edit([{ type: "body.add", body: spawnBody(k, id, g.start, v) }], `Spawn ${id}`)) selection.value = [id];
        return;
      }
      case "attachDrag": {
        const b = sb.world.bodies.find((x) => x.id === g.id);
        if (!b) return;
        const pl = attach.current;
        b.position = g.original; // restore; the attach is applied as recorded commands
        b.angle = g.originalAngle;
        attach.current = null;
        portMarkers.current = [];
        if (pl?.valid) edit(attachCommands(sb.world, b, pl, freshId("joint"), false), `Attach ${b.id} to ${pl.target}`);
        else if (pl) showToast(pl.reason);
        bump();
        return;
      }
      case "link": {
        const compatible = highlight.current;
        highlight.current = null;
        const to = hit(p);
        const from = sb.world.bodies.find((x) => x.id === g.from);
        if (!to || !from || to.id === from.id) return;
        if (!compatible?.has(to.id)) {
          showToast(`Feed links need a matching store at both ends; ${to.id} has none.`);
          return;
        }
        // One feed link per resource both ends can hold (a tank's H₂ and O₂ to an engine in one drag).
        const resources = from.contents!.filter((st) => to.contents?.some((d) => d.resource === st.resource)).map((st) => st.resource);
        const have = new Set(sb.world.links.filter((l) => l.kind === "feed" && l.from === from.id && l.to === to.id).map((l) => (l as { resource: string }).resource));
        const fresh = resources.filter((r) => !have.has(r));
        if (!fresh.length) {
          showToast(`${from.id} already feeds ${to.id} with ${resources.join(" and ")}.`);
          return;
        }
        // Rate: enough for the receiving injector's full flow (with margin), else 1 kg/s.
        const inj = to.injector;
        edit(
          fresh.map((resource) => ({ type: "link.add" as const, link: { id: freshId("feed"), kind: "feed" as const, from: from.id, to: to.id, resource, rate: inj ? 2 * inj.rate * (inj.mixture[resource] ?? 0) || 1 : 1 } })),
          `Link ${from.id} → ${to.id} (${fresh.join(", ")})`,
        );
        return;
      }
      case "gas": {
        const f = gasRect(g.start, p);
        if (f.area < 1e-4) return;
        const o = gasOptions.value;
        if (o.mode === "clear") {
          const before = sb.world.gas.parcels.length;
          edit([{ type: "gas.remove", min: f.min, max: f.max }], "Clear gas");
          showToast(`Removed ${before - sb.world.gas.parcels.length} parcels`);
          return;
        }
        const events = sb.world.events.length;
        edit([{ type: "gas.fill", fill: { min: f.min, max: f.max, count: f.count, mass: f.mass, temperature: o.temperature, composition: { [o.species]: 1 } } }], "Fill gas");
        const e = sb.world.events.slice(events).find((x) => x.type === "limit.refused" || x.type === "gas.fill");
        if (e?.type === "limit.refused") showToast(`Refused: ${e.data.requested} more parcels would pass the limit of ${e.data.limit}.`);
        else if (e) showToast(`Added ${e.data.created} parcels`);
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
    if (tool.value !== "attach") {
      portMarkers.current = [];
      attach.current = null;
      setAttachText(null);
      if (!gesture.current) preview.current = null;
    }
  }, [tool.value]);

  const sb = sandbox.value;
  const hb = hover.value && sb ? sb.world.bodies.find((b) => b.id === hover.value) : null;
  const lookFor = sb?.scenario.ui?.lookFor;
  const active = OVERLAYS.filter((o) => overlays.value.has(o.id) && o.id !== "grid");

  return (
    <div
      class={`view${sb?.world.challenge || sb?.world.duel ? " has-hud" : ""}`}
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
            Pick Spawn in the tools (or press <b>S</b>), choose a body, then click or tap here.
          </div>
        </div>
      )}
      {lookFor && !lookForHidden && sb?.world.challenge?.status.phase !== "landed" && sb?.world.challenge?.status.phase !== "crashed" && (sb?.world.duel?.status.phase ?? "fighting") === "fighting" && (
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
      {!hb && hoverParcel && hoverPos && (
        <div class="hovercard" data-testid="hovercard" style={{ left: `${hoverPos.x + 14}px`, top: `${hoverPos.y + 14}px` }}>
          gas parcel #{hoverParcel.id} · {Object.keys(hoverParcel.composition).join("+")} · {fmt(temperatureOf(hoverParcel, sb?.world.gas.scale ?? 1), "K")} · {fmt(hoverParcel.mass, "kg")} ·{" "}
          {fmt(length(hoverParcel.velocity), "m/s")}
        </div>
      )}
      {attachText && tool.value === "attach" && (
        <div class="hovercard readout" role="status" data-testid="attach-readout">
          {attachText}
        </div>
      )}
      {sb?.world.challenge && <ChallengeHud />}
      {sb?.world.duel && <DuelHud />}
      {sb && <FlightPad />}
      {Object.keys(bindings.value).length > 0 && sb && (
        <div class="keylegend" aria-label="Key bindings" data-testid="key-legend">
          <strong>Keys</strong>
          {Object.entries(bindings.value).map(([k, ch]) => (
            <div key={k}>
              <span class="kbd">{k.toUpperCase()}</span> → {ch} <span class="mono">{(sb.world.controls[ch] ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
      {rulerLabel && (
        <div class="hovercard readout" role="status" data-testid="ruler-readout">
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
      {sb && (sb.world.gas.parcels.length > 0 || tool.value === "gas") && <GasScale />}
      <div class="overlay-bar" role="group" aria-label="Overlays" onPointerDown={(e) => e.stopPropagation()}>
        {OVERLAYS.map((o) => (
          <button key={o.id} class={`btn small ${overlays.value.has(o.id) ? "on" : ""}`} aria-pressed={overlays.value.has(o.id)} data-testid={`overlay-${o.id}`} onClick={() => toggleOverlay(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Colour scale for gas parcels, with the temperature / composition and plume / dots switches (SBX-035). */
function GasScale() {
  const mode = gasColour.value;
  const style = gasStyle.value;
  const ticks = [50, 100, 300, 1000, 3000];
  const plume = style === "plume" && mode === "temperature";
  // The plume's legend: flame colours on the same log scale, smoke below GLOW_FROM.
  const flameRamp = FLAME.map(([t, col]) => `${col} ${(temperatureFraction(t) * 100).toFixed(1)}%`).join(", ");
  return (
    <div class="gas-scale" aria-label="Gas colour scale" data-testid="gas-scale" onPointerDown={(e) => e.stopPropagation()}>
      <div class="gas-scale-head">
        <span>GAS</span>
        <button class="btn small" onClick={() => (gasColour.value = mode === "temperature" ? "composition" : "temperature")} data-testid="gas-colour" title="Colour parcels by temperature or by composition">
          {mode === "temperature" ? "Temperature" : "Composition"}
        </button>
        {mode === "temperature" && (
          <button class="btn small" onClick={() => (gasStyle.value = style === "plume" ? "dots" : "plume")} data-testid="gas-style" title="Draw the gas as a glowing plume, or as one dot per parcel" aria-pressed={style === "plume"}>
            {style === "plume" ? "Plume" : "Dots"}
          </button>
        )}
      </div>
      {mode === "temperature" ? (
        <>
          <div class="gas-ramp" style={{ background: plume ? `linear-gradient(to right, ${flameRamp})` : `linear-gradient(to right, ${T_RAMP.join(", ")})` }} />
          <div class="gas-ticks">
            {ticks.map((t) => (
              <span key={t} style={{ left: `${(Math.log(t / T_MIN) / Math.log(T_MAX / T_MIN)) * 100}%` }}>
                {t >= 1000 ? `${t / 1000}k` : t}
              </span>
            ))}
          </div>
          <div class="muted">{plume ? `kelvin, log scale · glows above ${GLOW_FROM} K, grey smoke below` : "kelvin, log scale · darker is colder"}</div>
        </>
      ) : (
        <div class="gas-species">
          {SPECIES_LIST.map((sp) => (
            <span key={sp.id}>
              <i style={{ background: sp.colour }} />
              {sp.id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

let padGroup = 7_000_000;

/**
 * Hold-to-fire buttons, one per control channel that reaches a component (SBX-047), so ships can
 * be flown by touch with no keyboard. Each button tracks its own pointer, so two thumbs can hold
 * two engines at once. A bound key's letter is shown on its button.
 */
/** Combat duel readout and verdict (DUEL-002): both ships' health, then won or lost. */
function DuelHud() {
  const sb = sandbox.value!;
  void version.value;
  const d = sb.world.duel!;
  const s = d.status;
  const pct = (x: number) => `${Math.round(100 * x)}%`;
  const retry = () => {
    if (openScenario(sb.raw, scenarioKey.value, sb.scenario.values, { keepOverlays: true })) playing.value = true;
  };
  return (
    <>
      <div class="hud" role="group" aria-label="Duel readout" data-testid="duel-hud">
        <span class={s.player < 0.5 ? "over" : ""} title="Share of your ship's parts still welded on">
          <i>You</i> {pct(s.player)}
        </span>
        {d.goal.enemies.map((e) => (
          <span key={e} title={`Share of ${e}'s parts still welded on`}>
            <i>{d.goal.enemies.length > 1 ? e : "Enemy"}</i> {pct(s.enemies[e] ?? 0)}
          </span>
        ))}
        {(d.goal.kills ?? 1) > 1 && (
          <span title={`First to ${d.goal.kills} kills wins`} data-testid="duel-kills">
            <i>Kills</i> {s.kills.player}–{s.kills.enemies} <i>of {d.goal.kills}</i>
          </span>
        )}
        <span>
          <i>Time</i> {sb.world.time.toFixed(0)} s
        </span>
      </div>
      {s.phase !== "fighting" && (
        <div class={`verdict ${s.phase}`} role="status" aria-live="polite" data-testid="duel-verdict">
          <strong>{s.phase === "won" ? `You won · score ${s.score}` : "You lost"}</strong>
          <div>{s.reason}</div>
          <button class="btn primary" onPointerDown={(e) => e.stopPropagation()} onClick={retry} data-testid="duel-retry">
            Fight again
          </button>
        </div>
      )}
    </>
  );
}

/** Landing challenge readout and verdict (FLT-009). */
function ChallengeHud() {
  const sb = sandbox.value!;
  void version.value;
  const c = sb.world.challenge!;
  const s = c.status;
  const g = c.goal;
  const tooFast = -s.vy > g.maxSpeed;
  const tilted = Math.abs(s.tilt) > g.maxTilt;
  const fuelPct = s.fuelStart > 0 ? Math.round((100 * s.fuel) / s.fuelStart) : 0;
  // A fresh attempt: reopen the scenario, so the last attempt's key presses aren't replayed.
  const retry = () => {
    if (openScenario(sb.raw, scenarioKey.value, sb.scenario.values, { keepOverlays: true })) playing.value = true;
  };
  return (
    <>
      <div class="hud" role="group" aria-label="Landing readout" data-testid="challenge-hud">
        <span>
          <i>Above pad</i> {s.altitude.toFixed(1)} m
        </span>
        <span class={tooFast ? "over" : ""} title={`Touch the pad slower than ${g.maxSpeed} m/s`}>
          <i>Down</i> {(-s.vy).toFixed(1)} m/s{tooFast ? " ▲" : ""}
        </span>
        <span>
          <i>Side</i> {s.vx.toFixed(1)} m/s
        </span>
        <span class={tilted ? "over" : ""} title={`Come to rest within ${g.maxTilt}° of upright`}>
          <i>Tilt</i> {Math.round(s.tilt)}°{tilted ? " ▲" : ""}
        </span>
        <span>
          <i>Fuel</i> {fuelPct}%
        </span>
      </div>
      {s.phase !== "flying" && (
        <div class={`verdict ${s.phase}`} role="status" aria-live="polite" data-testid="challenge-verdict">
          <strong>{s.phase === "landed" ? `Landed · score ${s.score}` : "Crashed"}</strong>
          <div>{s.reason}</div>
          <button class="btn primary" onPointerDown={(e) => e.stopPropagation()} onClick={retry} data-testid="challenge-retry">
            Try again
          </button>
        </div>
      )}
    </>
  );
}

function FlightPad() {
  void version.value;
  const sb = sandbox.value!;
  // Channels an AI pilot flies are its own (AIP-003): no buttons for them.
  const piloted = new Set(sb.world.bodies.filter((b) => b.pilot).flatMap((b) => pilotChannels(sb.world, b)));
  // Nor for spawned ships' channels (ui.spawn), whose pilot may be wrecked while parts fly on.
  const spawned = (sb.scenario.ui?.spawn?.links ?? []).map((l) => String(l.channel ?? "")).filter((c) => c.includes("{n}"));
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = spawned.map((t) => new RegExp(`^${t.split("{n}").map(esc).join("\\d+")}$`));
  const fromTemplate = (c: string) => patterns.some((r) => r.test(c));
  const channels = [...new Set(sb.world.links.filter((l) => l.kind === "control").map((l) => (l as { channel: string }).channel))].filter((c) => !piloted.has(c) && !fromTemplate(c)).sort();
  const held = useRef(new Map<string, { pointer: number; group: number }>());
  const releaseChannel = (ch: string) => {
    const h = held.current.get(ch);
    if (!h) return;
    held.current.delete(ch);
    edit([{ type: "control.set", channel: ch, value: 0 }], `Fire ${ch}`, h.group);
  };
  // A pointer released anywhere ends its hold, even if it slid off its button and could not be
  // captured; a channel whose control link went away while held is let go too.
  useEffect(() => {
    const up = (e: PointerEvent) => {
      for (const [ch, h] of held.current) if (h.pointer === e.pointerId) releaseChannel(ch);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);
  const key = channels.join("\u0000");
  useEffect(() => {
    for (const ch of [...held.current.keys()]) if (!channels.includes(ch)) releaseChannel(ch);
  }, [key]);
  if (!channels.length) return null;
  const keyFor = (ch: string) => Object.entries(bindings.value).find(([, c]) => c === ch)?.[0];
  const press = (ch: string, e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      // Keep this button's pointer even if the thumb slides off it; some pointers can't be captured.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable: release still arrives on the button */
    }
    if (held.current.has(ch)) return;
    const group = ++padGroup;
    held.current.set(ch, { pointer: e.pointerId, group });
    edit([{ type: "control.set", channel: ch, value: 1 }], `Fire ${ch}`, group);
  };
  const release = (ch: string, e: PointerEvent) => {
    e.stopPropagation();
    const h = held.current.get(ch);
    if (!h || h.pointer !== e.pointerId) return;
    releaseChannel(ch);
  };
  // Flight pointers never reach the world's gesture handlers.
  const stop = (e: Event) => e.stopPropagation();
  return (
    <div class="flightpad" role="group" aria-label="Flight controls" data-testid="flight-pad" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onPointerCancel={stop}>
      {channels.map((ch) => {
        const key = keyFor(ch);
        const on = (sb.world.controls[ch] ?? 0) > 0;
        return (
          <button
            key={ch}
            class={`padbtn ${on ? "on" : ""}`}
            aria-pressed={on}
            aria-label={`Fire ${ch} (hold)`}
            title={key ? `Hold to fire ${ch} (or hold ${key.toUpperCase()})` : `Hold to fire ${ch}`}
            onPointerDown={(e) => press(ch, e)}
            onPointerUp={(e) => release(ch, e)}
            onPointerCancel={(e) => release(ch, e)}
            onContextMenu={(e) => e.preventDefault()}
            data-testid={`fly-${ch}`}
          >
            {key && <span class="kbd">{key.toUpperCase()}</span>}
            <span>{ch}</span>
          </button>
        );
      })}
    </div>
  );
}
