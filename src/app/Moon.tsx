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
import { aimFrom, bestTime, cameraFor, clock, LEVELS, saveBest, snapAim, type MoonCam } from "./moonHud.ts";
import { moonAim } from "../core/index.ts";

export const moonScreen = signal<"title" | "play">("title");

/**
 * The level played: 1 or 2 from the title, or the one the page's address names (`moon.html?level=2`;
 * `?level=test` and `?level=test2` play the small test moons).
 */
const level = signal<string>(
  (() => {
    const q = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("level");
    return q === "test" ? "moon-test" : q === "test2" ? "moon-test-2" : q === "2" ? "moon-2" : "moon-1";
  })(),
);
const levelName = (): string => level.value;

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

export function startMoon(name?: string): void {
  releaseKeys();
  if (typeof name === "string") level.value = name;
  aim = null;
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
      if (w.moon.spec.tools && playing.value) aimTick(dt, vp, next.below);
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

/**
 * The aim (MMN-100…MMN-103), one for the rifle and the hook: the angle last sent, in the mammoth's
 * own frame (0 to its right, a quarter turn up). The mouse points it, the aim keys swing it, the
 * touch stick and a controller's right stick set it.
 */
let aim: number | null = null;
/** Where the mouse last was over the view, px from its top left; and which way the aim keys are swinging it. */
let mouse: { x: number; y: number } | null = null;
let swing = 0;
/** How fast the aim keys swing the aim, rad/s. */
const SWING = 2.6;

function setAim(angle: number): void {
  const a = snapAim(angle);
  if (a === aim || !sandbox.value) return;
  aim = a;
  sendControl("aim", a, "Aim", 11_000_000);
}

/** Each frame: the aim follows whatever is pointing it. `below` is how far under the view's middle the mammoth is drawn, px. */
function aimTick(dt: number, vp: { width: number; height: number }, below: number): void {
  // A controller's right stick, pushed far enough to mean a direction.
  for (const pad of typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!pad) continue;
    const x = pad.axes[2] ?? 0;
    const y = pad.axes[3] ?? 0;
    if (Math.hypot(x, y) > 0.4) {
      mouse = null;
      return setAim(Math.atan2(-y, x));
    }
  }
  if (swing !== 0) {
    const w = sandbox.value?.world;
    const from = aim ?? (w ? moonAim(w)?.angle : undefined) ?? 0;
    mouse = null;
    return setAim(from + swing * SWING * dt);
  }
  if (mouse) setAim(aimFrom(mouse, vp, below));
}

/** The keys: each holds its channel on while it is down (MMN-070). Up is a jump too, but on the rope, where it reels in. */
const KEYS: Record<string, string> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "jump",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "duck",
  KeyS: "duck",
  ShiftLeft: "roll",
  ShiftRight: "roll",
  KeyX: "roll",
  KeyF: "fire",
  KeyG: "hook",
};
/** The keys that swing the aim: Q toward up-and-back (counter-clockwise), E the other way. */
const AIM_KEYS: Record<string, number> = { KeyQ: 1, KeyE: -1 };
const aimKeys = new Set<string>();
const swingNow = () => {
  swing = 0;
  for (const k of aimKeys) swing += AIM_KEYS[k];
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
  aimKeys.clear();
  swing = 0;
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
  if (AIM_KEYS[e.code]) {
    e.preventDefault();
    aimKeys.add(e.code);
    swingNow();
    return;
  }
  if (e.code === "KeyP" || e.code === "Escape") {
    e.preventDefault();
    if (!won()) playing.value = !playing.value;
  }
}

export function moonKeyUp(e: KeyboardEvent): void {
  release(e.code);
  if (aimKeys.delete(e.code)) swingNow();
  // Windows sends no release for a Shift let go while the other is still down.
  if (!e.shiftKey) for (const code of ["ShiftLeft", "ShiftRight"]) release(code);
}

