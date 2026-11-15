// Moon Mammoth (docs/games/moon-mammoth.md): the title over the moon turning, play with a HUD and
// touch buttons, the pause menu, and the result. Play runs the sandbox's world and view underneath at
// the fixed game pace, with none of its panels or tools. The game itself is in the world
// (src/core/moon.ts); this is only its page.
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { scenarioFile } from "./scenarios.ts";
import { camera, GAME_PACE, openScenario, overlays, playing, sandbox, screen, setFollow, timeScale, version, viewport } from "./state.ts";
import { shown } from "./smooth.ts";
import { View } from "./View.tsx";
import { usePad, type PadGame, type PadState } from "./gamepad.ts";
import { sendControl, useNoZoom, zoomed } from "./Lander.tsx";
import { moonView } from "./moonRender.ts";
import { bestTime, cameraFor, clock, saveBest, type MoonCam } from "./moonHud.ts";

export const moonScreen = signal<"title" | "play">("title");

/** The level played: `moon.html?level=test` plays the small test moon. */
function levelName(): string {
  const q = new URLSearchParams(window.location.search).get("level");
  return q === "test" ? "moon-test" : "moon-1";
}

/** Opens the level: the player's game (running), or the title's moon (not running). */
function openLevel(run: boolean): boolean {
  const name = levelName();
  const file = scenarioFile(name);
  if (!file) return false;
  if (!openScenario(structuredClone(file), name)) return false;
  // In the game nothing reads the conservation ledger: its bookkeeping is skipped (the physics is the
  // same), unless the address asks for it (`?ledger=1`).
  const sb = sandbox.value;
  if (sb && new URLSearchParams(window.location.search).get("ledger") !== "1") sb.world.ledgerOff = true;
  screen.value = "lander"; // openScenario switches to the sandbox: this is a game
  timeScale.value = 1;
  overlays.value = new Set();
  playing.value = run;
  return true;
}

export function startMoon(): void {
  releaseKeys();
  if (!openLevel(true)) return;
  moonView.title = false;
  moonScreen.value = "play";
}

/** The view follows the mammoth round the moon (MMN-060); the drawing turns it upright (moonRender.ts). */
function useFollowCamera(): void {
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    let cam: MoonCam | null = null;
    let then = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - then) / 1000);
      then = now;
      const w = sandbox.value?.world;
      const vp = viewport.value;
      if (!w?.moon || !vp.width || !vp.height) return;
      const next = cameraFor(w, shown.time - w.time, vp, cam, dt);
      if (!next) return;
      cam = next.cam;
      const c = camera.value;
      if (c.x !== next.x || c.y !== next.y || c.zoom !== next.zoom) camera.value = { x: next.x, y: next.y, zoom: next.zoom };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** The title's view: the whole moon in the middle. */
function useTitleCamera(): void {
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const game = sandbox.value?.world.moon;
      const vp = viewport.value;
      if (!game || !vp.width || !vp.height) return;
      const c0 = game.spec.centre;
      const r = Math.hypot(game.spec.flags[0].at.x - c0.x, game.spec.flags[0].at.y - c0.y);
      const zoom = Math.min(vp.width, vp.height) / (2.5 * r);
      const c = camera.value;
      if (c.x !== c0.x || c.y !== c0.y || c.zoom !== zoom) camera.value = { x: c0.x, y: c0.y, zoom };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** The keys: each holds its channel on while it is down (MMN-070). */
const KEYS: Record<string, string> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "jump",
  ArrowUp: "jump",
  KeyW: "jump",
  ArrowDown: "duck",
  KeyS: "duck",
  ShiftLeft: "roll",
  ShiftRight: "roll",
  KeyX: "roll",
};
/** What is held (a key, a pad button or a touch button), each with its channel; and how many hold each channel. */
const down = new Map<string, string>();
const held: Record<string, number> = {};
let group = 10_000_000;

function hold(channel: string, by: number): void {
  const was = held[channel] ?? 0;
  held[channel] = Math.max(0, was + by);
  if (was === 0 && held[channel] > 0) sendControl(channel, 1, `Key ${channel}`, ++group);
  else if (was > 0 && held[channel] === 0) sendControl(channel, 0, `Key ${channel}`, group);
}
function press(by: string, channel: string): void {
  if (down.has(by) || !sandbox.value) return;
  down.set(by, channel);
  hold(channel, 1);
}
function release(by: string): void {
  const channel = down.get(by);
  if (!channel) return;
  down.delete(by);
  if (sandbox.value) hold(channel, -1);
}
/** Lets go of everything (leaving play, or the window losing the keyboard). */
function releaseKeys(): void {
  down.clear();
  for (const c of Object.keys(held)) {
    if (held[c] > 0 && sandbox.value) sendControl(c, 0, `Key ${c}`, group);
    held[c] = 0;
  }
}

