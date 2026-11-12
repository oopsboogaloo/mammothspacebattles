# Mammoth Thrust: game spec

A cave-flying mini game built on the Mammoth Space Battles physics (mini game 4 of the roadmap,
`docs/spec.md` §12.1), after the 1986 BBC Micro game Thrust. You fly the Asteroids ship, fitted
with a tractor beam and a tether, down a twisting cave under lunar mountains, past gun turrets, to
an energy pod. You take the pod on the tether and carry it up to the height where the level ends. The landscape,
levels, look and sound are our own; only the idea and the rules of play follow the original.

Status: **draft, 12 November 2026**, from Chloe's brief and two rounds of questions (§10). Open
questions are in §11. Nothing is built. The requirement IDs (MTH-…) are this game's own. The
engine changes the game needs (§8) become requirements in `docs/spec.md` once agreed.

What the original does, for reference (Wikipedia's article, pasted by Chloe on 12 November 2026;
other sources in §12):

- Rotate and thrust under gravity. Ship and pod are joined by a stiff rod and can end up spinning
  round each other. Ship or pod touching a wall is death.
- Turrets fire bullets at the ship and are destroyed by a single shot.
- The reactor powers the defences. Shot enough, the turrets stop for a short time. Shot more, it
  goes critical and destroys the planet in 10 seconds. The ship must be in space before then,
  with the pod (more points) or without it.
- Fuel is collected with the tractor beam. Out of fuel, the whole game is over.
- The shield burns fuel, and the ship can't shoot while it is up.
- Later levels have doors opened by shooting a panel.
- Six levels; then again with reversed gravity, then with the planet and walls invisible unless
  the shield is up, then both.

## 1. Decisions

