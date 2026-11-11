# Mammoth Asteroids: design and plan

How the game in `mammoth-asteroids.md` is built: the engine changes first, then the game logic in
the world, then the page. Written 10 November 2026.

**Time.** The game runs at Lander's pace: one second of game time takes two seconds on screen
(`GAME_PACE = 0.5`). The spec's times are what the player sees. The scenario stores game time,
half as long: the gunship's 20 s is 10 game seconds, the 2.5 s wait for a new ship is 1.25, and
2 s of protection is 1. Rock and slug speeds are game speeds. Changing the pace after play means
rescaling these values, all of which sit in the game spec (§2.1).

## 1. Engine changes (shared physics, agreed with Chloe)

### 1.1 Collisions across the wrap edge (FLT-015), `src/core/physics.ts`

*Built (step 2 of the plan).* Since this was written the constraint solve moved to Rust
(`wasm/solver/src/lib.rs`). The contact search and the building of contacts are still in
`physics.ts`, where all of this is, except position correction, which is in the Rust and takes the
shift per contact. The velocity solve needed no change: it works from lever arms and velocities, and
books angular momentum from the bodies' real positions. A pair found through more than one copy
keeps the nearest. Notes and measurements: `docs/spec.md`, "Collisions across the edges".

Today the broad phase sorts boxes by raw position, so two bodies on opposite sides of an edge
never pair. In a wrapped world:

- **Ghost boxes.** After the boxes are built, every body whose box (fattened by its sweep and the
  slop) crosses an edge gets a ghost box: one world width (or height, or both, at a corner) back
  across. Ghost k remembers its body and its shift. The sweep runs over the real boxes and the
  ghosts.
- **Pairs.** A real body against another body's ghost is a candidate with that shift; ghost
  against ghost is skipped. Each candidate is normalised to (lower index, higher index, shift
  of the higher one), and duplicates are dropped, so a pair found from both sides is solved once.
  The fixed and same-assembly filters apply to the bodies, not the boxes. Order stays
  deterministic: candidates are sorted by the same codes as now, real pairs first.
- **Narrow phase and solve with a shift.** `SolverContact` gains `shift` (B's image offset). The
  manifold is computed with B placed at `position + shift`; lever arms `rB`, the disc
  time-of-impact (`discImpact`), the surface anchors `localB`, and position correction all use
  that image. Velocities don't depend on position, so the impulses are the same as for the same
  pair away from any edge. The ledger's angular momentum is booked from the real positions, as
  every other impulse is.
- **Contacts out.** `Contact` gains `shift?` (B's offset; `point` is on A's side).
  `damage.ts` takes B's hit point as `point − shift`, so welds near the hit on either body are the
  ones damaged. Warm starting keys on the pair as now. A contact that carries on after one body
  wraps meets the same geometry, so reusing its impulse is right.
- **Off when the world doesn't wrap**: no ghost boxes, so the sandbox's results don't change
  (determinism hashes unchanged).
- **Lander.** Its ground spans exactly the wrap width, so the ship's ghost now meets the real
  ground across the seam. `scripts/lander.ts` drops its `seam` copies, the scenarios are
  regenerated, and LND-042's test checks the same thing without them. All Lander unit and e2e
  tests must pass unchanged otherwise.

### 1.2 Blasts and AI across the edge (FLT-016)

- `explosive.ts`: a blast's reach (damage, push, fragments' targets) is measured with
  `nearestOffset`.
- `pilot.ts`: everything that measures from the ship to something else uses the nearest copy:
  `gravityAt`, `obstacles`/`avoid`, `shipsAround` (sight), `aimAt`'s target position (the target's
  nearest image), `clearShot`, and station keeping.

### 1.3 Every piece pulls (AST-009), `src/core/asteroid.ts`

`AsteroidSpec.gravity?: { G: number; core?: number }`. Every piece then gets
`gravity: { mu: G × its mass, core, feels: true }`, gold after its density is applied. `core`
defaults to the piece's own bounding radius. `feels` already keeps a rock's own pieces from
pulling each other (FLT-014) and lets broken-off chunks fall back. No change in `world.ts`.

*Strength:* a large rock (R 12 m, density ρ) has mass ≈ 0.8πR²ρ. For 1 m/s² at its surface,
G ≈ R² / M. That is about 0.02 at ρ = 20 kg/m².

*Cost:* every source acts on every free body and every gas parcel: (20 × N sources) × (bodies +
parcels) a step. It is measured in the first engine PR (§5, step 3). If it is over budget, the
options go to Chloe before anything is changed.

