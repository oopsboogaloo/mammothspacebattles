// Mammoth Thrust (docs/games/mammoth-thrust.md): the title over a still map, play with a HUD and
// touch buttons, the pause menu, a level complete and the next one, and game over. Play runs the
// sandbox's world and view underneath at the fixed game pace, with none of its panels or tools. The
// game itself is in the world (src/core/thrust.ts); this is only its page.
import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { scenarioFile } from "./scenarios.ts";
import { camera, openScenario, overlays, playing, sandbox, screen, setFollow, timeScale, version, viewport } from "./state.ts";
import { shown } from "./smooth.ts";
import { View } from "./View.tsx";
import { usePad, type PadGame, type PadState } from "./gamepad.ts";
import { asteroidsSide, sendControl, SwapSides, Thrust, useNoZoom, zoomed } from "./Lander.tsx";
import { easeLean, LEVELS, lookParts, POD_LABEL, shipStatus, zoomFor } from "./thrustHud.ts";
import { THRUST_DESTRUCT } from "../core/index.ts";

export const thrustScreen = signal<"title" | "play">("title");

/**
 * Opens a level: the player's game (running), or the title's still map (not running). `carry` is
 * the score and ships brought from the level before.
 */
function openLevel(n: number, run: boolean, carry?: { score: number; lives: number }): boolean {
  const file = scenarioFile(`thrust-${n}`);
  if (!file) return false;
  const raw = structuredClone(file) as { world: { thrust: { carry?: { score: number; lives: number } } } };
  if (carry) raw.world.thrust.carry = carry;
  if (!openScenario(raw, `thrust-${n}`)) return false;
  screen.value = "lander"; // openScenario switches to the sandbox: this is a game
  timeScale.value = 1;
  overlays.value = new Set();
  playing.value = run;
  return true;
}

/**
 * Play: from level 1, or from the level the page's address names (`thrust.html?level=3`), to try a
 * level without flying the ones before it.
 */
export function startThrust(level = firstLevel()): void {
  if (!openLevel(level, true)) return;
  thrustScreen.value = "play";
}

function firstLevel(): number {
  const n = Number(new URLSearchParams(window.location.search).get("level"));
  return Number.isInteger(n) && n >= 1 && n <= LEVELS ? n : 1;
}

/** The view follows the ship (and leans toward a pod on its tether), at a zoom set by the screen's height. */
function useFollowCamera(): void {
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    // Where the view last looked at a ship: with the ship gone it stays there, on the explosion and
    // what it leaves, until the next ship beams in.
    let last: { x: number; y: number } | null = null;
    // The view's lean toward the pod on the tether: eased in and out, so taking or dropping the pod never jumps it.
    let lean = { x: 0, y: 0 };
    let then = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - then) / 1000;
      then = now;
      const w = sandbox.value?.world;
      const vp = viewport.value;
      if (!w?.thrust || !vp.width || !vp.height) return;
      const look = lookParts(w, shown.time - w.time);
      if (look) lean = easeLean(lean, look.lean, dt);
      else lean = { x: 0, y: 0 };
      const ship = look && { x: look.ship.x + lean.x, y: look.ship.y + lean.y };
      if (ship) last = ship;
      else if (w.time < 0.05) last = null; // a new level
      const at = ship ?? last ?? w.thrust.spec.start;
      const zoom = zoomFor(vp.height);
      const c = camera.value;
      if (c.x !== at.x || c.y !== at.y || c.zoom !== zoom) camera.value = { x: at.x, y: at.y, zoom };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** The title's view: the whole surface of the map, still. */
function useTitleCamera(): void {
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const b = sandbox.value?.world.bounds;
      const vp = viewport.value;
      if (!b || !vp.width || !vp.height) return;
      const zoom = vp.width / (b.max.x - b.min.x - 40);
      const x = (b.min.x + b.max.x) / 2;
      const y = 20 + (0.12 * vp.height) / zoom;
      const c = camera.value;
      if (c.x !== x || c.y !== y || c.zoom !== zoom) camera.value = { x, y, zoom };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** How long the self-destruct button waits for its second press, ms. */
const DESTRUCT_CONFIRM = 3000;

/** Self-destruct, as Mammoth Asteroids': for a ship that can no longer fly usefully. Two presses, so one stray touch doesn't cost a ship. */
function SelfDestruct() {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), DESTRUCT_CONFIRM);
    return () => clearTimeout(t);
  }, [asking]);
  const press = () => {
    if (!asking) return setAsking(true);
    setAsking(false);
    sendControl(THRUST_DESTRUCT, 1, "Self-destruct", Math.floor(Math.random() * 1e9));
  };
  return (
    <button class={`mas-btn small${asking ? " danger" : ""}`} onClick={press} data-testid="mth-destruct">
      {asking ? "Confirm self-destruct" : "Self-destruct"}
    </button>
  );
}

