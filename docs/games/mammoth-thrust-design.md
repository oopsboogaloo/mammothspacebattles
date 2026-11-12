# Mammoth Thrust: design and plan

How the game in `mammoth-thrust.md` is built: what the engine already does, what it lacks, the game
logic in the world, the levels and ship, the page, and the order of work. Written 12 November 2026,
from a reading of the code at `b9b56a4`. Nothing here is built. Line numbers are that commit's.

**Time.** As Asteroids: the game runs at Lander's pace (`GAME_PACE = 0.5`, `state.ts:51`). The
spec's times are what the player sees; the scenario stores game time, half as long (a turret's 3 s
wait is 1.5 game seconds, the factory's 10 s countdown is 5). Speeds are game speeds.

**What "MVP" means here.** Steps 2 to 4 of the plan (§6): two levels, the ship, the pod, lives, win
and loss, the page. No enemies. Turrets, the factory, fuel and the shield follow, one PR each.

## 1. What the code allows today

These facts shape the design. Each was read in the source.

| Fact | Where | What it means for us |
|---|---|---|
| A railgun or magazine on a `fixed` body never fires. | `railgun.ts:44`, `world.ts:1015` | A turret's gun must be a free body. |
| A fixed body is never removed, even at 0 integrity; its joints and links do break. | `dust.ts:85`, `world.ts:1440` | Anything that should be destroyed (turret pieces, buildings, fuel tanks) must be free bodies welded to a fixed base. |
| A free body welded to a fixed one is held by the weld solver. | `physics.ts:599` | That is how turret pieces and buildings stand on the rock, and how they come off. |
| Joints are welds only. No pivot, no kinematic bodies. | `joints.ts` | The turning mount is new (§2.1). |
| The tractor pulls and captures free bodies only; a fixed body can't carry a tractor. | `tractor.ts:139`, `:196` | A free fuel tank welded down can be found by the beam. The pod must be a free body resting on its stand. |
| Capture needs mass ≤ 1.2 × the ship's, size ≤ the ship's, distance ≤ the tether's length. | `tractor.ts:213` | A 33 kg pod smaller than the ship passes. |
| Feed links move a resource between bodies at a rate, fixed bodies included. | `runFeeds`, `world.ts:504` | Fuel through the beam and a turret's fuel pipe can both be feeds. |
| There is no power model: batteries and generators are structure. | `docs/spec.md:526` | The turret's power rule is new (§2.3). |
| There is no invulnerable flag. Asteroids protects a new ship by removing its parts' `material`. | `arcade.ts:257`, `:271` | Reused for the beam-in. Not usable for the shield (§2.5). |
| Ships are spawned mid-game from a `p{n}-` template. | `addShip`, `arcade.ts:243` | Reused for each new life. |
| "Out of the fight" is: no working engine left on the ship's assembly. | `shipState().flies`, `duel.ts:74` | Reused as the life-lost rule. |
| Ground from an outline with overhangs, drawn as a closed line with `solid: "outside"`. | `scripts/lander.ts:378-480`, `render.ts:681` | Reused for the levels and for where the stripes go. |
| Randomness is from the world's seeded PRNG; trig is the pinned `sinCos`. | `prng.ts`, `math.ts` | Turret bearings use both. |
| The ledger books what a game adds or removes under `boundary`. | `ledger.ts`, `stepInPlace` | The beam back, the shield's push and beamed-in ships are booked there. |
| Step budget: 6 ms a step, 240 steps a game second. | `docs/spec.md:572`, `profile.ts:85` | Measured at steps 3, 5 and 8. |

## 2. Engine changes (shared physics, agreed with Chloe)

*Agreed, 12 November 2026:* Chloe approved every engine addition in this section. Changes to what
Lander or Asteroids themselves do are a separate matter, to be talked through with her first; none
is proposed here. The requirements are in `docs/spec.md` under milestone M10: ASM-008 (§2.1),
WPN-009 (§2.2), WPN-010 (§2.3), TRC-008 and TRC-009 (§2.4), SHD-001…005 (§2.5). None
changes what the sandbox, Lander or Asteroids do today: every one is a new, optional component, off
unless a scenario declares it (determinism hashes unchanged, checked in each PR).

### 2.1 A weld that can be turned (the mount), `src/core/joints.ts`

A weld holds two bodies at a fixed relative angle. Add an optional `turn` to a joint:
`{ rate, min, max, target }`. The joint's rest angle moves toward `target` at `rate`, kept inside
`[min, max]`; the weld solver then holds the bodies at the moving rest angle, as it holds a fixed
one now.

- The gun's carriage is a free body, joined to the fixed mount by such a joint at the mount's
  centre. So the gun is seen to turn, its recoil passes through the joint to the rock, and the
  joint breaks by load or damage like any weld (ASM-004). A broken joint leaves the gun as
  wreckage.