const won = (): boolean => sandbox.value?.world.moon?.state.phase === "won";

export function moonKeyDown(e: KeyboardEvent): void {
  if (moonScreen.value !== "play" || !sandbox.value || e.metaKey || e.ctrlKey) return;
  if (!e.shiftKey) for (const code of ["ShiftLeft", "ShiftRight"]) release(code);
  const channel = KEYS[e.code];
  if (channel) {
    e.preventDefault();
    press(e.code, channel);
    return;
  }
  if (e.code === "KeyP" || e.code === "Escape") {
    e.preventDefault();
    if (!won()) playing.value = !playing.value;
  }
}

export function moonKeyUp(e: KeyboardEvent): void {
  release(e.code);
  // Windows sends no release for a Shift let go while the other is still down.
  if (!e.shiftKey) for (const code of ["ShiftLeft", "ShiftRight"]) release(code);
}

/** A game controller (gamepad.ts): the stick or D-pad runs; A jumps; B, or the stick or D-pad down, ducks; X, the right bumper or trigger rolls. */
function padControls(p: PadState): string[] {
  const out: string[] = [];
  if (p.left) out.push("left");
  if (p.right) out.push("right");
  if (p.a) out.push("jump");
  if (p.b || p.down) out.push("duck");
  if (p.x || p.rb || p.rt) out.push("roll");
  return out;
}
const PAD: PadGame = {
  flying: () => moonScreen.value === "play" && !!sandbox.value && playing.value && !won(),
  controls: padControls,
  set: (channel, on) => (on ? press(`Pad:${channel}`, channel) : release(`Pad:${channel}`)),
  pause: () => {
    if (moonScreen.value !== "play" || !sandbox.value || won()) return false;
    playing.value = !playing.value;
    return true;
  },
};