/**
 * The keys: each holds its channels on while it is down. ↑ is left and right together: forward.
 * The tractor is beside either Shift: Z on the left, / on the right. (X and . are kept for the shield.)
 */
const KEYS: Record<string, string[]> = {
  KeyQ: ["left"],
  ArrowLeft: ["left"],
  ShiftLeft: ["left"],
  KeyE: ["right"],
  ArrowRight: ["right"],
  ShiftRight: ["right"],
  ControlLeft: ["left"],
  ControlRight: ["right"],
  ArrowUp: ["left", "right"],
  KeyS: ["reverse"],
  ArrowDown: ["reverse"],
  Space: ["fire"],
  KeyW: ["fire"],
  KeyZ: ["tractor"],
  Slash: ["tractor"],
};
/** The keys held, each with the channels it went to: they are let go on the same ones. */
const down = new Map<string, string[]>();
const held: Record<string, number> = {};
let group = 8_000_000;

function hold(channel: string, by: number): void {
  const was = held[channel] ?? 0;
  held[channel] = Math.max(0, was + by);
  if (was === 0 && held[channel] > 0) sendControl(channel, 1, `Key ${channel}`, ++group);
  else if (was > 0 && held[channel] === 0) sendControl(channel, 0, `Key ${channel}`, group);
}

const ended = (): boolean => {
  const phase = sandbox.value?.world.thrust?.state.phase;
  return phase === "won" || phase === "over";
};

export function thrustKeyDown(e: KeyboardEvent): void {
  // A game key works with Ctrl held too: Ctrl is itself a control.
  if (thrustScreen.value !== "play" || !sandbox.value || e.metaKey) return;
  if (!e.code.startsWith("Shift") && !e.code.startsWith("Control")) dropShifts(e);
  const channels = KEYS[e.code];
  if (channels) {
    e.preventDefault();
    if (down.has(e.code)) return;
    const to = channels.map(asteroidsSide);
    down.set(e.code, to);
    for (const c of to) hold(c, 1);
    return;
  }
  if (e.code === "KeyP" || e.code === "Escape") {
    e.preventDefault();
    if (!ended()) playing.value = !playing.value;
  }
}

/** Lets go of one key, if it was held. */
function release(code: string): void {
  const to = down.get(code);
  if (!to) return;
  down.delete(code);
  if (sandbox.value) for (const c of to) hold(c, -1);
}

/**
 * Windows sends no release for a Shift let go while the other Shift is still down (and the same
 * for Ctrl). So when an event says no Shift is held, neither is: both are let go.
 */
function dropShifts(e: KeyboardEvent): void {
  if (!e.shiftKey) for (const code of ["ShiftLeft", "ShiftRight"]) release(code);
  if (!e.ctrlKey) for (const code of ["ControlLeft", "ControlRight"]) release(code);
}

export function thrustKeyUp(e: KeyboardEvent): void {
  release(e.code);
  dropShifts(e);
}

/**
 * A game controller (gamepad.ts), by the keys it stands for: the stick or D-pad turns, A or the
 * right trigger is forward, B or the left trigger reverse, X or the right bumper fires, Y or the left bumper is the tractor.
 */
