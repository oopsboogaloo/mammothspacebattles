// The designer's panels (docs/blueprint/spec.md §2): components, properties, performance, and the
// blueprints drawer.
import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { bodyMass } from "../../core/bodies.ts";
import { NumberControl } from "./NumberControl.tsx";
import { fromShown, shown as show, shownParam } from "./shown.ts";
import { loadsFor } from "./tryLoads.ts";
import { layout, StatsFold } from "./Layout.tsx";
import { measurementOf, measuring, startMeasure } from "./measureClient.ts";
import { measureKey } from "./measure.ts";
import { CockpitControls, LineEditor } from "./Controls.tsx";
import { drop, KIND_COLOUR, placeAt, view } from "./View.tsx";
import { addComponent, allOverlaps, mirrorComponent, muzzles, withoutNewOverlaps, body, channelsOf, component, engines, flipComponent, freeSpot, instantiate, KINDS, params, removeComponent, weldingOf, removeWeld, response, RESPONSE_ROWS, setParam, setWeld, stats, WELD_PRESETS, weldMass, wallOf, weldPresetOpen, weldPresetsFor, welds, worldVertices, type Blueprint, type Kind, type Param, type Tab } from "./model.ts";
import { allBlueprints, baseline, current, drawerOpen, duplicate, edit, endGesture, importBlueprint, live, mine, newBlank, open, parts, placing, presets, preview, remove, rename, say, selection } from "./store.ts";

// ---------- components ----------

interface CatalogueItem {
  kind: Kind;
  name: string;
  from: string; // the preset part it is made from
  /** Made from THRUST OG's part, kept as the game has it (not for the final game's list). */
  og?: boolean;
  /** Where it comes from, if not THRUST 1: the Mastodon, or the parts with no preset (a triangle). */
  tpl?: "mastodon" | "parts";
}

/** What can be added, made from the Thrust 1 preset's parts. */
export const CATALOGUE: CatalogueItem[] = [
  { kind: "cockpit", name: "Cockpit", from: "hull" },
  { kind: "engine", name: "Main thruster", from: "main" },
  { kind: "engine", name: "Light thruster", from: "back-l" },
  { kind: "engine", name: "Double engine", from: "eng-l", tpl: "mastodon" },
  { kind: "tank", name: "Propellant tank", from: "tank-l" },
  { kind: "tank", name: "Trapezoid tank", from: "tank-l", tpl: "mastodon" },
  { kind: "storage", name: "Magazine", from: "mag-l" },
  { kind: "storage", name: "Bullet magazine", from: "mag-l", tpl: "mastodon" },
  { kind: "weapon", name: "Railgun", from: "gun" },
  { kind: "weapon", name: "Gun", from: "gun-l", tpl: "mastodon" },
  { kind: "generator", name: "Generator", from: "gen-l" },
  { kind: "battery", name: "Battery", from: "battery" },
  { kind: "utility", name: "Tractor projector", from: "tractor" },
  { kind: "utility", name: "Tether winch", from: "tether" },
  { kind: "utility", name: "Shield emitter", from: "shield" },
  { kind: "frame", name: "Trapezoid", from: "mount-l", tpl: "mastodon" },
  { kind: "frame", name: "Triangle", from: "triangle", tpl: "parts" },
];
/** The OG parts: Thrust's, from THRUST OG. */
const OG_ITEMS: CatalogueItem[] = CATALOGUE.filter((it) => !it.tpl).map((it) => ({ ...it, name: `${it.name} OG`, og: true }));
const templateOf = (it: CatalogueItem) => (it.tpl === "parts" ? parts : presets.find((p) => p.id === (it.og ? "preset-thrust-og" : it.tpl === "mastodon" ? "preset-mastodon" : "preset-thrust-1")) ?? presets[0]);

