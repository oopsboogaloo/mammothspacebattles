// Try it (docs/blueprint/spec.md §9): the blueprint flown at once, fully fuelled and armed, in a
// gravity-free field that wraps round, with one rock to fly round and shoot. Nothing here changes
// the blueprint; Back returns to it as it was left.
import { useEffect, useState } from "preact/hooks";
import { camera, openScenario, overlays as sandboxOverlays, playing, sandbox, screen, setFollow, timeScale, viewport } from "../state.ts";
import { sendControl, Thrust } from "../Lander.tsx";
import { View } from "../View.tsx";
import { keyLabel, loadKeys, MOVEMENT, playerControls } from "./bindings.ts";
import { actionLabel, physicsShip, type Blueprint } from "./model.ts";
import { current, say, tryOut } from "./store.ts";
import { loadSummary, useWeldLoads } from "./tryLoads.ts";
import { shipControls } from "./measure.ts";
import { powerOf } from "../../core/index.ts";
import { usePad, type PadAnalog, type PadGame, type PadState } from "../gamepad.ts";
import { wrapShift } from "../thrustHud.ts";

/** The field: 120 × 75 m, wrapping (twice the first try-outs' 60 × 37.5). */
const HALF = { x: 60, y: 37.5 };
/** How much of it the view shows at once, m: the view follows the ship round the field. */
const VIEW = { x: 60, y: 37.5 };

/** The rock: Flight test asteroids' rock A, without its gravity (no gravity here). */
const ROCK = {
  id: "rock",
  shape: {
    kind: "polygon",
    vertices: [
      { x: -5.050892, y: 1.109229 },
      { x: -3.760292, y: -2.812871 },
      { x: -2.940692, y: -4.717771 },
      { x: -0.592892, y: -5.329371 },
      { x: 4.118508, y: -2.343571 },
      { x: 5.566308, y: -0.238471 },
      { x: 4.091508, y: 2.477329 },
      { x: 2.433608, y: 4.148829 },
      { x: 0.478508, y: 4.768129 },
      { x: -1.459092, y: 5.216729 },
    ],
  },
  mass: 2912.7,
  position: { x: 16, y: 3 },
  velocity: { x: 0, y: 0 },
  angle: 0,
  angularVelocity: -0.04,
  restitution: 0.4,
  friction: 0.6,
};

/** The scenario Try it runs: the blueprint's ship at the middle, at rest, and the rock. */
export function tryScenario(bp: Blueprint, withRock = true): Record<string, unknown> {
  const ship = physicsShip(bp);
  for (const b of ship.bodies) {
    b.velocity = { x: 0, y: 0 };
    b.angularVelocity = 0;
  }
  return {
    schema: 1,
    name: "blueprint-try",
    title: `Try it: ${bp.name}`,
    description: "A blueprint flown in empty space: no gravity, the edges wrap round, one rock.",
    profile: "sandbox",
    seed: 1,
    world: {
      gravity: { x: 0, y: 0 },
      bounds: { min: { x: -HALF.x, y: -HALF.y }, max: { x: HALF.x, y: HALF.y }, wrap: true, farField: 10, depth: 2 },
      bodies: withRock ? [...ship.bodies, structuredClone(ROCK)] : ship.bodies,
      joints: ship.joints,
      links: ship.links,
      // The controls reach only what is welded to the cockpit; what comes off it stops answering, as
      // in the games (shipRules.ts). With no cockpit nothing answers.
      ...shipControls(bp),
    },
    timeline: [],
    end: { steps: 240 },
    probes: [],
    assertions: [],
    ui: { labels: false, overlays: [] },
  };
}

let rockOn = true;

function launch(): boolean {
  if (!openScenario(tryScenario(current.value, rockOn), "blueprint-try")) return false;
  const sb = sandbox.value;
  if (sb) sb.world.ledgerOff = true;
  screen.value = "lander"; // a game view: no sandbox tools
  timeScale.value = 1;
  sandboxOverlays.value = new Set();
  playing.value = true;
  replayHeld();
  return true;
}

/**
 * What the player is holding (keys, controller buttons, the stick and triggers), so a fresh flight
 * (Refuel & reset, the rock toggled) gets it at once: its world starts with no controls set, and
 * the inputs, unchanged, would not be sent again until let go and pressed (Codex review on #156).
 */