/** A touch button: holds its channel while pressed; mouse, touch or pen, several at once. */
function Hold({ channel, label, name }: { channel: string; label: string; name: string }) {
  const id = useRef(`Touch:${channel}`);
  return (
    <button
      class={`mmn-touch ${channel}`}
      aria-label={name}
      data-testid={`mmn-${channel}`}
      data-hold
      onPointerDown={(e) => {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // A synthetic press (tests) has no pointer to capture.
        }
        press(id.current, channel);
      }}
      onPointerUp={() => release(id.current)}
      onPointerCancel={() => release(id.current)}
      onLostPointerCapture={() => release(id.current)}
      onContextMenu={(e) => e.preventDefault()}
      // No click, so no double-tap zoom, from fast presses (the press itself is a pointer event).
      onTouchEnd={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export function MoonApp() {
  useNoZoom();
  usePad(PAD);
  return (
    <main class="mas mmn" data-testid="mmn">
      {moonScreen.value === "title" && <Title />}
      {moonScreen.value === "play" && sandbox.value && <Play />}
    </main>
  );
}

/** The title: the name and Play over the moon, slowly turning (MMN-001). */
function Title() {
  void version.value;
  useTitleCamera();
  const still = !!sandbox.value?.world.moon;
  useEffect(() => {
    moonView.title = true;
    if (!still) openLevel(false);
    else playing.value = false;
  }, [still]);
  const best = bestTime(levelName());
  return (
    <div class="mas-play" data-testid="mmn-title">
      {still && <View />}
      <div class="mas-shield" />
      <div class="mas-title over">
        <h1>MOON MAMMOTH</h1>
        <div class="mas-col">
          <button class="mas-btn" onClick={startMoon} data-testid="mmn-start">
            Play
          </button>
        </div>
        {best !== null && (
          <p class="mmn-best" data-testid="mmn-best">
            Best lap <b>{clock(best)}</b>
          </p>
        )}
        <p class="mas-credit">by Chloe Bolland © 2026</p>
      </div>
    </div>
  );
}

/** How long the note stays up after the mammoth is sent back, game s. */
const BACK_NOTE = 0.8;
const WHY = { time: ["TOO SLOW", "Back to the flag."], spikes: ["OUCH", "Jump the spikes."], rock: ["SQUASHED", "Roll out from under it."] } as const;

function Play() {
  void version.value;
  const sb = sandbox.value!;
  const game = sb.world.moon;
  const phase = game?.state.phase;

  useFollowCamera();
  useEffect(() => {
    window.addEventListener("blur", releaseKeys);
    return () => {
      window.removeEventListener("blur", releaseKeys);
      releaseKeys();
    };
  }, []);
  // The run is finished: the world rests, the keys are let go, and the time is kept if it is the best.
  useEffect(() => {
    if (phase !== "won") return;
    releaseKeys();
    playing.value = false;
    const s = sandbox.value?.world.moon?.state;
    if (s) saveBest(levelName(), s.elapsed / GAME_PACE);
  }, [phase]);

  if (!game) return null;
  const s = game.state;
  const done = s.phase === "won";
  // What the player sees is twice the game's time (the game runs at one in two).
  const left = Math.max(0, s.left / GAME_PACE);
  const back = s.back && sb.world.time - s.back.at < BACK_NOTE ? WHY[s.back.why] : null;
  return (
    <div class="mas-play" data-testid="mmn-play">
      <View />
      {/* The world under the HUD takes no taps: no sandbox tools in the game. */}
      <div class="mas-shield" />
      <div class="mas-hud" data-testid="mmn-hud">
        <span data-testid="mmn-flag">
          FLAG <b>{s.flag}</b>/{game.spec.flags.length - 1}
        </span>
        <span data-testid="mmn-time">
          LAP <b>{clock(s.elapsed / GAME_PACE)}</b>
        </span>
        <span data-testid="mmn-tries">
          TRIES <b>{s.tries}</b>
        </span>
        {!done && (
          <span class="mas-hud-buttons">
            <button class="mas-btn small" onClick={() => (playing.value = !playing.value)} data-testid="mmn-pause">
              {playing.value ? "Pause" : "Resume"}
            </button>
          </span>
        )}
      </div>
      {!done && (
        <div class={`mmn-timer${left <= 3 ? " low" : ""}`} data-testid="mmn-left">
          {left.toFixed(1)}
        </div>
      )}
      {!done && s.phase === "waiting" && playing.value && (
        <div class="mth-note mmn-note" data-testid="mmn-ready">
          GO WHEN YOU'RE READY
          <small>The clock starts when you move. Reach each flag before the timer runs out.</small>
        </div>
      )}
      {!done && back && (
        <div class="mth-note mmn-note" data-testid="mmn-back">
          {back[0]}
          <small>{back[1]}</small>
        </div>
      )}
      {!playing.value && !done && (
        <div class="mas-modal" data-testid="mmn-paused">
          <h2>Paused</h2>
          {zoomed.value && <p>The page is zoomed in. Pinch outwards to zoom back out, then resume.</p>}
          <button class="mas-btn" disabled={zoomed.value} onClick={() => (playing.value = true)} data-testid="mmn-resume">
            Resume
          </button>
          <button class="mas-btn" onClick={startMoon} data-testid="mmn-restart">
            Start again
          </button>
          <button class="mas-btn" onClick={quit} data-testid="mmn-quit">
            Quit to title
          </button>
        </div>
      )}
      {done && <Won time={s.elapsed / GAME_PACE} tries={s.tries} />}
      {!done && (
        <>
          <Hold channel="left" label="◀" name="Left" />
          <Hold channel="right" label="▶" name="Right" />
          <Hold channel="duck" label="DUCK" name="Duck" />
          <Hold channel="roll" label="ROLL" name="Roll" />
          <Hold channel="jump" label="JUMP" name="Jump" />
        </>
      )}
    </div>
  );
}

function quit(): void {
  playing.value = false;
  releaseKeys();
  moonScreen.value = "title";
}

/** The lap is run: its time, the tries, and the best on this device (MMN-055). */
function Won({ time, tries }: { time: number; tries: number }) {
  const best = bestTime(levelName());
  return (
    <div class="mas-modal" data-testid="mmn-won">
      <h2>Lap complete</h2>
      <p>
        Time <b data-testid="mmn-won-time">{clock(time)}</b> · tries <b>{tries}</b>
      </p>
      {best !== null && (
        <p>
          {best >= time - 0.005 ? "A new best." : "Best"} <b>{clock(best)}</b>
        </p>
      )}
      <div class="mas-row">
        <button class="mas-btn" onClick={startMoon} data-testid="mmn-again">
          Play again
        </button>
        <button class="mas-btn" onClick={quit}>
          Title
        </button>
      </div>
    </div>
  );
}
