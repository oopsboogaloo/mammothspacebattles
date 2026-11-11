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

*Built (11 November 2026), as AST-011.* With gunships flying, per-piece gravity was 1.2 ms of a
5.8 ms step on level 8 (three gunships), so the fallback is now what the game uses: `rocks.gravity`
is `{ G: 0.093, joined: true }`. `G` is higher than before because a joined rock's pull is softened
by half its reach: about `G M / (1.4 R²)` at the surface, still about 1 m/s². Three gunships on
level 8 now average 4.6 ms a step. The table is in `docs/spec.md` ("Rocks that pull as one").
What it gives up: close in, a rock pulls toward its centre and not toward its nearer lumps.

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

*Clearing, built (step 7 of the plan, 11 November 2026).* As above, with these particulars:

- **Loose gold** is a visible gold piece on its own or with one other piece still stuck to it. It
  flies into the nearest by keeping station on it with no offset, so it closes at a speed in
  proportion to the gap, and at no more than 1.2 m/s over the last 10 m (a piece is some 230 kg,
  five times the ship). It doesn't steer round the gold, or round anything within 10 m of it (the
  rubble it came out of).
- **Shooting:** it stands off 50 m plus up to 20 for low skill (a hunter: 35), and backs off to
  that again when the rock comes within 10 m of it, where a hunter would hold its ground.
- **How well it plays** (four games, headless, 284 × 160 m arena): it frees and collects its
  first gold in 20 to 65 game seconds in three of the four, and is out of ships in 60 to 140. It
  rarely clears a level: most ships are lost to rubble near the gold it is going for. It is a demo
  that plays, not a good player. The title starts a new demo 3 s after each one is over.
- **In the game:** `demo: true` in the spec puts the pilot on each new ship's hull (side "player",
  flight and combat skill 0.8). A lost ship's pilot is removed with its control links.
- **One scenario, not two:** the page sets `demo` on its copy of `asteroids.json`, where §3
  planned a second file.

## 2. The game in the world (MAS-070), `src/core/arcade.ts`

*Built (step 4 of the plan), without the gunships (step 6).* What the build changed from the text
below:

- **A slug lasts 0.7 game s, not 1.5** (now a shell at 96 m/s lasting 1.4 s, for the same reason: §2.3a). At 200 m/s a slug crosses the 160 m arena in 0.8 s, so at
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
- **Rock tuning was provisional** (`bond` 20,000 N/m, material threshold 100 J, toughness 20,000 J):
  in a trial of 60 slugs into a still rock, each slug took about 4% off the piece it hit, a piece
  was destroyed after about 30, and the first welds broke then. Changed in §2.3a.
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

### 2.3a The explosive shell and the rocks (11 November 2026, after Chloe first played)

The light solid slug did nothing a player could see. Chloe asked for an explosive round, and to
use what the earlier experiments had found. That is the mining tuning (AST-008, `docs/spec.md`):
light rock of **tough pieces with weak bonds**, and a shell whose **blast gas pushes the pieces
apart**, so a rock splits into chunks and few pieces are destroyed.

**What is used now**

- **The shell** is the Mammoth scenario's: a 0.26 × 0.22 m box of 0.5 kg, 0.3 kg of it charge, a
  2 m blast, no casing fragments, launched at 96 m/s, two a second on screen (reload 0.25 game s),
  40 in the magazine. A shell lasts 1.4 game s (134 m). The gunship's shell is still its solid slug.
- **The rocks** are that tuning's rock (density 6 kg/m², threshold 100 J, toughness 20,000 J) with
  bonds of **800 N/m, not 3,500**. `G` is 0.067, so a rock still pulls about 1 m/s² at its surface.

**Why the bonds are weaker.** That tuning was made on 4 m rocks of 12 pieces. These are 12 m rocks
of 20 pieces: each piece is about three times as long, so its bonds (strength × edge length) are
three times as strong and the piece nine times as heavy, against the same blast. With 3,500 N/m
(or the 20,000 used at first) no shell ever split a rock.

**Measured** the mining test's way (`tests/core/mining.test.ts`): a rock alone at rest, one shell
every 2.5 s at the middle of the biggest chunk, on four rock shapes; chunks and pieces destroyed
after hits 1, 2, 4, 8 and 12.