const keysHeld = new Map<string, string>();
const padAnalog = new Map<string, number>();
function replayHeld(): void {
  const on = new Set([...keysHeld.values(), ...padHeld]);
  for (const c of on) sendControl(c, 1, `Held ${c}`, 9_000_002);
  for (const [c, v] of padAnalog) if (v > 0 && !on.has(c)) sendControl(c, v, "Pad", 9_000_000);
}

export function startTry(): void {
  if (!current.value.ship.bodies.length) return;
  if (launch()) tryOut.value = true;
}

/**
 * A game controller, as Mammoth Thrust's (src/app/Thrust.tsx): the stick turns as far as it is
 * pushed; forward is the stick up, the right trigger or A; reverse the stick down, the left trigger
 * or B; X or the right bumper fires, Y is the tractor, the left bumper the shield; Start pauses.
 * They set the player's controls, which the blueprint's wiring then mixes.
 */
const PAD_BUTTONS: [keyof PadState, string][] = [
  ["x", "action-a"],
  ["rb", "action-a"],
  ["y", "action-b"],
  ["lb", "action-c"],
];
const padHeld = new Set<string>();
const PAD: PadGame = {
  flying: () => tryOut.value && !!sandbox.value && playing.value,
  controls: (p) => [...new Set(PAD_BUTTONS.filter(([b]) => p[b]).map(([, c]) => c))],
  set: (control, on) => {
    if (!sandbox.value) return;
    if (on === padHeld.has(control)) return;
    if (on) padHeld.add(control);
    else padHeld.delete(control);
    sendControl(control, on ? 1 : 0, "Pad", 9_000_001);
  },
  pause: () => {
    if (!tryOut.value || !sandbox.value) return false;
    playing.value = !playing.value;
    return true;
  },
  analog: {
    values: (p: PadState, a: PadAnalog) => {
      const on = (b: boolean) => (b ? 1 : 0);
      return {
        left: Math.max(a.left, on(p.left && a.left === 0)),
        right: Math.max(a.right, on(p.right && a.right === 0)),
        forward: Math.max(a.up, a.rt, on(p.a), on(p.up && a.up === 0)),
        reverse: Math.max(a.down, a.lt, on(p.b), on(p.down && a.down === 0)),
      };
    },
    set: (channel, value) => {
      padAnalog.set(channel, value);
      if (sandbox.value) sendControl(channel, value, "Pad", 9_000_000);
    },
  },
};

function back(): void {
  const summary = loadSummary(current.value);
  if (summary) say(summary);
  playing.value = false;
  tryOut.value = false;
}

/**
 * The view follows the ship (its cockpit, or its first part), showing 60 × 37.5 m of the field; when
 * the ship goes off one edge and comes in at the other, the view goes on past the edge with it (the
 * renderer draws the field's copies there) rather than jumping back, as Mammoth Thrust's (wrapShift).
 */
function useFollowCamera(bp: Blueprint): void {
  useEffect(() => {
    setFollow(false);
    const id = bp.components.find((c) => c.kind === "cockpit")?.bodies[0] ?? bp.ship.bodies[0]?.id;
    let raf = 0;
    let shift = { x: 0, y: 0 };
    let seen: { n: string; alive: boolean; at: { x: number; y: number } } | null = null;
    let lastTime = Infinity;
    let at = { x: 0, y: 0 };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const vp = viewport.value;
      const w = sandbox.value?.world;
      if (!vp.width || !vp.height || !w) return;
      if (w.time < lastTime) {
        // A fresh flight (reset & refuel): start the view afresh.
        shift = { x: 0, y: 0 };
        seen = null;
      }
      lastTime = w.time;
      const b = w.bodies.find((x) => x.id === id);
      if (b) at = { x: b.position.x, y: b.position.y };
      const now = { n: "1", alive: !!b, at };
      shift = wrapShift(shift, seen, now, w.bounds, true);
      seen = now;
      const zoom = Math.min(vp.width / VIEW.x, vp.height / VIEW.y);
      const c = camera.value;
      const x = at.x + shift.x;
      const y = at.y + shift.y;
      if (c.x !== x || c.y !== y || c.zoom !== zoom) camera.value = { x, y, zoom };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bp]);
}

