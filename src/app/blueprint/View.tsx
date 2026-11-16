// The blueprint itself (docs/blueprint/spec.md §2, §3): the ship on a grid, its welds, centre of
// mass and thrust; select by clicking; pan by dragging the empty grid; zoom with the wheel, a pinch
// or the buttons.
import { useEffect, useRef, useState } from "preact/hooks";
import { addComponent, allOverlaps, body, component, componentBounds, engineGeom, engines, jointPoint, moveComponent, place, SNAP, stats, weldingOf, welds, worldVertices, type Blueprint, type Kind } from "./model.ts";
import { current, edit, mode, overlays, placing, preview, say, selection, type Placing } from "./store.ts";
import { testHeld } from "./Controls.tsx";
import { loadsFor } from "./tryLoads.ts";
import { response } from "./model.ts";

export const KIND_COLOUR: Record<Kind, string> = {
  cockpit: "#a9b4ff",
  engine: "#ffd36a",
  tank: "#5d8cff",
  storage: "#d58cff",
  weapon: "#d58cff",
  generator: "#3fd0c0",
  battery: "#3fd0c0",
  utility: "#ff9f6b",
  frame: "#9fb6d8",
};

export interface ViewState {
  x: number;
  y: number;
  zoom: number; // px per metre
}

/** The view that shows the whole ship, with room round it. */
export function fitView(bp: Blueprint, w0: number, h: number): ViewState {
  // In Controls mode the response table takes the top right: fit the ship in the space beside it.
  const right = mode.value === "controls" ? Math.min(370, w0 * 0.4) : 0;
  const w = w0 - right;
  if (!bp.ship.bodies.length) return { x: 0, y: 0, zoom: 80 };
  const pts = bp.ship.bodies.flatMap(worldVertices);
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const zoom = Math.min((w * 0.62) / Math.max(1, maxX - minX), (h * 0.62) / Math.max(1, maxY - minY), 220);
  return { x: (minX + maxX) / 2 + right / 2 / zoom, y: (minY + maxY) / 2, zoom };
}

export const view: { fit: () => void; zoomBy?: (k: number) => void; clientToWorld?: (x: number, y: number) => { x: number; y: number; inside: boolean }; tol?: () => number } = { fit: () => {} };

/** Where a placing part would land if dropped with its main body at world point `w`. */
export function placeAt(pl: Placing, w: { x: number; y: number }, free: boolean): Placing {
  const bp = current.value;
  const main = pl.made.bodies[0].position;
  const at = place(bp, pl.made.bodies, weldingOf(pl.made.comp), w.x - main.x, w.y - main.y, { free: free || !overlays.value.snap, tol: view.tol?.() ?? SNAP, exclude: pl.moving });
  preview.value = at.overlap ? null : pl.moving ? moveComponent(bp, pl.moving, at.dx, at.dy) : addComponent(bp, pl.made, at.dx, at.dy);
  return { ...pl, at };
}

/** Drops a placing part where it would land; refuses an overlap, with the reason. */
export function drop(pl: Placing): void {
  placing.value = null;
  preview.value = null;
  const at = pl.at;
  if (!at) return;
  if (at.overlap) {
    say("It can't go there: it would overlap another part.");
    return;
  }
  if (pl.moving) {
    if (Math.abs(at.dx) < 1e-9 && Math.abs(at.dy) < 1e-9) return;
    edit((b) => moveComponent(b, pl.moving!, at.dx, at.dy));
    selection.value = { type: "component", id: pl.moving };
  } else {
    edit((b) => addComponent(b, pl.made, at.dx, at.dy));
    selection.value = { type: "component", id: pl.made.comp.id };
  }
  if (!at.touches.length) say("Placed, but not touching the ship: it isn't welded. Drag it against a part to weld it.");
}

