// Mammoth Asteroids (docs/games/mammoth-asteroids.md): the title, play with a HUD and touch
// buttons, the pause menu, game over with initials, and the high scores. Play runs the sandbox's
// world and view underneath at the fixed game pace (MAS-003), with none of its panels or tools
// (MAS-002). The game itself is in the world (src/core/arcade.ts); this is only its page.
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { scenarioFile } from "./scenarios.ts";
import { scoreBoard, type BaseEntry } from "./scores.ts";
import { camera, openScenario, overlays, playing, sandbox, screen, setFollow, timeScale, version, viewport } from "./state.ts";
import { View } from "./View.tsx";
import { sendControl, Thrust, useNoZoom, zoomed } from "./Lander.tsx";
import { arenaFor, shipStatus } from "./asteroidsHud.ts";

export interface AsteroidsEntry extends BaseEntry {
  /** The level reached. */
  level: number;
}
/** The one table's name in the store. */
const TABLE = "asteroids";
export const asteroidsScores = scoreBoard<AsteroidsEntry>("msb.asteroids.scores");

export const asteroidsScreen = signal<"title" | "play" | "scores">("title");
/** The place of the score just saved, to show it in the table. */
const justSaved = signal<number | null>(null);

/** The level layouts' seed: `?seed=` for a game that can be played again exactly, else the clock. */
function gameSeed(): number {
  const asked = Number(new URLSearchParams(location.search).get("seed"));
  return Number.isInteger(asked) && asked > 0 ? asked : 1 + (Date.now() % 1_000_000);
}

export function startAsteroids(): void {
  const file = scenarioFile("asteroids");
  if (!file) return;
  const raw = structuredClone(file) as { world: { bounds: { min: { x: number; y: number }; max: { x: number; y: number } }; arcade: { seed: number } } };
  // The arena is the screen's shape (MAS-010), set before the game lays out its first level.
  const arena = arenaFor(window.innerWidth, window.innerHeight);
  raw.world.bounds.min = { x: -arena.width / 2, y: -arena.height / 2 };
  raw.world.bounds.max = { x: arena.width / 2, y: arena.height / 2 };
  raw.world.arcade.seed = gameSeed();
  if (!openScenario(raw, "asteroids")) return;
  screen.value = "lander"; // openScenario switches to the sandbox: this is a game
  timeScale.value = 1;
  overlays.value = new Set();
  justSaved.value = null;
  asteroidsScreen.value = "play";
  playing.value = true;
}

/** The keys (MAS-052): each holds its channels on while it is down. ↑ is both engines. */
const KEYS: Record<string, string[]> = {
  KeyQ: ["left"],
  ArrowLeft: ["left"],
  ShiftLeft: ["left"],
  KeyE: ["right"],
  ArrowRight: ["right"],
  ShiftRight: ["right"],
  ArrowUp: ["left", "right"],
  Space: ["fire"],
  KeyW: ["fire"],
};
const down = new Set<string>();
const held: Record<string, number> = {};
let group = 7_000_000;

function hold(channel: string, by: number): void {
  const was = held[channel] ?? 0;
  held[channel] = Math.max(0, was + by);
  if (was === 0 && held[channel] > 0) sendControl(channel, 1, `Key ${channel}`, ++group);
  else if (was > 0 && held[channel] === 0) sendControl(channel, 0, `Key ${channel}`, group);
}

export function asteroidsKeyDown(e: KeyboardEvent): void {
  if (asteroidsScreen.value !== "play" || !sandbox.value || e.ctrlKey || e.metaKey) return;
  const channels = KEYS[e.code];
  if (channels) {
    e.preventDefault();
    if (down.has(e.code)) return;
    down.add(e.code);
    for (const c of channels) hold(c, 1);
    return;
  }
  if (e.code === "KeyP" || e.code === "Escape") {
    e.preventDefault();
    if (sandbox.value.world.arcade?.state.phase !== "over") playing.value = !playing.value;
  }
}

