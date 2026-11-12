// Mammoth Lander (docs/games/mammoth-lander.md): the title, the scenario select, play with a HUD
// and touch thrust buttons, game over with initials, and the high scores. Play runs the sandbox's
// world and view underneath, at a fixed 1× (LND-003), with none of its panels or tools (LND-002).
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { scenarioFile } from "./scenarios.ts";
import { addScore, best, loadScores, qualifies, type ScoreTable } from "./landerScores.ts";
import { bindings, camera, edit, openScenario, overlays, playing, sandbox, screen, setFollow, setSwapSides, swapSides, timeScale, version, viewport } from "./state.ts";
import { shown } from "./smooth.ts";
import { diag, liveStats, summary } from "./diag.ts";
import { sim, View } from "./View.tsx";
import { ABANDON, canonicalStringify, LANDER_DESTRUCT } from "../core/index.ts";
import { levelPreview } from "./levelPreview.ts";
import { usePad, type PadGame } from "./gamepad.ts";

/** The scenarios, in order; those without a file yet are shown as coming soon. */
export const LANDER_SCENARIOS: { key: string; title: string; blurb: string }[] = [
  { key: "lander-easy", title: "Easy", blurb: "Rolling ground, five pads, plenty of fuel." },
  { key: "lander-medium", title: "Medium", blurb: "Lunar peaks; pads on slopes and in valleys. Fuel matters." },
  { key: "lander-hard", title: "Hard", blurb: "Sheer mountains and narrow ledges." },
  { key: "lander-cave", title: "Cave", blurb: "Thread the stalactites; deeper pads score more." },
  { key: "lander-cave-2", title: "Cave 2", blurb: "A long cave that curls round; pads score by number, up to ×6." },
  { key: "lander-emergency", title: "Emergency", blurb: "Come in fast and spinning, with a fuel leak pushing you about." },
  { key: "lander-orbital", title: "Orbital", blurb: "Come down from orbit onto a slowly spinning asteroid." },
  { key: "lander-binary", title: "Binary", blurb: "Two asteroids orbiting each other; both pull on you." },
  { key: "lander-heavy-orbital", title: "Heavy Orbital", blurb: "A heavier asteroid, spinning faster, with stronger gravity." },
];

const rawOf = (key: string) => scenarioFile(key);

export const landerScreen = signal<"title" | "select" | "play" | "scores" | "howto" | "physics">("title");
/** The scenario being played (or whose scores are shown). */
export const landerKey = signal<string>("lander-easy");

/**
 * The game on its own page (lander.html), deployed without the sandbox: nothing leads back to it.
 * Set once at start-up.
 */
export const standalone = signal(false);

/** In the game, the left and right Shift keys are the left and right controls: hands apart, like the thumb pads. */
const GAME_KEYS: Record<string, string> = { ShiftLeft: "left", ShiftRight: "right", ControlLeft: "left", ControlRight: "right" };
/** ↑ is both engines, as in Mammoth Asteroids. */
const BOTH = "ArrowUp";
const keyGroups: Record<string, number> = {};
/** The channel each held key went to: it is let go on the same one, whatever the option says by then. */
const keyChannels: Record<string, string> = {};

const otherSide = (c: string): string => (c === "left" ? "right" : c === "right" ? "left" : c);
/**
 * Lander's left and right controls (LND-035): a left control turns the ship left, which is its
 * right engine, as in Mammoth Asteroids. With the option on, a left control is the left engine.
 */
export const landerSide = (c: string): string => (swapSides.value ? c : otherSide(c));
/** Mammoth Asteroids' (MAS-053): a left control turns the ship left; with the option on, right. */
export const asteroidsSide = (c: string): string => (swapSides.value ? otherSide(c) : c);

/** The option in both games' pause menus: left and right the other way round. */
export function SwapSides({ className }: { className: string }) {
  return (
    <button class={className} role="switch" aria-checked={swapSides.value} onClick={() => setSwapSides(!swapSides.value)} data-testid="swap-sides">
      Swap left and right: {swapSides.value ? "on" : "off"}
    </button>
  );
}
let keyCounter = 5_000_000;

