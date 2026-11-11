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

export const asteroidsScreen = signal<"title" | "play" | "scores" | "howto" | "physics">("title");
/** The place of the score just saved, to show it in the table. */
const justSaved = signal<number | null>(null);

/** The level layouts' seed: `?seed=` for a game that can be played again exactly, else the clock. */
function gameSeed(): number {
  const asked = Number(new URLSearchParams(location.search).get("seed"));
  return Number.isInteger(asked) && asked > 0 ? asked : 1 + (Date.now() % 1_000_000);
}

/** Opens a new game in the arena the screen's shape: the player's, or the title's demo (flown by its own pilot). */
function openGame(demo: boolean): boolean {
  const file = scenarioFile("asteroids");
  if (!file) return false;
  const raw = structuredClone(file) as { world: { bounds: { min: { x: number; y: number }; max: { x: number; y: number } }; arcade: { seed: number; demo?: boolean } } };
  // The arena is the screen's shape (MAS-010), set before the game lays out its first level.
  const arena = arenaFor(window.innerWidth, window.innerHeight);
  raw.world.bounds.min = { x: -arena.width / 2, y: -arena.height / 2 };
  raw.world.bounds.max = { x: arena.width / 2, y: arena.height / 2 };
  raw.world.arcade.seed = gameSeed() + (demo ? 7 : 0);
  if (demo) raw.world.arcade.demo = true;
  if (!openScenario(raw, "asteroids")) return false;
  screen.value = "lander"; // openScenario switches to the sandbox: this is a game
  timeScale.value = 1;
  overlays.value = new Set();
  playing.value = true;
  return true;
}

export function startAsteroids(): void {
  if (!openGame(false)) return;
  justSaved.value = null;
  asteroidsScreen.value = "play";
}

/** The title screen's game (MAS-001, MAS-060): the same game, its ship flown by an AI pilot. */
function startDemo(): void {
  openGame(true);
}

/** The camera never moves (MAS-010): the arena fills the view, or as much of it as its shape allows. */
function useArenaCamera(): void {
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
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** The keys (MAS-052): each holds its channels on while it is down. ↑ is left and right together: forward. */
const KEYS: Record<string, string[]> = {
  KeyQ: ["left"],
  ArrowLeft: ["left"],
  ShiftLeft: ["left"],
  KeyE: ["right"],
  ArrowRight: ["right"],
  ShiftRight: ["right"],
  ArrowUp: ["left", "right"],
  KeyS: ["reverse"],
  ArrowDown: ["reverse"],
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
      {asteroidsScreen.value === "howto" && <HowToPlay />}
      {asteroidsScreen.value === "physics" && <Physics />}
    </main>
  );
}

/** Seconds the demo's last game stays on screen after it is over, before the next starts. */
const DEMO_PAUSE = 3000;

function Title() {
  void version.value;
  useArenaCamera();
  const world = sandbox.value?.world;
  const demo = !!world?.arcade?.spec.demo;
  const over = demo && world?.arcade?.state.phase === "over";
  // The demo starts with the title, and again when its last ship is lost (MAS-060).
  useEffect(() => {
    if (!demo) startDemo();
    else playing.value = true; // back from another page: it carries on
  }, [demo]);
  useEffect(() => {
    if (!over) return;
    const t = setTimeout(startDemo, DEMO_PAUSE);
    return () => clearTimeout(t);
  }, [over]);
  const go = (to: "scores" | "howto" | "physics") => {
    playing.value = false; // the demo rests while another page is up
    asteroidsScreen.value = to;
  };
  return (
    <div class="mas-play" data-testid="mas-title">
      {demo && <View />}
      <div class="mas-shield" />
      <div class="mas-title over">
        <h1>MAMMOTH ASTEROIDS</h1>
        <div class="mas-col">
          <button class="mas-btn" onClick={startAsteroids} data-testid="mas-start">
            Play
          </button>
          <button class="mas-btn" onClick={() => go("howto")} data-testid="mas-open-howto">
            How to play
          </button>
          <button class="mas-btn" onClick={() => go("physics")} data-testid="mas-open-physics">
            The physics
          </button>
          <button class="mas-btn" onClick={() => go("scores")} data-testid="mas-open-scores">
            High scores
          </button>
        </div>
        <p class="mas-credit">by Chloe Bolland © 2026</p>
      </div>
    </div>
  );
}