| Rock and shell | Hit 1 | Hit 2 | Hit 4 | Hit 8 | Hit 12 |
|---|---|---|---|---|---|
| The mining test's own rock (4 m, 12 pieces, 3,500 N/m), 1 kg shell with fragments | 1–3 chunks | 2–4 | 2–7 | 5–7, 0–2 lost | |
| Game rock, 3,500 N/m, density 6 or 20 | 1 | 1 | 1 | 1, 1–2 lost | |
| Game rock, 1,200 N/m, density 6 | 1–2 | 1–3 | 1–4 | 1–6 | 2–7 |
| **Game rock, 800 N/m, density 6 (now)** | **1–2** | **1–3** | **2–5** | **3–10, 1–2 lost** | **6–14, 1–3 lost** |
| Game rock, 600 N/m, density 6 | 1–4 | 1–7 | 2–10 | 1–15 | 3–18 |
| Game rock, 400 N/m, density 2 | 1–4 | 1–8 | 9–14 | 14–19 | 15–20 |
| Game rock, 800 N/m, a lighter shell (0.2 kg, 0.15 kg charge of twice the energy) | 1 | 1–2 | 1–2 | 1–3 | 1–4 |

The push comes from the mass of blast gas, so a lighter shell with a richer charge did much less.
A small charge on the light slug (2 g to 20 g) changed nothing at all. An earlier attempt the same
day made the pieces a tenth as tough instead (toughness 2,000 J): that destroys pieces where they
are hit (six in sixteen slugs) and is not what the experiments had found, so it was replaced.

**More power (Chloe, 11 November 2026, after playing with the shell above).** The charge now has
three times TNT's energy (`heat` 12.6 MJ/kg: 37.8 kJ a shell in this profile) and a 3 m blast. The
shell's mass is the same, so the ship's weight and the recoil are too. Measured the same way,
bonds 800 N/m, chunks / pieces destroyed on four shapes:

| Shell | Hit 1 | Hit 2 | Hit 4 | Hit 8 |
|---|---|---|---|---|
| TNT, 2 m (the mining tuning's) | 1–2 / 0 | 1–3 / 0 | 2–4 / 0 | 3–6 / 1–2 |
| 0.45 kg of TNT, 3 m | 1–2 / 0 | 1–3 / 0 | 1–3 / 1 | 3–12 / 2–4 |
| 2 × TNT, 3 m | 1–2 / 0 | 1–3 / 0 | 1–8 / 1–2 | 4–12 / 3–4 |
| **3 × TNT, 3 m (now)** | **1–2 / 0** | **1–3 / 1–2** | **3–6 / 2–4** | **10–14 / 3–7** |
| 5 × TNT, 4 m | 1–3 / 1 | 1–4 / 2–4 | 5–12 / 3–6 | 9–13 / 6–11 |
| TNT, 2 m, bonds 500 N/m | 1–4 / 0 | 1–7 / 0 | 3–9 / 0 | 11–15 / 1 |

It now destroys some of what it hits as well as pushing the rest apart. The dials, if it wants
more or less: the charge's energy (`heat`) and the blast radius, in `scripts/asteroids.ts`.

**What it changes for the ship.** Forty 0.5 kg shells are 20 kg, so a full ship is 48 kg, not 34:
it accelerates about 4.3 m/s² on both engines with a full magazine, against 6.3 before, and gets
lighter as it fires. A shot kicks it about 1 m/s (0.6 before) at half the rate of fire.

**Rocks break each other up, with these settings and with the old ones.** Level 8, nobody
shooting (eight rocks at 2–6 m/s, pulling each other together):

| Settings | Chunks after 20 s | After 40 s | Step, ms, at 40 s |
|---|---|---|---|
| As first released (density 20, 20,000 N/m, toughness 20,000) | 77 | 109 | 4.2 |
| **Now (density 6, 800 N/m)** | 97 | 135 | 5.1 |
| Now, with rocks at 0.5–2 m/s | 8 | 103 | 3.6 |

Bonds that a 100 N·s blast can break can't hold when two rocks of a few tonnes meet, and nor could
the stronger ones. Level 1's single rock stays whole until it is shot. Chloe has set the debris
aside for now (11 November 2026); it is the main thing to look at in the tuning step, with the
step time it costs.

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
  a gunship at skill 0.3 needed five hits in 1.3 s to put it out. Its shells last as long as the
  player's (1.4 game s, 134 m), well past its stand-off distance of 35–55 m.
- **The pilot sees the player's ship** because a ship is now a working engine and a gun of either
  kind: a railgun counts as a gun (before, only a gas cannon did). No existing scenario changes
  (the same hashes).
- **The player's shell against a gunship:** Gunship 3's parts are thin (threshold 50 J, toughness
  600 J), and a shell carries 2,300 J of motion and its blast, so one destroys the part it hits.
  To tune in step 8.

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
  *As built, after play (11 November 2026):* with Lander's welds the recoil broke the ship. Each
  shot bent the gun's mount a little (DMG-008), the mount broke at about the 19th shot, and the
  loose gun then shot its own ship. Measured by firing all 40 shells in empty space, still, under
  thrust and turning each way: nothing bends once the mount is 4 times Lander's welds and the rest
  of the ship twice (at 1.5 times the tank's and wing's welds still bend). Built with margin: the
  mount 6 times, the rest 3 times. The parts' materials are unchanged. A stronger ship also
  survives harder knocks from rocks; not measured.
  *The game's own ship (11 November 2026),* from Chloe's sketch, replaces the LAND ship
  (`scripts/asteroidShip.ts`; Lander's ship and `scripts/landShip.ts` are unchanged):
  - **Parts (23, 67 kg with 40 shells and 16.2 kg of propellant):** cockpit `p{n}-hull` (a
    six-sided dome, 6 kg), gun (0.3 × 0.7 m), battery, two generators, two magazines, two tanks
    (1.5 × 1 m, 8.1 kg of propellant each), and five engines of three parts each: a head that
    injects and lights the propellant, and two walls that open out as its nozzle.
  - **Engines:** the main one under the battery (2.8 kg/s), and two on each wing 2.05 m out (0.68
    kg/s each), one firing back and one forward. Each wing's pair is fed by its own tank. The main
    one is fed by both, each giving just over half its draw, so the tanks empty together.
  - **Controls (MAS-035):** the game's spec has `mix`, rows of `{ channel, any: [{ on, off }] }`:
    an engine's channel is on when any row holds. The core sets the engines' channels from the
    player's `left`, `right` and `reverse` each step. The demo's pilot sets the engines' channels
    itself, so the demo has no mixing.
  - **Measured in empty space** (LAND ship first, the same way): forward 4.29 → 12.9 m/s² (3.0
    times), turning 1.74 → 3.47 rad/s² (2.0 times), reverse 4.2 m/s². Economy 30: the tanks last
    about two minutes of full thrust. A step with the ship alone at full thrust is 1.3 ms.
  - **Tuned after play (11 November 2026):** Chloe asked for a stronger forward engine, more
    cannon damage and stronger gravity. The main thruster's flow is 4.86 kg/s: 19.3 m/s² forward
    (half as much again), economy 45 for the same two minutes. The shell's charge has six times
    TNT's energy and a 4 m blast (it had three times and 3 m): nine shells leave a rock in 8 chunks
    with 11 of its 20 pieces destroyed. Rock gravity is doubled (G 0.186, about 2 m/s² at a large
    rock's surface). Welds between a struck rock's pieces now score wherever in that rock they
    break: the stronger blast destroys the piece it strikes in the same step, and only the welds
    of that piece were being scored.
  - **Tuned again (11 November 2026):** Chloe asked for more of a gas pressure effect from the
    cannon, rocks that start in orbit round each other, and more damage from the gunships.
    - *Gas.* More energy alone did nothing: at eight times the energy, with the rock as much
      tougher, the pieces still left at about 1 m/s, because 0.5 kg of gas can't push 100 kg
      pieces. A charge can now make more gas than its shell weighs (`explosive.gas`, a cheat like
      FLT-010, recorded under the ledger's `supply`). The shell makes 5 kg more, has twelve times
      TNT's energy, and the rock is twice as tough (200 J, 40 kJ). Three rocks, nine shells each:
      8 to 13 chunks, 7 to 12 pieces destroyed, pieces leaving at 1 to 3 m/s (they left at 0.5 to 2).
    - *Orbits (MAS-026).* `rocks.orbit`: each rock starts across the line to the rocks' centre of
      mass at v² = a r, where a is the others' pull toward that centre, taking each rock's copy
      nearest the first. Two rocks circle at about 1.5 to 2.5 m/s and stay whole for 40 s or
      more; with three or more it is a looser swirl. A lone rock drifts as before. Level 8 over
      80 s: 136 chunks and 5.7 ms a step (drifting: 154 and 6.0).
    - *Gunship shells.* 0.3 kg, not 0.15: a hit takes 15 to 18% off a hull part (it took about
      6%) and destroys a tank, which explodes; the ship flies on.
    - *Shells (the same day).* 120 of 0.167 kg, where there were 40 of 0.5 kg: the magazine
      still weighs 20 kg, and a shot kicks 0.24 m/s, a third as hard. Each blast is unchanged:
      0.1 kg of charge at three times the energy a kg, and 5.5 kg of gas, 5.33 kg of it made.
  - **Bursts, dead thrusters and leaks (11 November 2026, asked for by Chloe):**
    - *Bursts (MAS-027).* `rocks.burst`: where a piece of rock is destroyed the game adds a small
      charge that goes off at the next step (0.1 kg, 76 kJ, 2.7 kg of gas: half a shell's blast).
      Its blast radius is 1 cm, so it damages nothing and bursts don't chain. As strong as a shell,
      nine shells at a rock 40 m off wrecked the ship within two seconds.
    - *Shells are `safe`.* The bursts' gas blew a shell that had just left the gun back onto the
      ship, where it went off and set off a magazine. A `safe` charge never goes off against the
      assembly of the gun that fired it (`explosive.safe`).
    - *Fuel lines (MAS-037).* Each step the game checks each tank and engine the design joins by
      a feed link. If either is gone or no longer part of the ship, the feed links are removed.
      An engine that still exists gets a control channel of its own, held on, so it burns what is
      in its store (0.4 game seconds) and is then dead. If the tank and engine are no longer
      joined, the tank gets a breach on its top or bottom face, nearest the engine's place in the
      design, and loses 0.1 of its integrity: the leak rule (DMG-004) then drains it at about
      0.05 kg/s when full. A wing lost whole keeps its thrusters, so only its line to the main
      thruster leaks.
    - *Engines explode when destroyed:* 0.4% of the engine's mass as charge (5 g for a small
      thruster). Ten times that destroyed the tank beside it, which then exploded too.
    - *Measured* (three rocks, nine shells each, and level 8 left alone for 80 s): too chaotic
      to show a clear change in chunks or step time (4.3 to 5.1 ms a step against 5.1 without).
  - **Welds:** 3 times Lander's, the gun's mount 6 times, two welds between each tank and its
    generator. Nothing bends with all 40 shells fired still, forward, turning or reversing, nor
    spinning at 40 rad/s.
  - **Explosions (MAS-036):** a magazine holds 1 kg of TNT in its 3 kg, reaching 6 m. Destroyed,
    it takes the cockpit, both tanks, the battery, a generator and the main thruster with it, and
    leaves about 14 damaged parts. (2 kg at three times TNT's energy left nothing at all.) The
    battery holds 0.05 kg: it breaks four welds and damages four parts, and the ship flies on.
  - **The shells' weight is on the gun,** not in the magazines: the engine keeps a gun's shells
    in the gun's own body. The magazines are parts that explode; losing one loses no shells.
  - **The exhaust's tail lasts 0.4 s in this game, not 1 s** (`WISP_LIFE_ARCADE`). Exhaust leaves
    at about 200 m/s, so a 1 s tail crossed most of the 160 m arena. A ship thrusting up through
    the top edge came back in at the bottom as the tail it had left arrived there, and was turned
    by it (0.6 rad/s). The LAND ship was too slow to show it.
- **Gunship:** the Gunship 3 template from `stress-test.json`'s spawn (`s{n}` → `g{n}`, side
  `enemy`), with its shells tuned so one hit damages the LAND ship (§5, step 6).
- **Scenarios:** `asteroids.json` (the game) and `asteroids-demo.json` (the same, `demo: true`,
  the ship with a clearing pilot). They have no gravity field, wrapped bounds 160 m high (the
  width is set by the page) and no fixed bodies.

## 4. The page, `asteroids.html`

*Step 7 (11 November 2026):* the title now runs the demo behind its name and buttons (the same
view, with no HUD), and has How to play and The physics, each a page of text with Back. The demo
rests while another page is up and carries on after. The sandbox's start screen has a "Play
Mammoth Asteroids" button beside Lander's (asked for by Chloe): a link to this page, which still
has nothing leading back.

*Built (step 5 of the plan):* the title (static until the demo, step 7), play, the HUD, the keys
and touch buttons, pause, game over with initials, and the high scores. How to play and The
physics come with step 7. What the build settled:

- **A new game has a new seed** (from the clock), so the levels differ from game to game.
  `?seed=N` plays the same game again; the tests use it.
- **Shells are drawn as dots, 2 px at least** (the player's white, a gunship's red). At the
  arena's scale (about 5 px a metre) they would hardly show.
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