/**
 * The game's keys (on both pages): the engines (Shift left and right, Q/E, the arrows), and P or Esc
 * to pause. Nothing else does anything in the game.
 */
export function gameKeyDown(e: KeyboardEvent): void {
  const key = e.key.toLowerCase();
  if (!GAME_KEYS[e.code]) dropShifts(e);
  if (e.code === BOTH && sandbox.value && !e.metaKey) {
    e.preventDefault();
    for (const side of ["left", "right"]) {
      const pk = `${BOTH}:${side}`;
      if (keyGroups[pk] !== undefined) continue;
      keyGroups[pk] = ++keyCounter;
      keyChannels[pk] = side;
      sendControl(side, 1, "Key ↑", keyGroups[pk]);
    }
    return;
  }
  const control = GAME_KEYS[e.code] || bindings.value[key];
  // A game key works with Ctrl held too: Ctrl is itself a control.
  if (control && sandbox.value && !e.metaKey) {
    e.preventDefault();
    if (!e.repeat) {
      // Both Shift keys are "shift": the game's are told apart by where they are.
      const pk = GAME_KEYS[e.code] ? e.code : key;
      keyGroups[pk] = ++keyCounter;
      keyChannels[pk] = landerSide(control);
      // Keys go in as live input (no stall at each press).
      sendControl(keyChannels[pk], 1, `Key ${key.toUpperCase()}`, keyGroups[pk]);
    }
    return;
  }
  if ((key === "p" || key === "escape") && sandbox.value) {
    e.preventDefault();
    playing.value = !playing.value;
  }
}

/** Lets go of one held key, if it was held. */
function releaseKey(pk: string, name: string): void {
  if (!sandbox.value || keyGroups[pk] === undefined) return;
  const channel = keyChannels[pk];
  const group = keyGroups[pk];
  delete keyGroups[pk];
  delete keyChannels[pk];
  // Another key still holding the same engine keeps it on.
  if (Object.values(keyChannels).includes(channel)) return;
  sendControl(channel, 0, `Key ${name.toUpperCase()}`, group);
}

/**
 * Windows sends no release for a Shift let go while the other Shift is still down (and the same
 * for Ctrl). So when an event says no Shift is held, neither is: both are let go.
 */
function dropShifts(e: KeyboardEvent): void {
  if (!e.shiftKey) for (const code of ["ShiftLeft", "ShiftRight"]) releaseKey(code, "shift");
  if (!e.ctrlKey) for (const code of ["ControlLeft", "ControlRight"]) releaseKey(code, "ctrl");
}

export function gameKeyUp(e: KeyboardEvent): void {
  const key = e.key.toLowerCase();
  if (e.code === BOTH) for (const side of ["left", "right"]) releaseKey(`${BOTH}:${side}`, "↑");
  releaseKey(GAME_KEYS[e.code] ? e.code : key, key);
  dropShifts(e);
}

/**
 * A game controller (gamepad.ts): the stick, D-pad, bumpers or triggers are left and right, and A
 * is both engines together.
 */
const PAD: PadGame = {
  flying: () => landerScreen.value === "play" && !!sandbox.value && playing.value,
  controls: (p) => [...(p.left || p.lb || p.lt || p.a ? ["left"] : []), ...(p.right || p.rb || p.rt || p.a ? ["right"] : [])],
  set: (control, on) => {
    const pk = `pad-${control}`;
    if (!on) return releaseKey(pk, "pad");
    if (!sandbox.value || keyGroups[pk] !== undefined) return;
    keyGroups[pk] = ++keyCounter;
    keyChannels[pk] = landerSide(control);
    sendControl(keyChannels[pk], 1, "Pad", keyGroups[pk]);
  },
  pause: () => {
    if (landerScreen.value !== "play" || !sandbox.value || sandbox.value.world.lander?.state.phase === "over") return false;
    playing.value = !playing.value;
    return true;
  },
};

/** Opens the game's title screen. */
export function openLander(): void {
  landerScreen.value = "title";
  screen.value = "lander";
}