export function BlueprintView({ onZoom }: { onZoom?: (z: number) => void }) {
  const bp = current.value;
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [v, setV] = useState<ViewState>({ x: 0, y: 0, zoom: 100 });
  const fitted = useRef<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; hit: string | null; grab?: { x: number; y: number } } | null>(null);
  const pinch = useRef<{ d: number; zoom: number } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A blueprint opened is shown whole.
  useEffect(() => {
    if (fitted.current !== bp.id && size.w > 50) {
      fitted.current = bp.id;
      setV(fitView(bp, size.w, size.h));
    }
  }, [bp.id, size.w, size.h]);
  view.fit = () => setV(fitView(current.value, size.w, size.h));
  // Switching between Build and Controls changes the view's size: show the whole ship again.
  const lastMode = useRef(mode.value);
  useEffect(() => {
    if (lastMode.current !== mode.value && size.w > 50) {
      lastMode.current = mode.value;
      setV(fitView(current.value, size.w, size.h));
    }
  }, [mode.value, size.w, size.h]);
  useEffect(() => onZoom?.(v.zoom), [v.zoom]);

  const sx = (x: number) => size.w / 2 + (x - v.x) * v.zoom;
  const sy = (y: number) => size.h / 2 - (y - v.y) * v.zoom;
  const toWorld = (px: number, py: number) => ({ x: v.x + (px - size.w / 2) / v.zoom, y: v.y - (py - size.h / 2) / v.zoom });

  const zoomAt = (px: number, py: number, k: number) => {
    setV((o) => {
      const zoom = Math.min(600, Math.max(8, o.zoom * k));
      const wx = o.x + (px - size.w / 2) / o.zoom;
      const wy = o.y - (py - size.h / 2) / o.zoom;
      return { zoom, x: wx - (px - size.w / 2) / zoom, y: wy + (py - size.h / 2) / zoom };
    });
  };
  (view as { zoomBy?: (k: number) => void }).zoomBy = (k) => zoomAt(size.w / 2, size.h / 2, k);

  view.clientToWorld = (cx, cy) => {
    const r = ref.current!.getBoundingClientRect();
    const w = toWorld(cx - r.left, cy - r.top);
    return { ...w, inside: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom };
  };
  // Snap within 16 screen pixels, or 0.25 m, whichever is more.
  view.tol = () => Math.max(SNAP, 16 / v.zoom);
  const local = (e: PointerEvent | WheelEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: v.zoom };
      pan.current = null;
    } else {
      // What is under the pointer, read now: once captured, the pointer's later events come to the view itself.
      const hit = ((e.target as Element).closest("[data-hit]") as HTMLElement | null)?.getAttribute("data-hit") ?? null;
      // Grabbing a part: where on it, so it moves with the pointer.
      const grab = hit?.startsWith("comp:") ? toWorld(p.x, p.y) : undefined;
      pan.current = { x: p.x, y: p.y, vx: v.x, vy: v.y, moved: false, hit, grab };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const zoom = Math.min(600, Math.max(8, (pinch.current.zoom * d) / pinch.current.d));
      setV((o) => ({ ...o, zoom }));
      return;
    }
    const pn = pan.current;
    if (!pn) return;
    if (Math.hypot(p.x - pn.x, p.y - pn.y) > 4) pn.moved = true;
    if (pn.moved && pn.grab && pn.hit) {
      // Dragging a part: it follows the pointer and snaps (§3.2).
      const id = pn.hit.slice(5);
      const bp0 = current.value;
      let pl = placing.value;
      if (!pl || pl.moving !== id) {
        const c = component(bp0, id);
        pl = { moving: id, made: { comp: c, bodies: c.bodies.map((b) => body(bp0, b)), joints: [] }, at: null };
        selection.value = { type: "component", id };
      }
      const w = toWorld(p.x, p.y);
      const main = pl.made.bodies[0].position;
      placing.value = placeAt(pl, { x: main.x + w.x - pn.grab.x, y: main.y + w.y - pn.grab.y }, e.shiftKey);
      return;
    }
    if (pn.moved) setV((o) => ({ ...o, x: pn.vx - (p.x - pn.x) / o.zoom, y: pn.vy + (p.y - pn.y) / o.zoom }));
  };
  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const pn = pan.current;
    pan.current = null;
    if (placing.value?.moving) return drop(placing.value);
    if (pn && !pn.moved) {
      // A click: what is under it, else nothing.
      const h = pn.hit;
      if (h?.startsWith("weld:")) selection.value = { type: "weld", id: h.slice(5) };
      else if (h?.startsWith("comp:")) selection.value = { type: "component", id: h.slice(5) };
      else selection.value = null;
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  };

  const st = stats(bp);
  const sel = selection.value;
  const ov = overlays.value;
  const ws = welds(bp);
  const loads = loadsFor(bp);
  const crossing = new Set(allOverlaps(bp).flat());
  const grid = gridLines(size.w, size.h, v, sx, sy, toWorld);

  return (
    <svg ref={ref} class="bp" data-testid="blueprint-view" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      <defs>
        <marker id="bp-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#7fd4ff" />
        </marker>
        <marker id="bp-arrg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#7dffb0" />
        </marker>
        <linearGradient id="bp-plume" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stop-color="#fff3c0" />
          <stop offset=".5" stop-color="#ffb35a" />
          <stop offset="1" stop-color="#ff6a2a" stop-opacity="0" />
        </linearGradient>
      </defs>
      {grid}
      {bp.components.map((c) => {
        const colour = KIND_COLOUR[c.kind];
        const on = sel?.type === "component" && sel.id === c.id;
        const lifted = placing.value?.moving === c.id && !!placing.value.at;
        return (
          <g key={c.id} data-hit={`comp:${c.id}`} class="part" data-testid={`part-${c.id}`} opacity={lifted ? 0.25 : 1}>
            {c.bodies.map((id) => {
              const pts = worldVertices(body(bp, id))
                .map((p) => `${sx(p.x)},${sy(p.y)}`)
                .join(" ");
              const bad = crossing.has(c.id);
              return <polygon key={id} points={pts} fill={colour} fill-opacity={on ? 0.3 : 0.16} stroke={bad ? "#ff7b7b" : colour} stroke-width={on ? 2 : bad ? 2 : 1.3} stroke-dasharray={bad ? "5 3" : undefined} stroke-linejoin="round" data-overlap={bad ? "1" : undefined} />;
            })}
          </g>
        );
      })}
      {sel?.type === "component" && bp.components.some((c) => c.id === sel.id) && <Selected bp={bp} id={sel.id} sx={sx} sy={sy} dims={ov.dims} zoom={v.zoom} />}
      {ov.thrust &&
        engines(bp).map((e) => {
          const L = (0.35 + e.thrust / 2000) * v.zoom;
          const x0 = sx(e.at.x) + e.dir.x * 0.15 * v.zoom;
          const y0 = sy(e.at.y) - e.dir.y * 0.15 * v.zoom;
          return <line key={e.id} x1={x0} y1={y0} x2={x0 + e.dir.x * L} y2={y0 - e.dir.y * L} stroke="#7fd4ff" stroke-width={2} marker-end="url(#bp-arr)" pointer-events="none" />;
        })}
      {ov.welds &&
        ws.map((w) => {
          const on = sel?.type === "weld" && sel.id === w.id;
          // After a try-out, each weld point takes the colour of how hard it worked: amber from half its limit, red near it, a cross if it broke.
          const ld = loads?.[w.id];
          const ring = !ld ? "#e8f0ff" : ld.broke || ld.peak >= 0.8 ? "#ff7b7b" : ld.peak >= 0.5 ? "#ffb35a" : "#7dffb0";
          return (
            <g key={w.id} data-hit={`weld:${w.id}`} class="weld" data-testid={`weld-${w.id}`}>
              {w.joints.map((j) => {
                const p = jointPoint(bp, j);
                return on ? (
                  <g key={j.id}>
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={12} fill="none" stroke="#ffe08a" stroke-width={2} />
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={5} fill="#ffe08a" />
                  </g>
                ) : (
                  <g key={j.id} data-load={ld ? (ld.broke ? "broke" : Math.round(ld.peak * 100)) : undefined}>
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={7} fill="transparent" />
                    <circle cx={sx(p.x)} cy={sy(p.y)} r={ld ? 5 : 4} fill="#0b1430" stroke={ring} stroke-width={ld ? 2 : 1.4} />
                    {ld?.broke && <path d={`M ${sx(p.x) - 3} ${sy(p.y) - 3} L ${sx(p.x) + 3} ${sy(p.y) + 3} M ${sx(p.x) + 3} ${sy(p.y) - 3} L ${sx(p.x) - 3} ${sy(p.y) + 3}`} stroke={ring} stroke-width={1.6} />}
                  </g>
                );
              })}
            </g>
          );
        })}
      {mode.value === "controls" && <Testing bp={bp} sx={sx} sy={sy} zoom={v.zoom} com={st.com} />}
      {ov.com && st.mass > 0 && <ComMarker x={sx(st.com.x)} y={sy(st.com.y)} />}
      {placing.value?.at && <Ghost pl={placing.value} sx={sx} sy={sy} />}
      {placing.value?.at && preview.value && ov.com && (() => {
        const ps = stats(preview.value);
        return Math.hypot(ps.com.x - st.com.x, ps.com.y - st.com.y) > 0.01 ? (
          <g opacity={0.55}>
            <ComMarker x={sx(ps.com.x)} y={sy(ps.com.y)} />
          </g>
        ) : null;
      })()}
      <ScaleBar zoom={v.zoom} h={size.h} />
    </svg>
  );
}