function padControls(p: PadState): string[] {
  const out: string[] = [];
  if (p.left) out.push("ArrowLeft");
  if (p.right) out.push("ArrowRight");
  if (p.a || p.rt || p.up) out.push("ArrowUp");
  if (p.b || p.lt || p.down) out.push("ArrowDown");
  if (p.x || p.rb) out.push("Space");
  if (p.y || p.lb) out.push("KeyZ");
  return out;
}
const PAD: PadGame = {
  flying: () => thrustScreen.value === "play" && !!sandbox.value && playing.value && !(ended()),
  controls: padControls,
  set: (code, on) => {
    const pk = `Pad:${code}`;
    if (!on) return release(pk);
    if (down.has(pk) || !sandbox.value) return;
    const to = KEYS[code].map(asteroidsSide);
    down.set(pk, to);
    for (const c of to) hold(c, 1);
  },
  pause: () => {
    if (thrustScreen.value !== "play" || !sandbox.value || ended()) return false;
    playing.value = !playing.value;
    return true;
  },
};

/** Lets go of every key (leaving play, or the window losing the keyboard). */
function releaseKeys(): void {
  down.clear();
  for (const c of Object.keys(held)) {
    if (held[c] > 0 && sandbox.value) sendControl(c, 0, `Key ${c}`, group);
    held[c] = 0;
  }
}

export function ThrustApp() {
  useNoZoom();
  usePad(PAD);
  return (
    <main class="mas" data-testid="mth">
      {thrustScreen.value === "title" && <Title />}
      {thrustScreen.value === "play" && sandbox.value && <Play />}
    </main>
  );
}

/** The title: the name and Play over the first map, still, with nothing happening (MTH-001). */
function Title() {
  void version.value;
  useTitleCamera();
  const still = !!sandbox.value?.world.thrust;
  useEffect(() => {
    if (!still) openLevel(1, false);
    else playing.value = false;
  }, [still]);
  return (
    <div class="mas-play" data-testid="mth-title">
      {still && <View />}
      <div class="mas-shield" />
      <div class="mas-title over">
        <h1>MAMMOTH THRUST</h1>
        <div class="mas-col">
          <button class="mas-btn" onClick={() => startThrust()} data-testid="mth-start">
            Play
          </button>
        </div>
        <p class="mas-credit">by Chloe Bolland © 2026</p>
      </div>
    </div>
  );
}

/** How long the note stays up after a ship is beamed back from the top, game s. */
const BACK_NOTE = 1.5;

