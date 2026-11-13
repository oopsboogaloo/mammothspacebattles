# Mammoth Thrust: game spec

A cave-flying mini game built on the Mammoth Space Battles physics (mini game 4 of the roadmap,
`docs/spec.md` §12.1), after the 1986 BBC Micro game Thrust. You fly the Asteroids ship, fitted
with a tractor beam and a tether, down a twisting cave under lunar mountains, past gun turrets, to
an energy pod. You take the pod on the tether and carry it up to the height where the level ends. The landscape,
levels, look and sound are our own; only the idea and the rules of play follow the original.

Status: agreed 12 November 2026, from Chloe's brief and several rounds of questions (§10). **The
MVP is built** (milestones 1 and the playable part of 4, §9): two levels, the ship, the pod, lives,
the level's top and the page. **Turrets are built too** (the MVP1 turret, firing at random bearings). The factory, fuel and the
shield are not built yet, so the rules for them below are still plans. What the build measured and changed is in
`mammoth-thrust-design.md` §8 and §9. The requirement IDs (MTH-…) are this game's own. The
engine changes the game needs (§8) become requirements in `docs/spec.md` once agreed. Design and plan:
`mammoth-thrust-design.md`.

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
| Turrets | Real machines on the rock: a railgun on a turning mount, a battery, a generator and a fuel tank joined to it. The gun is seen to turn to its aim before it fires. First version (MVP1): it turns to a random bearing in its arc, then fires. Later: it aims roughly at the ship. Can be shot and destroyed. |
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
| Turrets' build | Welded pieces with materials, like a ship, and damaged by the same model: nothing is forced. One good hit mostly blows a turret to bits, above all a hit on its fuel; a poor one may leave it working, or working worse. |
| Doors | Doors opened by shooting a panel, in a later phase. |
| Scenery that can be destroyed | Explosions leave craters in the rock (asked for by Chloe, 12 November 2026, in line with physics-led play). A crater is 0.6 of the blast's reach: one of the ship's magazines 3.6 m, a turret's fuel tank 2.4 m. Bullets leave none: a slug is spent in the rock, and a turret's bolt bursts on it, without marking it. (Small bullet craters were built first and dropped the same day: a crater for every bullet cost too much step time, and there is no problem to solve without them.) Nothing else that hits the ground leaves a crater, for now. The rock leaves as dust. Tunnelling is allowed: it is a sandbox, and harder than the intended way. What stands on the ground comes loose when a crater cuts the rock at its foot (version 2, the same day): a turret tips into the hole or falls from its roof, and fires on from where it lies if its pieces survive; the pod's stand goes too, and the pod with it. |
| After playing (12 November 2026) | It is already fun, and very hard: leave it that hard. The ship turning with real inertia is a lot to fly, balanced by a ship that survives grazing the walls: keep Asteroids' generous damage tolerance for now. Landing for a rest is possible until the pod is taken. Picking the pod up was too hard, so: |
| Beam | Three times the pull (1,200 N). It pulls the pod and nothing else. |
| Tether | Takes the pod from up to 22 m off, further than its 12 m length, and reels it in to that length and holds it there, heavily damped. It takes the pod and nothing else: not the wreckage of earlier ships. (Later games will want the tether as a general tool.) It holds five times the pull it did, and no longer lets go under thrust. |
| A ship lost | However it is lost (a crash, a hit, self-destruct), the page leaves 3 seconds to enjoy the explosion before it says the ship is lost and the wait for the next one begins. Self-destruct goes up at once. (First for self-destruct only; for every loss after Chloe played again, 12 November 2026.) |
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
- **Level 3: the winding cave** (Chloe's drawing, 13 November 2026, traced at 0.1 m a pixel). About
  200 m across. A cave mouth 38 m wide between hills winds down past ledges into a wide chamber
  about 135 m down. Six electric turrets: two on the ledge under the mouth, one on a ledge on the
  left, one hanging from the right wall, one from the chamber's roof, and one on the chamber's
  floor. The pod stands at the chamber's left end with two fuel tanks beside it; one more fuel
  tank is on the surface. Play can start here: `thrust.html?level=3`.
- No passage is narrower than about 25 m (the tether is 12 to 15 m, and the pod must swing
  through). Level 3 is drawn tighter at the chamber's left end, where the roof is 19 m over the pod;
  the tips of its two dead-end alcoves narrow to nothing.
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

- A turret is a machine built of pieces, like a ship. Everything it does comes from its pieces:
  none of it is forced by a rule.
- **Its pieces** (MVP1 turret, first sizes; "up" is away from the rock it stands on):

  ```
                         gun
                          /
                         /
     ______    ____   __(o)__   ____
    | fuel |==| gen | |mount| |batt|
    |_tank_|  |_____| |_____| |____|
    =================================  base
    ///////////// rock //////////////
  ```

  - **Base:** a fixed plate about 6 m long and 0.3 m thick on the ground, a wall or a roof.
  - **Mount:** a half-disc of 1 m radius at the middle of the base. The gun's carriage turns about
    its centre, across an arc (first value 60° each side of up) at a steady rate (first value
    60°/s).
  - **Railgun:** a barrel 1.8 m long on the carriage, with its magazine. A railgun as the ship's
    (WPN-008): no propellant, the shell leaves along the bore.
  - **Battery:** a 1 m box beside the mount. The gun fires from the battery's charge.
  - **Generator:** a 1 m box on the mount's other side. It keeps the battery charged, and burns
    fuel to do it.
  - **Fuel tank:** one of the level's standard fuel tanks (§3, Fuel), beside the generator and
    joined to it by a pipe that can be seen. The ship can take its fuel with the beam.
  - Each piece has a material and is welded to the base (the gun to its carriage, the carriage
    held by the mount), with weld limits.
- **Power, simply** (there is no power model in the engine yet; a first step, §11):
  - The gun fires only while it, its carriage, the battery and the wiring between them are whole
    and joined.
  - The battery holds a few shots (first value 5). The generator refills it while the generator is
    whole, joined, and has fuel in its tank.
  - So a turret whose fuel is stolen, or whose generator or pipe is gone, fires what its battery
    holds and then falls quiet.
- **Damage.** Nothing is forced:
  - A hit on the fuel tank sets off what the tank holds: a significant explosion, which is likely
    to wreck the generator and the mount beside it.
  - The gun knocked off its carriage, or the carriage off its mount: no more firing; the gun lies
    as wreckage.
  - The mount damaged: the gun turns slower, or sticks (first values).
  - The battery or generator lost: as Power above.
- **Aiming, seen.** A turret never fires from where it happens to point. Each shot:
  1. it picks a bearing in its arc;
  2. the gun is seen to turn to it at the mount's rate;
  3. on the bearing, and reloaded, it fires;
  4. it holds for a moment (first value 0.5 s), then picks again.
- **Which bearing.**
  - **MVP1:** a random one in the arc (from the level's seed, so a replay is the same).
  - **Next:** toward the ship's present position (no lead), with a random error of up to about
    8°, kept inside the arc. The gun then follows the ship between shots.
- **Waking.** It sees the ship when the ship is within its range and the line to it is clear of
  rock. From first sight it waits (first value 3 s) before its first shot, and goes on while it
  sees the ship. Out of sight, the gun stops where it is.
- It doesn't fire while the factory has stopped it (how the factory fits with the turret's own
  power is parked, §11).
- A bolt is a slow shell (first value 40 m/s) that bursts on what it strikes, or after its time.
  Its charge gives mostly gas and little damage: the Asteroids gunship shell made weaker and
  gassier. Bolts don't damage turrets, the factory or the pod's stand.

### Electric turrets

From Chloe's drawing (13 November 2026). A turret of a second kind, on level 3:

- **Pieces.** A **base**, a rigid plate fixed on the rock. On it a **neat arc** (a segment of a
  circle, not a full half-disc), welded. At each end of the arc, on the base, a **power node**.
  The **barrel**, in two parts (the breech and the outer barrel), stands on the arc and rides
  along it as it aims: it turns about the arc's centre, so the arc itself stays still.
- **Power.** From the level's power plant, along its power lines (below). It has no battery,
  generator or fuel tank of its own.
- **Firing.** As the fuel turret: it waits from first sight, picks a random bearing (here within
  50° either way along the arc), turns to it and fires a bolt. The outer barrel folds back into
  the breech with the recoil and slides out again (drawn; the body itself doesn't move).
- **Damage.** One slug on the barrel knocks it off (or destroys it): the turret is out of
  action. The arc takes two slugs. A power node is the weak point: one slug sets it off, and its
  blast alone puts the turret out of action.

### The power plant

From Chloe's drawings (13 November 2026), on level 3. It takes the place of the original's
reactor and of our factory below.

- **The plant.** Three tall domes, a tower with a light, and an annex, on a base on the surface.
  The light is green while the plant is on, red while it is off. Bullets don't wear it down.
- **Offline.** A slug that hits any part of it takes it offline: 5 s for the first hit, and each
  hit while it is offline adds 2 s. Offline, it powers nothing.
- **Coolant.** The reactor holds a volatile liquid coolant that boils off as it leaks. The first
  slug in a dome opens a leak where it strikes; the next two make that leak bigger; the fourth
  opens a second leak where it strikes, and so on: a new leak every 3 slugs (Chloe, 13 November
  2026: fewer, stronger leaks that show). Every slug adds the same to the flow: one empties it in
  4 minutes, two in 2, eight in 30 s. The gas is real and pushes what flies through it, about 2 N
  for each slug's share. It is drawn as pale vapour. A COOLANT gauge on the HUD shows what is left
  (red under a quarter).
- **Critical.** With no coolant left, a 10 s countdown on the page, then it explodes. Out above the
  top with the pod before then: 2000 more. If it blows with the pod still down, the game is over.
  Critical, it powers nothing.
- **Power lines** run from the plant through the rock to every turret it powers: white while they
  carry power, dark while they don't. They can't be destroyed (for now: we may come back to that).
- **Transmitter.** Where a line has to cross the open, two antennae, one either side, carry the
  power across as a moving electric shock. A ship that touches the shock loses all control for
  1 s. Each antenna is destructible (one slug): with either gone there's no shock, and the turret
  beyond it has no power.

### The factory

From before Chloe's power design; level 3's plant does this. Levels 1 and 2 have none yet.

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
- A fuel tank stands on a pad on the ground. While the beam is held with one in its wedge, fuel
  moves to the ship until the tank is empty or the ship is full, and the game says REFUELLING.
  First values: a tank holds 8.1 kg, half a ship's load, and gives 2 kg a game second, so a full
  tank takes about 8 s on screen. The tank isn't lifted or pulled.
- A turret's own tank gives up its fuel the same way.
- A tank that is destroyed explodes with what it still holds; an empty one only breaks.
- A crater under a tank's pad lets it fall, as a turret does (MTH-063).

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

- **Controls.** Turn left and right, thrust, fire, as Asteroids (Q/E, either Shift or Ctrl, Space, and the option to
  swap). New: **tractor** on **Z** and **shield** on **X** (beside the left Shift), or **/** and **.** (beside the right Shift), and a touch button each.
- **Controller.** As PAD-002 in `docs/spec.md`: stick or D-pad turns, A or right trigger forward,
  B or left trigger reverse, X or right bumper fires, Y or left bumper the tractor, Start pauses.
- **HUD.** Score, lives, fuel, shells, a pod light (on the stand / loose / on the tether), the
  factory's countdown when critical, and "turrets stopped" with its time left.
- **View.** The camera follows the ship, as Lander's cave levels do, and widens a little to keep
  the pod in view when it is on the tether: it leans 35% of the way to the pod, easing there and
  back over about 0.4 s so that taking or dropping the pod never jumps the view. Lander's pace (1× = half real time).

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
- **MTH-014** `[M]` Level 3 is Chloe's winding cave (§3): six electric turrets, three fuel tanks,
  and the pod at the bottom. Nothing on it moves as it starts. `thrust.html?level=3` plays from it.

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
- **MTH-027** `[M]` The beam pulls, and the tether takes, the pod and nothing else.
- **MTH-024** `[M]` The level is complete when the ship is above the level's top with the pod
  on its tether.

**Turrets and factory**
- **MTH-030** `[M]` A turret fires only with a clear line to the ship inside its range, and first
  after its wait from first sight.
- **MTH-036** `[M]` Before each shot the gun turns at its mount's rate to the chosen bearing, inside
  its arc, and fires only once it is on it. In MVP1 the bearing is random within the arc, the same
  for the same seed.
- **MTH-031** `[M]` A turret is a base, a mount, a railgun, a battery, a generator and a fuel tank
  joined by a pipe: welded pieces with materials, damaged by the shared damage model.
- **MTH-037** `[M]` A turret without its gun, its carriage or its battery doesn't fire. Without its
  generator or its fuel it fires only the shots its battery holds.
- **MTH-038** `[M]` A turret's fuel tank is a fuel tank: the ship can take its fuel (MTH-042), and
  destroyed it explodes (MTH-043).
- **MTH-035** `[M]` A slug from the ship's cannon square on a turret's fuel tank puts the turret out
  of action through the explosion alone, with no rule forcing it.
- **MTH-032** `[M]` A bolt that bursts 2 m from the ship changes the ship's velocity by a
  measurable amount and destroys no part of an undamaged ship. (Values tuned by Chloe.)
- **MTH-033** `[M]` A slug hitting the factory stops every turret for a time that grows with each
  hit.
- **MTH-034** `[M]` Past its damage total the factory counts down 10 s and explodes. If the pod is
  still on the planet then, the game is over.

**Electric turrets**
- **MTH-070** `[M]` An electric turret is a fixed base, an arc welded to it, a power node at each
  end of the arc, and a barrel in two parts that rides along the arc, turning about its centre. It
  needs no power, and fires at the ship as the fuel turret does.
- **MTH-071** `[M]` One slug on the barrel puts it out of action. The arc takes two. One slug on a
  power node sets it off, and the blast alone puts the turret out of action.
- **MTH-072** `[S]` When it fires, the outer barrel is drawn folded back into the breech, and slides
  out again.

**Power plant**
- **MTH-080** `[M]` A level's power plant powers its turrets. A slug on it takes it offline 5 s,
  and each slug while it is offline 2 s more; offline, no turret it powers fires.
- **MTH-081** `[M]` Slugs in the domes leak the reactor's coolant as gas: each adds the same to
  the flow (4 minutes for one, that divided by the slugs for more). Every third opens a new leak
  where it strikes; the others make the newest leak bigger. The gas pushes what is in it.
- **MTH-082** `[M]` With no coolant left the plant goes critical: the page counts down 10 s, then
  it explodes. With the pod still down the game is over; out with it first, 2000 more.
- **MTH-083** `[M]` Two antennae carry power across the open. Either destroyed, the turrets beyond
  them have no power, and the others still do.
- **MTH-084** `[M]` A ship touching the shock between live antennae has no control for 1 s.
- **MTH-087** `[S]` For testing (Chloe, 13 November 2026), the title has a small row of buttons to
  start at any level. Not meant for players: to go before release.
- **MTH-086** `[M]` On a level with a power plant, the HUD has a coolant gauge: the share of the
  reactor's coolant left, red under a quarter.
- **MTH-085** `[M]` Power lines are drawn white while they carry power and dark while they don't;
  the plant's light green while it is on and red while it is off; the shock, moving like
  electricity, only while it carries power.

**Shield and fuel**
- **MTH-040** `[M]` While the shield is held, a bolt bursting at the field neither damages the
  ship (the pod is not covered) nor changes its velocity; fuel falls at the shield's rate; engines and gun don't work.
- **MTH-041** `[M]` With no fuel the shield doesn't come up.
- **MTH-042** `[M]` Holding the tractor on a fuel tank in range moves fuel to the ship until the
  tank is empty or the ship is full. A tank the ship has emptied scores once.
- **MTH-043** `[M]` A destroyed fuel tank explodes in proportion to what it holds.

**Lives and score**
- **MTH-060** `[M]` The level's rock can be cratered by explosions (TER-001…005): a crater 0.6 of
  the blast's reach, none under 1 m. A slug leaves none and is spent in the rock.
- **MTH-061** `[M]` A turret's base and the pod's stand are anchored to the rock (TER-006): when a
  crater cuts the rock at their foot they come loose, and the physics takes them. A turret that has
  come loose fires on while its pieces work. The pod, off a fallen stand, is loose, not lost.
- **MTH-062** `[M]` What has come off the ship no longer answers its controls, as in Mammoth
  Asteroids (MAS-037). An engine no longer welded to the ship has its fuel line cut, burns off what
  it holds and is dead, and its tank leaks where the line left it. A wing lost whole burns on until
  its tank is empty. A gun knocked off doesn't fire.
- **MTH-050** `[M]` A life is lost when the cockpit is destroyed or no working engine is welded to
  it. Three lives. Running out of fuel costs nothing by itself.
- **MTH-051** `[M]` Scoring as §3.
- **MTH-053** `[M]` The ground is filled with horizontal coloured lines fixed to the world. Stars
  show only in the sky; open space inside the cave is a plain block colour.
- **MTH-052** `[M]` The HUD shows score, lives, fuel, shells, the pod's state, the turrets' stop
  time and the factory's countdown.

## 8. Engine changes (agreed 12 November 2026; in `docs/spec.md` as milestone M10)

New, shared physics or world logic:

- **Fixed turret.** A railgun on a fixed base with a simple fire control: range, line of sight, a
  wait from first sight, the bearing to turn to. Not an AI pilot; it reuses `clearShot` from
  `pilot.ts`. There are no fixed guns today.
- **A turning mount.** The engine joins bodies with welds only. The gun needs a pivot that holds
  it to the mount and turns it to a commanded angle at a rate, and that can break like a weld. On
  a fixed turret the first build may simply set the carriage's angle each step.
- **Power, simply.** Battery and generator are structure today, with no power model. The turret
  needs the small rule in §3: shots held by a battery, refilled by a joined generator with fuel.
  Whether the ship's own gun follows the same rule is a later question.
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
| Turrets (fourth round) | Real machines: railgun on a turning mount, battery, generator, a standard fuel tank joined on. The gun is seen to turn before it fires, even when its aim is random. Damage is modelled, not forced. |
| The beam back | Always, with no exception, the factory critical or not. Gravity is uniform, so there is no escape velocity to worry about. |

## 11. Open questions

Parked by Chloe (12 November 2026): build the turret as laid out in §3, fuel tank and all, and
keep the factory's rule as it is (a hit stops the turrets). To come back to:

1. **The factory and the turrets.** Each turret has its own generator, battery and fuel, and the
   factory (the reactor) is also said to power them. How the two fit together is undecided. One
   idea: the factory is their fire control.
2. **Power, simply** (§3): the battery-and-generator rule is the first step as written; whether
   it is the right one is to be seen in play.

To settle in the build: the turret's sizes, weld limits and what a damaged mount does; the 30 m/s
in MTH-025 and the other first values.

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
