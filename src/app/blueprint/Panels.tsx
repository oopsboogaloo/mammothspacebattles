// The designer's panels (docs/blueprint/spec.md §2): components, properties, performance, and the
// blueprints drawer.
import { useState } from "preact/hooks";
import { NumberControl } from "./NumberControl.tsx";
import { KIND_COLOUR } from "./View.tsx";
import { body, component, engines, KINDS, params, removeComponent, removeWeld, response, RESPONSE_ROWS, setParam, setWeld, stats, WELD_PRESETS, welds, worldVertices, type Blueprint, type Kind, type Param, type Tab } from "./model.ts";
import { allBlueprints, baseline, current, drawerOpen, duplicate, edit, endGesture, importBlueprint, live, mine, newBlank, open, presets, remove, rename, say, selection } from "./store.ts";

// ---------- components ----------

interface CatalogueItem {
  kind: Kind;
  name: string;
  from: string; // the preset part it is made from
}

/** What can be added, made from the Thrust 1 preset's parts. */
export const CATALOGUE: CatalogueItem[] = [
  { kind: "cockpit", name: "Cockpit", from: "hull" },
  { kind: "engine", name: "Main thruster", from: "main" },
  { kind: "engine", name: "Light thruster", from: "back-l" },
  { kind: "tank", name: "Propellant tank", from: "tank-l" },
  { kind: "storage", name: "Magazine", from: "mag-l" },
  { kind: "weapon", name: "Railgun", from: "gun" },
  { kind: "generator", name: "Generator", from: "gen-l" },
  { kind: "battery", name: "Battery", from: "battery" },
  { kind: "utility", name: "Tractor projector", from: "tractor" },
  { kind: "utility", name: "Tether winch", from: "tether" },
  { kind: "utility", name: "Shield emitter", from: "shield" },
];