function gridLines(w: number, h: number, v: ViewState, sx: (x: number) => number, sy: (y: number) => number, toWorld: (x: number, y: number) => { x: number; y: number }) {
  const a = toWorld(0, h);
  const b = toWorld(w, 0);
  const minor = v.zoom > 40 ? 0.2 : 1;
  const out = [];
  for (let x = Math.floor(a.x / minor) * minor; x <= b.x; x += minor) {
    const major = Math.abs(x - Math.round(x)) < 1e-6;
    out.push(<line key={`x${x.toFixed(2)}`} x1={sx(x)} x2={sx(x)} y1={0} y2={h} class={major ? "gmaj" : "gmin"} />);
  }
  for (let y = Math.floor(a.y / minor) * minor; y <= b.y; y += minor) {
    const major = Math.abs(y - Math.round(y)) < 1e-6;
    out.push(<line key={`y${y.toFixed(2)}`} y1={sy(y)} y2={sy(y)} x1={0} x2={w} class={major ? "gmaj" : "gmin"} />);
  }
  return <g pointer-events="none">{out}</g>;
}

function Selected({ bp, id, sx, sy, dims, zoom }: { bp: Blueprint; id: string; sx: (x: number) => number; sy: (y: number) => number; dims: boolean; zoom: number }) {
  const c = bp.components.find((x) => x.id === id)!;
  const box = componentBounds(bp, c);
  const pad = 8;
  const x0 = sx(box.minX) - pad;
  const x1 = sx(box.maxX) + pad;
  const y0 = sy(box.maxY) - pad;
  const y1 = sy(box.minY) + pad;
  const handles = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];
  const label = (x: number, y: number, t: string) => (
    <text x={x} y={y} class="dimlbl">
      {t}
    </text>
  );
  let dimEls = null;
  if (dims) {
    if (c.kind === "engine") {
      const g = engineGeom(bp, c);
      dimEls = (
        <g>
          {label(x1 + 8, (y0 + y1) / 2, `walls ${g.length.toFixed(2)} m · ${g.flare.toFixed(1)}°`)}
          {label(x0, y1 + 18, `chamber ${g.headWidth.toFixed(2)} · throat ${g.throat.toFixed(2)} m`)}
        </g>
      );
    } else {
      dimEls = (
        <g>
          <line x1={x0 + pad} x2={x1 - pad} y1={y1 + 10} y2={y1 + 10} class="dim" />
          {label((x0 + x1) / 2 - 18, y1 + 26, `${(box.maxX - box.minX).toFixed(2)} m`)}
          <line x1={x1 + 10} x2={x1 + 10} y1={y0 + pad} y2={y1 - pad} class="dim" />
          {label(x1 + 16, (y0 + y1) / 2 + 4, `${(box.maxY - box.minY).toFixed(2)} m`)}
        </g>
      );
    }
  }
  void zoom;
  return (
    <g pointer-events="none">
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="#ffe08a" stroke-width={1.5} stroke-dasharray="6 4" />
      {handles.map(([x, y], i) => (
        <rect key={i} x={x - 4} y={y - 4} width={8} height={8} fill="#0b1430" stroke="#ffe08a" stroke-width={1.5} />
      ))}
      {dimEls}
    </g>
  );
}