/** What the gauges show, read from the world a few times a second. */
function useGauges(bp: Blueprint) {
  const [g, setG] = useState({ fuel: 0, fuelMax: 0, shells: 0, shellsMax: 0, speed: 0, spin: 0, lost: 0, power: null as ReturnType<typeof powerOf> });
  useEffect(() => {
    const tanks = bp.ship.bodies.filter((b) => b.contents?.length && !b.injector).map((b) => b.id);
    const fuelMax = bp.ship.bodies.filter((b) => tanks.includes(b.id)).reduce((s, b) => s + b.contents!.reduce((t, c) => t + c.capacity, 0), 0);
    // Shells in the guns and in the magazines that feed them (WPN-015).
    const shellsOf = (bodies: { magazine?: { count: number }; ammo?: { count: number } }[]) => bodies.reduce((s, b) => s + (b.magazine?.count ?? 0) + (b.ammo?.count ?? 0), 0);
    const shellsMax = shellsOf(bp.ship.bodies);
    const cockpit = bp.components.find((c) => c.kind === "cockpit")?.bodies[0] ?? bp.ship.bodies[0]?.id;
    const ids = new Set(bp.ship.bodies.map((b) => b.id));
    const t = setInterval(() => {
      const w = sandbox.value?.world;
      if (!w) return;
      const byId = new Map(w.bodies.map((b) => [b.id, b]));
      const fuel = tanks.reduce((s, id) => s + (byId.get(id)?.contents?.reduce((t2, c) => t2 + c.mass, 0) ?? 0), 0);
      const hull = cockpit ? byId.get(cockpit) : undefined;
      const present = [...ids].filter((id) => byId.has(id) && (byId.get(id)!.integrity ?? 1) > 0).length;
      setG({
        fuel,
        fuelMax,
        shells: shellsOf([...ids].map((id) => byId.get(id)).filter((b): b is NonNullable<typeof b> => !!b)),
        shellsMax,
        power: cockpit && byId.has(cockpit) ? powerOf(w, cockpit) : null,
        speed: hull ? Math.hypot(hull.velocity.x, hull.velocity.y) : 0,
        spin: hull ? Math.abs(hull.angularVelocity) : 0,
        lost: ids.size - present,
      });
    }, 150);
    return () => clearInterval(t);
  }, [bp]);
  return g;
}

