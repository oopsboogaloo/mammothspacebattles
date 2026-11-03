import { useEffect, useRef, useState } from "preact/hooks";
import { assemblyProps, bodyMass, controlInputs, cross, dot, length, massProps, type Body, type Joint, type Shape, type Store } from "../core/index.ts";
import { assemblyIds, makePrefab } from "./ports.ts";
import { deg, fmt, rad } from "./format.ts";
import { NumberField } from "./NumberField.tsx";
import { Icon } from "./icons.tsx";
import {
  ACTIONS,
  achieved,
  action,
  bindingFor,
  bindings,
  freshId,
  prefabs,
  showToast,
  collapsed,
  drawerOpen,
  edit,
  graphWindow,
  jumpTo,
  persist,
  playing,
  SCALE_BUTTONS,
  sandbox,
  scaleLabel,
  selection,
  setParameter,
  sheet,
  spawnKind,
  timeScale,
  tool,
  TOOLS,
  version,
  violationsOpen,
  visibleSeries,
  type SpawnKind,
} from "./state.ts";

const shortcut = (id: string) => ACTIONS.find((a) => a.id === id)?.keys;
const tip = (label: string, id: string) => (shortcut(id) ? `${label} (${shortcut(id)})` : label);

export function TopBar() {
  void version.value;
  const sb = sandbox.value!;
  const title = String(sb.scenario.title ?? sb.scenario.name);
  const violations = sb.world.ledger.violations;
  const a = achieved.value;
  return (
    <header class="topbar">
      <button class="btn" onClick={() => action("scenarios").run()} title="Back to scenarios" data-testid="scenarios">
        <Icon name="menu" />
        <span>{title}</span>
        {sb.dirty && <span class="muted" title="Unsaved changes">●</span>}
      </button>
      <div class="group" role="group" aria-label="Time controls">
        <button class="btn icon-btn" onClick={() => action("reset").run()} aria-label="Reset to start" title={tip("Reset to start", "reset")} data-testid="reset">
          <Icon name="reset" />
        </button>
        <button class="btn primary icon-btn" onClick={() => action("play").run()} aria-label={playing.value ? "Pause" : "Play"} title={tip(playing.value ? "Pause" : "Play", "play")} data-testid="play">
          <Icon name={playing.value ? "pause" : "play"} />
        </button>
        <button class="btn icon-btn" onClick={() => action("step").run()} aria-label="Step one tick" title={tip("Step one tick", "step")} data-testid="step">
          <Icon name="step" />
        </button>
        <button class="btn small" onClick={() => action("step10").run()} aria-label="Step 10 ticks" title={tip("Step 10 ticks", "step10")} data-testid="step10">
          +10
        </button>
      </div>
      <div class="seg" role="group" aria-label="Time scale" title="Time scale ([ and ])">
        {SCALE_BUTTONS.map((s) => (
          <button key={s} aria-pressed={timeScale.value === s} onClick={() => (timeScale.value = s)} data-testid={`scale-${s}`}>
            {scaleLabel(s)}
          </button>
        ))}
      </div>
      <div class="clock">
        <span>
          t = <b data-testid="sim-time">{sb.world.time.toFixed(3)} s</b>
        </span>
        <span class="wide">
          tick <b data-testid="tick">{sb.world.tick}</b>
        </span>
        <span class={playing.value && a.behind ? "behind" : ""} data-testid="achieved" title="Achieved simulation speed (SBX-005)">
          {playing.value ? `speed ${a.scale.toFixed(2)}×${a.behind ? " (can't keep up)" : ""}` : "paused"}
        </span>
      </div>
      <div class="spacer" />
      <div class="group wide">
        <button class="btn icon-btn" disabled={!sb.canUndo} onClick={() => action("undo").run()} aria-label="Undo" title={sb.undoLabel ? `Undo ${sb.undoLabel} (Ctrl+Z)` : "Nothing to undo"} data-testid="undo">
          <Icon name="undo" />
        </button>
        <button class="btn icon-btn" disabled={!sb.canRedo} onClick={() => action("redo").run()} aria-label="Redo" title={sb.redoLabel ? `Redo ${sb.redoLabel} (Ctrl+Shift+Z)` : "Nothing to redo"} data-testid="redo">
          <Icon name="redo" />
        </button>
        <button class="btn" onClick={() => action("save").run()} title="Save scenario file (Ctrl+S)" data-testid="save">
          Save
        </button>
      </div>
      <button class={`badge ${violations ? "alert" : ""}`} onClick={() => (violationsOpen.value = !violationsOpen.value)} title="Conservation violations — click to list and jump" data-testid="violations">
        <Icon name="warn" />
        <span>
          {violations} violation{violations === 1 ? "" : "s"}
        </span>
      </button>
      <button class="btn wide" onClick={() => action("palette").run()} title="Command palette (Ctrl+K)" data-testid="open-palette">
        <Icon name="search" />
        Commands <span class="kbd">Ctrl K</span>
      </button>
    </header>
  );
}

