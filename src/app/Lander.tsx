// Mammoth Lander (docs/games/mammoth-lander.md): the title, the scenario select, play with a HUD
// and touch thrust buttons, game over with initials, and the high scores. Play runs the sandbox's
// world and view underneath, at a fixed 1× (LND-003), with none of its panels or tools (LND-002).
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { scenarioFile } from "./scenarios.ts";
import { addScore, best, loadScores, qualifies, type ScoreTable } from "./landerScores.ts";
import { bindings, camera, edit, openScenario, overlays, playing, sandbox, screen, setFollow, timeScale, version, viewport } from "./state.ts";
import { shown } from "./smooth.ts";
import { diag, liveStats, summary } from "./diag.ts";
import { sim, View } from "./View.tsx";
import { ABANDON } from "../core/index.ts";

/** The six scenarios, in order; those without a file yet are shown as coming soon. */
export const LANDER_SCENARIOS: { key: string; title: string; blurb: string }[] = [
  { key: "lander-easy", title: "Easy", blurb: "Rolling ground, five pads, plenty of fuel." },
  { key: "lander-medium", title: "Medium", blurb: "Lunar peaks; pads on slopes and in valleys. Fuel matters." },
  { key: "lander-hard", title: "Hard", blurb: "Sheer mountains and narrow ledges." },
  { key: "lander-cave", title: "Cave", blurb: "Thread the stalactites; deeper pads score more." },
  { key: "lander-orbital", title: "Orbital", blurb: "Come down from orbit onto a slowly spinning asteroid." },
  { key: "lander-emergency", title: "Emergency", blurb: "Hard, with a fuel leak pushing you about." },
];

const rawOf = (key: string) => scenarioFile(key);

export const landerScreen = signal<"title" | "select" | "play" | "scores">("title");
/** The scenario being played (or whose scores are shown). */
export const landerKey = signal<string>("lander-easy");

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
const zoomed = signal(false);

/**
 * Keeps the browser from zooming the game (LND-030). Two thumbs on the pads moving apart are a pinch,
 * and Safari zooms on a pinch whatever the page says (it ignores `user-scalable=no`), so the pinch
 * and double-tap gestures are cancelled here. If it zooms anyway, the game pauses until it's back.
 */
function useNoZoom(): void {
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
  return (
    <main class="lander" data-testid="lander">
      {landerScreen.value === "title" && <Title />}
      {landerScreen.value === "select" && <Select />}
      {landerScreen.value === "play" && sandbox.value && <Play />}
      {landerScreen.value === "scores" && <Scores />}
    </main>
  );
}

function Title() {
  return (
    <button class="lander-title" onClick={() => (landerScreen.value = "select")} data-testid="lander-title">
      <h1>MAMMOTH LANDER</h1>
      <p>Tap to start</p>
    </button>
  );
}

function Select() {
  const table = loadScores();
  return (
    <div class="lander-select" data-testid="lander-select">
      <h2>Choose a mission</h2>
      <div class="lander-cards">
        {LANDER_SCENARIOS.map((s) => {
          const ready = !!rawOf(s.key);
          const top = best(table, s.key);
          return (
            <button key={s.key} class="lander-card" disabled={!ready} onClick={() => startGame(s.key)} data-testid={`lander-pick-${s.key}`}>
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
        <button class="lander-btn ghost" onClick={() => (screen.value = "picker")}>
          Back to the sandbox
        </button>
      </div>
    </div>
  );
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
function Thrust({ channel, label, side }: { channel: string; label: string; side: "left" | "right" }) {
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
      class={`lander-thrust ${side}`}
      aria-label={`${label} engine`}
      data-testid={`thrust-${channel}`}
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

function Play() {
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
  // At rest, the player may give the ship up (it is then stranded).
  const resting = game?.state.phase === "flying" && status?.phase === "flying" && Math.hypot(status.vx, status.vy) < 0.3;
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
          <button class="lander-btn ghost" onClick={quit}>
            Quit to menu
          </button>
        </div>
      )}
      {over && game && <GameOver score={game.state.score} landings={game.state.landings.length} cleared={game.state.ended === "cleared"} />}
      {!over && (
        <>
          <Thrust channel="left" label="L" side="left" />
          <Thrust channel="right" label="R" side="right" />
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
      "bodies · parcels · wisps · dust · events": w ? `${w.bodies.length} · ${w.gas.parcels.length} · ${w.wisps?.length ?? 0} · ${w.dust?.length ?? 0} · ${w.events.length}` : "-",
      "world size": w ? `${(JSON.stringify(w).length / 1024).toFixed(0)} kB` : "-",
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