export function asteroidsKeyUp(e: KeyboardEvent): void {
  const channels = KEYS[e.code];
  if (!channels || !down.delete(e.code)) return;
  if (sandbox.value) for (const c of channels) hold(c, -1);
}

/** Lets go of every key (leaving play, or the window losing the keyboard). */
function releaseKeys(): void {
  down.clear();
  for (const c of Object.keys(held)) {
    if (held[c] > 0 && sandbox.value) sendControl(c, 0, `Key ${c}`, group);
    held[c] = 0;
  }
}

export function AsteroidsApp() {
  useNoZoom();
  return (
    <main class="mas" data-testid="mas">
      {asteroidsScreen.value === "title" && <Title />}
      {asteroidsScreen.value === "play" && sandbox.value && <Play />}
      {asteroidsScreen.value === "scores" && <Scores />}
    </main>
  );
}

function Title() {
  return (
    <div class="mas-title" data-testid="mas-title">
      <h1>MAMMOTH ASTEROIDS</h1>
      <div class="mas-col">
        <button class="mas-btn" onClick={startAsteroids} data-testid="mas-start">
          Play
        </button>
        <button class="mas-btn" onClick={() => (asteroidsScreen.value = "scores")} data-testid="mas-open-scores">
          High scores
        </button>
      </div>
      <p class="mas-credit">by Chloe Bolland © 2026</p>
    </div>
  );
}

function Play() {
  void version.value;
  const sb = sandbox.value!;
  const game = sb.world.arcade;

  // The camera never moves (MAS-010): the arena fills the view, or as much of it as its shape allows.
  useEffect(() => {
    setFollow(false);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const b = sandbox.value?.world.bounds;
      const vp = viewport.value;
      if (!b || !vp.width || !vp.height) return;
      const zoom = Math.min(vp.width / (b.max.x - b.min.x), vp.height / (b.max.y - b.min.y));
      const c = camera.value;
      const x = (b.min.x + b.max.x) / 2;
      const y = (b.min.y + b.max.y) / 2;
      if (c.x !== x || c.y !== y || c.zoom !== zoom) camera.value = { x, y, zoom };
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("blur", releaseKeys);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("blur", releaseKeys);
      releaseKeys();
    };
  }, []);

  if (!game) return null;
  const s = game.state;
  const over = s.phase === "over";
  const ship = shipStatus(sb.world);
  return (
    <div class="mas-play" data-testid="mas-play">
      <View />
      {/* The world under the HUD takes no taps: no sandbox tools in the game. */}
      <div class="mas-shield" />
      <div class="mas-hud" data-testid="mas-hud">
        <span data-testid="mas-score">
          SCORE <b>{s.score}</b>
        </span>
        <span data-testid="mas-level">
          LEVEL <b>{s.level}</b>
        </span>
        <span data-testid="mas-lives" aria-label={`${s.lives} ships`}>
          <b class="mas-ships">{"▲".repeat(Math.max(0, s.lives))}</b>
        </span>
        <span data-testid="mas-gold">
          GOLD <b>{s.gold.left.length}</b> / {s.gold.total}
        </span>
        <span class="mas-fuel" data-testid="mas-fuel" title="Fuel">
          <i class={ship.fuel < 0.15 ? "low" : ""} style={{ width: `${(100 * ship.fuel).toFixed(1)}%` }} />
          <em>FUEL</em>
        </span>
        <span class={ship.slugs === 0 ? "bad" : ""} data-testid="mas-slugs">
          SHELLS <b>{ship.slugs}</b>
        </span>
        <span class={ship.damage > 0.005 ? "bad" : ""} data-testid="mas-damage">
          DAMAGE <b>{(100 * ship.damage).toFixed(0)}</b>%
        </span>
        {!over && (
          <button class="mas-btn small" onClick={() => (playing.value = !playing.value)} data-testid="mas-pause">
            {playing.value ? "Pause" : "Resume"}
          </button>
        )}
      </div>
      {s.phase === "clearing" && (
        <div class="mas-banner" data-testid="mas-clear">
          LEVEL {s.level} CLEAR
          <small>+{s.bonus ?? 0}</small>
        </div>
      )}
      {!playing.value && !over && (
        <div class="mas-modal" data-testid="mas-paused">
          <h2>Paused</h2>
          {zoomed.value && <p>The page is zoomed in. Pinch outwards to zoom back out, then resume.</p>}
          <button class="mas-btn" disabled={zoomed.value} onClick={() => (playing.value = true)} data-testid="mas-resume">
            Resume
          </button>
          <button class="mas-btn" onClick={quit} data-testid="mas-quit">
            Quit to title
          </button>
        </div>
      )}
      {over && <GameOver score={s.score} level={s.level} />}
      {!over && (
        <>
          <Thrust channel="left" label="L" side="left" className="mas-thrust" />
          <Thrust channel="fire" label="FIRE" side="fire" className="mas-thrust" />
          <Thrust channel="right" label="R" side="right" className="mas-thrust" />
        </>
      )}
    </div>
  );
}