function Play() {
  void version.value;
  const sb = sandbox.value!;
  const game = sb.world.arcade;

  useArenaCamera();
  useEffect(() => {
    window.addEventListener("blur", releaseKeys);
    return () => {
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
          <Thrust channel="reverse" label="REV" side="reverse" className="mas-thrust" />
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

/** A page of text over black, with Back to the title (MAS-007). */
function Page({ id, title, children }: { id: string; title: string; children: preact.ComponentChildren }) {
  return (
    <div class="mas-title mas-page" data-testid={id}>
      <h2>{title}</h2>
      <div class="mas-text">{children}</div>
      <div class="mas-row">
        <button class="mas-btn" onClick={() => (asteroidsScreen.value = "title")} data-testid="mas-back">
          Back
        </button>
      </div>
    </div>
  );
}

/** How to play: the goal, the controls, gold, lives, damage, gunships, scoring and a few tips. */
function HowToPlay() {
  return (
    <Page id="mas-howto" title="HOW TO PLAY">
      <h3>The goal</h3>
      <p>Collect all the gold. Each rock holds two or three pieces of it. Break the rocks open with your gun, then fly into the gold to pick it up. When the last piece is collected the level is cleared, and the next has one more rock, up to eight.</p>
      <h3>Controls</h3>
      <table>
        <tbody>
          <tr>
            <th></th>
            <th>Keyboard</th>
            <th>Touch</th>
          </tr>
          <tr>
            <td>Turn left</td>
            <td>Q, ← or Left Shift</td>
            <td>hold L</td>
          </tr>
          <tr>
            <td>Turn right</td>
            <td>E, → or Right Shift</td>
            <td>hold R</td>
          </tr>
          <tr>
            <td>Forward</td>
            <td>both keys, or ↑</td>
            <td>both buttons</td>
          </tr>
          <tr>
            <td>Reverse (brake)</td>
            <td>S or ↓</td>
            <td>hold REV</td>
          </tr>
          <tr>
            <td>Fire</td>
            <td>Space or W (hold to repeat)</td>
            <td>hold FIRE</td>
          </tr>
          <tr>
            <td>Pause</td>
            <td>P or Esc</td>
            <td>Pause button</td>
          </tr>
        </tbody>
      </table>
      <p>The ship has five engines: a main thruster at the back, and two small thrusters on each wing, one facing back and one facing forward. Turning fires one back thruster and the opposite front one, so the ship turns where it is. Forward fires the main thruster and both back ones. Reverse fires both front ones: a fifth of the forward push, enough to brake.</p>
      <h3>Gold</h3>
      <p>Touch a gold piece with any part of the ship to collect it, whether it is loose or still in its rock. Gold can't be destroyed. Some of it is hidden inside larger fragments of rock and can't be collected until the fragment cracks open. GOLD on the top bar shows how many pieces are left.</p>
      <h3>Ships and damage</h3>
      <p>You have three ships. A ship is lost when its hull is destroyed or it has no working engine left. Short of that you fly on with the damage: a damaged engine pushes less, a lost wing takes its tank and thrusters with it, and a holed tank leaks. A magazine that is destroyed explodes violently; the battery and the tanks explode too, less so. The wreck stays where it is. The next ship beams in after a moment and can't be damaged for two seconds, while it flashes. Each new ship, and each new level, has a full tank and 40 shells.</p>
      <h3>Gunships</h3>
      <p>From level 3 a gunship beams in 20 seconds into the level, and another every minute, three at the most. A ring shows where it will appear. It hunts you and shoots; one hit damages you without destroying you, though a hit on a fuel tank blows the tank up. From level 9 they come sooner, more often and shoot better.</p>
      <h3>Scoring</h3>
      <table>
        <tbody>
          <tr>
            <td>A gold piece collected</td>
            <td>500</td>
          </tr>
          <tr>
            <td>A rock weld broken by your shells</td>
            <td>10</td>
          </tr>
          <tr>
            <td>A gunship destroyed</td>
            <td>1,000</td>
          </tr>
          <tr>
            <td>Level N cleared</td>
            <td>1,000 × N, plus 10 for each second under 2 minutes</td>
          </tr>
        </tbody>
      </table>
      <h3>Tips</h3>
      <ul>
        <li>Shoot the rock next to the gold to free it. A few shells split a rock.</li>
        <li>Mind the recoil: every shot pushes you back about a metre a second.</li>
        <li>Rocks pull you in. Left alone, you drift into the nearest one.</li>
        <li>From level 2 the rocks start out circling each other. They don't keep it up for ever.</li>
        <li>Come up on gold slowly. A piece weighs several times what your ship does.</li>
        <li>What leaves one edge of the screen comes in at the other, your shells included, though they don't fly far enough to come back at you.</li>
      </ul>
    </Page>
  );
}

/** The physics behind the game, short, and where it cheats (MAS-007). */
function Physics() {
  return (
    <Page id="mas-physics" title="THE PHYSICS">
      <p>Nothing in Mammoth Asteroids is scripted. The ship flies, the rocks break and the gold drifts free because of the physics.</p>
      <h3>Welded parts</h3>
      <p>The ship is a set of rigid parts (cockpit, battery, two generators, two magazines, two fuel tanks, the gun, and each engine's head and nozzle walls) welded together, each with its own mass. A rock is about twenty pieces welded along their shared edges. Everything that touches pushes equal and opposite, with friction. The world runs 240 steps a second and is deterministic: the same inputs always give the same game.</p>
      <h3>Thrust is gas</h3>
      <p>There is no thrust force. The engines burn hydrogen and oxygen in their chambers, and the hot gas pushes on the engine's head and walls and leaves through the nozzle. The tanks drain as you burn, so the ship gets lighter.</p>
      <h3>The gun</h3>
      <p>The gun is a railgun: it throws a half-kilogram shell at 96 m/s, and the ship is pushed back with the same momentum. Forty shells weigh 20 kg, so the ship handles better as you use them. A shell carries a charge that goes off when it strikes. Its blast damages what is within four metres, and its gas pushes the rock's pieces apart.</p>
      <h3>Welds bend and break</h3>
      <p>Every weld has limits in tension, compression, shear and torque. A load past its limit breaks it. On the ship, a load past 30% of the limit bends the weld and leaves it weaker. A rock breaks along its welds: a blast, or another rock, loads them until they go.</p>
      <h3>Damage</h3>
      <p>Impact and blast energy beyond a part's threshold costs it integrity. A part at zero is destroyed and leaves as dust. A damaged engine gives less thrust, and a damaged tank leaks; the leak pushes the ship.</p>
      <h3>Gravity</h3>
      <p>Every rock, and every chunk broken off one, pulls by its mass: about 2 m/s² at a large rock's surface, a tenth of your forward thrust. Rocks pull each other and you; the ship pulls nothing.</p>
      <h3>The wrap</h3>
      <p>The arena has no edges. Collisions, gravity, blasts and the gunships' aim all work across them.</p>
      <h3>Nothing created, nothing lost</h3>
      <p>A ledger tracks mass, momentum, spin and energy every step, and flags anything the physics creates or loses that it can't account for.</p>
      <h3>Where the game cheats</h3>
      <ul>
        <li>Fuel goes forty-five times further than it would for real, so the tanks last.</li>
        <li>A shell's blast makes eleven times the shell's weight in gas (5.5 kg from a 0.5 kg shell), so it can push the rock's pieces apart.</li>
        <li>Gold can't be damaged or destroyed.</li>
        <li>Space doesn't wrap round. This arena does, both ways.</li>
        <li>New ships, new levels and beamed-out rocks appear and vanish. The ledger records them as crossing the world's boundary.</li>
        <li>A shell is removed after flying 134 m, so it can't come round and hit you.</li>
        <li>All the pieces of a rock pull as one from its centre, not each on its own.</li>
      </ul>
    </Page>
  );
}