export function ToolRail() {
  return (
    <nav class="rail" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          aria-pressed={tool.value === t.id}
          aria-label={t.label}
          title={t.disabled ? `${t.label} — ${t.disabled}` : `${t.label} (${t.key})`}
          disabled={!!t.disabled}
          onClick={() => (tool.value = t.id)}
          data-testid={`tool-${t.id}`}
        >
          <Icon name={t.id} />
        </button>
      ))}
    </nav>
  );
}

const PALETTE: { kind: SpawnKind; label: string; detail: string }[] = [
  { kind: "disc", label: "Disc", detail: "0.5 m radius · 1 kg" },
  { kind: "box", label: "Box", detail: "1 × 1 m · 1 kg" },
  { kind: "plank", label: "Plank", detail: "3 × 0.2 m · 2 kg" },
  { kind: "triangle", label: "Triangle", detail: "convex polygon · 1 kg" },
  { kind: "hexagon", label: "Hexagon", detail: "convex polygon · 1.5 kg" },
  { kind: "wall", label: "Wall (fixed)", detail: "4 × 0.4 m · never moves" },
];

export function SpawnPalette() {
  const [q, setQ] = useState("");
  const items = PALETTE.filter((p) => `${p.label} ${p.detail}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside class="flyout" aria-label="Spawn palette">
      <div class="muted" style={{ fontSize: "12px", letterSpacing: "0.08em" }}>
        BODIES
      </div>
      <input type="search" placeholder="Search" aria-label="Search bodies" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} data-testid="palette-search" />
      {items.map((p) => (
        <button key={p.kind} class="palette-item" aria-pressed={spawnKind.value === p.kind} onClick={() => (spawnKind.value = p.kind)} data-testid={`spawn-${p.kind}`}>
          <span>
            {p.label}
            <small>{p.detail}</small>
          </span>
        </button>
      ))}
      {items.length === 0 && <div class="muted">No bodies match "{q}".</div>}
      <div class="muted" style={{ fontSize: "12px", letterSpacing: "0.08em", marginTop: "8px" }}>
        PREFABS
      </div>
      {prefabs.value.length === 0 && (
        <div class="muted" style={{ fontSize: "12px" }}>
          None yet. Right-click an assembly and choose "Save as prefab".
        </div>
      )}
      {prefabs.value
        .map((pf, i) => ({ pf, i }))
        .filter(({ pf }) => pf.name.toLowerCase().includes(q.toLowerCase()))
        .map(({ pf, i }) => (
          <div key={i} style={{ display: "flex", gap: "4px" }}>
            <button class="palette-item" style={{ flex: 1 }} aria-pressed={spawnKind.value === `prefab:${i}`} onClick={() => (spawnKind.value = `prefab:${i}`)} data-testid={`prefab-${i}`}>
              <span>
                {pf.name}
                <small>
                  {pf.bodies.length} parts · {pf.joints.length} joints
                </small>
              </span>
            </button>
            <button
              class="btn small ghost"
              aria-label={`Delete prefab ${pf.name}`}
              onClick={() => {
                prefabs.value = prefabs.value.filter((_, k) => k !== i);
                if (spawnKind.value === `prefab:${i}`) spawnKind.value = "disc";
                persist();
              }}
            >
              ✕
            </button>
          </div>
        ))}
      <div class="muted" style={{ fontSize: "12px" }}>
        Components with functions (tanks, thrusters, cannons) arrive in M4–M6.
      </div>
    </aside>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: preact.ComponentChildren }) {
  const closed = !!collapsed.value[id];
  return (
    <section class="section">
      <h3>
        <button
          aria-expanded={!closed}
          onClick={() => {
            collapsed.value = { ...collapsed.value, [id]: !closed };
            persist();
          }}
          data-testid={`section-${id}`}
        >
          <span>{title.toUpperCase()}</span>
          <span aria-hidden="true">{closed ? "+" : "−"}</span>
        </button>
      </h3>
      {!closed && <div class="content">{children}</div>}
    </section>
  );
}

const Row = ({ k, v, title }: { k: string; v: string; title?: string }) => (
  <div class="row" title={title}>
    <span class="muted">{k}</span>
    <span class="value">{v}</span>
  </div>
);

/** One value if every selected body agrees, else "mixed" (INS-005). */
function shared(bodies: Body[], get: (b: Body) => number): number | "mixed" {
  const v = get(bodies[0]);
  return bodies.every((b) => get(b) === v) ? v : "mixed";
}

const positive = (v: number) => (v > 0 ? null : "Must be greater than 0");
const unit01 = (v: number) => (v >= 0 && v <= 1 ? null : "Must be between 0 and 1");
const nonNegative = (v: number) => (v >= 0 ? null : "Must be 0 or more");

function BodyInspector({ bodies }: { bodies: Body[] }) {
  // Signals skip re-rendering components whose props are unchanged; the body object is mutated in place.
  void version.value;
  const one = bodies.length === 1 ? bodies[0] : null;
  const set = (label: string, patch: (b: Body, v: number) => Partial<Body>) => (v: number) =>
    edit(bodies.map((b) => ({ type: "body.set", id: b.id, patch: patch(b, v) })), bodies.length > 1 ? `${label} (${bodies.length} bodies)` : `${label} ${bodies[0].id}`);
  const kinds = new Set(bodies.map((b) => b.shape.kind));
  const kind = kinds.size === 1 ? bodies[0].shape.kind : null;
  const mp = one ? massProps(one.shape, bodyMass(one)) : null;
  const shapeSet = (field: "radius" | "width" | "height") => (v: number) =>
    edit(
      bodies.map((b) => ({ type: "body.set", id: b.id, patch: { shape: { ...b.shape, [field]: v } as Shape } })),
      `Resize ${bodies.length > 1 ? `${bodies.length} bodies` : bodies[0].id}`,
    );
  const sb = sandbox.value!;
  return (
    <>
      <Section id="identity" title="Identity">
        <Row k="Id" v={one ? one.id : `${bodies.length} selected`} />
        <Row k="Type" v={kind ?? "mixed"} />
      </Section>
      <Section id="shape" title="Shape">
        {kind === "disc" && <NumberField id="radius" label="Radius" unit="m" step={0.05} value={shared(bodies, (b) => (b.shape as { radius: number }).radius)} validate={positive} onCommit={shapeSet("radius")} />}
        {kind === "box" && (
          <>
            <NumberField id="width" label="Width" unit="m" step={0.05} value={shared(bodies, (b) => (b.shape as { width: number }).width)} validate={positive} onCommit={shapeSet("width")} />
            <NumberField id="height" label="Height" unit="m" step={0.05} value={shared(bodies, (b) => (b.shape as { height: number }).height)} validate={positive} onCommit={shapeSet("height")} />
          </>
        )}
        {kind === "polygon" && one && <Row k="Vertices" v={String((one.shape as { vertices: unknown[] }).vertices.length)} />}
        {mp && <Row k="Area (derived)" v={fmt(mp.area, "m²")} title="Derived from the shape's dimensions." />}
      </Section>
      <Section id="material" title="Material">
        <NumberField id="mass" label={bodies.some((b) => b.contents?.length) ? "Dry mass" : "Mass"} unit="kg" step={0.1} value={shared(bodies, (b) => b.mass)} validate={positive} onCommit={set("Set mass", (_b, v) => ({ mass: v }))} />
        {one && one.contents?.length ? <Row k="Total mass (derived)" v={fmt(bodyMass(one), "kg")} title="Dry mass plus everything in its stores." /> : null}
        {one && mp && <Row k="Density (derived)" v={fmt(bodyMass(one) / mp.area, "kg/m²")} title="Total mass ÷ area. Change the mass, contents or shape to change it." />}
        {one && mp && <Row k="Moment of inertia (derived)" v={fmt(mp.inertia, "kg·m²")} title="From mass and shape, assuming uniform density." />}
        <NumberField id="restitution" label="Restitution" step={0.05} value={shared(bodies, (b) => b.restitution)} validate={unit01} onCommit={set("Set restitution", (_b, v) => ({ restitution: v }))} />
        <NumberField id="friction" label="Friction" step={0.05} value={shared(bodies, (b) => b.friction)} validate={nonNegative} onCommit={set("Set friction", (_b, v) => ({ friction: v }))} />
        <label class="row">
          <span class="muted">Fixed (never moves)</span>
          <input
            type="checkbox"
            data-testid="field-fixed"
            checked={bodies.every((b) => b.fixed)}
            ref={(el) => {
              if (el) el.indeterminate = !bodies.every((b) => b.fixed) && bodies.some((b) => b.fixed);
            }}
            onChange={(e) => {
              const fixed = (e.currentTarget as HTMLInputElement).checked;
              edit(bodies.map((b) => ({ type: "body.set", id: b.id, patch: { fixed } })), fixed ? "Make fixed" : "Make free");
            }}
          />
        </label>
      </Section>
      <Section id="motion" title="Motion">
        <NumberField id="px" label="Position x" unit="m" value={shared(bodies, (b) => b.position.x)} onCommit={set("Move", (b, v) => ({ position: { x: v, y: b.position.y } }))} />
        <NumberField id="py" label="Position y" unit="m" value={shared(bodies, (b) => b.position.y)} onCommit={set("Move", (b, v) => ({ position: { x: b.position.x, y: v } }))} />
        <NumberField id="angle" label="Angle" unit="°" step={1} decimals={2} value={shared(bodies, (b) => deg(b.angle))} onCommit={set("Rotate", (_b, v) => ({ angle: rad(v) }))} />
        <NumberField id="vx" label="Velocity x" unit="m/s" value={shared(bodies, (b) => b.velocity.x)} onCommit={set("Set velocity", (b, v) => ({ velocity: { x: v, y: b.velocity.y } }))} />
        <NumberField id="vy" label="Velocity y" unit="m/s" value={shared(bodies, (b) => b.velocity.y)} onCommit={set("Set velocity", (b, v) => ({ velocity: { x: b.velocity.x, y: v } }))} />
        <NumberField id="w" label="Spin" unit="rad/s" value={shared(bodies, (b) => b.angularVelocity)} onCommit={set("Set spin", (_b, v) => ({ angularVelocity: v }))} />
      </Section>
      {one ? (
        <>
          <AssemblySection body={one} />
          <JointsSection body={one} />
          <ContentsSection body={one} />
          <LinksSection body={one} />
        </>
      ) : (
        <Section id="assembly" title="Assembly">
          <span class="muted">Select one body to see its assembly, joints, contents and links.</span>
        </Section>
      )}
      {one && mp && (
        <Section id="live" title="Live values">
          <Row k="Speed" v={fmt(length(one.velocity), "m/s")} />
          <Row k="Kinetic energy" v={fmt(0.5 * bodyMass(one) * dot(one.velocity, one.velocity) + 0.5 * mp.inertia * one.angularVelocity ** 2, "J")} />
          <Row k="Momentum" v={fmt(bodyMass(one) * length(one.velocity), "kg·m/s")} />
          <Row k="Angular momentum (origin)" v={fmt(bodyMass(one) * cross(one.position, one.velocity) + mp.inertia * one.angularVelocity, "kg·m²/s")} />
          <Row k="Contacts now" v={String(sb.world.contacts.filter((c) => (c.a === one.id || c.b === one.id) && c.normalImpulse > 0).length)} />
        </Section>
      )}
    </>
  );
}

function AssemblySection({ body }: { body: Body }) {
  // Signals skip re-rendering components whose props are unchanged; the body object is mutated in place.
  void version.value;
  const sb = sandbox.value!;
  const ids = assemblyIds(sb.world, body.id);
  if (ids.length < 2)
    return (
      <Section id="assembly" title="Assembly">
        <span class="muted">Not attached to anything. Use the Attach tool (A) to weld parts to it.</span>
      </Section>
    );
  const members = ids.map((id) => sb.world.bodies.find((b) => b.id === id)!);
  const fixed = members.some((b) => b.fixed);
  const p = assemblyProps(members.map((b) => ({ mass: bodyMass(b), inertia: massProps(b.shape, bodyMass(b)).inertia, position: b.position })));
  return (
    <Section id="assembly" title="Assembly">
      <Row k="Parts" v={String(p.count)} title={ids.join(", ")} />
      <Row k="Total mass" v={fmt(p.mass, "kg")} />
      <Row k="Centre of mass" v={`${p.centreOfMass.x.toFixed(3)}, ${p.centreOfMass.y.toFixed(3)} m`} />
      <Row k="Moment of inertia" v={fmt(p.inertia, "kg·m²")} title="About the assembly's centre of mass: each part's own inertia plus mass × distance² (parallel axis theorem)." />
      {fixed && <span class="muted">Anchored to a fixed body.</span>}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        <button class="btn small" onClick={() => edit([{ type: "body.detach", id: body.id }], `Detach ${body.id}`)} data-testid="detach">
          Detach this part
        </button>
        <button class="btn small" onClick={() => savePrefab(body.id)} data-testid="save-prefab">
          Save as prefab
        </button>
      </div>
    </Section>
  );
}

export function savePrefab(id: string): void {
  const sb = sandbox.value;
  if (!sb) return;
  const name = `Prefab ${prefabs.value.length + 1} (${assemblyIds(sb.world, id).length} parts)`;
  prefabs.value = [...prefabs.value, makePrefab(sb.world, id, name)];
  persist();
  showToast(`Saved "${name}". Pick it in the Spawn palette (S) to place copies.`);
}

const LIMIT_FIELDS: { k: keyof Joint["limits"]; label: string; unit: string }[] = [
  { k: "tension", label: "Tension limit", unit: "N" },
  { k: "compression", label: "Compression limit", unit: "N" },
  { k: "shear", label: "Shear limit", unit: "N" },
  { k: "torque", label: "Torque limit", unit: "N·m" },
];

function JointsSection({ body }: { body: Body }) {
  // Signals skip re-rendering components whose props are unchanged; the body object is mutated in place.
  void version.value;
  const sb = sandbox.value!;
  const joints = sb.world.joints.filter((j) => j.a === body.id || j.b === body.id);
  return (
    <Section id="joints" title={`Joints (${joints.length})`}>
      {joints.length === 0 && <span class="muted">None.</span>}
      {joints.map((j) => {
        const other = j.a === body.id ? j.b : j.a;
        const pct = Math.min(100, j.load.fraction * 100);
        const worst = LIMIT_FIELDS.reduce((w, f) => (j.load[f.k] / j.limits[f.k] > j.load[w.k] / j.limits[w.k] ? f : w), LIMIT_FIELDS[0]);
        return (
          <div key={j.id} class="joint" data-testid={`joint-${j.id}`}>
            <div class="row">
              <span>
                Weld to <b>{other}</b>
              </span>
              <span class="mono" data-testid={`joint-load-${j.id}`} title="Largest load as a share of its limit">
                {pct.toFixed(0)}% {worst.k}
              </span>
            </div>
            <div class="loadbar" role="meter" aria-label={`Load on ${j.id}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
              <div style={{ width: `${pct}%`, background: pct >= 80 ? "var(--orange)" : pct >= 50 ? "#F2C94C" : "var(--accent)" }} />
            </div>
            {LIMIT_FIELDS.map((f) => (
              <NumberField
                key={f.k}
                id={`${j.id}-${f.k}`}
                label={f.label}
                unit={f.unit}
                step={10}
                decimals={1}
                value={j.limits[f.k]}
                validate={positive}
                onCommit={(v) => edit([{ type: "joint.set", id: j.id, limits: { [f.k]: v } }], `Set ${f.k} limit`)}
              />
            ))}
            <button class="btn small ghost" onClick={() => edit([{ type: "joint.remove", id: j.id }], `Remove joint ${j.id}`)}>
              Remove joint
            </button>
          </div>
        );
      })}
    </Section>
  );
}