- A damaged mount: the joint's `rate` scales with the mount body's integrity (first value: rate ×
  integrity; below 0.3 it sticks).
- The railgun needs no change, because the carriage isn't fixed.
- *To check when built:* that the weld solver holds a 3 kg gun on a fixed body stiffly enough at
  60°/s, and what the turning costs the ledger (the motor's work is booked under `power`).

### 2.2 Turret fire control, `src/core/turret.ts` (new)

A `turret` component on the carriage: `{ joint, gun, side, range, wait, hold, aim: "random" | "ship",
spread, battery?, enabled }`. It is not a pilot. It runs once a step after `runPilots` and before
`fireRailguns` (`world.ts:1266`, `:1312`):

1. **Sight.** Its target is the nearest body of the other side (`pilot.side`, AIP-016) within
   `range` with a clear line (`clearShot`, `pilot.ts`). No target: do nothing; the joint's target
   stays where it is.
2. **Wait.** `wait` game seconds from first sight before the first cycle.
3. **Pick.** `random`: a bearing uniform in the joint's arc, from a PRNG seeded per turret
   (`createRng(seed)`), so a replay is the same. `ship`: the bearing to the target's present
   position plus a uniform error within `spread`, clamped to the arc.
4. **Turn.** Set the joint's `target`. Wait until the joint's angle is within 1° of it.
5. **Fire.** Turn the railgun's channel on for one step, if the battery rule (§2.3) allows and
   `enabled` is true. Then `hold`, then pick again.

MVP1 uses `random`. `ship` is the same code with a different pick, switched in the scenario.
`enabled` is what the factory's stop rule turns off (§3.4).

### 2.3 Power, simply, `src/core/turret.ts`

Not a general power model: one small rule, to be replaced when the engine gets one.

- A battery body carries `charge: { shots, capacity }` (first value 5).
- A generator body carries `generator: { battery, burn }` and its own small `contents`. Each step
  it is whole and has fuel, it burns `burn` and adds to the battery's shots up to capacity. Its
  fuel arrives by a feed link from the turret's tank (the pipe).
- A shot takes one from the battery. With none, the turret doesn't fire.
- "Joined" is by welds: the turret checks that the gun, carriage, mount and battery are still
  connected through unbroken joints (the assembly roots the tractor already uses, `tractor.ts`).
  The pipe is a thin body welded between tank and generator; its feed link breaks with it
  (`breakWreckage`).
- Burnt fuel leaves the world: booked under `boundary`. *(A cheat: no exhaust, no heat.)*
- The ship's own gun doesn't use this rule.

### 2.4 Fuel through the beam, `src/core/tractor.ts`

A tractor may declare `siphon: { rate, into: [ids] }`. While the beam is on and a body in its wedge
carries `contents` and `siphon: true`, propellant moves from that body's stores to the ship's
tanks at `rate` in total, until the source is empty or the tanks are full. It uses the store
arithmetic of `runFeeds`; mass and energy are conserved (booked under `transfer`).

- The tank is a free body welded to its base, so the beam finds it. The beam's pull is also on it
  (TRC-002): the weld must be stronger than the beam's force, or the beam tears the tank off.
  First values: beam 400 N, the tank's weld Lander's ×3. To measure.
- A tank isn't captured: it is given `capture: false`, a new flag the capture test reads
  (`tractor.ts:213`), so the tether never takes it.
- The shell's explosive `whenDestroyed` charge is set from what the tank still holds, as the
  ship's tanks are (LND-021).

### 2.5 Shield, `src/core/shield.ts` (new). The largest piece

A `shield` component on the cockpit: `{ channel, radius, burn, from: [tank ids] }`. While its
channel is on and there is fuel:

- **Fuel.** It draws `burn` kg/s with `drawPropellant` (`world.ts:898`). No fuel: it is down.
- **Shells.** Before `solveContacts`, a body with an `explosive` or flagged `shell`, not of the
  ship's own assembly, that is inside `radius` and closing, has its velocity relative to the ship
  reflected about the line from the ship's centre of mass. It doesn't burst (no contact). The
  ship's velocity doesn't change.
- **Gas.** The field is one more wall for gas: a disc of `radius` moving with the ship, added
  where `wallBodies` and `buildWalls` gather walls (`gas.ts:1835`, `:664`). Parcels bounce off
  it; the impulse isn't passed to the ship.
- **Blast.** The declared blast term (WPN-006) skips bodies of a shielded ship when the blast's
  centre is outside the field.
- **Cost of the cheat.** The momentum the field takes from shells and gas goes nowhere: booked
  under `boundary`, each step, so the ledger still closes and the amount is on record.
- **While up:** the game zeroes the ship's engine and gun channels (in the mix, §3.2), and the
  tractor takes nothing new. The field doesn't cover the pod and does nothing against rock or
  buildings: those are contacts, which it leaves alone.
- *Risks:* a moving gas wall that isn't a body is new to `gas.ts`; its step cost with several
  bolts' gas near the ship is measured before it is merged. If it is too costly or too invasive,
  the fallback is to delete parcels that enter the field (booked under `boundary`), which looks
  the same from the cockpit. That choice goes to Chloe.

### 2.6 Small ones

- **`capture: false`** on a body (§2.4).
- **A detonation the game can call.** The factory's blast is an `explosive` on its core set off by
  the game at the countdown's end. `Explosive.trigger` exists (`explosive.ts:28`); if it doesn't
  serve, `detonate` is exported for game logic.

## 3. The game in the world, `src/core/thrust.ts` (new)

Beside `lander.ts` and `arcade.ts`: `Scenario.world.thrust?: ThrustSpec`, validated by
`validateThrust` (`scenario.ts`), started by `startThrust` in `createWorld`, stepped by
`runThrust` after `runArcade` (`world.ts:1589`). `World.thrust = { spec, state }`.

### 3.1 Spec (scenario `world.thrust`)

```
ship:      the ship template (bodies, joints, links with p{n}- ids), as arcade's
start:     { position, angle }          where each ship beams in
top:       number                        the height that ends the level
up?:       "y"                           reserved: "centre" for round gravity (V2)
pod:       body id
stand:     { position }                  for the HUD's "on the stand"
lives:     3
wait:      1.25                          game s before the next ship
grace:     1                             game s of protection at beam-in
factory?:  { core, parts: [ids], stop: { first, more }, critical, countdown }
turrets:   [carriage ids]
scores:    { turret, tank, pod, critical, fuel }
carry?:    { score, lives }              from the level before (set by the page)
seed:      number
```

`up` and the optional `factory` are there for the V2 note in the spec (§11b): round gravity and
levels with no factory.

### 3.2 State and the mix

`ThrustState`: `phase` (`flying` / `between` / `won` / `over`), `lives`, `score`, `shipN`,
`nextAt`, `graceUntil`, `pod` (`stand` / `loose` / `tether` / `gone`), `factory` (`hits`,
`stoppedUntil`, `criticalAt`, `blown`), `turretsOut`, `tanksEmptied`, `reason` (why it is over).

`thrustMix`, called where `arcadeMix` is (`world.ts:1264`), applies the ship's control mix
(`SHIP_MIX`, `scripts/asteroidShip.ts:212`) and, while the shield's channel is on, zeroes the
engine and gun channels.

### 3.3 The step hook, `runThrust`

In order:

1. **Ship lost?** `shipState(world, ship).flies` is false (`duel.ts:74`), or the cockpit is gone.
   Then: remove its control links (as `arcade.ts:798`), `lives − 1`, phase `between`,
   `nextAt = now + wait`. Nothing else is touched: the wreck, the pod, the turrets, the tanks and
   the factory stay as they are (MTH-023). A pod on the tether is let go by the tractor when its
   body is wreckage (TRC-001).
2. **Next ship.** In `between` at `nextAt`, with lives left: `addShip` at `start` with `grace`
   (factored out of `arcade.ts:243` into a shared `spawn` helper, with `withN`). If the start is
   blocked by wreckage, the ship beams in at the nearest clear point above it (`clearestSpot`'s
   test, `arcade.ts:486`). No lives left: phase `over`, reason `ships`.
3. **Pod.** Its state is read from the body and the ship's tractor (`mode === "tether"` and
   `cargo` is the pod). The pod's body gone or at 0 integrity: phase `over`, reason `pod`.
