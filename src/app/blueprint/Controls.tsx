// Controls (docs/blueprint/spec.md §10): how the player's controls drive the ship's engines and
// devices. The controls and their keys are the player's, one set for every ship; the wiring (the
// mixer) is the blueprint's. Nothing is guessed: the player wires every engine.
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { mixerValues, type MixerLine, type MixerRow } from "../../core/index.ts";
import { addControl, bindKey, controlName, keyLabel, keysFor, MOVEMENT, playerControls, playerKeys, unbindKey } from "./bindings.ts";
import { actionLabel, setLabel, channelsOf, component, componentOfChannel, describeRow, response, setRow, setRules, stats, wiringChecks, type Blueprint } from "./model.ts";
import { NumberControl } from "./NumberControl.tsx";
import { layout, StatsFold } from "./Layout.tsx";
import { measurementOf } from "./measureClient.ts";
import { MeasureButton } from "./Panels.tsx";
import { current, edit, endGesture, live, mode, selection } from "./store.ts";
import { KIND_COLOUR } from "./View.tsx";

/** The controls held to test the wiring on the blueprint (keys in Controls mode, or ● held). */
export const testHeld = signal<Record<string, number>>({});

const hold = (id: string, on: boolean) => {
  const next = { ...testHeld.value };
  if (on) next[id] = 1;
  else delete next[id];
  testHeld.value = next;
};

/** While Controls mode is open, the player's keys test the wiring instead of editing. */
export function useTestKeys(): void {
  useEffect(() => {
    const held = new Map<string, string>();
    const down = (e: KeyboardEvent) => {
      if (mode.value !== "controls" || capturing.value) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
      const c = playerKeys.value[e.code];
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      held.set(e.code, c);
      hold(c, true);
    };
    const up = (e: KeyboardEvent) => {
      const c = held.get(e.code);
      if (!c) return;
      held.delete(e.code);
      if (![...held.values()].includes(c)) hold(c, false);
    };
    const blur = () => {
      held.clear();
      testHeld.value = {};
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
}

/** The control a key press will be bound to, while waiting for it. */
const capturing = signal<string | null>(null);

function KeyChips({ control }: { control: string }) {
  void playerKeys.value;
  const keys = keysFor(control);
  useEffect(() => {
    if (capturing.value !== control) return;
    const press = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") bindKey(e.code, control);
      capturing.value = null;
    };
    window.addEventListener("keydown", press, true);
    return () => window.removeEventListener("keydown", press, true);
  }, [capturing.value, control]);
  return (
    <div class="ck">
      {keys.map((k) => (
        <kbd key={k} title="Click to unbind (for every ship)" class="chipkey" onClick={() => unbindKey(k)}>
          {keyLabel(k)}
        </kbd>
      ))}
      <button class="bind" title="Bind a key: press it (for every ship)" aria-label={`Bind a key to ${controlName(control)}`} onClick={() => (capturing.value = control)}>
        {capturing.value === control ? "press a key…" : "＋"}
      </button>
    </div>
  );
}

/**
 * What an action is called on its touch button and in Try it's legend, in this ship: by default the
 * largest thing it drives (wired 100% to the shield, it is SHIELD); the player can name it.
 */
function ScreenName({ control, fallback }: { control: string; fallback: string }) {
  const bp = current.value;
  const own = bp.labels?.[control] ?? "";
  const auto = actionLabel({ ...bp, labels: {} }, control, fallback);
  return (
    <label class="sname" title="What its button says in Try it, in this ship. Leave empty for the automatic name: the largest thing it drives.">
      <span>on screen</span>
      <input
        data-testid={`screen-name-${control}`}
        value={own}
        placeholder={auto}
        maxLength={12}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === "Escape") (e.currentTarget as HTMLInputElement).blur();
        }}
        onBlur={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          if (v.trim().toUpperCase() !== own) edit((b) => setLabel(b, control, v));
        }}
      />
    </label>
  );
}

/** What each control drives in this ship. */
function drives(bp: Blueprint, control: string): string[] {
  const out: string[] = [];
  for (const r of bp.mix.rows) {
    if (!r.lines.some((l) => l.control === control)) continue;
    const c = componentOfChannel(bp, r.channel);
    if (c && !out.includes(c.label)) out.push(c.label);
  }
  return out;
}