*Decided (Chloe, 10 November 2026):* rocks are capped at 8 a level, so the most the game asks of
gravity is level 8's 160 sources (3.7 ms a step in the probe). Later levels get harder through the
gunships (MAS-043). More gunships cost step time too: that is measured in step 6.

*Fallback, agreed in advance (Chloe, 10 November 2026):* if per-piece gravity proves too costly
when it is measured with the game running (on an iPad above all), the simpler model is fine: one
gravity source for each joined group of pieces (each rock, and each chunk broken off it), at the
group's centre of mass with the group's mass. It needs no further sign-off. Not built: the
per-piece model is inside the budget so far.

*Built and measured (step 3 of the plan).* Level 6 averages 2.96 ms a step in Node on the build
machine, against the 6 ms budget, about 0.8 ms of it rock gravity; the table is in `docs/spec.md`
("What it costs"). Within budget, so nothing was changed in the physics. To repeat on an iPad once
the game runs.

### 1.4 Gold that can't be destroyed (AST-010)

`AsteroidSpec.goldIndestructible?: boolean`. Gold pieces are then given no material, so contacts
and blasts never damage them (DMG-002) and `removeDestroyed` never removes them. Their welds still
break: by load, and by damage from hits on the rock next to them.

### 1.5 Clearing pilot (AIP-020), `src/core/pilot.ts`

A new mode, `clearing`, built from the parts Hunting already has (calibration, thrust allocation,
attitude, station keeping, `aimAt`, `clearShot`, `avoid`):

1. **Gold to collect.** If a visible gold piece is within reach, fly to it, arriving slowly
   (≤ 2 m/s relative), avoiding everything else.