function quit(): void {
  playing.value = false;
  asteroidsScreen.value = "title";
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function GameOver({ score, level }: { score: number; level: number }) {
  const [table] = useState(() => asteroidsScores.load());
  const [letters, setLetters] = useState([0, 0, 0]);
  const enter = asteroidsScores.qualifies(table, TABLE, score);
  const turn = (i: number, d: number) => setLetters(letters.map((v, k) => (k === i ? (v + d + LETTERS.length) % LETTERS.length : v)));
  const save = () => {
    justSaved.value = asteroidsScores.add(TABLE, { initials: letters.map((v) => LETTERS[v]).join(""), score, level, date: new Date().toISOString().slice(0, 10) });
    playing.value = false;
    asteroidsScreen.value = "scores";
  };
  return (
    <div class="mas-modal" data-testid="mas-over">
      <h2>Game over</h2>
      <p>
        Score <b>{score}</b> · level <b>{level}</b>
      </p>
      {enter ? (
        <>
          <p>A high score! Your initials:</p>
          <div class="mas-initials">
            {letters.map((v, i) => (
              <div key={i} class="letter">
                <button class="mas-btn small" onClick={() => turn(i, 1)} aria-label="Next letter">
                  ▲
                </button>
                <b>{LETTERS[v]}</b>
                <button class="mas-btn small" onClick={() => turn(i, -1)} aria-label="Previous letter">
                  ▼
                </button>
              </div>
            ))}
          </div>
          <button class="mas-btn" onClick={save} data-testid="mas-save">
            Save
          </button>
        </>
      ) : (
        <div class="mas-row">
          <button class="mas-btn" onClick={startAsteroids} data-testid="mas-again">
            Play again
          </button>
          <button class="mas-btn" onClick={quit}>
            Title
          </button>
        </div>
      )}
    </div>
  );
}

function Scores() {
  const list = asteroidsScores.load()[TABLE] ?? [];
  const mine = useRef(justSaved.value).current;
  return (
    <div class="mas-title mas-scores" data-testid="mas-scores">
      <h2>HIGH SCORES</h2>
      <table>
        <tbody>
          {list.length ? (
            list.map((e, i) => (
              <tr key={i} class={i === mine ? "mine" : ""} data-testid={i === mine ? "mas-score-mine" : undefined}>
                <td>{i + 1}</td>
                <td>
                  <b>{e.initials}</b>
                </td>
                <td>{e.score}</td>
                <td>level {e.level}</td>
                <td>{e.date}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td>No scores yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div class="mas-row">
        <button class="mas-btn" onClick={startAsteroids}>
          Play
        </button>
        <button class="mas-btn" onClick={() => (asteroidsScreen.value = "title")} data-testid="mas-scores-back">
          Back
        </button>
      </div>
    </div>
  );
}