export const pickedKind = { value: 1 };

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
  const preset = presets[0];
  const kind = KINDS[kindIndex];
  const items = CATALOGUE.filter((c) => c.kind === kind.kind);
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
        {items.map((it) => {
          const c = preset && component(preset, it.from);
          const b = preset && body(preset, it.from);
          const mass = c ? c.bodies.reduce((s, id) => s + body(preset, id).mass, 0) : 0;
          const size = b?.shape.kind === "box" ? `${b.shape.width} × ${b.shape.height} m` : "";
          return (
            <div class="card" key={it.name}>
              <div class="thumb">{c && <Thumb bp={preset} ids={c.bodies} />}</div>
              <div class="ctext">
                <div class="cname">{it.name}</div>
                <div class="cstat">{size || `${b?.injector ? `${b.injector.rate} kg/s` : ""}`}</div>
                <div class="cstat">{mass.toFixed(2)} kg</div>
              </div>
              <button class="add" title="Add to the blueprint" aria-label={`Add ${it.name}`} onClick={() => say("Adding parts (＋, drag or double-click) comes in the next build stage.")}>
                ＋
              </button>
            </div>
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
  const bp = current.value;
  const base = baseline.value;
  const st = stats(bp);
  const bs = stats(base);
  const r = (b: Blueprint, s: ReturnType<typeof stats>) => RESPONSE_ROWS.map((row) => response(b, row.controls, s));
  const [f, rv, l] = r(bp, st);
  const [bf, brv, bl] = r(base, bs);
  const flow = engines(bp)
    .filter((e) => (response(bp, { forward: 1 }, st).throttles[e.id] ?? 0) > 0)
    .reduce((s, e) => {
      const inj = body(bp, e.id).injector!;
      return s + (inj.rate ?? 0) / (inj.economy ?? 1);
    }, 0);
  const burn = flow > 0 ? st.propellant / flow : NaN;
  const rows: [string, string, number, number][] = [
    ["Mass", `${n(st.mass)} kg`, st.mass, bs.mass],
    ["Width × height", `${n(st.width, 2)} × ${n(st.height, 2)} m`, st.width, bs.width],
    ["Accel. forward", `${n(f.ahead)} m/s²`, f.ahead, bf.ahead],
    ["Accel. reverse", `${n(-rv.ahead)} m/s²`, -rv.ahead, -brv.ahead],
    ["Turn", `${n(Math.abs(l.turn), 2)} rad/s²`, Math.abs(l.turn), Math.abs(bl.turn)],
    ["Thrust ÷ mass", `${n(f.ahead / 9.81, 2)} g`, f.ahead, bf.ahead],
    ["Full-burn time", `${Number.isFinite(burn) ? n(burn, 0) : "—"} s`, burn, burn],
    ["Joins", `${st.welds} welds · ${st.parts} parts`, st.welds, bs.welds],
  ];
  return (
    <div class="stats" data-testid="performance">
      <div class="sh">
        PERFORMANCE <small>full tanks · est.</small>
      </div>
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
    </div>
  );
}

// ---------- properties ----------

const TAB_NAMES: Record<Tab, string> = { shape: "SHAPE", fuel: "FUEL", function: "FUNCTION", build: "BUILD" };

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
  const tabs = (["shape", "fuel", "function", "build"] as Tab[]).filter((t) => ps.some((p) => p.tab === t));
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const shown = ps.filter((p) => p.tab === (tabs.includes(tab) ? tab : tabs[0]));
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
            <button key={t} role="tab" aria-selected={t === tab} class={t === tab ? "on" : ""} onClick={() => setTab(t)}>
              {TAB_NAMES[t]}
            </button>
          ))}
        </div>
      )}
      <div class="fields">
        {shown.map((p) => {
          const w = was(p);
          const changed = w !== undefined && Math.abs(w - p.value) > 1e-9;
          return (
            <NumberControl
              key={p.key}
              testid={`param-${p.key}`}
              label={p.label}
              value={p.value}
              unit={p.unit}
              min={p.min}
              max={p.max}
              step={p.step}
              decimals={p.decimals}
              readonly={p.readonly}
              note={p.note}
              changed={changed}
              onReset={() => w !== undefined && edit((b) => setParam(b, id, p.key, w))}
              onLive={(v) => live((b) => setParam(b, id, p.key, v))}
              onEnd={endGesture}
            />
          );
        })}
      </div>
      <div class="derived">
        <div>
          <small>MASS</small>
          <b>{mass.toFixed(2)} kg</b>
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
  const preset = WELD_PRESETS.find((p) => (Object.keys(p.limits) as (keyof typeof lim)[]).every((k) => Math.abs(p.limits[k]! - lim[k]) < 1e-6) && Math.abs(p.yield - y) < 1e-9);
  const a = component(bp, w.a);
  const b = component(bp, w.b);
  const pts = w.joints.length;
  const weakest = (["tension", "shear", "torque"] as const).reduce((p, k) => (lim[k] / (k === "torque" ? 0.5 : 1) < lim[p] / (p === "torque" ? 0.5 : 1) ? k : p), "tension" as "tension" | "shear" | "torque");
  const field = (key: keyof typeof lim, label: string, unit: string) => (
    <NumberControl key={key} label={label} unit={unit} value={lim[key]} min={100} max={200000} step={50} decimals={0} onLive={(v) => live((bb) => setWeld(bb, id, { [key]: v }))} onEnd={endGesture} />
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
        {WELD_PRESETS.map((p) => (
          <button key={p.name} class={preset?.name === p.name ? "on" : ""} onClick={() => edit((bb) => setWeld(bb, id, p.limits, p.yield))}>
            {p.name}
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
          <small>LIVE LOAD</small>
          <b>— (try it)</b>
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
                    {st.mass.toFixed(1)} kg · {fwd.toFixed(1)} m/s² · {b.components.filter((c) => c.kind === "engine").length} engines
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