2. **Otherwise, free some gold.** Pick the nearest rock that holds gold. Target the rock piece
   welded to its gold that is nearest the ship (or a hidden fragment's piece). Hold off about 35 m
   from it, aim with lead, and fire when lined up and clear.
3. **No gold left in rocks:** shoot the nearest rock.
4. **Avoid** always runs on top, as in the other modes.

It flies only through the ship's channels, like every pilot (AIP-001).

## 2. The game in the world (MAS-070), `src/core/arcade.ts`

*Built (step 4 of the plan), without the gunships (step 6).* What the build changed from the text
below:

- **A slug lasts 0.7 game s, not 1.5.** At 200 m/s a slug crosses the 160 m arena in 0.8 s, so at
  1.5 s one fired straight up came round and hit the ship that fired it: three of them wrecked the
  tank in the first trial. At 0.7 s it flies 140 m, less than the arena's height.
- **The clearest spot prefers the centre.** Clearances past 40 m count the same, so the new ship
  comes back at the centre whenever the centre is safe, and moves off only when something is
  coming.
- **A ship lost during the pause after a clear** comes back with the next level at the centre of
  the (then empty) arena, protected. If it was the last ship, the level's bonus is still paid, and
  then the game is over.
- **The gunship's settings** (`gunship`, and step 5 and 9 of the hook) are not in the spec type
  yet; they come with step 6.
- **Rock tuning is provisional** (`bond` 20,000 N/m, material threshold 100 J, toughness 20,000 J):
  in a trial of 60 slugs into a still rock, each slug took about 4% off the piece it hit, a piece
  was destroyed after about 30, and the first welds broke then. Retuned in step 8.
- **Holding fire pushes the ship back hard**: each shot kicks it 0.59 m/s (20 N·s against 34 kg),
  so a full second of fire is 4.7 m/s. For the tuning after play.

Like Lander, the game lives in the world (`world.arcade`), so a run and a replay agree. Ids: the
player's ship `p{n}-…`, gunships `g{n}-…`, and rocks `a{level}-{k}` (pieces `a{level}-{k}-{i}`).

### 2.1 Spec (scenario `world.arcade`)

```ts
interface ArcadeSpec {
  ship: { bodies; joints; links };   // LAND + railgun, ids with {n}; channels left/right/fire
  hull: string; gun: string;         // with {n}
  lives?: number;                    // 3
  rocks: { radius: 12; pieces: 20; density; bond; material; gravity: { G };
           gold: [2, 3]; compounds: [1, 2]; speed: [min, max]; spin: number;
           most: 8 };                // rocks a level: min(level, most) (MAS-020)
  gunship?: { template; hull: string; fromLevel: 3; first: 10; every: 30;  // game s
              skill: { base: 0.3; perLevel: 0.1; max: 0.8 };
              // Past the level where the rocks stop growing (MAS-043), per level, in game s:
              late: { first: -1; firstMin: 5; every: -2.5; everyMin: 10; skill: 0.05; skillMax: 1 } };
  respawn?: 1.25; grace?: 1; clearPause?: 1.5;  // game s
  shellLife?: 0.7;                   // game s, any railgun shell (140 m: less than the arena's height)
  pace: 0.5;                         // to turn game time into the player's seconds for the bonus
  demo?: boolean;                    // the title screen's game: the ship flies itself
  seed: number;
}
```

### 2.2 State

`level`, `phase` (`playing` | `clearing` | `waiting` | `over`), `lives`, `n` (ship number),
`score`, `gold: { total, left: string[] }`, `levelStart`, `nextGunship`, `gunships: { n, hull,
out }[]`, `graceUntil`, `next` (when the waiting ends), `beams: { at, x, y, r }[]` (rings to
draw), `shells: Record<id, tick>`, `slugHits: Record<bodyId, tick>`, and stats for the game-over
screen.

### 2.3 The step hook

`runArcade(world, dt)` runs inside the step, after damage and removal, before wrapping. Like the
duel, everything it adds or removes is booked under `boundary`. In order:

1. **Shells:** note the new ones (`railgun.fired` events); remove any older than `shellLife`.
   Player slugs that touched a rock mark that rock's assembly as hit (`slugHits`).
2. **Weld score:** each `joint.break` this step between rock pieces scores 10 when either piece was
   hit by a player slug within 60 ticks.
3. **Gold:** contacts between the ship's assembly and a visible gold piece (`!compound`), touching
   (impulse > 0 or separation ≤ 0.05 m), collect it. It goes through `removeBodies` (welds,
   links and contacts with it), with a gold sparkle (dust kind `gold`), and scores 500. Event
   `arcade.gold`.
4. **Ship out?** Duel's rule, `shipState` exported from `duel.ts`: hull gone, or no working engine
   welded to it. On a loss, the wreck's control links are cut (as Lander does), `lives − 1`,
   and `phase = waiting` until `respawn` later. With no lives left, `over` after the same wait.
5. **Gunships out?** Each that is out scores 1,000 once, and its pilot is switched off.
6. **Grace over:** restore the ship's materials from the template.
7. **Level cleared** (no gold left): bonus `1000 × level + 10 × max(0, 120 − seconds)`. Then
   `clearing` for `clearPause`, then: remove everything but the ship (rocks, debris, gunships,
   shells); replace the ship with a fresh copy at the same place, angle and motion (or, if it
   was lost, spawn as below); and lay out the next level.
8. **Waiting over:** a new ship at the clearest spot (below), at rest, pointing up, protected:
   its bodies' materials are taken off for `grace`.
9. **Gunship due** (level ≥ fromLevel, at `levelStart + first`, then every `every`; past level
   `rocks.most` each of the two shortens and the skill's ceiling rises, by `gunship.late`, MAS-043): a ring at a
   spot far from the ship, then 0.5 game s later the gunship (skill for the level, side `enemy`).

**Clearest spot:** a 7 × 5 grid over the middle of the arena, nearest the centre first. Each point
is scored by its worst clearance over the next 3 game seconds: the nearest-image distance to every
free body's straight-line path, less that body's reach. The best one wins (for a gunship, also at
least 70 m from the player).

**Level layout (MAS-020):** `rng = createRng(seed × 1000 + level)`. Rocks are placed at random,
at least 50 m from the ship and 2R + 8 m from each other (nearest image), with a random heading,
speed and spin. Each gets its own seed and 2–3 gold. `generateAsteroid` makes the pieces and
welds, with `gravity` and `goldIndestructible` on.

Wiring in `world.ts`: `world.arcade?`, set from the scenario at start (`startArcade`), and
`runArcade` in the step next to the duel's hook. Validation in `scenario.ts`.

### 2.4 Gunships (step 6 of the plan, built)

- **The spec's `gunship`**: the template (Gunship 3 from the stress test, ids and channels `g{n}`,
  side "enemy", no tractor), its hull, `fromLevel` 3, `first` 10 and `every` 30 game s, the skill
  (0.3 at level 3, 0.1 more a level, to 0.8), and `late` for the levels past `rocks.most`
  (MAS-043). `gunshipPlan(spec, level)` gives a level's times and skill.
- **Coming in.** When one is due, a ring shows at its spot for 0.5 game s, then it beams in there
  at rest. The spot (`gunshipSpot`) is the clearest of a 9 × 5 grid over the whole arena that is
  at least 70 m from the player the short way round; the furthest from the player wins a tie.
- **Out of the fight** by the duel's rule (hull gone, or no working engine welded to it): 1,000,
  once, whatever destroyed it. Its pilot is removed, its control links are cut, its wreck stays.
- **At a level clear** they beam out with everything else. Gunship numbers go on counting through
  the game, so no id is used twice.
- **Its shell** is a 0.15 kg solid disc at 96 m/s (691 J), not Gunship 3's 1 kg explosive shell. A
  square hit takes about 6% off a hull part of the LAND ship and over half the tank; a glancing
  one about 1%; one on a light chamber wall, nothing. In a trial against a ship that didn't move,
  a gunship at skill 0.3 needed five hits in 1.3 s to put it out. Its shells last 0.7 game s like
  the player's (67 m), which is past its stand-off distance of 35–55 m.
- **The pilot sees the player's ship** because a ship is now a working engine and a gun of either
  kind: a railgun counts as a gun (before, only a gas cannon did). No existing scenario changes
  (the same hashes).
- **The player's slug against a gunship:** Gunship 3's parts are thin (threshold 50 J, toughness
  600 J), and a slug carries 2,000 J, so one slug destroys the part it hits. To tune in step 8.

**What gunships cost** (level 8, the ship idle and protected so it stays; 2,400 steps; Node on the
cloud build machine, 11 November 2026; budget 6 ms a step):

| Gunships flying | Bodies | Mean step, ms | Worst step, ms | Mean with no rock gravity, ms |
|---|---|---|---|---|
| 0 | 179 | 2.84 | 9.9 | 1.91 |
| 1 | 202 | 4.06 | 9.8 | 2.70 |
| 2 | 225 | 4.56 | 12.2 | 3.26 |
| 3 | 248 | 5.48 | 15.1 | 3.82 |
| 4 | 268 | 6.28 | 22.2 | 4.29 |

Each gunship costs about 0.9 ms a step, and from level 12 one comes every 20 s on screen. Four at
once are over the budget here, and an iPad is slower. **Decided (Chloe, 11 November 2026): three
fly at the most** (`gunship.most`, default 3). One that is due waits until another is out of the
fight, and the one after it is timed from when it came. With three flying, level 8 averages
5.5 ms a step here.

About 2 ms of four gunships' 6.3 ms is per-piece rock gravity (each of a gunship's 23 parts is
pulled by all 160 pieces), which the agreed fallback (§1.3: one source for each joined group)
would mostly remove. That is the next change.