4. **The top.** The ship's cockpit above `top`:
   - pod on the tether: phase `won`; score the pod, fuel left, and the critical bonus if the
     factory is counting down;
   - otherwise: **beam back.** Every body of the ship's assembly is moved by the same offset to
     `start`, with velocity and spin set to zero (`body.set`, `world.ts:1125`). Damage, fuel and
     shells are untouched. No life is lost. No exception (spec §1). Booked under `boundary`.
5. **Factory** (when the level has one):
   - a **hit** is a contact between one of the ship's shells and a factory part, read from the
     step's contacts. Each hit: `hits + 1`, `stoppedUntil = now + first + more × (hits − 1)`.
     While `now < stoppedUntil`, every turret's `enabled` is false.
   - **critical** when the core's integrity falls below `critical`: `criticalAt = now +
     countdown`.
   - at `criticalAt`: the core's charge is set off. If the phase isn't `won`, the pod is still on
     the planet: phase `over`, reason `factory`.
6. **Turrets and tanks scored.** A turret counts once when it can no longer fire (gun, carriage
   or battery gone). A tank counts once when the ship has emptied it.

Events for the page and tests: `thrust.ship`, `thrust.lost`, `thrust.back`, `thrust.pod`
(state changes), `thrust.factory.hit`, `thrust.critical`, `thrust.blown`, `thrust.won`,
`thrust.over`.

**Out of fuel** needs no rule: the engines stop, the ship falls, and step 1 sees the crash.

### 3.4 What is left to the physics

Nothing in `runThrust` damages anything. Turrets die, the pod survives, tanks explode and the
ship breaks only through contacts, blasts and welds, by the shared damage model. The factory's
stop rule and the countdown are the only game rules that reach into the world, and the spec's
physics page lists them as cheats.

## 4. Levels, ship and pieces, `scripts/thrust.ts` (new)

Run as `node scripts/thrust.ts`; writes `scenarios/thrust-1.json` and `thrust-2.json`.

### 4.1 Ground

- The outline code moves out of `scripts/lander.ts` into `scripts/terrain.ts` (the polyline
  `terrain()`, `:30-50`, and Cave 2's outline-to-crust, `:378-480`), used by both. Lander's
  scenarios must come out byte for byte the same.
- A level is an outline of points, in metres, written in `scripts/thrust.ts` for levels 1 and 2
  and read from `scripts/data/*.json` for drawn ones (MTH-013).
- The generator throws if any passage is narrower than the level's least width (MTH-012), as
  Cave 1's does (`scripts/lander.ts:345`).
- No wrap; rock walls at the sides; gravity `{ x: 0, y: -4 }`.
- The scenario also carries `ui.sky`: the polygon above the surface, closed across each cave
  mouth, for the stars (§5.2).

### 4.2 The ship

`asteroidShip()` (`scripts/asteroidShip.ts`) gains an option for the two units; Asteroids' own
output must not change.

- **Tractor unit** and **tether unit:** 1 kg boxes under the two generators, either side of the
  main engine. The tractor unit carries `tractor: { channel, origin, direction: down, arc, range,
  force, tether: { length: 12, … }, tetherFrom: tether unit, siphon }`. To check: clear of the
  main engine's exhaust.
- **Turning:** the small thrusters' flow raised until turning is about 7 rad/s² (it is 3.5 at
  0.68 kg/s). That also raises braking and adds to forward thrust; measured and recorded.
- **Slugs:** the magazine's shell with no `explosive`. First values: Asteroids' mass and speed.
- **Shield** component on the cockpit (from step 8).
- Mass about 69 kg; the pod 34 kg.

### 4.3 The pod

A free disc (radius 1 m, 34 kg) resting on a fixed stand, with a material tough enough for
MTH-025 (a 30 m/s crash, a bolt and a slug leave it whole). `explosive` with `whenDestroyed`, a
small charge. The stand is a fixed cup so the pod doesn't roll off.

### 4.4 Turret, buildings, tanks

- **Turret** (spec §3): a fixed base plate; welded to it as free bodies the mount, battery,
  generator and fuel tank; the pipe between tank and generator; the carriage on the mount by the
  turning joint (§2.1), the gun welded to the carriage with its magazine. A template function
  `turret(at, angle)` places one on ground, wall or roof.
- **Bolt:** the magazine's shell: the gunship shell (`scripts/asteroids.ts`, disc 0.3 kg, charge
  0.05) with less heat and more `gas`, at 40 m/s, bursting on contact or at the end of its life.
- **Factory and buildings:** fixed foundations with free pieces welded on, so they break up and
  can be destroyed. The factory's core carries the big charge.
- **Fuel tank:** a free tank body welded to a fixed pad, `siphon: true`, `capture: false`.

## 5. The page, `thrust.html`

As Asteroids' page was added (commits `04b3f50`, `9b1e6f1`):

- `thrust.html`, an input in `vite.config.ts`, `src/app/thrustMain.tsx`, `src/app/Thrust.tsx`,
  `src/app/thrustHud.ts`; a `scoreBoard("thrust")` (`scores.ts`); scenarios loaded with
  `scenarioFile` (`scenarios.ts:61`).
- **Levels.** One scenario a level. On `won`, the page loads the next scenario and sets its
  `carry` (score, lives). After the last level: the game is complete, then the score table.

### 5.1 Controls

- Keys, as `Asteroids.tsx:111`: Q/E turn, Space thrust, the fire key as Asteroids; **Z** tractor,
  **X** shield; **/** and **.** as the right-hand pair. The swap-turn option carries over.