function ContentsSection({ body }: { body: Body }) {
  // Signals skip re-rendering components whose props are unchanged; the body object is mutated in place.
  void version.value;
  const [resource, setResource] = useState("fuel");
  const stores = body.contents ?? [];
  const setStores = (next: Store[], label: string) => edit([{ type: "body.set", id: body.id, patch: { contents: next } }], label);
  return (
    <Section id="contents" title="Contents">
      {stores.length === 0 && <span class="muted">No stores.</span>}
      {stores.map((s, i) => (
        <div key={s.resource} class="joint">
          <div class="row">
            <b>{s.resource}</b>
            <button class="btn small ghost" onClick={() => setStores(stores.filter((_, k) => k !== i), `Remove ${s.resource} store`)}>
              Remove
            </button>
          </div>
          <NumberField
            id={`store-${s.resource}-mass`}
            label="Amount"
            unit="kg"
            value={s.mass}
            validate={(v) => (v < 0 ? "Must be 0 or more" : v > s.capacity ? `Must not exceed capacity (${s.capacity} kg)` : null)}
            onCommit={(v) => setStores(stores.map((x, k) => (k === i ? { ...x, mass: v } : x)), `Set ${s.resource}`)}
          />
          <NumberField
            id={`store-${s.resource}-cap`}
            label="Capacity"
            unit="kg"
            value={s.capacity}
            validate={(v) => (v < s.mass ? `Must hold the current ${s.mass} kg` : null)}
            onCommit={(v) => setStores(stores.map((x, k) => (k === i ? { ...x, capacity: v } : x)), `Set ${s.resource} capacity`)}
          />
        </div>
      ))}
      <div class="row">
        <input class="textin" aria-label="New store resource" value={resource} onInput={(e) => setResource((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} data-testid="new-store-resource" />
        <button
          class="btn small"
          disabled={!resource.trim() || stores.some((s) => s.resource === resource.trim())}
          onClick={() => setStores([...stores, { resource: resource.trim(), mass: 0, capacity: 10 }], `Add ${resource.trim()} store`)}
          data-testid="add-store"
        >
          Add store
        </button>
      </div>
    </Section>
  );
}

function LinksSection({ body }: { body: Body }) {
  // Signals skip re-rendering components whose props are unchanged; the body object is mutated in place.
  void version.value;
  const sb = sandbox.value!;
  const [channel, setChannel] = useState("main");
  const feeds = sb.world.links.filter((l) => l.kind === "feed" && (l.from === body.id || l.to === body.id));
  const controls = controlInputs(sb.world, body.id);
  const keyFor = (ch: string) => Object.entries(bindings.value).find(([, c]) => c === ch)?.[0];
  return (
    <Section id="links" title="Links">
      {feeds.map((l) =>
        l.kind === "feed" ? (
          <div key={l.id} class="joint">
            <div class="row">
              <span>
                {l.resource}: {l.from} → {l.to}
              </span>
              <button class="btn small ghost" onClick={() => edit([{ type: "link.remove", id: l.id }], `Remove link ${l.id}`)}>
                Remove
              </button>
            </div>
            <NumberField
              id={`${l.id}-rate`}
              label="Flow rate"
              unit="kg/s"
              value={l.rate}
              validate={positive}
              onCommit={(v) => edit([{ type: "link.remove", id: l.id }, { type: "link.add", link: { ...l, rate: v } }], `Set ${l.id} rate`)}
            />
          </div>
        ) : null,
      )}
      {Object.entries(controls).map(([ch, value]) => {
        const link = sb.world.links.find((l) => l.kind === "control" && l.to === body.id && l.channel === ch)!;
        const key = keyFor(ch);
        return (
          <div key={ch} class="joint">
            <div class="row">
              <span>
                Control in: <b>{ch}</b> = <span class="mono">{value.toFixed(2)}</span>
              </span>
              <button class="btn small ghost" onClick={() => edit([{ type: "link.remove", id: link.id }], `Remove control ${ch}`)}>
                Remove
              </button>
            </div>
            <div class="row">
              <span class="muted">Key</span>
              <button class={`btn small ${bindingFor.value === ch ? "on" : ""}`} onClick={() => (bindingFor.value = ch)} data-testid={`bind-${ch}`}>
                {bindingFor.value === ch ? "Press a key…" : key ? `${key.toUpperCase()} (change)` : "Bind key"}
              </button>
            </div>
          </div>
        );
      })}
      <div class="row">
        <input class="textin" aria-label="Control channel" value={channel} onInput={(e) => setChannel((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.stopPropagation()} data-testid="new-channel" />
        <button
          class="btn small"
          disabled={!channel.trim() || channel.trim() in controls}
          onClick={() => edit([{ type: "link.add", link: { id: freshId("control"), kind: "control", channel: channel.trim(), to: body.id } }], `Add control ${channel.trim()}`)}
          data-testid="add-control"
        >
          Add control link
        </button>
      </div>
      <span class="muted" style={{ fontSize: "12px" }}>
        Drag between stores with the Link tool (L) to add a feed link. Control values have no actuator to drive until thrusters arrive in M4.
      </span>
    </Section>
  );
}

function ScenarioPanel() {
  // Signals skip re-rendering components whose props are unchanged; the body object is mutated in place.
  void version.value;
  const sb = sandbox.value!;
  const scn = sb.scenario;
  const L = sb.world.ledger;
  const t = L.totals;
  const res = L.last?.residual;
  return (
    <>
      <Section id="scenario" title="Scenario">
        <div>{scn.description ?? "No description."}</div>
        {(scn.parameters ?? []).length > 0 && <div class="muted" style={{ fontSize: "12px" }}>Parameters — changing one resets and reruns the scenario.</div>}
        {(scn.parameters ?? []).map((p) => (
          <div class="param" key={p.id}>
            <NumberField
              id={`param-${p.id}`}
              label={p.label}
              unit={p.unit}
              step={p.step ?? 0.1}
              value={scn.values[p.id]}
              validate={(v) => (v >= p.min && v <= p.max ? null : `Must be between ${p.min} and ${p.max}`)}
              onCommit={(v) => setParameter(p.id, v)}
            />
            <input
              type="range"
              aria-label={`${p.label} slider`}
              min={p.min}
              max={p.max}
              step={p.step ?? 0.1}
              value={scn.values[p.id]}
              onChange={(e) => setParameter(p.id, Number((e.currentTarget as HTMLInputElement).value))}
              data-testid={`slider-${p.id}`}
            />
          </div>
        ))}
      </Section>
      <Section id="world" title="World">
        <NumberField id="gx" label="Gravity x" unit="m/s²" value={sb.world.gravity.x} onCommit={(v) => edit([{ type: "world.set", patch: { gravity: { x: v, y: sb.world.gravity.y } } }], "Set gravity")} />
        <NumberField id="gy" label="Gravity y" unit="m/s²" value={sb.world.gravity.y} onCommit={(v) => edit([{ type: "world.set", patch: { gravity: { x: sb.world.gravity.x, y: v } } }], "Set gravity")} />
        <Row k="Bodies" v={String(sb.world.bodies.length)} />
      </Section>
      <Section id="ledger" title="Ledger">
        <Row k="Mass" v={fmt(t.mass, "kg")} />
        <Row k="Momentum" v={`${fmt(t.momentum.x, "kg·m/s")}, ${fmt(t.momentum.y, "")}`} />
        <Row k="Angular momentum" v={fmt(t.angularMomentum, "kg·m²/s")} />
        <Row k="Kinetic" v={fmt(t.energy.kinetic, "J")} />
        <Row k="Potential" v={fmt(t.energy.potential, "J")} />
        <Row k="Heat" v={fmt(t.energy.thermal, "J")} />
        <Row k="Total energy" v={fmt(t.energy.total, "J")} />
        {res && <Row k="Last residual (p, E)" v={`${Math.hypot(res.momentumX, res.momentumY).toExponential(1)}, ${res.energy.toExponential(1)}`} title="What the ledger could not attribute to any source in the last step." />}
      </Section>
    </>
  );
}

export function Inspector() {
  void version.value;
  const sb = sandbox.value!;
  const bodies = selection.value.map((id) => sb.world.bodies.find((b) => b.id === id)).filter((b): b is Body => !!b);
  return (
    <aside class="inspector" aria-label="Inspector" data-testid="inspector">
      <header>
        <span class="muted" style={{ fontSize: "12px", letterSpacing: "0.08em" }}>
          INSPECTOR
        </span>
        <strong data-testid="inspector-title">{bodies.length === 0 ? "Scenario" : bodies.length === 1 ? bodies[0].id : `${bodies.length} bodies`}</strong>
      </header>
      {bodies.length === 0 ? <ScenarioPanel /> : <BodyInspector bodies={bodies} />}
      <EventLog />
    </aside>
  );
}

export function EventLog() {
  void version.value;
  const sb = sandbox.value!;
  const events = sb.world.events.filter((e) => e.type === "collision" || e.type === "violation").slice(-8).reverse();
  return (
    <section class="events" aria-label="Event log" data-testid="event-log">
      <div class="muted" style={{ fontSize: "12px", letterSpacing: "0.08em" }}>
        EVENTS
      </div>
      {events.length === 0 && <span class="muted">No events yet. Press play.</span>}
      {events.map((e, i) => {
        const ids = e.type === "collision" ? [String(e.data.a), String(e.data.b)] : String(e.data.entities ?? "").split(",").filter(Boolean);
        const text = e.type === "collision" ? `Collision ${e.data.a}–${e.data.b}, ${fmt(Number(e.data.impulse), "N·s")}` : `Violation: ${e.data.quantity} off by ${Number(e.data.magnitude).toExponential(2)}`;
        return (
          // A collision is recorded during step `tick`; show the state just after it.
          <button key={`${e.tick}-${i}`} class={e.type === "violation" ? "violation" : ""} onClick={() => jumpTo(e.type === "collision" ? e.tick + 1 : e.tick, ids)} title="Jump to this step" data-testid="event">
            <span class="mono">t={(e.tick * sb.profile.timestep).toFixed(3)}</span>
            <span>{text}</span>
          </button>
        );
      })}
    </section>
  );
}

function Graph({ id }: { id: string }) {
  void version.value;
  const sb = sandbox.value!;
  const s = sb.series.find((x) => x.id === id);
  const ref = useRef<HTMLCanvasElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const data = sb.history[id] ?? [];
  const dt = sb.profile.timestep;
  const now = sb.world.tick;
  const win = graphWindow.value;
  const from = win === "all" ? 0 : Math.max(0, now - Math.round(win / dt));
  const to = Math.max(now, from + 1);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = from; t <= to && t < data.length; t++) {
      const v = data[t];
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo)) return;
    const pad = Math.max((hi - lo) * 0.1, Math.abs(hi) * 1e-6, 1e-12);
    lo -= pad;
    hi += pad;
    const X = (t: number) => ((t - from) / (to - from)) * w;
    const Y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
    ctx.strokeStyle = "#5AA9FF";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const stride = Math.max(1, Math.floor((to - from) / (w * 2)));
    let started = false;
    for (let t = from; t <= to && t < data.length; t += stride) {
      const v = data[t];
      if (!Number.isFinite(v)) continue;
      if (!started) ctx.moveTo(X(t), Y(v));
      else ctx.lineTo(X(t), Y(v));
      started = true;
    }
    ctx.stroke();
    // Cursor at the current tick.
    ctx.strokeStyle = "#FF9F43";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(now), 0);
    ctx.lineTo(X(now), h);
    ctx.stroke();
    ctx.setLineDash([]);
    if (hoverX !== null) {
      ctx.strokeStyle = "#A3ADC2";
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, h);
      ctx.stroke();
    }
  });

  if (!s) return null;
  const hoverTick = hoverX !== null && ref.current ? Math.round(from + (hoverX / ref.current.clientWidth) * (to - from)) : null;
  const shownTick = hoverTick ?? now;
  const value = data[shownTick];
  return (
    <div class="graph" data-testid={`graph-${id}`}>
      <header>
        <span class="muted">{s.label}</span>
        <span class="mono" data-testid={`graph-value-${id}`}>
          {Number.isFinite(value) ? fmt(value, s.unit, 5) : "—"}
          {hoverTick !== null ? ` @ ${(hoverTick * dt).toFixed(2)} s` : ""}
        </span>
      </header>
      <canvas
        ref={ref}
        role="img"
        aria-label={`Graph of ${s.label}`}
        onPointerMove={(e) => setHoverX(e.offsetX)}
        onPointerLeave={() => setHoverX(null)}
        onClick={() => hoverTick !== null && jumpTo(Math.min(hoverTick, sb.maxTick))}
      />
    </div>
  );
}