/** The player's controls, their keys (shared by every ship) and test buttons: the left panel in Controls mode. */
export function ControlsPanel() {
  const [naming, setNaming] = useState(false);
  const held = testHeld.value;
  const bp = current.value;
  return (
    <section class="panel left" aria-label="Controls">
      <header class="ph">
        <span class="phl">CONTROLS</span>
        <button class="ib sm" title="A new control, for every ship" aria-label="New control" onClick={() => setNaming(true)}>
          ＋
        </button>
      </header>
      <div class="ctllist" data-testid="controls-list">
        {playerControls.value.map((c) => (
          <div key={c.id} class={`ctl${held[c.id] ? " held" : ""}`} data-testid={`control-${c.id}`}>
            <div class="cbody">
              <div class="cn">
                {c.name}
                <span class="kind">{c.kind}</span>
              </div>
              <KeyChips control={c.id} />
              <div class="drv">{drives(bp, c.id).join(" · ") || <span class="dimtxt">drives nothing in this ship</span>}</div>
              {!MOVEMENT.has(c.id) && <ScreenName control={c.id} fallback={c.name} />}
            </div>
            <button class="testbtn" title="Hold to test" aria-label={`Test ${c.name}`} onPointerDown={() => hold(c.id, true)} onPointerUp={() => hold(c.id, false)} onPointerLeave={() => hold(c.id, false)}>
              {held[c.id] ? "●" : "○"}
            </button>
          </div>
        ))}
        <Rules />
        {naming ? (
          <input
            class="rename"
            placeholder="Name, e.g. Strafe left"
            ref={(el) => el?.focus()}
            onKeyDown={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              if (e.key === "Enter" && el.value.trim()) {
                addControl(el.value);
                setNaming(false);
              } else if (e.key === "Escape") setNaming(false);
            }}
            onBlur={() => setNaming(false)}
          />
        ) : null}
      </div>
      <footer class="pf">Keys are yours, for every ship · hold a control's key or ○ to test it</footer>
    </section>
  );
}

function Rules() {
  const bp = current.value;
  const rules = bp.mix.rules ?? [];
  return (
    <div class="rules">
      {rules.map((r, i) => (
        <div class="rule" key={i}>
          <b>
            ⇄ {controlName(r.opposites[0])} + {controlName(r.opposites[1])}
          </b>
          <span>
            Opposites: held together they cancel{r.both ? <> and count as <b>{controlName(r.both)}</b></> : null}.
          </span>
          <button class="ib sm" aria-label="Remove rule" title="Remove this rule" onClick={() => edit((b) => setRules(b, rules.filter((_, k) => k !== i)))}>
            ✕
          </button>
        </div>
      ))}
      {!rules.length && (
        <button class="addline" onClick={() => edit((b) => setRules(b, [{ opposites: ["left", "right"], both: "forward" }]))}>
          ＋ Rule: Turn left + Turn right cancel, count as Forward
        </button>
      )}
    </div>
  );
}