/** Controls mode: each engine's throttle as a tag and a plume, and what the controls held do to the ship. */
function Testing({ bp, sx, sy, zoom, com }: { bp: Blueprint; sx: (x: number) => number; sy: (y: number) => number; zoom: number; com: { x: number; y: number } }) {
  const held = testHeld.value;
  const r = response(bp, held);
  const any = Object.keys(held).length > 0;
  return (
    <g pointer-events="none" data-testid="testing">
      {engines(bp).map((e) => {
        const t = r.throttles[e.channel] ?? 0;
        const h = body(bp, e.head);
        const walls = e.walls.map((id) => body(bp, id));
        const exitDepth = walls.length ? Math.max(...walls.flatMap((w) => worldVertices(w).map((p) => -((p.x - h.position.x) * e.dir.x + (p.y - h.position.y) * e.dir.y)))) : 0.2;
        const base = { x: h.position.x - e.dir.x * exitDepth, y: h.position.y - e.dir.y * exitDepth };
        const n = { x: -e.dir.y, y: e.dir.x };
        const w = (h.shape.kind === "box" ? h.shape.width : 0.6) * 0.5;
        const len = 0.25 + 1.4 * t;
        const tip = { x: base.x - e.dir.x * len, y: base.y - e.dir.y * len };
        const tag = { x: h.position.x + (h.position.x >= com.x ? 1 : -1) * ((h.shape.kind === "box" ? h.shape.width / 2 : 0.3) + 0.45), y: h.position.y };
        return (
          <g key={e.head}>
            {t > 0 && (
              <>
                <linearGradient id={`plume-${e.head}`} gradientUnits="userSpaceOnUse" x1={sx(base.x)} y1={sy(base.y)} x2={sx(tip.x)} y2={sy(tip.y)}>
                  <stop offset="0" stop-color="#fff3c0" />
                  <stop offset=".5" stop-color="#ffb35a" />
                  <stop offset="1" stop-color="#ff6a2a" stop-opacity="0" />
                </linearGradient>
                <polygon points={`${sx(base.x + n.x * w)},${sy(base.y + n.y * w)} ${sx(base.x - n.x * w)},${sy(base.y - n.y * w)} ${sx(tip.x)},${sy(tip.y)}`} fill={`url(#plume-${e.head})`} opacity={0.45 + 0.5 * t} />
              </>
            )}
            <g transform={`translate(${sx(tag.x)},${sy(tag.y)})`}>
              <rect x={-30} y={-10} width={60} height={20} rx={2} fill="#0b1430" stroke={t > 0 ? "#ffd36a" : "#5a6890"} />
              <text x={0} y={4} text-anchor="middle" class="tagtxt" fill={t > 0 ? "#ffd36a" : "#93a3c8"}>
                {Math.round(t * 100)}%
              </text>
            </g>
          </g>
        );
      })}
      {any && (Math.abs(r.ahead) > 0.01 || Math.abs(r.side) > 0.01) && (
        <line x1={sx(com.x)} y1={sy(com.y)} x2={sx(com.x) + r.side * 0.04 * zoom} y2={sy(com.y) - r.ahead * 0.04 * zoom} stroke="#7dffb0" stroke-width={3} marker-end="url(#bp-arrg)" />
      )}
      {any && Math.abs(r.turn) > 0.01 && (
        <path d={r.turn < 0 ? `M ${sx(com.x) - 40} ${sy(com.y) - 30} A 50 50 0 0 1 ${sx(com.x) + 40} ${sy(com.y) - 30}` : `M ${sx(com.x) + 40} ${sy(com.y) - 30} A 50 50 0 0 0 ${sx(com.x) - 40} ${sy(com.y) - 30}`} fill="none" stroke="#7dffb0" stroke-width={2.5} marker-end="url(#bp-arrg)" />
      )}
    </g>
  );
}