- Touch: Asteroids' buttons plus Tractor and Shield (`<Thrust>`, `Lander.tsx:273`).

### 5.2 Drawing (`render.ts`)

- **Stripes.** A ground style `ui.ground: { fill: "stripes", colour, pitch }`. Beside
  `drawGroundLine` (`:681`): clip to the rock (the outline's solid side) and draw horizontal lines
  at world heights that are multiples of `pitch`, a line and a gap of equal height, snapped to
  whole pixels so they don't shimmer when the camera moves. No outline is drawn.
- **Stars.** `drawStars` (`:654`) clipped to `ui.sky`. Open space below it is left black.
- **Camera.** Lander's follow loop (`Lander.tsx:322-346`), with the view widened to keep the pod
  in frame while it is on the tether.
- **HUD** (`thrustHud.ts`): score, lives, fuel, shells, the pod's state, the turrets' stop time,
  the factory's countdown.
- **Title:** the level-1 scenario drawn still (no stepping) under the name and buttons.

## 6. Plan

One PR each, merged once `pnpm check`, the e2e tests and CI are green. Each records its
measurements in the PR and the spec. Chloe plays after steps 4, 6 and 8.

1. **Docs:** the spec, this design, and the engine requirements added to `docs/spec.md`.
2. **Levels, ship and pod** (`scripts/terrain.ts`, `scripts/thrust.ts`, the scenarios).
   - Tests: Lander's scenarios unchanged; Asteroids' ship unchanged; the least-width check
     throws; the ship turns at 7 rad/s² ± 10%; the beam takes the pod and the tether holds it
     through a climb; MTH-025's three pod tests; a clean ledger.
3. **Game core** (`thrust.ts`): lives, nothing resets, win, beam back, pod destroyed.
   - Tests, scripted runs: loss → wait → protected ship, level untouched; three losses → over;
     the top with the pod → won and scored; the top without → back at the start with the same
     damage and fuel; pod destroyed → over; out of fuel → crash → life lost; determinism (same
     hash twice).
   - **Performance probe:** step time on both levels against 6 ms.
4. **The page:** play, HUD, stripes, stars, camera, touch, pause, game over, level 1 → level 2.
   - e2e: load, fly, Z takes the pod, reach the top, level 2 loads with the score carried; touch;
     pause and quit; no zoom. Screenshots at iPad and laptop sizes.
   - **This is the MVP. Chloe plays.**
5. **Turrets:** the turning weld (§2.1), fire control (§2.2), power (§2.3), bolts; a sandbox
   scenario `turret.json`.
   - Tests: the gun reaches its bearing before every shot; the same seed gives the same bearings;
     no sight, no fire; first shot only after the wait; the battery runs out with no generator;
     a slug on the tank puts the turret out (MTH-035) with nothing forced; a bolt 2 m off pushes
     the ship and destroys nothing (MTH-032); the mount's joint survives the gun's recoil; hashes
     of every existing scenario unchanged.
   - Probe: step time with four turrets firing.
6. **Factory:** buildings that break up, the stop rule, critical, countdown, blast, game over.
   - Tests: each hit stops the turrets longer; critical at the threshold; out with the pod in
     time → bonus; pod still down at the blast → over; a ship at the top without the pod during
     the countdown is beamed back.
   - **Chloe plays.**
7. **Fuel through the beam** (§2.4).
   - Tests: fuel moves at the rate and stops when full or empty; mass conserved; the tank's weld
     holds against the beam; a shot tank explodes by what it holds; a turret whose tank is drained
     falls quiet after its battery's shots.
8. **Shield** (§2.5).
   - Tests: a bolt at the field leaves the ship's velocity and parts unchanged (MTH-040); fuel
     falls at the rate; no fuel, no shield; engines and gun off; the pod isn't covered; rock still
     hurts; the ledger closes with the push booked under `boundary`; hashes unchanged elsewhere.
   - Probe: step time with gas against the field. The fallback (§2.5) goes to Chloe if needed.
   - **Chloe plays.**
9. **Title, How to play, The physics, high scores.**
10. **Tuning and review:** slow tuning tests for the values Chloe sets (bolt damage, pod
    toughness, turret timings); `docs/reviews/M10.md`; then level 3 and drawn levels; doors later.

Requirement IDs: the MTH-… IDs in test names; the engine requirements in `docs/spec.md` under a
new milestone M10, so `req:report` traces them.

## 8. The MVP as built (12 November 2026)

Steps 2 to 4 of the plan, in one branch. What is in it, what it measured, and where it left the
text above.

**Built**

- `src/core/thrust.ts`, with `world.thrust` in the scenario format: lives, the pod's state, a lost
  ship and the next one, the level's top (won with the pod, beamed back without), the pod
  destroyed, self-destruct.
- `scripts/terrain.ts`, `scripts/thrust.ts`, `scenarios/thrust-1.json` and `thrust-2.json`.
- The ship's tractor unit and tether unit (`scripts/asteroidShip.ts`, an option; Mammoth
  Asteroids' scenario comes out unchanged).
- `thrust.html`, `src/app/Thrust.tsx`, `thrustHud.ts`, `thrustMain.tsx`; the striped rock, the
  stars in the sky only and the pod's glow in `render.ts`; a button on the sandbox's start screen.
- Tests: `tests/core/thrust.test.ts` (14), `tests/app/thrust.test.ts` (5), one more in
  `tests/core/tractor.test.ts`, `e2e/mammoth-thrust.spec.ts` (10).

**Measured** (Node, the build machine)

| What | Value |
|---|---|
| Turning, small thrusters at 1.45 kg/s (Asteroids: 0.68) | 7.0 rad/s² (Asteroids: 3.5) |
| Forward, with those thrusters | 31.5 m/s² (Asteroids: 28.3) |
| Braking | 8 m/s² (Asteroids: 4.2) |
| Ship | 69 kg; the pod 34 kg |
| Step time, level 1, falling | 0.8 ms |
| Step time, level 2, hovering in the chamber for 12 s | 0.8 to 1.7 ms, against 6 ms |
| A level-1 flight straight up from the pod to the top | 4.9 game s; 1,530 points of fuel left |
| The pod: a 30 m/s crash into rock; a slug | integrity 1 after each |

**Changed from the text above**

- **The tether pays out (TRC-010, new).** Taken at 9 m, a 12 m tether pushed ship and pod apart
  with 6,000 N (the TRC spring pushes as well as pulls) and tore the 1 kg tractor unit off. The
  tether now starts at the distance the pod was taken at and lengthens at 4 m/s. It is an option
  of the tractor, off unless a scenario sets it. The two units also have two welds each.
- **`scripts/terrain.ts` is new code, not Lander's moved** (§4.1 said moved). Lander's generator is
  untouched, so its scenarios can't have changed. The two could share the code later.
- **A level's ground is one closed outline of its open space**, sky and caves together, with the
  rock as a crust on its rock side. The scenario carries the sky's outline and each cave's, for
  the drawing (`thrust.view`), where §4.1 said `ui.sky`.
- **A ship out of fuel and lying still is lost** after 1 game second. The spec's rule (it falls and
  crashes) leaves a ship set down gently with empty tanks stuck for ever.