/** One driven channel's lines (an engine's, a gun's): the right panel in Controls mode, and an engine's CONTROLS tab. */
export function LineEditor({ channel }: { channel: string }) {
  const bp = current.value;
  const row: MixerRow = bp.mix.rows.find((r) => r.channel === channel) ?? { channel, lines: [] };
  const controls = playerControls.value;
  const change = (f: (r: MixerRow) => MixerRow) => edit((b) => setRow(b, channel, f));
  const setLine = (i: number, f: (l: MixerLine) => MixerLine) => change((r) => ({ ...r, lines: r.lines.map((l, k) => (k === i ? f(l) : l)) }));
  const select = (value: string, on: (v: string) => void, label: string) => (
    <select class="src" aria-label={label} value={value} onChange={(e) => on((e.currentTarget as HTMLSelectElement).value)}>
      {controls.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      {!controls.some((c) => c.id === value) && <option value={value}>{value}</option>}
    </select>
  );
  return (
    <div class="lineeditor" data-testid={`lines-${channel}`}>
      <div class="say" data-testid="say">
        {describeRow(row, controlName)}
      </div>
      <div class="lines">
        {row.lines.map((l, i) => (
          <div class="line" key={i}>
            <div class="lh">
              <span class="ln">{i + 1}</span>
              {select(l.control, (v) => setLine(i, (x) => ({ ...x, control: v })), `Line ${i + 1} control`)}
              <button class="ib sm" aria-label={`Remove line ${i + 1}`} title="Remove this line" onClick={() => change((r) => ({ ...r, lines: r.lines.filter((_, k) => k !== i) }))}>
                ✕
              </button>
            </div>
            <NumberControl label="Amount" unit="%" value={l.weight * 100} min={0} max={100} step={5} decimals={0} onLive={(v) => live((b) => setRow(b, channel, (r) => ({ ...r, lines: r.lines.map((x, k) => (k === i ? { ...x, weight: v / 100 } : x)) })))} onEnd={endGesture} />
            {l.ease ? (
              <div class="ease">
                <div class="lh">
                  <span>eased by</span>
                  {select(l.ease.control, (v) => setLine(i, (x) => ({ ...x, ease: { ...x.ease!, control: v } })), `Line ${i + 1} eased by`)}
                  <button
                    class="ib sm"
                    aria-label="No easing"
                    onClick={() =>
                      setLine(i, (x) => {
                        const y = { ...x };
                        delete y.ease;
                        return y;
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
                <NumberControl label="Less by" unit="%" value={l.ease.amount * 100} min={0} max={100} step={5} decimals={0} onLive={(v) => live((b) => setRow(b, channel, (r) => ({ ...r, lines: r.lines.map((x, k) => (k === i && x.ease ? { ...x, ease: { ...x.ease, amount: v / 100 } } : x)) })))} onEnd={endGesture} />
              </div>
            ) : (
              <button class="addease" onClick={() => setLine(i, (x) => ({ ...x, ease: { control: controls.find((c) => c.id !== x.control)?.id ?? x.control, amount: 1 } }))}>
                ＋ eased by another control
              </button>
            )}
          </div>
        ))}
        <button class="addline" data-testid="add-line" onClick={() => change((r) => ({ ...r, lines: [...r.lines, { control: controls[0]?.id ?? "forward", weight: 1 }] }))}>
          ＋ Add line
        </button>
      </div>
      <div class="seg">
        <span>Combine</span>
        {(["max", "sum", "min"] as const).map((k) => (
          <button key={k} class={(row.combine ?? "max") === k ? "on" : ""} onClick={() => change((r) => ({ ...r, combine: k === "max" ? undefined : k }))}>
            {k === "max" ? "Largest" : k === "sum" ? "Sum" : "Least"}
          </button>
        ))}
      </div>
      <NumberControl label="Throttle limit" unit="%" value={(row.limit ?? 1) * 100} min={0} max={100} step={5} decimals={0} onLive={(v) => live((b) => setRow(b, channel, (r) => ({ ...r, limit: v >= 100 ? undefined : v / 100 })))} onEnd={endGesture} />
    </div>
  );
}

/** The cockpit's CONTROLS tab: the controls, their keys, what each drives here, and the checks. */
export function CockpitControls() {
  const bp = current.value;
  const checks = wiringChecks(bp, playerControls.value);
  return (
    <div class="cclist" data-testid="cockpit-controls">
      <div class="cch">
        <span>CONTROL</span>
        <span>KEYS</span>
        <span>DRIVES</span>
      </div>
      {playerControls.value.map((c) => (
        <div class="cc" key={c.id}>
          <b>{c.name}</b>
          <span class="ck">
            {keysFor(c.id)
              .slice(0, 2)
              .map((k) => (
                <kbd key={k}>{keyLabel(k)}</kbd>
              ))}
          </span>
          <span class="drv">{drives(bp, c.id).join(" · ") || "—"}</span>
        </div>
      ))}
      <Rules />
      {checks.map((c, i) => (
        <div key={i} class={c.ok ? "okline" : "warnline"}>
          {c.ok ? "✓" : "▲"} {c.text}
        </div>
      ))}
      <button class="primary wide" data-testid="open-mixer" onClick={() => (mode.value = "controls")}>
        ⤢ Open the mixer <kbd>K</kbd>
      </button>
      <p class="hint">Keys are yours, shared by every ship. What each control drives is this ship's wiring.</p>
    </div>
  );
}

/** The mixer: every driven channel against every control (the bottom of the centre in Controls mode). */
export function MixerTable() {
  const bp = current.value;
  const controls = playerControls.value;
  const st = stats(bp);
  const now = response(bp, testHeld.value, st).throttles;
  const values = Object.keys(testHeld.value).length ? mixValues(bp) : {};
  const sel = selection.value;
  const rows = bp.components.flatMap((c) => channelsOf(bp, c.id).map((ch) => ({ c, ch })));
  return (
    <div class="mixer" data-testid="mixer">
      <div class="mh">
        <b>MIXER</b>
        <span>
          each engine or device takes the <b>largest</b> of its lines · click a cell to wire it
        </span>
      </div>
      <div class="mscroll">
        <table>
          <thead>
            <tr>
              <th />
              {controls.map((c) => (
                <th key={c.id}>{c.name}</th>
              ))}
              <th>NOW</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, ch }) => {
              const row = bp.mix.rows.find((r) => r.channel === ch);
              const on = sel?.type === "component" && sel.id === c.id;
              const v = c.kind === "engine" ? (now[ch] ?? 0) : (values[ch] ?? 0);
              return (
                <tr key={ch} class={on ? "sel" : ""}>
                  <th onClick={() => (selection.value = { type: "component", id: c.id })}>
                    <span class="sw" style={{ background: KIND_COLOUR[c.kind] }} />
                    {c.label}
                    {channelsOf(bp, c.id).length > 1 || (c.kind !== "engine" && ch !== c.id) ? <small> · {ch}</small> : null}
                    {!row?.lines.length && <span class="unw"> not wired</span>}
                  </th>
                  {controls.map((k) => {
                    const lines = row?.lines.filter((l) => l.control === k.id) ?? [];
                    return (
                      <td
                        key={k.id}
                        class={lines.length ? "on" : "off"}
                        data-testid={`cell-${ch}-${k.id}`}
                        onClick={() => {
                          selection.value = { type: "component", id: c.id };
                          if (!lines.length) edit((b) => setRow(b, ch, (r) => ({ ...r, lines: [...r.lines, { control: k.id, weight: 1 }] })));
                        }}
                      >
                        {lines.length ? (
                          lines.map((l, i) => (
                            <span key={i}>
                              <b>{Math.round(l.weight * 100)}</b>
                              {l.ease ? <small>− {l.ease.amount < 1 ? `${Math.round(l.ease.amount * 100)}% ` : ""}{controlName(l.ease.control)}</small> : null}
                            </span>
                          ))
                        ) : (
                          "·"
                        )}
                      </td>
                    );
                  })}
                  <td class="live">
                    <div class="lv">
                      <i style={{ width: `${v * 100}%` }} />
                    </div>
                    <span>{Math.round(v * 100)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function mixValues(bp: Blueprint): Record<string, number> {
  return mixerValues(bp.mix, testHeld.value);
}

/** What each control does to the ship, estimated, and what is held now (top right in Controls mode). */
export function ResponseBox() {
  const bp = current.value;
  const st = stats(bp);
  const controls = playerControls.value.filter((c) => ["forward", "reverse", "left", "right"].includes(c.id));
  const held = Object.keys(testHeld.value);
  const m = measurementOf(bp);
  const rows = controls.map((c) => {
    const got = m?.find((x) => Object.keys(x.controls).length === 1 && x.controls[c.id] === 1);
    return { name: c.name, r: got ? { ahead: got.ahead, side: got.side, turn: got.turn } : response(bp, { [c.id]: 1 }, st), now: false, measured: !!got };
  });
  if (held.length) rows.push({ name: held.map(controlName).join(" + "), r: response(bp, testHeld.value, st), now: true, measured: false });
  const checks = wiringChecks(bp, playerControls.value);
  const turn = (t: number) => `${Math.abs(t).toFixed(2)} ${t > 1e-6 ? "↺" : t < -1e-6 ? "↻" : ""}`;
  return (
    <div class="stats resp" data-testid="response">
      <div class="sh">
        RESPONSE <small>what each control does · {m ? "✓ measured" : "est."}</small>
        <MeasureButton bp={bp} measuredNow={!!m} />
        <StatsFold />
      </div>
      {layout.value.stats && (
      <>
      <table>
        <thead>
          <tr>
            <th />
            <td>ahead m/s²</td>
            <td>sideways</td>
            <td>turn rad/s²</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.name} class={x.now ? "now" : ""}>
              <th>
                {x.name}
                {x.measured ? <span class="mtick"> ✓</span> : null}
              </th>
              <td>{fix1(x.r.ahead)}</td>
              <td>{fix1(x.r.side)}</td>
              <td>{turn(x.r.turn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="checks">
        {checks.map((c, i) => (
          <div key={i} class={c.ok ? "ok" : "warn"}>
            {c.ok ? "✓" : "▲"} {c.text}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

/** One decimal, without a minus on a value that rounds to zero. */
const fix1 = (x: number) => (Math.abs(x) < 0.05 ? "0.0" : x.toFixed(1));

/** The right panel in Controls mode: the selected part's wiring. */
export function WiringPanel() {
  const bp = current.value;
  const sel = selection.value;
  const c = sel?.type === "component" && bp.components.some((x) => x.id === sel.id) ? component(bp, sel.id) : null;
  return (
    <section class="panel right" aria-label="Wiring">
      <header class="ph">
        <span class="phl">PROPERTIES</span>
      </header>
      {!c ? (
        <p class="hint">Click an engine or a device, on the blueprint or in the mixer, to wire it to your controls. Hold a control's key to test it.</p>
      ) : (
        <>
          <div class="selhead">
            <div class="swatch" style={{ background: KIND_COLOUR[c.kind] }} />
            <div>
              <b data-testid="selected-name">{c.label}</b>
              <small>its controls</small>
            </div>
          </div>
          <div class="fields">
            {channelsOf(bp, c.id).length ? channelsOf(bp, c.id).map((ch) => <LineEditor key={ch} channel={ch} />) : <p class="hint">{c.label} isn't driven by a control.</p>}
          </div>
        </>
      )}
    </section>
  );
}