| Question | Decision |
|---|---|
| Ship | The Mammoth Asteroids ship (67 kg), with a **tractor unit** under the belly and a **tether unit** beside it (two new parts, each can be knocked off). About twice the turning power (3.5 → about 7 rad/s²). |
| Gun | The same cannon, firing **solid slugs with no charge**: no blast, so a shot at a wall beside you does nothing to you. Turrets, the factory and fuel tanks are damaged by the impact alone. Speed, mass, rate and magazine to be tuned. |
| Gravity | Uniform, **4 m/s²** down (Lander: 1.6), for the first tuning pass. |
| Landscape | Lander's kind: a polyline (later Chloe's hand-drawn outlines, as Cave 2), fixed rock that can't be damaged. The levels grow as the original's do: an open surface first, then one chamber, then twisting caves. All layouts are our own. |
| On the surface | A small **factory** (the reactor) and a couple of other buildings. |
| Pod | A sphere of about **half the ship's mass (33 kg)** on a stand at the bottom of the cave. Taken with the tractor beam and held on the tether. |
| Tether | The existing springy tether (TRC-004), retuned: a damped spring between the centres of mass that breaks over its tension limit (TRC-006). Not the original's rigid rod. |
| Turrets | Fixed hemispheres on the rock. A turret starts firing a few seconds after it first sees the ship, slowly, at where the ship is now (no lead) with some spread. Can be shot and destroyed. |
| Turret bolts | Concussive: a small charge that makes gas. Mostly they push the ship off course; they do a little damage and may knock parts off. One hit doesn't kill. Chloe tunes the damage. |
| Factory (reactor) | Powers the turrets. Each hit stops every turret for a time, longer with each hit. Enough damage and it goes critical: a countdown, then a very large explosion. Escaping with the pod before it blows earns a bonus. If it blows with the pod still on the planet, the **game is over**: nothing is replayed. |
| Shield | A round field about the ship while its button is held. It turns away bolts and blast gas, so they neither damage nor push the ship. It burns fuel; engines and gun are off while it is up; it doesn't protect against rock. A separate button from the tractor. |
| Fuel | Limited. Fuel tanks stand on the ground; holding the tractor beam on one refills the ship. A tank that is shot explodes. |
| Crashes | Physical, as in Lander and Asteroids: gentle scrapes are survived, hard hits break parts off. The pod is damaged the same way. |
| Life lost | The cockpit destroyed, or no working engine still welded to it (the duel's rule, DUEL-001). |
| Nothing resets | When a life is lost the level stays exactly as it is: the wreck, the pod wherever it lies, destroyed turrets, emptied tanks, the factory's damage. Only a new ship comes in. |
| Lives | 3. |
| Game over | The third ship lost, the factory blowing while the pod is still on the planet, or the pod destroyed. The pod is made very, very hard to destroy. |
| The top without the pod | The ship is beamed back to the start, as it is, to finish the mission. No life is lost. No exception: with the factory counting down it is beamed back too, and the game is lost when the factory blows. |
| Out of fuel | The ship falls and crashes: a life lost in the usual way, and a new ship. |
| Turrets' build | Made of welded pieces with materials, like a ship, and damaged by the same model. One good hit mostly blows a turret to bits; a poor one may leave it working, or working worse. |
| Doors | Doors opened by shooting a panel, in a later phase. |
| Shells | A magazine of 120, full with each new ship. |
| Win | The ship, with the pod on its tether, climbs above the level's top. There is no air anywhere: the top is only a height. |
| Levels | The missions we draw, in order. No reversed gravity, no invisible walls. |
| Title | One of the maps, still, with nothing happening, under the name and buttons. No demo. |
| Name | **Mammoth Thrust**, on its own page, `thrust.html`. |

## 2. Flow

1. **Title screen:** **MAMMOTH THRUST** over a still view of one of the maps, with Play, How to
   play, The physics and High scores.
2. **Play.** The ship starts in the sky above the mountains, with a full tank and magazine.
3. **Down.** Past the surface turrets and into the cave. Shoot the turrets or the factory, or
   shield through.
4. **The pod.** Hold the tractor beam on the pod until the tether takes it.
5. **Up and out** with the pod swinging below. Level complete at the level's top, with the
   bonuses.
6. **Life lost.** Nothing on the level resets. After a short wait the next ship beams in at the
   start, with a full tank and magazine. The wreck, the pod, the turrets, the tanks and the
   factory are as they were left.
7. **Game over** when the third ship is lost, or when the factory blows with the pod still on the
   planet. Score, and initials if it makes the top 10.

## 3. Rules

### The level

- A level is a scenario: the outline of the ground, the start, the pod's stand, the factory, the
  buildings, the turrets, the fuel tanks, and the height of the level's top.
- The ground is fixed and can't be damaged. Buildings are fixed bodies with a material, so they
  can be damaged and destroyed.
- **How the levels grow** (from the map of the original's six missions Chloe supplied, 12 November
  2026). The original starts very small and adds one thing at a time: an open surface with the pod
  in plain sight; then a short shaft into a single chamber; then stepped caves that get longer,
  with more turrets and fuel; doors from the fourth mission. Ours follow that progression.
- **Our own layouts.** We take the scale and the order of difficulty, not the shapes: no level is
  traced or copied from the original's.
- **Level 1 (MVP): the surface.** No cave. Lunar mountains across about 300 m, with a hollow
  between them. The pod stands in the hollow, in plain sight. The factory and two buildings on a
  flat to one side, one fuel tank, one turret. It teaches flying, the beam, the tether and the
  climb out.
- **Level 2 (MVP): one chamber.** The factory, a building and a turret on the surface. One shaft,
  about 30 m wide and 80 m deep, opens into a single chamber about 120 m across. Two turrets on
  the chamber's walls, the pod and a fuel tank on its floor. It teaches flying the pod up a shaft.
- **Level 3 (after the MVP): the twisting cave.** Mountains across about 600 m; a cave that turns
  four or five times on its way about 300 m down; two turrets on the surface and three or four in
  the cave; two fuel tanks; the pod in a chamber at the bottom.
- No passage is narrower than about 25 m (the tether is 12 to 15 m, and the pod must swing
  through).
- The level doesn't wrap. Its sides are high rock walls beyond the mountains.

### The ship

- The Asteroids ship (`scripts/asteroidShip.ts`) with the two new parts and stronger turning.
  Forward thrust stays 28 m/s² alone, about 19 m/s² with the pod, against 4 m/s² of gravity.
- The tractor unit carries the beam. The tether unit is its tether generator (TRC-007): lose it
  and the beam still pulls but nothing can be held, and a pod on the tether drops.
- Damage is the Asteroids damage model unchanged (`mammoth-asteroids.md`, "Damage model").

### Tractor, tether and pod

- The beam points down from the belly (a 30° wedge). Held on the pod within the tether's length,
  the tether takes it (TRC-003: the pod is half the ship's mass and smaller than it).
- The tether is the TRC spring, with its length (first value 12 m), stiffness, damping and
  breaking tension as tuning values. If it breaks, the pod falls; it can be taken again if it
  survives.
- Pressing the tractor again lets the pod go (TRC-005).
- The pod is a disc with a material so tough that ordinary crashes, bolts and slugs don't destroy
  it; the factory's blast may. Destroyed, it bursts (a small charge) and the game is over.
- The ship reaching the level's top without the pod on its tether is beamed back to the start,
  with its damage, fuel and shells as they are. This holds while the factory is critical too:
  there is no leaving without the pod.

### Turrets and bolts

- A turret is built like a ship: a fixed base on the ground, the cave wall or the roof, with a
  dome, a gun and a power unit welded to it, each with a material. It is damaged by the Asteroids
  damage model. To be designed piece by piece.
- One good hit should mostly blow it to bits. Less than that can leave it working or working
  worse: the gun knocked off (it can't fire), the power unit lost (it can't fire), the dome
  damaged (first value: its aim spreads wider).
- It sees the ship when the ship is within its range and the line to it is clear of rock.
- From first sight it waits (first value 3 s), then fires one bolt every 2 s while it still sees
  the ship, at the ship's present position, with a random error of up to about 8°.
- It doesn't fire while the factory is stopped, or without its gun or its power unit.
- A bolt is a slow shell (first value 40 m/s) that bursts on what it strikes, or after its time.
  Its charge gives mostly gas and little damage: the Asteroids gunship shell made weaker and
  gassier. Bolts don't damage turrets, the factory or the pod's stand.

### The factory

- Each slug that hits the factory stops all turrets: 4 s for the first hit, 2 s longer for each
  one after (first values).
- The factory has a damage total. Past it (about 10 hits), it goes critical: a 10 s countdown on
  the HUD, then a blast that destroys everything on the surface and in the upper cave.
- Critical with the pod on the tether: get above the level's top before the blast for the bonus.
  Caught in the blast: the life is lost.
- If it blows while the pod is still on the planet, the game is over, whatever lives are left.

### Shield

- Held: a field of fixed radius round the ship's centre of mass. Shells and bolts that reach it
  bounce off it without bursting; gas parcels are turned back at it. The push goes into the field
  and not the ship (a cheat with momentum, recorded by the ledger).
- It burns fuel at a fixed rate (first value: as much as the main engine at half thrust).
- While it is up the engines and the gun don't work, and the tractor beam lets go of nothing but
  takes nothing new.
- It never covers the pod, however close, and it does nothing against rock or buildings.

### Fuel

- One tank load is about 2 minutes of full thrust, as in Asteroids. Out of fuel, the ship falls.
- A fuel tank on the ground is a fixed body. While the beam is held on one within range, fuel
  moves to the ship at a fixed rate until the tank is empty (first value: one tank is half a ship's
  load). The tank isn't lifted.
- A tank that is destroyed explodes with what it still holds.

### Scoring

| For | Points |
|---|---|
| A turret put out of action | 750 |
| A fuel tank emptied | 300 |
| The pod carried out | 2000 |
| The factory critical, and out with the pod | 2000 more |
| Fuel left at the end | 1 per 0.01 kg |

First values, to tune. Top 10 with initials, as Asteroids (`scores.ts`).

## 4. Controls, HUD and view

- **Controls.** Turn left and right, thrust, fire, as Asteroids (Q/E, Space, and the option to
  swap). New: **tractor** on **Z** and **shield** on **X** (beside the left Shift), or **/** and **.** (beside the right Shift), and a touch button each.
- **HUD.** Score, lives, fuel, shells, a pod light (on the stand / loose / on the tether), the
  factory's countdown when critical, and "turrets stopped" with its time left.
- **View.** The camera follows the ship, as Lander's cave levels do, and widens a little to keep
  the pod in view when it is on the tether. Lander's pace (1× = half real time).

## 5. How to play and The physics

Two pages, as Asteroids. The physics page says what is real (gravity, the tether's spring, gas
pushing the ship, parts breaking by impulse) and what is a cheat (the shield, fuel through the
beam, the factory's link to the turrets).

## 6. Look and sound

From Chloe, 12 November 2026, to give the feel of Thrust, and checked against three screenshots
of the original she supplied (two surface views with red rock, one cave with green rock).

What the screenshots show: the rock is nothing but thin horizontal lines of one colour on black,
a line and a gap of about the same height, with no outline, so a slope is the stepped ends of the
lines. The colour changes with the level (red, green). Open space is plain black, in the sky and
in the cave alike; the cave is a black shape cut out of the striped rock. Objects are thin
coloured outlines.

Ours:

- **Rock** is filled with thin horizontal lines of one colour on black, a line and a gap of equal
  height, fixed to the world so they scroll with the ground. No outline is drawn: the rock's edge
  is where the lines end. Each level has its own colour.
- **Sky.** A star field behind everything above the ground. (Ours; the screenshots have a plain
  black sky.)
- **Caves.** The star field stops where the cave begins. From the cave mouth down, the open space
  is plain black with no stars, so the cave reads as a hole in the striped rock and not as more
  sky.
- **Everything else** is our own modelled objects, drawn as the other games draw them: the ship,
  the pod, the factory, the buildings, the turrets, the fuel tanks, wreckage, gas. The HUD is
  ours too (Asteroids' style), not the original's framed bar.
- The pod glows. The shield is a thin circle. Buttons are Asteroids' black-and-white ones.
- Sound: to decide with the build.

## 7. Requirements

Priority: **M** must, **S** should.

**Game shell**
- **MTH-001** `[M]` A title screen with the game's name over a still view of one of the maps, and
  buttons Play, How to play, The physics and High scores. No demo.
- **MTH-002** `[M]` Play at the fixed game pace, with a pause menu (Resume, Quit to title).
- **MTH-003** `[M]` Game over, initials and a top-10 table kept on the device.

**Level**
- **MTH-010** `[M]` A level is a generated scenario with fixed, undamageable ground from an
  outline, uniform gravity of 4 m/s², and no wrap.
- **MTH-011** `[M]` The first version has two levels of our own design, as §3: an open surface
  with the pod in sight, and a shaft into one chamber. Each has a factory, a turret or more, and a
  fuel tank.
- **MTH-012** `[M]` The generator fails if the cave is anywhere narrower than its declared
  least width.
- **MTH-013** `[S]` A level may be built from a hand-drawn outline file, as Lander's Cave 2.

**Ship, tether and pod**
- **MTH-020** `[M]` The ship is the Asteroids ship with a tractor unit, a tether unit, turning of
  about 7 rad/s², and a cannon firing slugs with no charge.
- **MTH-021** `[M]` Holding the tractor on the pod within the tether's length puts the pod on the
  tether; pressing it again lets go.
- **MTH-022** `[M]` With the tether unit lost, the pod can't be held.
- **MTH-023** `[M]` When a life is lost nothing on the level is reset: the pod, the wreck, the
  turrets, the tanks and the factory stay as they are, and a new ship beams in at the start.
- **MTH-025** `[M]` When the pod is destroyed the game is over. A crash of the pod into rock at 30 m/s,
  a bolt and a slug each leave it whole.
- **MTH-026** `[M]` A ship above the level's top without the pod on its tether is beamed back to the
  start as it is, with no life lost.
- **MTH-024** `[M]` The level is complete when the ship is above the level's top with the pod
  on its tether.

**Turrets and factory**
- **MTH-030** `[M]` A turret fires only with a clear line to the ship inside its range, first
  after its wait from first sight, then at its rate, at the ship's present position with its
  spread.
- **MTH-031** `[M]` A turret is welded pieces with materials, damaged by the shared damage model. One
  that has lost its gun or its power unit doesn't fire, and stays so for the level.
- **MTH-035** `[M]` A slug from the ship's cannon square on a turret's dome puts it out of action.
- **MTH-032** `[M]` A bolt that bursts 2 m from the ship changes the ship's velocity by a
  measurable amount and destroys no part of an undamaged ship. (Values tuned by Chloe.)
- **MTH-033** `[M]` A slug hitting the factory stops every turret for a time that grows with each
  hit.
- **MTH-034** `[M]` Past its damage total the factory counts down 10 s and explodes. If the pod is
  still on the planet then, the game is over.

**Shield and fuel**
- **MTH-040** `[M]` While the shield is held, a bolt bursting at the field neither damages the
  ship (the pod is not covered) nor changes its velocity; fuel falls at the shield's rate; engines and gun don't work.
- **MTH-041** `[M]` With no fuel the shield doesn't come up.
- **MTH-042** `[M]` Holding the tractor on a fuel tank in range moves fuel to the ship until the
  tank is empty or the ship is full.
- **MTH-043** `[M]` A destroyed fuel tank explodes in proportion to what it holds.

**Lives and score**
- **MTH-050** `[M]` A life is lost when the cockpit is destroyed or no working engine is welded to
  it. Three lives. Running out of fuel costs nothing by itself.
- **MTH-051** `[M]` Scoring as §3.
- **MTH-053** `[M]` The ground is filled with horizontal coloured lines fixed to the world. Stars
  show only in the sky; open space inside the cave is a plain block colour.
- **MTH-052** `[M]` The HUD shows score, lives, fuel, shells, the pod's state, the turrets' stop
  time and the factory's countdown.

## 8. Engine changes (to agree, then into `docs/spec.md`)

New, shared physics or world logic:

- **Fixed turret.** A gun on a fixed body with a simple fire control: range, line of sight, a wait
  from first sight, a rate, a spread, a power switch. Not an AI pilot; it reuses `clearShot` from
  `pilot.ts`. There are no fixed guns today.
- **Shield.** A new body component: a field that turns back shells and gas parcels while its
  channel is on, and burns fuel. The largest piece of new physics here.
- **Fuel through the beam.** The tractor moving propellant from a declared tank body to the ship.
- **Tractor on fixed bodies.** Today the beam pulls free assemblies only (TRC-002); it has to
  find a fixed fuel tank, and the pod on its stand must be a free body resting there.
- **Tether tuning** per tractor (length, stiffness, damping, maximum tension): exists.
- **Game logic** `world.thrust` in `src/core/thrust.ts`, beside `lander.ts` and `arcade.ts`:
  lives, the factory's state, the countdown, win and loss, score.

Exists already: outline terrain with overhangs (`scripts/lander.ts`, Cave 2), uniform gravity, the
ship and its damage model, the cannon (WPN-008), explosive shells and gas, the tractor and tether
(TRC-001…007), spawning ships mid-game (SCN-010), the life-lost rule (DUEL-001), score tables.

## 9. Milestones

1. **Playable levels:** the level generator and levels 1 and 2, the ship with tractor, tether and slug
   cannon, the pod, gravity, win and life-lost rules, the page and HUD. No enemies.
2. **Turrets and the factory:** fixed turrets, concussive bolts, stopping the turrets, critical
   and countdown.
3. **Fuel and shield.**
4. **Title (a still map), How to play, The physics, high scores.**
5. **Tuning after play;** level 3 and Chloe's hand-drawn levels.
6. **Later:** doors opened by shooting a panel.

## 10. Answered (12 November 2026)

| Question | Answer |
|---|---|
| The factory | The original's reactor rules in full: stops the turrets, goes critical, countdown. |
| Tether | The existing springy tether, retuned. |
| Fuel and shield | Both: fuel tanks refilled from with the beam, and a shield. |
| Crashes and lives | Physical damage; 3 lives. |
| Shield | Turns away bolts and gas; burns fuel; engines and gun off; no help against rock; its own button. |
| Turret aim | At the ship's present position, with spread, slowly. |
| Gravity | About 4 m/s². |
| Ship | Faster turning; slugs with no charge; tractor and tether units added. |

## 10b. Answered (12 November 2026, second round)

| Question | Answer |
|---|---|
| The factory blows without the pod | Game over. There is no replay. |
| After a life is lost | Nothing on the level resets: the pod and the wreck stay where they are, turrets stay destroyed. A new ship comes in. |
| Later levels | Only the missions we have. No reversed gravity, no invisible walls. |
| Keys | Near the Shift keys, Claude to pick: Z tractor, X shield (and / and . on the right). |
| Shells | A magazine of 120 to start with. |
| Shield and pod | The shield never covers the pod. |
| Title | No demo. A still map behind the title for now. |
| Atmosphere | None. All vacuum; the top is only a height to reach. |

## 10c. Answered (12 November 2026, third round)

| Question | Answer |
|---|---|
| The pod destroyed | Game over. But the pod is very, very hard to destroy. |
| The top without the pod | Beamed back to the start to finish the mission. |
| Out of fuel | You crash, lose the life, and get a new ship. |
| Turret toughness | Built of pieces and damaged like anything else. One good hit mostly destroys one; partial damage can leave it working or working worse. |
| Doors | Yes, in a later phase. |
| The beam back | Always, with no exception, the factory critical or not. Gravity is uniform, so there is no escape velocity to worry about. |

## 11. Open questions

None from the rules. To settle in the build: the turret's pieces and what each one's loss does; the
30 m/s in MTH-025 and the other first values.

## 11b. Later (V2): where this is heading

From Chloe, 12 November 2026. None of this is in the first version (the MVP is §1 to §9), and no
decision above changes. It is here so the build doesn't close these doors.

- **Beyond Thrust.** The game already goes further than the original and will go further still.
  The Amiga game Zarathrusta (1991), a 16-bit Thrust with many more planets, is a source of ideas;
  which of its features we take is to be decided.
- **Round gravity.** A level like Lander's Orbital: a massive asteroid whose pull comes from its
  centre, with caves into it, and the pod somewhere inside.
  - The level's top becomes an altitude above the asteroid, all the way round. The rules are the
    same: reach it with the pod to win; reach it without and you are put back.
  - Here an escape velocity does exist, so the beam back has to cope with a ship arriving fast.
- **Organic levels.** The pod may be something living that we steal or harvest, with organic
  defences in place of turrets. These levels probably have no factory. This leads toward the
  main game's roadmap.
- **What it asks of the first build** (design notes, not requirements):
  - The level's top, the turrets' line of sight and the camera should work from "up", not from
    the y axis, so point gravity can replace uniform gravity (the engine has both).
  - The factory should be optional in a level, with the turrets able to run without one.
  - Defences should be a kind of thing a level places, so another kind can be added beside the
    turret.

## 12. Sources

- Thrust (video game), Wikipedia: https://en.wikipedia.org/wiki/Thrust_(video_game) (the
  article's text, pasted by Chloe)
- Thrust (BBC/Electron), Everygamegoing: https://www.everygamegoing.com/litem/Thrust-1/1289/
- Thrust instructions, 8BS: https://8bs.com/elecgame/thrust.htm
- Thrust manual (C64 rewrite), Lysator: https://www.lysator.liu.se/~peda/thrust/thrust-man.html
- Zarathrusta, Wikipedia: https://en.wikipedia.org/wiki/Zarathrusta (through search results)
- Thrust, BBC Model B, 1986: http://bestretrogames.blogspot.com/2012/10/thrust-bbc-model-b-1986.html