/**
 * A game controller (gamepad.ts): the stick or D-pad runs, and up and down on it reel the rope; A
 * jumps; B, or down, ducks; X or the right bumper rolls; the right trigger fires; the left trigger,
 * or Y, is the hook. The right stick aims (aimTick).
 */
function padControls(p: PadState): string[] {
  const out: string[] = [];
  if (p.left) out.push("left");
  if (p.right) out.push("right");
  if (p.up) out.push("up");
  if (p.a) out.push("jump");
  if (p.b || p.down) out.push("duck");
  if (p.x || p.rb) out.push("roll");
  if (p.rt) out.push("fire");
  if (p.lt || p.y) out.push("hook");
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

/** The touch stick that aims (MMN-103): held and dragged, the aim is from its middle to the finger. */
function AimStick() {
  const point = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < 8) return;
    mouse = null;
    setAim(Math.atan2(-y, x));
  };
  return (
    <div
      class="mmn-stick"
      aria-label="Aim"
      data-testid="mmn-aim"
      onPointerDown={(e) => {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // A synthetic press (tests) has no pointer to capture.
        }
        point(e);
      }}
      onPointerMove={(e) => (e.buttons || e.pointerType === "touch") && point(e)}
      onContextMenu={(e) => e.preventDefault()}
      onTouchEnd={(e) => e.preventDefault()}
    >
      AIM
    </div>
  );
}

/**
 * The mouse over the view (MMN-103): it points the aim; its left button fires and its right is the
 * hook. A finger on the view does nothing: touch has its own stick and buttons.
 */
function MouseAim() {
  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div
      class="mas-shield mmn-mouse"
      data-testid="mmn-mouse"
      onPointerMove={(e) => e.pointerType === "mouse" && at(e)}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse") return;
        at(e);
        if (e.button === 0) press("Mouse:fire", "fire");
        else if (e.button === 2) press("Mouse:hook", "hook");
      }}
      onPointerUp={(e) => {
        if (e.button === 0) release("Mouse:fire");
        else if (e.button === 2) release("Mouse:hook");
      }}
      onPointerLeave={() => {
        release("Mouse:fire");
        release("Mouse:hook");
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
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
          <button class="mas-btn" onClick={() => startMoon()} data-testid="mmn-start">
            Play
          </button>
        </div>
        <div class="mas-row" data-testid="mmn-levels">
          {LEVELS.map((l) => (
            <button key={l.name} class={`mas-btn small${l.name === levelName() ? " on" : ""}`} onClick={() => startMoon(l.name)} data-testid={`mmn-level-${l.n}`}>
              Level {l.n}
              {bestTime(l.name) !== null ? ` · ${clock(bestTime(l.name)!)}` : ""}
            </button>
          ))}
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
  const tools = !!game.spec.tools;
  return (
    <div class="mas-play" data-testid="mmn-play">
      <View />
      {/* The world under the HUD takes no taps: no sandbox tools in the game. With the rifle and the hook, the mouse aims over it. */}
      {tools && !done ? <MouseAim /> : <div class="mas-shield" />}
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
          {tools && <small data-testid="mmn-tools-note">Aim with the mouse, or Q and E. Click or F fires. Right-click or G casts the hook: up and down reel it, jump lets go.</small>}
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
          <button class="mas-btn" onClick={() => startMoon()} data-testid="mmn-restart">
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
          {tools && (
            <>
              <Hold channel="up" label="▲" name="Up" />
              <AimStick />
              <Hold channel="fire" label="FIRE" name="Fire" />
              <Hold channel="hook" label="HOOK" name="Hook" />
            </>
          )}
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
  const next = LEVELS[LEVELS.findIndex((l) => l.name === levelName()) + 1];
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
        {next && (
          <button class="mas-btn" onClick={() => startMoon(next.name)} data-testid="mmn-next">
            Level {next.n}
          </button>
        )}
        <button class="mas-btn" onClick={() => startMoon()} data-testid="mmn-again">
          Play again
        </button>
        <button class="mas-btn" onClick={quit}>
          Title
        </button>
      </div>
    </div>
  );
}