- **Self-destruct**, as Mammoth Asteroids', for a ship too damaged to fly usefully.
- **The beam back sets the ship upright** at the start, as well as at rest.
- **A new ship always beams in at the start.** §3.3 planned a search for a clear spot if wreckage
  is there; the start is in the sky, where wreckage doesn't stay.
- **The view is 90 m tall**, following the ship, and leans a third of the way toward a pod on the
  tether. It doesn't widen.
- **Keys:** Z or / for the tractor. X and . are kept for the shield.
- **Not in the MVP:** high scores, How to play and The physics (step 9); the title has Play only.

**To look at when playing**

- Exhaust lingers in level 2's closed chamber as a glowing haze. It is the engine's own wisps,
  and costs little, but it may be more than is wanted.
- The 90 m view makes the ship about 45 px wide on a laptop.
- Gravity, thrust, the tether's length and pay-out, and the fuel's worth are all first values.

## 9. Turrets as built (step 5, 12 November 2026)

**Built**

- `src/core/turret.ts`: the joint that turns (ASM-008), turret fire control (WPN-009), and the
  battery and generator rule (WPN-010). Bodies gain `turret`, `charge` and `generator`; joints gain
  `turn`. All off unless a scenario declares them.
- `scripts/turretParts.ts`: the turret of the spec's drawing, 8 pieces: a fixed base; a fuel tank,
  a pipe, a generator, a mount and a battery welded to it; a carriage on the mount by the turning
  joint; a barrel welded to the carriage.