function Ghost({ pl, sx, sy }: { pl: Placing; sx: (x: number) => number; sy: (y: number) => number }) {
  const at = pl.at!;
  const colour = at.overlap ? "#ff7b7b" : at.touches.length ? "#7dffb0" : "#7fd4ff";
  return (
    <g pointer-events="none" data-testid="ghost" data-state={at.overlap ? "overlap" : at.touches.length ? "weld" : "free"}>
      {pl.made.bodies.map((b) => (
        <polygon
          key={b.id}
          points={worldVertices({ ...b, position: { x: b.position.x + at.dx, y: b.position.y + at.dy } })
            .map((p) => `${sx(p.x)},${sy(p.y)}`)
            .join(" ")}
          fill={colour}
          fill-opacity={0.1}
          stroke={colour}
          stroke-width={2}
          stroke-dasharray="7 5"
        />
      ))}
      {at.guides.map((g, i) => (
        <line key={i} x1={sx(g.a.x)} y1={sy(g.a.y)} x2={sx(g.b.x)} y2={sy(g.b.y)} stroke="#7dffb0" stroke-dasharray="4 4" stroke-width={1.5} opacity={0.8} />
      ))}
      {!at.overlap &&
        at.points.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={7} fill="none" stroke="#7dffb0" stroke-width={2} />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={3} fill="#7dffb0" />
          </g>
        ))}
    </g>
  );
}