export function TryOut() {
  const bp = current.value;
  const g = useGauges(bp);
  // Touch buttons on a touch screen (or `?touch=1`, to try them with a mouse).
  const touch = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || new URLSearchParams(window.location.search).get("touch") === "1");
  useWeldLoads(bp);
  usePad(PAD);
  const [paused, setPaused] = useState(false);
  const [rock, setRock] = useState(rockOn);
  useFollowCamera(bp);

  useEffect(() => {
    const keys = loadKeys();
    const held = keysHeld;
    let group = Math.floor(Math.random() * 1e9);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape") return back();
      if (e.code === "KeyR" && !e.repeat) {
        launch();
        return;
      }
      if (e.code === "KeyP" && !e.repeat) {
        playing.value = !playing.value;
        setPaused(!playing.value);
        return;
      }
      const c = keys[e.code];
      if (!c) return;
      e.preventDefault();
      if (held.has(e.code)) return;
      held.set(e.code, c);
      if ([...held.values()].filter((x) => x === c).length === 1) sendControl(c, 1, `Key ${c}`, ++group);
    };
    const up = (e: KeyboardEvent) => {
      const c = held.get(e.code);
      if (!c) return;
      held.delete(e.code);
      if (![...held.values()].includes(c)) sendControl(c, 0, `Key ${c}`, group);
    };
    const blur = () => {
      for (const c of new Set(held.values())) sendControl(c, 0, `Key ${c}`, group);
      held.clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, []);

  const keys = loadKeys();
  const keysFor = (id: string) =>
    Object.entries(keys)
      .filter(([, c]) => c === id)
      .slice(0, 2)
      .map(([k]) => keyLabel(k));
  const bar = (v: number, m: number) => `${m > 0 ? Math.max(0, Math.min(100, (100 * v) / m)) : 0}%`;
  return (
    <div class={`tryview${touch ? " touch" : ""}`} data-testid="try-view">
      <div class="tryfield">
        <View />
        <div class="mas-shield" />
      </div>
      <div class="tbar">
        <button class="back" onClick={back} data-testid="try-back">
          ◀ BACK TO BLUEPRINT <kbd>Esc</kbd>
        </button>
        <div class="tt">
          <small>TRY-OUT</small>
          <b>{bp.name}</b>
          <span>{bp.components.some((c) => c.kind === "cockpit") ? "no gravity · edges wrap · nothing is saved" : "no cockpit: nothing answers the controls"}</span>
        </div>
        <div class="spacer" />
        <button class="ib" onClick={() => launch()} data-testid="try-reset">
          ↺ Refuel & reset <kbd>R</kbd>
        </button>
        <button
          class="ib"
          onClick={() => {
            playing.value = !playing.value;
            setPaused(!playing.value);
          }}
        >
          {paused ? "▶ Resume" : "⏸ Pause"} <kbd>P</kbd>
        </button>
        <button
          class={`ib${rock ? " on" : ""}`}
          onClick={() => {
            rockOn = !rockOn;
            setRock(rockOn);
            launch();
          }}
        >
          ◌ Rock: {rock ? "on" : "off"}
        </button>
      </div>
      <div class="gauges">
        <div class="g">
          <small>FUEL</small>
          <div class="bar">
            <i style={{ width: bar(g.fuel, g.fuelMax) }} />
          </div>
          <b>
            {g.fuel.toFixed(2)} / {g.fuelMax.toFixed(2)} kg
          </b>
        </div>
        {g.shellsMax > 0 && (
          <div class="g">
            <small>SHELLS</small>
            <div class="bar">
              <i style={{ width: bar(g.shells, g.shellsMax) }} />
            </div>
            <b>
              {g.shells} / {g.shellsMax}
            </b>
          </div>
        )}
        {g.power && (
          <>
            <div class="g" data-testid="try-battery">
              <small>BATTERY</small>
              <div class="bar">
                <i style={{ width: bar(g.power.stored, g.power.capacity) }} />
              </div>
              <b>
                {Math.round(g.power.stored)} / {Math.round(g.power.capacity)} kJ
              </b>
            </div>
            <div class="g" data-testid="try-generators">
              <small>GENERATORS</small>
              <div class="bar">
                <i style={{ width: bar(g.power.making, g.power.output) }} />
              </div>
              <b>
                {Math.round(g.power.making)} / {Math.round(g.power.output)} kW
              </b>
            </div>
          </>
        )}
        <div class="g">
          <small>SPEED</small>
          <b class="big">{g.speed.toFixed(1)} m/s</b>
        </div>
        <div class="g">
          <small>SPIN</small>
          <b class="big">{g.spin.toFixed(2)} rad/s</b>
        </div>
        <div class="g">
          <small>DAMAGE</small>
          <b class="big">{g.lost} parts lost</b>
        </div>
      </div>
      {touch && (
        // On a touch screen, Mammoth Thrust's buttons: L and R in the corners (both together are
        // Forward, through the Thrust ships' wiring), and FWD for a ship wired without that rule.
        <div class="trytouch" data-testid="try-touch">
          <Thrust channel="left" label="L" side="left" className="mas-thrust" />
          <Thrust channel="forward" label="FWD" side="forward" className="mas-thrust" />
          <Thrust channel="reverse" label="REV" side="reverse" className="mas-thrust" />
          {/* The actions, each named by what it does in this ship (or the player's name for it). */}
          <Thrust channel="action-c" label={actionLabel(bp, "action-c", "C")} name={`Action C: ${actionLabel(bp, "action-c", "C").toLowerCase()}`} side="shield" className="mas-thrust" />
          <Thrust channel="action-b" label={actionLabel(bp, "action-b", "B")} name={`Action B: ${actionLabel(bp, "action-b", "B").toLowerCase()}`} side="tractor" className="mas-thrust" />
          <Thrust channel="action-a" label={actionLabel(bp, "action-a", "A")} name={`Action A: ${actionLabel(bp, "action-a", "A").toLowerCase()}`} side="fire" className="mas-thrust" />
          <Thrust channel="right" label="R" side="right" className="mas-thrust" />
        </div>
      )}
      <div class="keys">
        <b>CONTROLS</b>
        {playerControls.value.map((c) => (
          <span key={c.id}>
            {keysFor(c.id).map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}{" "}
            {MOVEMENT.has(c.id) ? c.name.toLowerCase() : actionLabel(bp, c.id, c.name).toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