/** Adds a part at the nearest free place that welds it to the ship (＋, double-click, Duplicate). */
export function addAtFreeSpot(tpl: Blueprint, from: string, label?: string): void {
  const made = instantiate(current.value, tpl, from, label);
  const spot = freeSpot(current.value, made.bodies, weldingOf(made.comp));
  let welded = false;
  edit((b) => {
    const out = addComponent(b, made, spot.dx, spot.dy);
    welded = out.ship.joints.some((j) => made.comp.bodies.includes(j.a) || made.comp.bodies.includes(j.b));
    return out;
  });
  selection.value = { type: "component", id: made.comp.id };
  if (!welded) say(`${made.comp.label} is placed clear of the ship: there's no free side it fits against. Drag it where it should weld.`);
}

/** Dragging a card from the list onto the blueprint (§3.1). */
function dragFromList(e: PointerEvent, tpl: Blueprint, from: string, label: string): void {
  if (e.button !== 0) return;
  e.preventDefault(); // no text selection while dragging
  const start = { x: e.clientX, y: e.clientY };
  let started = false;
  const move = (m: PointerEvent) => {
    if (!started) {
      if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < 6) return;
      started = true;
      placing.value = { made: instantiate(current.value, tpl, from, label), at: null };
    }
    const w = view.clientToWorld?.(m.clientX, m.clientY);
    const pl = placing.value;
    if (!w || !pl) return;
    if (!w.inside) {
      placing.value = { ...pl, at: null };
      preview.value = null;
      return;
    }
    placing.value = placeAt(pl, w, m.shiftKey);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    const pl = placing.value;
    if (!started || !pl) return;
    if (pl.at) drop(pl);
    else {
      placing.value = null;
      preview.value = null;
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

function Thumb({ bp, ids }: { bp: Blueprint; ids: string[] }) {
  const outlines = ids.map((id) => worldVertices(body(bp, id)));
  const pts = outlines.flat();
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const k = Math.min(52 / Math.max(0.1, maxX - minX), 48 / Math.max(0.1, maxY - minY));
  return (
    <svg class="ico" viewBox="0 0 60 56">
      {outlines.map((o, i) => (
        <polygon key={i} points={o.map((p) => `${30 + (p.x - (minX + maxX) / 2) * k},${28 - (p.y - (minY + maxY) / 2) * k}`).join(" ")} />
      ))}
    </svg>
  );
}

export function ComponentsPanel({ kindIndex, setKind }: { kindIndex: number; setKind: (i: number) => void }) {
  const kind = KINDS[kindIndex];
  const items = [...CATALOGUE, ...OG_ITEMS].filter((c) => c.kind === kind.kind);
  return (
    <section class="panel left" aria-label="Components">
      <header class="ph">
        <span class="phl">COMPONENTS</span>
      </header>
      <div class="typesel">
        <button class="arrow" title="Previous type ([)" aria-label="Previous type" onClick={() => setKind((kindIndex + KINDS.length - 1) % KINDS.length)}>
          ◀
        </button>
        <div class="tname">
          <small>
            TYPE · {kindIndex + 1}/{KINDS.length}
          </small>
          <b data-testid="kind-name">{kind.label.toUpperCase()}</b>
        </div>
        <button class="arrow" title="Next type (])" aria-label="Next type" onClick={() => setKind((kindIndex + 1) % KINDS.length)}>
          ▶
        </button>
      </div>
      <div class="dots" role="tablist">
        {KINDS.map((k, i) => (
          <button key={k.kind} role="tab" aria-selected={i === kindIndex} class={`dot${i === kindIndex ? " on" : ""}`} title={k.label} onClick={() => setKind(i)}>
            {k.short}
          </button>
        ))}
      </div>
      <div class="list" data-testid="catalogue">
        {items.map((it, i) => {
          const preset = templateOf(it);
          const c = preset && component(preset, it.from);
          const b = preset && body(preset, it.from);
          // As it weighs on a ship: with what it holds (shells, propellant).
          const mass = c ? c.bodies.reduce((s, id) => s + bodyMass(body(preset, id) as Parameters<typeof bodyMass>[0]), 0) : 0;
          const firstOg = it.og && !items[i - 1]?.og;
          const f = c?.form;
          const m = (x: number) => +show(x, "m").toFixed(2);
          const size = f ? (f.kind === "trapezoid" ? `${m(f.base)} / ${m(f.top)} × ${m(f.height)} m` : `${m(f.base)} × ${m(f.height)} m`) : b?.shape.kind === "box" ? `${m(b.shape.width)} × ${m(b.shape.height)} m` : "";
          const nHeads = c?.heads?.length ?? 1;
          return (
            <Fragment key={it.name}>
            {firstOg && <div class="og-head" title="The Thrust game's parts as they are, kept for comparison while the regular parts are improved">OG · AS THRUST HAS THEM</div>}
            <div
              class={`card${placing.value && !placing.value.moving && placing.value.made.comp.label.startsWith(it.name.split(" ")[0]) ? " picked" : ""}`}
              data-testid={`card-${it.tpl === "mastodon" ? `m-${it.from}` : it.from}${it.og ? "-og" : ""}`}
              title="Drag onto the blueprint, double-click, or ＋"
              onPointerDown={(e) => !(e.target as HTMLElement).closest("button") && dragFromList(e, preset, it.from, it.name)}
              onDblClick={() => addAtFreeSpot(preset, it.from, it.name)}
            >
              <div class="thumb">{c && <Thumb bp={preset} ids={c.bodies} />}</div>
              <div class="ctext">
                <div class="cname">{it.name}</div>
                <div class="cstat">{size || `${b?.injector ? `${nHeads > 1 ? `${nHeads} × ` : ""}${Math.round(show(b.injector.rate ?? 0, "kg/s"))} kg/s` : ""}`}</div>
                <div class="cstat">{Math.round(show(mass, "kg")).toLocaleString("en-GB")} kg</div>
              </div>
              <button class="add" title="Add to the blueprint" aria-label={`Add ${it.name}`} onClick={() => addAtFreeSpot(preset, it.from, it.name)}>
                ＋
              </button>
            </div>
            </Fragment>
          );
        })}
        {!items.length && <div class="empty">None of these yet.</div>}
      </div>
      <footer class="pf">Drag onto the blueprint · double-click · or ＋</footer>
    </section>
  );
}

// ---------- performance ----------

const n = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");

export function PerformanceBox() {
  // While a part is being placed, what dropping it would do.
  const bp = preview.value ?? current.value;
  const base = baseline.value;
  const st = stats(bp);
  const bs = stats(base);
  const r = (b: Blueprint, s: ReturnType<typeof stats>) => RESPONSE_ROWS.map((row) => response(b, row.controls, s));
  const est = r(bp, st);
  // Measured figures replace the estimates while the blueprint is as it was measured (not while placing).
  const m = preview.value ? null : measurementOf(bp);
  const bm = measurementOf(base);
  const [f, rv, l] = m ? m.map((x) => ({ ahead: x.ahead, turn: x.turn })) : est;
  const [bf, brv, bl] = bm ? bm.map((x) => ({ ahead: x.ahead, turn: x.turn })) : r(base, bs);
  const flow = engines(bp)
    .filter((e) => (response(bp, { forward: 1 }, st).throttles[e.channel] ?? 0) > 0)
    .reduce((s, e) => {
      const inj = body(bp, e.head).injector!;
      return s + (inj.rate ?? 0) / (inj.economy ?? 1);
    }, 0);
  const burn = flow > 0 ? st.propellant / flow : NaN;
  const tag = m ? " ✓" : "";
  const rows: [string, string, number, number][] = [
    ["Mass", `${n(show(st.mass, "kg") / 1000, 2)} t${st.pilot ? ` · ${n(show(st.mass - st.pilot, "kg") / 1000, 2)} t without the pilot` : ""}`, st.mass, bs.mass],
    ["Width × height", `${n(show(st.width, "m"), 1)} × ${n(show(st.height, "m"), 1)} m`, st.width, bs.width],
    ["Accel. forward", `${n(show(f.ahead, "m/s²"))} m/s²${tag}`, f.ahead, bf.ahead],
    ["Accel. reverse", `${n(show(-rv.ahead, "m/s²"))} m/s²${tag}`, -rv.ahead, -brv.ahead],
    ["Turn", `${n(Math.abs(l.turn), 2)} rad/s²${tag}`, Math.abs(l.turn), Math.abs(bl.turn)],
    ["Thrust ÷ mass", `${n(show(f.ahead, "m/s²") / 9.81, 2)} g${tag}`, f.ahead, bf.ahead],
    ["Full-burn time", `${Number.isFinite(burn) ? n(burn, 0) : "—"} s`, burn, burn],
    ["Joins", `${st.welds} welds · ${st.parts} parts`, st.welds, bs.welds],
  ];
  const loose = st.pieces > 1;
  const crossing = allOverlaps(bp);
  // Guns that can't fire: something in front of the muzzle (Chloe, 19 November 2026).
  const blocked = muzzles(bp).filter((m) => m.blocked);
  return (
    <div class="stats" data-testid="performance">
      <div class="sh">
        PERFORMANCE <small>full tanks · {m ? "✓ measured" : "est."}</small>
        <MeasureButton bp={bp} measuredNow={!!m} />
        <StatsFold />
      </div>
      {layout.value.stats && (
      <table>
        <tbody>
          {rows.map(([k, v, now, was]) => {
            const d = now - was;
            const show = Number.isFinite(d) && Math.abs(d) > 1e-6;
            return (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
                <td class={`d ${show ? (d > 0 ? "up" : "down") : ""}`}>{show ? `${d > 0 ? "+" : "−"}${n(Math.abs(d), Math.abs(d) < 1 ? 2 : 1)}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
      {crossing.length > 0 && (
        <div class="warnrow" data-testid="overlapping">
          ▲ Overlapping: {crossing.map(([a, b]) => `${component(bp, a).label} and ${component(bp, b).label}`).join("; ")}. Move one clear.
        </div>
      )}
      {blocked.length > 0 && (
        <div class="warnrow" data-testid="muzzle-blocked">
          ▲ Can't fire: {blocked.map((m) => `${component(bp, m.comp).label}, its muzzle in ${m.blocked === m.comp ? "its own barrel" : component(bp, m.blocked!).label}`).join("; ")}. Clear the way in front of it.
        </div>
      )}
      {loose && (
        <div class="warnrow" data-testid="loose">
          ▲ Not all joined: the ship is in {st.pieces} pieces
        </div>
      )}
    </div>
  );
}

/** Runs the real physics on the blueprint for a few seconds and shows what it does (§7). */
export function MeasureButton({ bp, measuredNow }: { bp: Blueprint; measuredNow: boolean }) {
  const run = measuring.value;
  if (!bp.ship.bodies.length) return null;
  if (run) {
    const mine = run.key === measureKey(bp);
    return (
      <span class="measure busy" data-testid="measuring" role="status">
        {mine ? `Measuring… ${Math.round(run.progress * 100)}%` : "Measuring…"}
      </span>
    );
  }
  return (
    <button class="measure" data-testid="measure" title="Fly it in the real physics for a few seconds, each control held from rest, and show what it really does" onClick={() => startMeasure(current.value)} disabled={!!preview.value}>
      ⏱ {measuredNow ? "Again" : "Measure"}
    </button>
  );
}

/**
 * Components never overlap (§3.2): an edit that would push this one into another is refused, and
 * the page says which part is in the way.
 */
let lastBlocked = "";
function noOverlap(before: Blueprint, after: Blueprint, id: string): Blueprint {
  const r = withoutNewOverlaps(before, after, id);
  if (r.blocked.length) {
    const msg = `That would make ${component(before, id).label} overlap ${r.blocked.map((x) => component(after, x).label).join(" and ")}. Move it clear first.`;
    if (msg !== lastBlocked) say(msg);
    lastBlocked = msg;
  } else lastBlocked = "";
  return r.bp;
}

// ---------- properties ----------

const TAB_NAMES: Record<Tab | "controls", string> = { shape: "SHAPE", fuel: "FUEL", function: "FUNCTION", build: "BUILD", controls: "CONTROLS" };

export function PropertiesPanel() {
  const sel = selection.value;
  return (
    <section class="panel right" aria-label="Properties">
      <header class="ph">
        <span class="phl">PROPERTIES</span>
      </header>
      {!sel && <ShipSummary />}
      {sel?.type === "component" && current.value.components.some((c) => c.id === sel.id) && <ComponentProps id={sel.id} key={sel.id} />}
      {sel?.type === "weld" && <WeldProps id={sel.id} key={sel.id} />}
    </section>
  );
}

function ShipSummary() {
  const bp = current.value;
  const st = stats(bp);
  return (
    <div class="summary">
      <div class="selhead">
        <div>
          <b>{bp.name}</b>
          <small>
            {bp.preset ? "Preset: editing makes a copy" : "Your blueprint"} · {st.parts} parts · {st.welds} welds
          </small>
        </div>
      </div>
      <p class="hint">Click a part to see and change it, or a weld point (the small circles) to see how strong it is.</p>
      <p class="hint">Drag the empty grid to look around; the wheel or a pinch zooms.</p>
    </div>
  );
}

function ComponentProps({ id }: { id: string }) {
  const bp = current.value;
  const c = component(bp, id);
  const ps = params(bp, id);
  const channels = channelsOf(bp, id);
  const wired = c.kind === "cockpit" || channels.length > 0;
  const tabs = [...(["shape", "fuel", "function", "build"] as Tab[]).filter((t) => ps.some((p) => p.tab === t)), ...(wired ? (["controls"] as const) : [])];
  const [tab, setTab] = useState<Tab | "controls">(tabs[0]);
  const showing = tabs.includes(tab) ? tab : tabs[0];
  const shown = ps.filter((p) => p.tab === showing);
  const base = baseline.value.components.some((x) => x.id === id) ? params(baseline.value, id) : null;
  const was = (p: Param) => base?.find((q) => q.key === p.key)?.value;
  const nWelds = welds(bp).filter((w) => w.a === id || w.b === id).length;
  const mass = c.bodies.reduce((s, b) => s + body(bp, b).mass, 0);
  const kindName = KINDS.find((k) => k.kind === c.kind)!.label.replace(/s$/, "").replace(/ie$/, "y");
  return (
    <>
      <div class="selhead">
        <div class="swatch" style={{ background: KIND_COLOUR[c.kind] }} />
        <div>
          <b data-testid="selected-name">{c.label}</b>
          <small>
            {kindName} · {c.bodies.length} {c.bodies.length === 1 ? "part" : "parts"} · {nWelds} {nWelds === 1 ? "weld" : "welds"}
          </small>
        </div>
      </div>
      {tabs.length > 1 && (
        <div class="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={t === showing} class={t === showing ? "on" : ""} onClick={() => setTab(t)}>
              {TAB_NAMES[t]}
            </button>
          ))}
        </div>
      )}
      {showing === "controls" && (
        <div class="fields">
          {c.kind === "cockpit" ? <CockpitControls /> : null}
          {c.kind !== "cockpit" && channels.map((ch) => <LineEditor key={ch} channel={ch} />)}
        </div>
      )}
      <div class="fields" hidden={showing === "controls"}>
        {shown.map((p) => {
          const w = was(p);
          const changed = w !== undefined && Math.abs(w - p.value) > 1e-9;
          // Shown and typed in the game's units (shown.ts); kept in the designer's.
          const sp = shownParam(p);
          return (
            <NumberControl
              key={p.key}
              testid={`param-${p.key}`}
              label={p.label}
              value={sp.value}
              unit={p.unit}
              min={sp.min}
              max={sp.max}
              step={sp.step}
              decimals={sp.decimals}
              readonly={p.readonly}
              note={p.note}
              changed={changed}
              onReset={() => w !== undefined && edit((b) => noOverlap(b, setParam(b, id, p.key, w), id))}
              onLive={(v) => live((b) => noOverlap(b, setParam(b, id, p.key, fromShown(v, p.unit)), id))}
              onEnd={endGesture}
            />
          );
        })}
      </div>
      <div class="derived">
        <div>
          <small>MASS</small>
          <b>{Math.round(show(mass, "kg")).toLocaleString("en-GB")} kg</b>
        </div>
        <div>
          <small>WELDS</small>
          <b>{nWelds}</b>
        </div>
        <div>
          <small>KIND</small>
          <b>{kindName}</b>
        </div>
      </div>
      <div class="actions">
        <button data-testid="duplicate-part" title="Another like it, placed where it welds (Ctrl+D)" onClick={() => addAtFreeSpot(current.value, id)}>
          ⧉ Duplicate
        </button>
        <button
          data-testid="mirror-part"
          title="A mirror image on the other side of the ship's middle line, wired as the mirror of this one (turn left and right swapped)"
          onClick={() => {
            const r = mirrorComponent(current.value, id);
            if ("error" in r) return say(r.error);
            edit(() => r.bp);
            selection.value = { type: "component", id: r.id };
          }}
        >
          ⇋ Mirror
        </button>
        {c.kind === "engine" && (
          <button data-testid="flip-part" title="Turn it round to push the other way" onClick={() => edit((b) => noOverlap(b, flipComponent(b, id), id))}>
            ↕ Flip
          </button>
        )}
        <button
          class="danger"
          data-testid="remove-part"
          onClick={() => {
            edit((b) => removeComponent(b, id));
            selection.value = null;
          }}
        >
          Remove
        </button>
      </div>
    </>
  );
}

function WeldProps({ id }: { id: string }) {
  const bp = current.value;
  const w = welds(bp).find((x) => x.id === id);
  if (!w) return <ShipSummary />;
  const j = w.joints[0];
  const lim = { ...WELD_PRESETS[1].limits, ...j.limits } as Record<"tension" | "compression" | "shear" | "torque", number>;
  const y = j.yield ?? 0;
  const presets = weldPresetsFor(bp, id);
  const preset = presets.find((p) => (Object.keys(p.limits) as (keyof typeof lim)[]).every((k) => Math.abs(p.limits[k]! - lim[k]) < 1e-6) && Math.abs(p.yield - y) < 1e-9);
  const a = component(bp, w.a);
  const b = component(bp, w.b);
  const pts = w.joints.length;
  const og = !!(a.part?.endsWith("_og") || b.part?.endsWith("_og"));
  const weldKg = w.joints.reduce((sum, jj) => sum + weldMass(jj, Math.min(wallOf(a), wallOf(b))), 0);
  const flown = loadsFor(bp)?.[id] ?? null;
  const weakest = (["tension", "shear", "torque"] as const).reduce((p, k) => (lim[k] / (k === "torque" ? 0.5 : 1) < lim[p] / (p === "torque" ? 0.5 : 1) ? k : p), "tension" as "tension" | "shear" | "torque");
  const field = (key: keyof typeof lim, label: string, unit: string) => (
    <NumberControl key={key} label={label} {...shownParam({ value: lim[key], min: 100, max: 200000, step: 50, decimals: 0, unit })} onLive={(v) => live((bb) => setWeld(bb, id, { [key]: fromShown(v, unit) }))} onEnd={endGesture} />
  );
  return (
    <>
      <div class="selhead">
        <div class="swatch weld" />
        <div>
          <b data-testid="selected-name">
            Weld · {a.label} ↔ {b.label}
          </b>
          <small>
            {pts} weld {pts === 1 ? "point" : "points"}
          </small>
        </div>
      </div>
      <div class="joins">
        <button class="chip" style={{ "--c": KIND_COLOUR[a.kind] }} onClick={() => (selection.value = { type: "component", id: a.id })}>
          {a.label} ↗
        </button>
        <span>↔</span>
        <button class="chip" style={{ "--c": KIND_COLOUR[b.kind] }} onClick={() => (selection.value = { type: "component", id: b.id })}>
          {b.label} ↗
        </button>
      </div>
      <div class="seg">
        <span>Strength</span>
        {presets.map((p) => (
          <button
            key={p.name}
            class={preset?.name === p.name ? "on" : ""}
            disabled={!og && !weldPresetOpen(bp, p.quality).open}
            title={og ? undefined : weldPresetOpen(bp, p.quality).why}
            data-testid={`weld-preset-${p.name.toLowerCase()}`}
            onClick={() => edit((bb) => setWeld(bb, id, p.limits, p.yield))}
          >
            {p.name}
            {!og && <small> {show(pts * weldMass({ ...j, limits: p.limits }, Math.min(wallOf(a), wallOf(b))), "kg").toFixed(1)} kg</small>}
          </button>
        ))}
        <button class={preset ? "" : "on"} disabled>
          Custom
        </button>
      </div>
      <div class="fields">
        {field("tension", "Tension limit", "N")}
        {field("compression", "Compression limit", "N")}
        {field("shear", "Shear limit", "N")}
        {field("torque", "Torque limit", "N·m")}
        <NumberControl label="Yield (bends before it breaks)" unit="" value={y} min={0} max={0.95} step={0.05} decimals={2} onLive={(v) => live((bb) => setWeld(bb, id, {}, v))} onEnd={endGesture} />
      </div>
      <div class="derived">
        <div>
          <small>WEAKEST WAY</small>
          <b>{weakest[0].toUpperCase() + weakest.slice(1)}</b>
        </div>
        <div>
          <small>POINTS</small>
          <b>{pts}</b>
        </div>
        <div>
          <small>WEIGHS</small>
          <b data-testid="weld-mass" title={og ? "A weld on an OG part is free, as in Thrust" : "A fillet bead of the walls' own material: Light 0.25×, Heavy 4× a Standard weld's mass, for half or twice its strength"}>
            {og ? "— (OG)" : `${show(weldKg, "kg").toFixed(1)} kg`}
          </b>
        </div>
        <div>
          <small>LAST TRY-OUT</small>
          <b data-testid="weld-load" class={flown ? (flown.broke ? "bad" : flown.peak >= 0.8 ? "hot" : flown.peak >= 0.5 ? "warm" : "") : ""} title={flown ? `Its hardest load in the last try-out: ${Math.round(flown.peak * 100)}% of its limit, in ${flown.kind}` : "Fly it with Try it to see how hard each weld works"}>
            {flown ? (flown.broke ? "BROKE" : `${Math.round(flown.peak * 100)}% ${flown.kind}`) : "— (try it)"}
          </b>
        </div>
      </div>
      <div class="actions">
        <button
          class="danger"
          onClick={() => {
            edit((bb) => removeWeld(bb, id));
            selection.value = null;
          }}
        >
          Remove weld
        </button>
      </div>
    </>
  );
}

// ---------- blueprints drawer ----------

function ShipThumb({ bp }: { bp: Blueprint }) {
  if (!bp.ship.bodies.length) return <div class="nothumb">empty</div>;
  const outlines = bp.ship.bodies.map(worldVertices);
  const pts = outlines.flat();
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const k = Math.min(108 / (maxX - minX), 60 / (maxY - minY));
  return (
    <svg width={120} height={70}>
      {bp.ship.bodies.map((b, i) => {
        const c = bp.components.find((x) => x.bodies.includes(b.id));
        const col = c ? KIND_COLOUR[c.kind] : "#e8f0ff";
        return <polygon key={b.id} points={outlines[i].map((p) => `${60 + (p.x - (minX + maxX) / 2) * k},${35 - (p.y - (minY + maxY) / 2) * k}`).join(" ")} fill={col} fill-opacity={0.2} stroke={col} stroke-width={0.8} />;
      })}
    </svg>
  );
}

export function BlueprintsDrawer() {
  const [filter, setFilter] = useState<"all" | "mine" | "presets">("all");
  const [renaming, setRenaming] = useState<string | null>(null);
  const cur = current.value;
  const list = allBlueprints().filter((b) => (filter === "all" ? true : filter === "mine" ? !b.preset : b.preset));
  const close = () => (drawerOpen.value = false);
  const exportIt = () => {
    const blob = new Blob([JSON.stringify(cur, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cur.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.blueprint.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importIt = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const problem = importBlueprint(await f.text());
      if (problem) say(problem);
      else close();
    };
    input.click();
  };
  return (
    <>
      <div class="scrim" onClick={close} />
      <div class="drawer" role="dialog" aria-label="Blueprints" data-testid="drawer">
        <header class="ph">
          <span class="phl">BLUEPRINTS</span>
          <button class="ib sm" title="Close (Esc)" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        <div class="dtools">
          <button
            class="primary"
            onClick={() => {
              newBlank();
              close();
            }}
          >
            ＋ New blank
          </button>
          <button
            data-testid="duplicate"
            onClick={() => {
              const c = duplicate(cur);
              open(c.id);
              say(`Made ${c.name}.`);
            }}
          >
            ⧉ Duplicate
          </button>
          <button disabled={!!cur.preset} onClick={() => setRenaming(cur.id)}>
            ✎ Rename
          </button>
          <button onClick={exportIt}>⤓ Export</button>
          <button onClick={importIt}>⤒ Import</button>
          <button
            class="danger"
            disabled={!!cur.preset}
            title="Delete this blueprint"
            onClick={() => {
              if (confirm(`Delete ${cur.name}? This can't be undone.`)) remove(cur.id);
            }}
          >
            🗑 Delete
          </button>
        </div>
        <div class="dfilter">
          {(["all", "mine", "presets"] as const).map((f) => (
            <button key={f} class={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? `All ${presets.length + mine.value.length}` : f === "mine" ? `Mine ${mine.value.length}` : `Presets ${presets.length}`}
            </button>
          ))}
        </div>
        <div class="dlist">
          {list.map((b) => {
            const st = stats(b);
            const fwd = response(b, { forward: 1 }, st).ahead;
            return (
              <div
                key={b.id}
                class={`dcard${b.id === cur.id ? " cur" : ""}`}
                role="button"
                tabIndex={0}
                data-testid={`design-${b.name}`}
                onClick={() => {
                  open(b.id);
                  close();
                }}
              >
                <ShipThumb bp={b} />
                <div class="dt">
                  {renaming === b.id ? (
                    <input
                      class="rename"
                      value={b.name}
                      ref={(el) => el?.focus()}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={(e) => {
                        rename(b.id, (e.currentTarget as HTMLInputElement).value);
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <b>{b.name}</b>
                  )}
                  <small>{b.preset ? "🔒 Preset" : `Yours · rev ${b.rev}`}</small>
                  <small>
                    {(show(st.mass, "kg") / 1000).toFixed(1)} t · {show(fwd, "m/s²").toFixed(1)} m/s² · {b.components.filter((c) => c.kind === "engine").length} engines
                  </small>
                </div>
              </div>
            );
          })}
        </div>
        <footer class="pf">Presets can't be changed: editing one makes a copy · Kept in this browser · Export for a file</footer>
      </div>
    </>
  );
}

export type { Param };