function startGame(key: string): void {
  const raw = rawOf(key);
  if (!raw || !openScenario(raw, key)) return;
  screen.value = "lander"; // openScenario switches to the sandbox
  landerKey.value = key;
  timeScale.value = 1;
  overlays.value = new Set();
  // Q/E from the scenario; the arrow keys too.
  bindings.value = { ...bindings.value, arrowleft: "left", arrowright: "right" };
  landerScreen.value = "play";
  playing.value = true;
}

/** The page is zoomed in by the browser (a pinch on iPad): the game pauses until it's back. */
export const zoomed = signal(false);

/**
 * Keeps the browser from zooming the game (LND-030). Two thumbs on the pads moving apart are a pinch,
 * and Safari zooms on a pinch whatever the page says (it ignores `user-scalable=no`), so the pinch
 * and double-tap gestures are cancelled here. If it zooms anyway, the game pauses until it's back.
 */
export function useNoZoom(): void {
  useEffect(() => {
    // Once zoomed, a pinch is let through: it's the way back out.
    const stop = (e: Event) => {
      if (!zoomed.value) e.preventDefault();
    };
    const twoFingers = (e: TouchEvent) => {
      if (e.touches.length > 1 && !zoomed.value) e.preventDefault();
    };
    const opts = { passive: false } as const;
    for (const type of ["gesturestart", "gesturechange", "gestureend", "dblclick"]) document.addEventListener(type, stop, opts);
    document.addEventListener("touchmove", twoFingers, opts);
    // Browsers that honour it (not Safari) won't zoom at all; on iOS, setting it can also undo a zoom.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const was = meta?.content;
    if (meta) meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
    const vv = window.visualViewport;
    const check = () => {
      zoomed.value = !!vv && vv.scale > 1.02;
      if (zoomed.value) playing.value = false;
    };
    vv?.addEventListener("resize", check);
    check();
    // The game fills the screen and never scrolls: iPadOS scrolled the page to show a focused text
    // box (the diagnostics log), leaving the view shifted up with empty space below.
    const html = document.documentElement;
    const was2 = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const unscroll = () => {
      // Not while zoomed in: the player may need to move about to pinch back out.
      if (!zoomed.value && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);
    };
    window.addEventListener("scroll", unscroll);
    vv?.addEventListener("scroll", unscroll);
    unscroll();
    return () => {
      html.style.overflow = was2.html;
      document.body.style.overflow = was2.body;
      window.removeEventListener("scroll", unscroll);
      vv?.removeEventListener("scroll", unscroll);
      for (const type of ["gesturestart", "gesturechange", "gestureend", "dblclick"]) document.removeEventListener(type, stop);
      document.removeEventListener("touchmove", twoFingers);
      if (meta && was !== undefined) meta.content = was;
      vv?.removeEventListener("resize", check);
      zoomed.value = false;
    };
  }, []);
}

export function LanderApp() {
  useNoZoom();
  usePad(PAD);
  return (
    <main class="lander" data-testid="lander">
      {landerScreen.value === "title" && <Title />}
      {landerScreen.value === "select" && <Select />}
      {landerScreen.value === "play" && sandbox.value && <Play />}
      {landerScreen.value === "scores" && <Scores />}
      {landerScreen.value === "howto" && <HowToPlay />}
      {landerScreen.value === "physics" && <Physics />}
    </main>
  );
}

const CREDIT = "by Chloe Bolland © 2026";

function Title() {
  return (
    <button class="lander-title" onClick={() => (landerScreen.value = "select")} data-testid="lander-title">
      <h1>MAMMOTH LANDER</h1>
      <p class="credit" data-testid="lander-credit">
        {CREDIT}
      </p>
      <p class="tap">Tap to start</p>
    </button>
  );
}