- One turret on level 1 (a ledge at the hollow's rim, 26 m from the pod); three on level 2 (the
  surface, the chamber's floor, and hanging from its roof over the pod).
- The game points each turret at the ship flying, and at nothing between ships. A turret that can
  no longer fire scores 750, once.
- Tests: `tests/core/turret.test.ts` (9), four more in `tests/core/thrust.test.ts`, one browser test.

**Measured**

| What | Value |
|---|---|
| The gun behind its bearing while turning at 2.1 rad/s | under 0.012 rad; on it as the joint arrives |
| A turret standing or hanging under 4 m/s² for 8 s | all 12 welds whole; the mount moved 1 mm |
| One of the ship's slugs on the fuel tank | the tank, pipe, generator, mount and barrel gone; out of action |
| One slug on the barrel, battery or generator | that piece at 30 to 40%; a second destroys it |
| A bolt bursting 2 m from a wing tip | the ship pushed 0.6 m/s; nothing broken |
| A bolt striking the wing | pushed 2.3 m/s, turned 0.5 rad/s; the part it strikes destroyed |
| Step time, level 2, hovering in the chamber, three turrets awake | 1.5 ms; worst half second 2.9 ms; against 6 ms |

**Changed from the text above**

- **The bolts ride at the pivot.** The railgun is on the carriage, which carries the bolts; the
  barrel is a light piece welded to it, and the turret needs it to fire. With 12 kg of bolts in the
  barrel the gun hung 0.19 rad off its bearing and took seconds to settle: a weld to a fixed body
  is held softly.
- **A turret's target is a body's id**, set by the scenario or by the game each step. §2.2 said
  the nearest body of the other side; the player's ship has no pilot, so no side.
- **Aiming at the ship works without an angle.** The core may not use `atan2` (DET-003). The gun
  turns by the sine of the angle between its bore and the line to the target, which is enough.
  Levels use `random` for now, as agreed for MVP1; `ship` is one word in `scripts/thrust.ts`.
- **A turret's metal is a third as tough as the ship's**, so two slugs destroy a piece.
- **The bolt:** 0.3 kg at 40 m/s, a 0.05 kg charge that makes 6 kg of gas (a cheat the ledger
  records) and damages only within 0.6 m.
- **The wait is once.** A turret waits 3 s the first time it sees a ship. After that, losing sight
  and seeing again starts it firing at once.
- **Not built:** the sandbox scenario `turret.json`; the factory's stop (step 6), so `enabled` is
  always on; the ship taking a turret's fuel (step 7), though a turret whose tank is empty does
  fall quiet once its battery is flat.

**To look at when playing**

- Random fire with gravity: bolts go up and come down somewhere. On level 1 that is mostly not on
  you; in level 2's chamber they burst on the walls round you.
- A direct hit destroys the part it strikes, often a thruster's nozzle wall. The HUD's DAMAGE reads
  the worst part still on the ship, so a part knocked clean off can leave it at 0%.

## 10. Tuning after Chloe first played (12 November 2026)

She found it fun and very hard, and asked for the pod to be easier to pick up and keep.

| Asked for | Done |
|---|---|
| A stronger beam | 400 N to 1,200 N. |
| The tether to attach from further off and bring the pod in to its length, heavily damped | `tether.reach` 22 m (the length is 12 m). The tether starts at the distance the pod was taken at and reels in at 6 m/s (TRC-010, now both ways). Damping 0.7 to 1.5 of critical. Measured from 20 m while hovering on short burns: at 12 m in 1.5 game s, the pull never over 800 N. |
| The beam and tether to take only the pod | `only: ["pod"]` on the ship's tractor (TRC-011, new). Wreckage in the beam is not pulled. |
| A few seconds to watch a self-destruct, and then (after playing again) any loss | The page says "ship lost" 3 s (1.5 game s) after a ship is lost, however it was lost, and the next ship comes the usual 2.5 s after that (`watch` in the game's spec). |
| A stronger tether: it let go under thrust | See below: it wasn't the tether's strength. The limit is up five times all the same, to 100,000 N. |

**Why the tether let go.** It never reached its limit: the most it carried in hard flying was about
2,100 N of 20,000. The tether's pull is applied at the ship's centre of mass, on the body that
carries the tractor, which was the 1 kg tractor unit a metre away. That twisted the unit's welds
with about 2,300 N·m at each burn. A weld bends at 30% of its limit (1,650 N·m here) and is left
weaker each time, so after enough burns the unit came off, and the pod went with it. The cockpit
now carries the tractor, through the two units: the tractor unit is its beam's generator (TRC-012,
new) and the tether unit its tether's (TRC-007), so losing either still stops it. Measured after:
six seconds of full thrust and a hard turn with the pod on, no weld of the ship below 100%.

## 11. Ground that can be cratered (12 November 2026)

Asked for by Chloe: cannon shots and explosions should leave craters in the scenery. Built as
version 1, `src/core/terrain.ts` (TER-001…005 in `docs/spec.md` §9.13).

**How it works**

- The level's ground was already one closed outline of its open space, with the rock as a crust
  along it. The world now makes that crust itself, from `world.terrain.outline`, where the level
  script used to write the rock's bodies into the scenario.
- A crater is a disc of open space added to the outline. The boundary of the rock is then every
  stretch of the outline outside all the craters, and every stretch of a crater's rim that lies
  in rock. Each stretch gets its piece of crust. Nothing needs the boundary as one ordered loop,
  so tunnels, islands of rock and craters on craters all come out of the same rule, with no
  polygon clipping to go wrong.
- Behind any new surface the crust is made afresh, so the rock is as deep as anyone digs. Round a
  crater it is 4 m deep and fans out from the crater's centre, so its pieces meet.
- A new crater makes again only the crust near it.
- The page draws each crater as a black disc over the rock's lines.

**What was decided** (Chloe, 12 November 2026)

| Question | Answer |
|---|---|
| What makes a crater | Explosions, and a very small one for a bullet, to give bullets weight. Not other impacts this time (a mass-impact rule may come later). |
| What stands on the ground | Let it float for version 1. Ideally it falls when its ground goes. |
| Tunnelling | Yes. It is a physics sandbox; a stupid shortcut is the player's to take, and likely harder than the intended way. |
| The rock removed | Dust, for now. |

**First values** (`scripts/thrust.ts`)

- An explosion's crater: 0.6 × the reach of its blast. The ship's magazines (6 m) 3.6 m; a
  turret's fuel tank (4 m) 2.4 m; the ship's battery (1 m), tanks and engines (0.5 m), and a
  turret's bolt (0.6 m) the least, 0.8 m.
- A slug: 0.8 m, and the slug is spent. (0.5 m was tried first: 8 px across at the game's zoom, it
  could hardly be seen.)
- At most 250 craters, 150 of them under 1 m.

**Bullet craters dropped (12 November 2026, the same day).** Chloe asked what craters cost. Each
adds two or three fixed bodies for good, and a step pays for every body: 250 craters took a step
from 1.3 to 1.9 ms falling and from 1.9 to 3.7 ms thrusting, and 351 put it over the 6 ms allowed.
Slugs and bolts were where the numbers came from (three turrets, a bolt each every 2 s). She chose
craters for explosions only: `bullet` is 0 and `least` 1 m, so a slug, a bolt, and the ship's
battery, tanks and engines leave none; the ship's magazines and a turret's fuel tank do. A slug is
still spent in the rock. The first values and the slug measurements above are from before this.

**Sized from the blast's reach, not its energy.** Energy was tried first (0.9 × ∛kJ). A turret's
bolt carries more energy than a fuel tank, because it is made to push with gas, so bolts left the
bigger craters. The reach is what each charge is declared to damage.

**Measured** (Node, the build machine, level 1)

| What | Value |
|---|---|
| Cutting a crater, 250 there already | 4 ms on average, 13 ms at worst |
| The same before the crust round a crater was made 4 m deep (it was 15 m) | 11 ms on average, 39 ms at worst |
| A step with 250 craters (584 rock bodies; 38 at the start) | 1.9 ms falling, 3.7 ms thrusting |
| A step with none | 1.3 ms falling, 1.9 ms thrusting |
| 24 slugs strafed along flat ground | 23 craters; the rock's bodies 38 to 99 |
| 13 craters of 2 m dug straight down | a shaft 18 m deep; a ball dropped in rests on its floor |

**Found on the way**

- **The view left with the ship.** With the cockpit destroyed the view went straight back to the
  start, so the 3 s to watch a lost ship showed empty sky. It now stays where the ship was until
  the next one beams in.
- **Rays miss small craters.** The crust's depth was found by rays from 9 points along a stretch,
  as Lander's cave does. A small crater between two rays under a 40 m stretch was missed, and the
  crust ran through it. Every wall that passes over a stretch now limits its depth as well.

**Not in version 1**

- Things standing on the ground falling when it is cut away.
- Craters from a ship, the pod or wreckage hitting the ground.
- Rubble: the rock leaves as dust, which is only drawn.
- Between two craters that nearly touch, the sliver of rock left is cased in both their crusts
  but may be hollow inside. Nothing can get in.

## 12. Engines that had come off still answered the controls (12 November 2026)

Found by Chloe in play: the controls still worked engines that were no longer on the ship.

- **Cause.** Mammoth Asteroids has a rule for this (MAS-037, `cutLines` in `arcade.ts`): an engine
  no longer welded to the ship has its fuel line cut, burns off what it holds on a channel of its
  own, and is then dead; a gun knocked off loses its control link. Mammoth Thrust uses the same
  ship but its game (`thrust.ts`) never called that rule. §8 said the MVP left it out; it should
  not have. A link has no mass and no weld: when a part breaks off, nothing in the physics cuts it.
- **Fix.** The rule is now one function both games call (`cutShipLines`, `cutControl`), and
  Mammoth Thrust's requirement is MTH-062.
- **Checked.** A test knocks the left back thruster off, then holds the control that fires it on
  a whole ship: no fuel reaches it and nothing lights in it, while the thrusters still on the ship
  fire. It failed before the fix. Mammoth Asteroids' own tests for the rule pass unchanged.
- **What else was looked at.** The tractor unit and the tether unit: losing either stops the beam
  or drops the pod (TRC-007, TRC-012, tested). A lost ship: all its control links go, so a wreck
  answers nothing (tested). A turret: without its barrel, carriage joint or battery it doesn't fire
  (tested).

## 7. To decide or measure, in order of when it bites

| When | What | Who |
|---|---|---|
| Step 1 | The engine changes in §2 change shared code (joints, tractor, gas, explosive). | Agreed by Chloe, 12 November 2026 |
| Step 2 | Does raising the small thrusters' flow give the turning wanted without too much extra braking, or should the thrusters move outward? | Measured (§8): 7.0 rad/s², with braking doubled to 8 m/s². For Chloe to judge in play. |
| Step 3 | Protection at beam-in: Asteroids' 2 s, assumed here. The spec doesn't say. | Chloe |
| Step 5 | Is the weld solver stiff enough to hold and turn the gun (§2.1)? If not, the carriage's angle is set directly each step, and recoil is lost. | Measured (§9): yes, once the bolts' weight is at the pivot. |
| Step 6 | How the factory fits with turrets that have their own power (parked, spec §11). | Chloe |
| Step 8 | The shield's gas wall, or the simpler fallback. | Measured, then Chloe |