function Play() {
  void version.value;
  const sb = sandbox.value!;
  const game = sb.world.thrust;
  const phase = game?.state.phase;

  useFollowCamera();
  useEffect(() => {
    window.addEventListener("blur", releaseKeys);
    return () => {
      window.removeEventListener("blur", releaseKeys);
      releaseKeys();
    };
  }, []);
  // The level is over, either way: the world rests, and the keys are let go.
  useEffect(() => {
    if (phase !== "won" && phase !== "over") return;
    releaseKeys();
    playing.value = false;
  }, [phase]);

  if (!game) return null;
  const s = game.state;
  const level = game.spec.level ?? 1;
  const over = s.phase === "over";
  const won = s.phase === "won";
  const ship = shipStatus(sb.world);
  const back = s.backAt !== undefined && sb.world.time - s.backAt < BACK_NOTE;
  return (
    <div class="mas-play" data-testid="mth-play">
      <View />
      {/* The world under the HUD takes no taps: no sandbox tools in the game. */}
      <div class="mas-shield" />
      <div class="mas-hud" data-testid="mth-hud">
        <span data-testid="mth-score">
          SCORE <b>{s.score}</b>
        </span>
        <span data-testid="mth-level">
          LEVEL <b>{level}</b>
        </span>
        <span data-testid="mth-lives" aria-label={`${s.lives} ships`}>
          <b class="mas-ships">{"▲".repeat(Math.max(0, s.lives))}</b>
        </span>
        <span class={s.pod === "gone" ? "bad" : ""} data-testid="mth-pod">
          POD <b>{POD_LABEL[s.pod]}</b>
        </span>
        <span class="mas-fuel" data-testid="mth-fuel" title="Fuel">
          <i class={ship.fuel < 0.15 ? "low" : ""} style={{ width: `${(100 * ship.fuel).toFixed(1)}%` }} />
          <em>FUEL</em>
        </span>
        <span class={ship.slugs === 0 ? "bad" : ""} data-testid="mth-slugs">
          SHELLS <b>{ship.slugs}</b>
        </span>
        <span class={ship.damage > 0.005 ? "bad" : ""} data-testid="mth-damage">
          DAMAGE <b>{(100 * ship.damage).toFixed(0)}</b>%
        </span>
        {!over && !won && (
          <span class="mas-hud-buttons">
            {playing.value && s.phase === "flying" && <SelfDestruct />}
            <button class="mas-btn small" onClick={() => (playing.value = !playing.value)} data-testid="mth-pause">
              {playing.value ? "Pause" : "Resume"}
            </button>
          </span>
        )}
      </div>
      {s.phase === "between" && sb.world.time >= (s.noteAt ?? 0) && (
        <div class="mth-note" data-testid="mth-lost">
          SHIP LOST
          <small>{s.lives > 0 ? "The next one is beaming in. Nothing else has changed." : ""}</small>
        </div>
      )}
      {s.phase === "flying" && !back && sb.world.bodies.some((b) => b.id === game.spec.tractor.replaceAll("{n}", String(s.n)) && b.tractor?.siphoning) && (
        <div class="mth-note" data-testid="mth-refuel">
          REFUELLING
        </div>
      )}
      {s.phase === "flying" && back && (
        <div class="mth-note" data-testid="mth-back">
          BACK YOU GO
          <small>You left without the pod. Finish the mission.</small>
        </div>
      )}
      {!playing.value && !over && !won && (
        <div class="mas-modal" data-testid="mth-paused">
          <h2>Paused</h2>
          {zoomed.value && <p>The page is zoomed in. Pinch outwards to zoom back out, then resume.</p>}
          <button class="mas-btn" disabled={zoomed.value} onClick={() => (playing.value = true)} data-testid="mth-resume">
            Resume
          </button>
          <SwapSides className="mas-btn" />
          <button class="mas-btn" onClick={quit} data-testid="mth-quit">
            Quit to title
          </button>
        </div>
      )}
      {won && <Won level={level} score={s.score} lives={s.lives} pod={s.bonus?.pod ?? 0} fuel={s.bonus?.fuel ?? 0} />}
      {over && <GameOver score={s.score} level={level} reason={s.reason} />}
      {!over && !won && (
        <>
          <Thrust channel={asteroidsSide("left")} label="L" side="left" className="mas-thrust" />
          <Thrust channel="reverse" label="REV" side="reverse" className="mas-thrust" />
          <Thrust channel="tractor" label="BEAM" side="tractor" className="mas-thrust" />
          <Thrust channel="fire" label="FIRE" side="fire" className="mas-thrust" />
          <Thrust channel={asteroidsSide("right")} label="R" side="right" className="mas-thrust" />
        </>
      )}
    </div>
  );
}

function quit(): void {
  playing.value = false;
  thrustScreen.value = "title";
}

/** The pod is out: what it scored, and on to the next level with the score and ships carried over. */
function Won({ level, score, lives, pod, fuel }: { level: number; score: number; lives: number; pod: number; fuel: number }) {
  const last = level >= LEVELS;
  return (
    <div class="mas-modal" data-testid="mth-won">
      <h2>{last ? "Mission complete" : `Level ${level} complete`}</h2>
      <p>
        The pod <b>+{pod}</b> · fuel left <b>+{fuel}</b>
      </p>
      <p>
        Score <b>{score}</b>
      </p>
      {last ? (
        <div class="mas-row">
          <button class="mas-btn" onClick={() => startThrust()} data-testid="mth-again">
            Play again
          </button>
          <button class="mas-btn" onClick={quit}>
            Title
          </button>
        </div>
      ) : (
        <button class="mas-btn" onClick={() => openLevel(level + 1, true, { score, lives })} data-testid="mth-next">
          Next level
        </button>
      )}
    </div>
  );
}

function GameOver({ score, level, reason }: { score: number; level: number; reason?: "ships" | "pod" }) {
  return (
    <div class="mas-modal" data-testid="mth-over">
      <h2>Game over</h2>
      <p>{reason === "pod" ? "The pod was destroyed." : "No ships left."}</p>
      <p>
        Score <b>{score}</b> · level <b>{level}</b>
      </p>
      <div class="mas-row">
        <button class="mas-btn" onClick={() => startThrust()} data-testid="mth-again">
          Play again
        </button>
        <button class="mas-btn" onClick={quit}>
          Title
        </button>
      </div>
    </div>
  );
}