## 3. The ship and scenarios, `scripts/asteroids.ts`

- **Ship:** Lander's breakable LAND ship (its materials, welds and yield are factored out of
  `scripts/lander.ts` into a shared `scripts/landShip.ts`, so the two stay the same). Added: a
  railgun body `p{n}-gun` (0.5 × 0.3 m, 1 kg, hull material) on top of the hull at the ship's
  centre line, welded twice. A magazine of 60 slugs, reload 0.125 game s (4 a second on screen),
  muzzle 200 m/s. The slug is a 0.06 m disc of 0.1 kg with a weak material, so it breaks up into
  dust when it hits. The bore is along +y, through the centre of mass, so recoil doesn't spin
  the ship. Fuel economy generous (to tune; start at 15).
- **Gunship:** the Gunship 3 template from `stress-test.json`'s spawn (`s{n}` → `g{n}`, side
  `enemy`), with its shells tuned so one hit damages the LAND ship (§5, step 6).
- **Scenarios:** `asteroids.json` (the game) and `asteroids-demo.json` (the same, `demo: true`,
  the ship with a clearing pilot). They have no gravity field, wrapped bounds 160 m high (the
  width is set by the page) and no fixed bodies.

## 4. The page, `asteroids.html`

*Built (step 5 of the plan):* the title (static until the demo, step 7), play, the HUD, the keys
and touch buttons, pause, game over with initials, and the high scores. How to play and The
physics come with step 7. What the build settled:

- **A new game has a new seed** (from the clock), so the levels differ from game to game.
  `?seed=N` plays the same game again; the tests use it.
- **Slugs are drawn as white dots, 2 px at least.** At the arena's scale (about 5 px a metre) a
  6 cm slug would not show.
- **Rocks are dark grey with light edges**; the ship keeps the normal body colours.
- **Fuel on the HUD is the tank's share**, not the engines' small stores.
- **Damage on the HUD** is the worst-hit part or weld of the ship flying; 100% once it is lost.
- **Outside the arena is black** when the window is another shape than the arena was made for (a
  window resized during a game): the arena is fitted inside the view.
- **The page's pure parts** (the arena's shape, the HUD's readings) are in
  `src/app/asteroidsHud.ts`, and the score table is `src/app/scores.ts`, which Lander's now uses.