function ComMarker({ x, y }: { x: number; y: number }) {
  const r = 10;
  return (
    <g transform={`translate(${x},${y})`} pointer-events="none" data-testid="com">
      <circle r={r} fill="#0b1430" stroke="#fff" stroke-width={1.5} />
      <path d={`M0,-${r} A${r},${r} 0 0 1 ${r},0 L0,0 Z M0,${r} A${r},${r} 0 0 1 -${r},0 L0,0 Z`} fill="#fff" />
      <line x1={-r - 7} x2={-r - 2} stroke="#fff" />
      <line x1={r + 2} x2={r + 7} stroke="#fff" />
      <line y1={-r - 7} y2={-r - 2} stroke="#fff" />
      <line y1={r + 2} y2={r + 7} stroke="#fff" />
    </g>
  );
}

function ScaleBar({ zoom, h }: { zoom: number; h: number }) {
  // A bar of 1, 2 or 5 m (or tenths) about 150 px long.
  const target = 150 / zoom;
  const p = 10 ** Math.floor(Math.log10(target));
  const len = [1, 2, 5, 10].map((k) => k * p).find((m) => m >= target * 0.7) ?? p;
  const px = len * zoom;
  const x = 16;
  const y = h - 30;
  return (
    <g class="scale" pointer-events="none">
      <line x1={x} x2={x + px} y1={y} y2={y} stroke="#e8f0ff" stroke-width={1.5} />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={x + f * px} x2={x + f * px} y1={y - (f % 0.5 === 0 ? 8 : 4)} y2={y} stroke="#e8f0ff" />
      ))}
      <text x={x} y={y + 16}>
        0
      </text>
      <text x={x + px - 6} y={y + 16}>
        {len >= 1 ? len : len.toFixed(1)} m
      </text>
    </g>
  );
}