export function Drawer() {
  void version.value;
  const sb = sandbox.value!;
  const open = drawerOpen.value;
  const toggleSeries = (id: string) => {
    visibleSeries.value = visibleSeries.value.includes(id) ? visibleSeries.value.filter((x) => x !== id) : [...visibleSeries.value, id];
  };
  return (
    <section class="drawer" aria-label="Graphs and timeline">
      <div class="drawer-head">
        <button class="btn ghost small" aria-expanded={open} onClick={() => action("drawer").run()} data-testid="toggle-drawer">
          {open ? "▾" : "▸"} Graphs
        </button>
        <input
          type="range"
          aria-label="Timeline scrub"
          min={0}
          max={Math.max(1, sb.maxTick)}
          value={sb.world.tick}
          onInput={(e) => jumpTo(Number((e.currentTarget as HTMLInputElement).value))}
          data-testid="scrub"
        />
        <span class="mono muted" style={{ fontSize: "12px" }}>
          {(sb.maxTick * sb.profile.timestep).toFixed(1)} s recorded
        </span>
        <div class="seg" role="group" aria-label="Graph window">
          {([2, 10, "all"] as const).map((w) => (
            <button
              key={String(w)}
              aria-pressed={graphWindow.value === w}
              onClick={() => {
                graphWindow.value = w;
                persist();
              }}
            >
              {w === "all" ? "All" : `${w} s`}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <>
          <div class="chips" style={{ padding: "0 12px 6px" }} role="group" aria-label="Series">
            {sb.series.map((s) => (
              <button key={s.id} class="chip" aria-pressed={visibleSeries.value.includes(s.id)} onClick={() => toggleSeries(s.id)} data-testid={`series-${s.id}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div class="graphs">
            {visibleSeries.value.map((id) => (
              <Graph key={id} id={id} />
            ))}
            {visibleSeries.value.length === 0 && <span class="muted">Pick a series above to graph it.</span>}
          </div>
        </>
      )}
    </section>
  );
}

export function StatusBar() {
  const t = TOOLS.find((x) => x.id === tool.value)!;
  return (
    <footer class="statusbar" data-testid="status">
      <span class="tool">{t.label.toUpperCase()}</span>
      <span data-testid="status-hint">{t.hint}</span>
      <span class="spacer" />
      <span class="shortcuts">Esc: back to Select · ?: shortcuts · Ctrl K: commands</span>
    </footer>
  );
}

export function MobileBar() {
  return (
    <div class="mobilebar">
      <button class="btn" onClick={() => (sheet.value = sheet.value === "graphs" ? null : "graphs")} aria-expanded={sheet.value === "graphs"}>
        Graphs
      </button>
      <button class="btn" onClick={() => (sheet.value = sheet.value === "inspector" ? null : "inspector")} aria-expanded={sheet.value === "inspector"}>
        Inspector
      </button>
      <button class="btn" onClick={() => action("fit").run()}>
        Fit
      </button>
    </div>
  );
}