- `asteroids.html` → `src/app/asteroidsMain.tsx` → `src/app/Asteroids.tsx`, added to
  `vite.config.ts`. `standalone`, with no route back to the sandbox. The same sim worker and
  controller as Lander.
- **Screens:** `title` (with the demo running behind), `play`, `howto`, `physics`, `scores`,
  `over`.
- **Arena size:** before opening a scenario, the page sets its bounds from the screen: height 160,
  width = 160 × aspect, clamped to 1.2–2.2. The camera is fixed: centred, zoom = screen height
  ÷ 160 (or width-limited, letterboxed).
- **Drawing:** `render.ts`'s copies across the edges use the same body drawing as the originals,
  gold and wrecks included. That body drawing is factored into one function used by both. No
  dashed seam. A still starfield. Beam rings come from `arcade.beams`. The ship flashes during
  grace. Drawing only: no physics.
- **HUD:** score, level, lives, gold left, fuel, slugs and damage.
- **Controls:** thrust buttons (Lander's component) and a fire button. Keys: Q/E/←/→/Shifts, ↑ for
  both, Space/W to fire, P/Esc to pause. No browser zoom (Lander's `useNoZoom`, shared).
- **Pause:** Resume, Quit to title.
- **Scores:** Lander's score table code made generic (a storage key and columns), key
  `msb.asteroids.scores`.
- **Style:** `.mas-*` classes: black buttons with a 2 px white border, white sans-serif text
  (system UI font), square corners.
- **Test hook:** `window.__msb` as Lander's, plus `arcade()`, which returns the game state.

## 5. Plan

One PR each, merged once `pnpm check`, the e2e tests and CI are green. Each records its
measurements in the PR and the spec.

1. **Docs:** this design, the spec, and the engine requirements in `docs/spec.md`.
2. **FLT-015, collisions across the edge.**
   - Ghost boxes, shifted contacts, `Contact.shift`, damage.
   - Tests:
     - two discs and two boxes meeting across each edge and a corner behave exactly as the same
       pair moved away from the edges (a property test over random offsets, fast-check);
     - momentum and energy are exact and the ledger is clean;
     - a welded asteroid straddling an edge is hit across it;
     - no change in a world that doesn't wrap (hash).
   - Lander's seam copies removed, scenarios regenerated, all Lander tests green.
3. **FLT-016, AST-009, AST-010.**
   - Blast across the edge; a hunter sees, aims at and hits a target across the edge.
   - Per-piece mu = G·m, pieces don't pull their own rock, a broken piece falls back; gold with no
     material survives a blast that wrecks the rock.
   - **Performance probe:** step time for levels 1–6 (rocks, gravity, an engine firing), against
     a budget of 6 ms a step (120 steps a second at 1×). If it is over, report to Chloe with the
     options before changing any physics.
4. **Game core and ship.**
   - `arcade.ts`, the scenarios, `scripts/asteroids.ts`.
   - Unit tests, scripted runs:
     - level 1 layout;
     - gold collected by touch, and hidden gold not;
     - weld score;
     - loss → wait → protected respawn → protection ends;
     - 3 losses → over;
     - level clear → bonus → level 2 with 2 rocks and a fresh ship;
     - shells expire;
     - determinism (same hash twice) and a clean ledger over a long run.
5. **The page.**
   - Title (static at first), play, HUD, touch, pause, game over, initials, scores.
   - The shared render copies.
   - e2e tests (load, play, keys and touch fire a slug, pause, quit to title, scores kept through a
     reload, no zoom) and screenshots at iPad and laptop sizes.
6. **Gunships.**
   - The schedule and ring, skill by level, kill score, beam-out at a clear.
   - Tests: due at the right times, spawned clear, hits damage and don't kill outright (tuned
     shell), kill scored once.
7. **The clearing pilot and the title demo; How to play and The physics.**
   - Tests: the demo ship collects gold on level 1 within a time limit (scenario test); e2e for the
     demo running behind the title and both pages with Back.
8. **Tuning and review.**
   - Slow tuning tests:
     - slugs needed to free a gold piece;
     - rock-on-rock damage at 2 and 5 m/s;
     - a grazing hit on a small rock survives, damaged;
     - a gunship hit.
   - `docs/reviews/M9.md` with the exit criteria, measurements and screens.
   - Then play by Chloe, and a tuning PR.

Requirement IDs: the MAS-… IDs in test names; the engine IDs (FLT-015, FLT-016, AST-009, AST-010,
AIP-020) in `docs/spec.md` as milestone M9, so `req:report` traces them.
