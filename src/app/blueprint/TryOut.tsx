// Try it (docs/blueprint/spec.md §9): the blueprint flown at once, fully fuelled and armed, in a
// gravity-free field that wraps round, with one rock to fly round and shoot. Nothing here changes
// the blueprint; Back returns to it as it was left.
import { useEffect, useState } from "preact/hooks";
import { camera, openScenario, overlays as sandboxOverlays, playing, sandbox, screen, setFollow, timeScale, viewport } from "../state.ts";
import { sendControl } from "../Lander.tsx";
import { View } from "../View.tsx";
import { keyLabel, loadKeys, playerControls } from "./bindings.ts";
import { type Blueprint } from "./model.ts";
import { current, tryOut } from "./store.ts";

const HALF = { x: 30, y: 18.75 };

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
  const ship = structuredClone(bp.ship);
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
      mix: bp.mix,
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
  return true;
}

export function startTry(): void {
  if (!current.value.ship.bodies.length) return;
  if (launch()) tryOut.value = true;
}

function back(): void {
  playing.value = false;
  tryOut.value = false;
}

/** The whole field in view, as Mammoth Asteroids' arena. */
function useFieldCamera(): void {
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const vp = viewport.value;
      if (!vp.width || !vp.height) return;
      const zoom = Math.min(vp.width / (2 * HALF.x), vp.height / (2 * HALF.y));
      const c = camera.value;
      if (c.x !== 0 || c.y !== 0 || c.zoom !== zoom) camera.value = { x: 0, y: 0, zoom };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** What the gauges show, read from the world a few times a second. */
function useGauges(bp: Blueprint) {
  const [g, setG] = useState({ fuel: 0, fuelMax: 0, shells: 0, shellsMax: 0, speed: 0, spin: 0, lost: 0 });
  useEffect(() => {
    const tanks = bp.ship.bodies.filter((b) => b.contents?.length && !b.injector).map((b) => b.id);
    const fuelMax = bp.ship.bodies.filter((b) => tanks.includes(b.id)).reduce((s, b) => s + b.contents!.reduce((t, c) => t + c.capacity, 0), 0);
    const gun = bp.ship.bodies.find((b) => b.magazine);
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
        shells: gun ? (byId.get(gun.id)?.magazine?.count ?? 0) : 0,
        shellsMax: gun?.magazine?.count ?? 0,
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
  const [paused, setPaused] = useState(false);
  const [rock, setRock] = useState(rockOn);
  useFieldCamera();

  useEffect(() => {
    const keys = loadKeys();
    const held = new Map<string, string>();
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
    <div class="tryview" data-testid="try-view">
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
          <span>no gravity · edges wrap · nothing is saved</span>
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
      <div class="keys">
        <b>CONTROLS</b>
        {playerControls.value.map((c) => (
          <span key={c.id}>
            {keysFor(c.id).map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}{" "}
            {c.name.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