function Select() {
  const table = loadScores();
  return (
    <div class="lander-select" data-testid="lander-select">
      <h1 class="lander-heading">MAMMOTH LANDER</h1>
      <h2>Choose a mission</h2>
      <div class="lander-cards">
        {LANDER_SCENARIOS.map((s) => {
          const ready = !!rawOf(s.key);
          const top = best(table, s.key);
          return (
            <button key={s.key} class="lander-card" disabled={!ready} onClick={() => startGame(s.key)} data-testid={`lander-pick-${s.key}`}>
              {ready && <Preview level={s.key} />}
              <span class="name">{s.title}</span>
              <span class="blurb">{ready ? s.blurb : "Coming soon"}</span>
              {top && (
                <span class="best">
                  Best {top.score} · {top.initials}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div class="lander-row">
        <button class="lander-btn" onClick={() => (landerScreen.value = "scores")}>
          High scores
        </button>
        <button class="lander-btn ghost" onClick={() => (landerScreen.value = "howto")} data-testid="lander-howto">
          How to play
        </button>
        <button class="lander-btn ghost" onClick={() => (landerScreen.value = "physics")} data-testid="lander-physics">
          The physics
        </button>
        {!standalone.value && (
          <button class="lander-btn ghost" onClick={() => (screen.value = "picker")}>
            Back to the sandbox
          </button>
        )}
      </div>
      <p class="lander-credit">{CREDIT}</p>
    </div>
  );
}

/** A picture of the level on its card, drawn once the screen is up (the first drawing takes a moment). */
function Preview({ level }: { level: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setUrl(levelPreview(level, rawOf(level))), 0);
    return () => clearTimeout(t);
  }, [level]);
  return <span class="preview">{url && <img src={url} alt="" data-testid={`lander-preview-${level}`} />}</span>;
}

/**
 * Sets a control channel from the game: while running, straight to the simulation as live input (no
 * stall); paused, an ordinary edit, after any input still queued (so a release while paused isn't
 * undone by its press when play resumes).
 */
export function sendControl(channel: string, value: number, label: string, group: number): void {
  const cmd = [{ type: "control.set" as const, channel, value }];
  if (playing.value && sim.input(cmd)) return;
  if (sandbox.value) sim.flush(sandbox.value);
  edit(cmd, label, group);
}

/** Holds a channel at full while pressed: mouse, touch or pen, several at once (LND-030). */
export function Thrust({ channel, label, side, className = "lander-thrust" }: { channel: string; label: string; side: string; className?: string }) {
  const group = useRef(0);
  const down = useRef(false);
  const set = (on: boolean) => {
    if (on === down.current) return;
    down.current = on;
    if (on) group.current = Math.floor(Math.random() * 1e9);
    sendControl(channel, on ? 1 : 0, `Thrust ${label}`, group.current);
  };
  return (
    <button
      class={`${className} ${side}`}
      aria-label={side === "fire" ? "Fire" : side === "reverse" ? "Reverse" : side === "tractor" ? "Tractor" : side === "left" ? "Left" : "Right"}
      data-testid={`thrust-${side}`}
      data-hold
      onPointerDown={(e) => {
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // A synthetic press (tests) has no pointer to capture.
        }
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
      // No click, so no double-tap zoom, from fast presses (the press itself is a pointer event).
      onTouchEnd={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

/** How long the self-destruct button waits for its second press, ms. */
const DESTRUCT_CONFIRM = 3000;

/**
 * Self-destruct (LND-036), beside Pause, as in Mammoth Asteroids: two presses, so one stray touch
 * doesn't cost a ship. The first asks, the second (within 3 s) does it.
 */
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
    sendControl(LANDER_DESTRUCT, 1, "Self-destruct", Math.floor(Math.random() * 1e9));
  };
  return (
    <button class={`lander-btn small${asking ? " danger" : ""}`} onClick={press} data-testid="lander-destruct">
      {asking ? "Confirm self-destruct" : "Self-destruct"}
    </button>
  );
}

/** Seconds of game time a ship must stay at rest before it can be abandoned. */
const ABANDON_AFTER = 4;

function Play() {
  const restSince = useRef<number | null>(null);
  void version.value;
  const sb = sandbox.value!;
  const game = sb.world.lander;
  const status = sb.world.challenge?.status;
  const goal = sb.world.challenge?.goal;
  // Ships still to fly, the one flying included.
  const lives = game ? (game.spec.ships ?? 3) - game.state.n + (game.state.phase === "flying" ? 1 : 0) : 0;

  // The camera frames the ship (the one flying, or the last) and the ground under it, closing in as
  // it comes down (LND-031). It follows the ship as drawn (moved on for smooth motion, smooth.ts).
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const w = sandbox.value?.world;
      const g = w?.lander;
      if (!w || !g || g.state.n === 0) return;
      const hull = w.bodies.find((b) => b.id === g.spec.hull.replaceAll("{n}", String(g.state.n)));
      if (!hull) return;
      const ahead = shown.time - w.time;
      const x = hull.position.x + hull.velocity.x * ahead;
      const y = hull.position.y + hull.velocity.y * ahead;
      const alt = Math.min(150, Math.max(0, w.challenge?.status.altitude ?? 50));
      const vp = viewport.value;
      const zoom = Math.min(18, Math.max(3, vp.height / (1.5 * alt + 45)));
      const c = camera.value;
      const z = c.zoom + (zoom - c.zoom) * 0.04;
      // The ship sits above the middle, so the ground below it is in view. The view never turns,
      // also on Orbital: under the asteroid you land upside down, which is part of the challenge.
      camera.value = { x, y: y - 0.35 * alt, zoom: z };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const over = game?.state.phase === "over";
  const between = game?.state.phase === "between";
  const fuelShare = status && status.fuelStart > 0 ? status.fuel / status.fuelStart : 0;
  // A guide, not a rule (the damage model decides): faster than this, expect damage.
  const speedBad = status && goal ? Math.abs(status.vy) > goal.maxSpeed || Math.abs(status.vx) > goal.maxSpeed : false;
  const damage = status?.damage ?? 0;
  // A crash plays out a while before its verdict shows (the world's own pause, `watch`).
  const watched = !status || status.phase !== "crashed" || status.at === undefined || (sb.world.tick - status.at) * sb.profile.timestep >= (game?.spec.watch ?? 1.25) - 1e-9;
  // At rest, the player may give the ship up (it is then stranded): once it has stayed at rest for
  // ABANDON_AFTER s of game time, so the button doesn't flick up at the top of a hop or as the ship
  // settles after touching down.
  const still = game?.state.phase === "flying" && status?.phase === "flying" && Math.hypot(status.vx, status.vy) < 0.3;
  if (!still) restSince.current = null;
  else if (restSince.current === null) restSince.current = sb.world.time;
  const resting = still && restSince.current !== null && sb.world.time - restSince.current >= ABANDON_AFTER;
  const tiltBad = status && goal ? Math.abs(status.tilt) > goal.maxTilt : false;
  const last = game?.state.landings.at(-1);
  return (
    <div class="lander-play" data-testid="lander-play">
      <View />
      {/* The world under the HUD takes no taps: no sandbox tools in the game. */}
      <div class="lander-shield" />
      <div class="lander-hud" data-testid="lander-hud">
        <div class="lander-stats">
          <span>
            ALT <b>{status ? status.altitude.toFixed(1) : "–"}</b> m
          </span>
          <span class={speedBad ? "bad" : ""}>
            V↓ <b>{status ? (-status.vy).toFixed(1) : "–"}</b> · V→ <b>{status ? status.vx.toFixed(1) : "–"}</b> m/s
          </span>
          <span class={tiltBad ? "bad" : ""}>
            TILT <b>{status ? Math.abs(status.tilt).toFixed(0) : "–"}</b>°
          </span>
          <span class={damage > 0.005 ? "bad" : ""} data-testid="lander-damage">
            DAMAGE <b>{(100 * damage).toFixed(0)}</b>%
          </span>
        </div>
        <div class="lander-fuel" title="Fuel">
          <div class={`bar${fuelShare < 0.15 ? " low" : ""}`} style={{ width: `${(100 * fuelShare).toFixed(1)}%` }} />
          <span>FUEL {status ? status.fuel.toFixed(2) : "–"} kg</span>
        </div>
        <div class="lander-stats">
          <span data-testid="lander-score">
            SCORE <b>{game?.state.score ?? 0}</b>
          </span>
          <span data-testid="lander-lives">
            SHIPS <b>{Math.max(0, lives)}</b>
          </span>
        </div>
        {game?.state.phase === "flying" && playing.value && <SelfDestruct />}
        <button class="lander-btn small" onClick={() => (playing.value = !playing.value)} data-testid="lander-pause">
          {playing.value ? "Pause" : "Resume"}
        </button>
      </div>
      {diag.on && <DiagBox />}
      {landerKey.value === "lander-emergency" && !over && (
        <div class="lander-emergency" data-testid="lander-emergency">
          EMERGENCY
        </div>
      )}
      {between && status && watched && (
        <div class={`lander-banner ${status.phase === "landed" ? "good" : "bad"}`} data-testid="lander-verdict">
          {status.phase === "landed" ? `LANDED ×${goal?.pads?.find((p) => p.id === status.landedOn)?.multiplier ?? 1}  +${last?.score ?? 0}` : status.phase === "stranded" ? "STRANDED" : "CRASHED"}
          <small>{status.reason}</small>
        </div>
      )}
      {resting && playing.value && (
        <button class="lander-btn small lander-abandon" onClick={() => sendControl(ABANDON, 1, "Abandon ship", Math.floor(Math.random() * 1e9))} data-testid="lander-abandon">
          Abandon ship
        </button>
      )}
      {!playing.value && !over && (
        <div class="lander-modal">
          <h2>Paused</h2>
          {zoomed.value && <p data-testid="lander-zoomed">The page is zoomed in. Pinch outwards to zoom back out, then resume.</p>}
          <button class="lander-btn" disabled={zoomed.value} onClick={() => (playing.value = true)}>
            Resume
          </button>
          <SwapSides className="lander-btn ghost" />
          <button class="lander-btn ghost" onClick={quit}>
            Quit to menu
          </button>
        </div>
      )}
      {over && game && <GameOver score={game.state.score} landings={game.state.landings.length} cleared={game.state.ended === "cleared"} />}
      {!over && (
        <>
          <Thrust channel={landerSide("left")} label="L" side="left" />
          <Thrust channel={landerSide("right")} label="R" side="right" />
        </>
      )}
    </div>
  );
}

function quit(): void {
  playing.value = false;
  landerScreen.value = "select";
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function GameOver({ score, landings, cleared }: { score: number; landings: number; cleared: boolean }) {
  const key = landerKey.value;
  const [table] = useState<ScoreTable>(() => loadScores());
  const [saved, setSaved] = useState(false);
  const [letters, setLetters] = useState([0, 0, 0]);
  const enter = qualifies(table, key, score) && !saved;
  const turn = (i: number, d: number) => setLetters(letters.map((v, k) => (k === i ? (v + d + LETTERS.length) % LETTERS.length : v)));
  const save = () => {
    addScore(key, { initials: letters.map((v) => LETTERS[v]).join(""), score, landings, date: new Date().toISOString().slice(0, 10) });
    setSaved(true);
    landerScreen.value = "scores";
  };
  return (
    <div class="lander-modal" data-testid="lander-over">
      <h2>{cleared ? "Every pad used!" : "Game over"}</h2>
      <p>
        Score <b>{score}</b> · {landings} landing{landings === 1 ? "" : "s"}
      </p>
      {enter ? (
        <>
          <p>A high score! Your initials:</p>
          <div class="lander-initials">
            {letters.map((v, i) => (
              <div key={i} class="letter">
                <button onClick={() => turn(i, 1)} aria-label="Next letter">
                  ▲
                </button>
                <b>{LETTERS[v]}</b>
                <button onClick={() => turn(i, -1)} aria-label="Previous letter">
                  ▼
                </button>
              </div>
            ))}
          </div>
          <button class="lander-btn" onClick={save} data-testid="lander-save">
            Save
          </button>
        </>
      ) : (
        <div class="lander-row">
          <button class="lander-btn" onClick={() => startGame(key)}>
            Play again
          </button>
          <button class="lander-btn ghost" onClick={quit}>
            Menu
          </button>
        </div>
      )}
    </div>
  );
}

/** How to play: the goal, the controls, landing and scoring, and a few tips. */
function HowToPlay() {
  return (
    <div class="lander-select lander-info" data-testid="lander-howto-screen">
      <h2>How to play</h2>
      <section>
        <h3>The goal</h3>
        <p>
          Land on the pads. Each pad shows its multiplier (×2, ×5 …): harder pads score more. A pad can be used once, so each landing brings a new ship to try the next. You have three ships; land on
          every pad to clear the level for a 1,000 point bonus.
        </p>
      </section>
      <section>
        <h3>Controls</h3>
        <table>
          <tbody>
            <tr>
              <th></th>
              <th>Touch</th>
              <th>Keyboard</th>
              <th>Controller</th>
            </tr>
            <tr>
              <td>Turn left (the right engine)</td>
              <td>hold L</td>
              <td>Q, ←, Left Shift or Left Ctrl</td>
              <td>left bumper or trigger, or stick left</td>
            </tr>
            <tr>
              <td>Turn right (the left engine)</td>
              <td>hold R</td>
              <td>E, →, Right Shift or Right Ctrl</td>
              <td>right bumper or trigger, or stick right</td>
            </tr>
            <tr>
              <td>Both engines</td>
              <td>hold L and R</td>
              <td>both keys, or ↑</td>
              <td>A, or both sides</td>
            </tr>
            <tr>
              <td>Pause</td>
              <td>Pause button</td>
              <td>P or Esc</td>
              <td>Start</td>
            </tr>
            <tr>
              <td>Self-destruct</td>
              <td>the button beside Pause, pressed twice</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <p>
          Both engines together push you along the ship's axis. One engine alone turns you: the left control fires the right engine, which turns the nose left, and the right control the
          left engine. The pause menu can swap them, so the left control fires the left engine. To move sideways, tip over a little and burn both.
        </p>
      </section>
      <section>
        <h3>Landing</h3>
        <p>
          You've landed when the ship comes to rest on an open pad, on its legs (within the level's tilt limit, 10–15°) and in one piece. There is no speed limit, but the legs feel the impact: about
          2 m/s does no harm, 3 m/s bends them and 4.5 m/s snaps one off. A ship that breaks apart has crashed.
        </p>
        <p>
          Score: 200, plus up to 100 for fuel left, times the pad's multiplier, less the share of the ship that's damaged (the DAMAGE readout).
        </p>
        <p>
          Resting anywhere else is fine, and you can take off again. Out of fuel there, the ship is stranded. After 4 seconds at rest, Abandon ship gives it up for the next one.
        </p>
      </section>
      <section>
        <h3>Tips</h3>
        <ul>
          <li>Short bursts. Kill your sideways speed high up, then come straight down.</li>
          <li>Watch the speed and tilt readouts in the last few metres; they turn red when they're risky.</li>
          <li>Rocks are fatal at speed: the ship spins, then breaks up, and a ruptured tank explodes.</li>
          <li>On the asteroids, down is towards the rock, but the view never turns. The pads ride on the spinning rock: match their speed before you touch down.</li>
          <li>Emergency: stop the spin first (one engine), then deal with the leak's push.</li>
        </ul>
      </section>
      <div class="lander-row">
        <button class="lander-btn" onClick={() => (landerScreen.value = "select")} data-testid="lander-info-back">
          Back
        </button>
      </div>
    </div>
  );
}

/** The physics behind the game, short. */
function Physics() {
  return (
    <div class="lander-select lander-info" data-testid="lander-physics-screen">
      <h2>The physics</h2>
      <p class="lead">Nothing in Mammoth Lander is scripted: the ship flies, lands and breaks because of the physics.</p>
      <section>
        <h3>Rigid bodies</h3>
        <p>
          The ship is a set of real parts (hull, legs, tank and each engine's chamber and nozzle walls) welded together, each with its own mass and inertia. Every contact pushes equal and
          opposite, with friction. The world runs 240 steps a second and is deterministic: the same inputs always give the same flight.
        </p>
      </section>
      <section>
        <h3>Thrust is gas</h3>
        <p>
          There is no thrust force. The engines draw hydrogen and oxygen from the tank and burn them in their chambers at about 3,000 K. The hot gas pushes on the chamber walls and leaves through
          the throat as a choked jet; thrust and turning come only from gas pushing on the engine. The exhaust is simulated as particles of gas (smoothed-particle hydrodynamics) that hit the ground
          and push back, which is why the ground pushes up when you hover low. The tank drains as you burn, so the ship gets lighter, as the rocket equation says. (To give you enough flying time,
          each level lets the propellant go further than it would for real.)
        </p>
      </section>
      <section>
        <h3>Welds bend and break</h3>
        <p>
          Every weld has limits in tension, compression, shear and torque. A load beyond 30% of them bends it, leaving it permanently weaker; beyond its limit it snaps. That's why a hard touchdown
          bends the legs and a harder one breaks them off.
        </p>
      </section>
      <section>
        <h3>Damage</h3>
        <p>
          Impact energy beyond a part's material threshold costs it integrity. A damaged engine gives less thrust. A damaged tank leaks through the breach, and the escaping gas pushes the ship
          (Emergency starts that way). A destroyed tank explodes. An engine that breaks off burns what's left in it for half a second.
        </p>
      </section>
      <section>
        <h3>Gravity</h3>
        <p>
          The surface levels have the Moon's gravity, 1.6 m/s². Each asteroid pulls towards its centre (softened inside the rock). Binary's two rocks also pull on each other, in proportion to their
          masses, so they orbit their common centre.
        </p>
      </section>
      <section>
        <h3>Nothing created, nothing lost</h3>
        <p>A ledger tracks mass, momentum, spin and energy every step, and flags anything the physics creates or loses that it can't account for.</p>
      </section>
      <div class="lander-row">
        <button class="lander-btn" onClick={() => (landerScreen.value = "select")} data-testid="lander-info-back">
          Back
        </button>
      </div>
    </div>
  );
}

function Scores() {
  const table = loadScores();
  const [key, setKey] = useState(landerKey.value);
  const list = table[key] ?? [];
  return (
    <div class="lander-select" data-testid="lander-scores">
      <h2>High scores</h2>
      <div class="lander-row">
        {LANDER_SCENARIOS.map((s) => (
          <button key={s.key} class={`lander-btn small${s.key === key ? "" : " ghost"}`} onClick={() => setKey(s.key)}>
            {s.title}
          </button>
        ))}
      </div>
      <ol class="lander-table">
        {list.length ? (
          list.map((e, i) => (
            <li key={i}>
              <b>{e.initials}</b> <span>{e.score}</span> <small>
                {e.landings} landing{e.landings === 1 ? "" : "s"} · {e.date}
              </small>
            </li>
          ))
        ) : (
          <li class="muted">No scores yet.</li>
        )}
      </ol>
      <div class="lander-row">
        <button class="lander-btn" onClick={() => startGame(key)} disabled={!rawOf(key)}>
          Play {LANDER_SCENARIOS.find((s) => s.key === key)?.title}
        </button>
        <button class="lander-btn ghost" onClick={() => (landerScreen.value = "select")}>
          Back
        </button>
      </div>
    </div>
  );
}

/** `?diag=1`: live frame and step times, and a summary to copy and paste back. */
function DiagBox() {
  void version.value;
  const [text, setText] = useState<string | null>(null);
  const s = liveStats(performance.now());
  const copy = () => {
    const w = sandbox.value?.world;
    const t = summary({
      scenario: landerKey.value,
      ship: w?.lander?.state.n ?? 0,
      "bodies · parcels · wisps · dust · events": w ? `${w.bodies.length} · ${w.gas.count} · ${w.wisps?.length ?? 0} · ${w.dust?.length ?? 0} · ${w.events.length}` : "-",
      "world size": w ? `${(canonicalStringify(w).length / 1024).toFixed(0)} kB` : "-",
    });
    setText(t);
    navigator.clipboard?.writeText(t).catch(() => undefined);
  };
  return (
    <div class="lander-diag" data-testid="lander-diag">
      <span>
        {s.fps.toFixed(0)} fps · worst frame {s.worstFrame.toFixed(0)} ms · step {s.msPerStep.toFixed(1)} ms · take {s.takeMs.toFixed(1)} ms
      </span>
      <button class="lander-btn small" onClick={copy} data-testid="lander-diag-copy">
        Copy log
      </button>
      <button class="lander-btn small ghost" onClick={() => diag.reset()}>
        Reset
      </button>
      {text && (
        <textarea readOnly value={text} onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()} onClick={() => setText(null)} aria-label="Diagnostics log (copied)" />
      )}
    </div>
  );
}
