# Mammoth Thrust: game spec

A cave-flying mini game built on the Mammoth Space Battles physics (mini game 4 of the roadmap,
`docs/spec.md` §12.1), after the 1986 BBC Micro game Thrust. You fly the Asteroids ship, fitted
with a tractor beam and a tether, down a twisting cave under lunar mountains, past gun turrets, to
an energy pod. You take the pod on the tether and carry it up out of the atmosphere. The landscape,
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
| Landscape | Lander's kind: a polyline (later Chloe's hand-drawn outlines, as Cave 2), fixed rock that can't be damaged. First level: lunar mountains on the surface, and one cave that twists back and forth a little and mostly goes down. |
| On the surface | A small **factory** (the reactor) and a couple of other buildings. |
| Pod | A sphere of about **half the ship's mass (33 kg)** on a stand at the bottom of the cave. Taken with the tractor beam and held on the tether. |
| Tether | The existing springy tether (TRC-004), retuned: a damped spring between the centres of mass that breaks over its tension limit (TRC-006). Not the original's rigid rod. |
| Turrets | Fixed hemispheres on the rock. A turret starts firing a few seconds after it first sees the ship, slowly, at where the ship is now (no lead) with some spread. Can be shot and destroyed. |
| Turret bolts | Concussive: a small charge that makes gas. Mostly they push the ship off course; they do a little damage and may knock parts off. One hit doesn't kill. Chloe tunes the damage. |
| Factory (reactor) | Powers the turrets. Each hit stops every turret for a time, longer with each hit. Enough damage and it goes critical: a countdown, then a very large explosion. Escaping with the pod before it blows earns a bonus; without the pod the mission has failed. |
| Shield | A round field about the ship while its button is held. It turns away bolts and blast gas, so they neither damage nor push the ship. It burns fuel; engines and gun are off while it is up; it doesn't protect against rock. A separate button from the tractor. |
| Fuel | Limited. Fuel tanks stand on the ground; holding the tractor beam on one refills the ship. A tank that is shot explodes. |
| Crashes | Physical, as in Lander and Asteroids: gentle scrapes are survived, hard hits break parts off. The pod is damaged the same way. |
| Life lost | The cockpit destroyed, or no working engine still welded to it (the duel's rule, DUEL-001); or the pod destroyed. The pod goes back to its stand. |
| Lives | 3. |
| Win | The ship, with the pod on its tether, climbs above the top of the atmosphere. |
| Name | **Mammoth Thrust**, on its own page, `thrust.html`. |

## 2. Flow

1. **Title screen:** **MAMMOTH THRUST**, with Play, How to play, The physics and High scores.
2. **Play.** The ship starts in the sky above the mountains, with a full tank and magazine.
3. **Down.** Past the surface turrets and into the cave. Shoot the turrets or the factory, or
   shield through.
4. **The pod.** Hold the tractor beam on the pod until the tether takes it.
5. **Up and out** with the pod swinging below. Level complete at the top of the atmosphere, with
   the bonuses.
6. **Life lost.** The wreck stays. The next ship beams in at the start after a short wait; the pod
   is back on its stand; destroyed turrets stay destroyed.
7. **Mission failed** if the factory blows while the pod is still on the planet, or the ship
   leaves without it. The level is replayed at the cost of a life (to confirm, §11).
8. **Game over** when the third ship is lost; score, initials if it makes the top 10.

## 3. Rules

### The level

- A level is a scenario: the outline of the ground, the start, the pod's stand, the factory, the
  buildings, the turrets, the fuel tanks, and the height of the atmosphere's top.
- The ground is fixed and can't be damaged. Buildings are fixed bodies with a material, so they
  can be damaged and destroyed.
- The first level: mountains across about 600 m; the factory and two buildings on a flat between
  them; one cave mouth, a cave that turns four or five times on its way about 300 m down, never
  narrower than about 25 m (the tether is 15 m, and the pod must swing through); two turrets on the
  surface and three or four in the cave; two fuel tanks; the pod in a chamber at the bottom.
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
- The pod is a disc with a material tougher than the ship's tanks. Destroyed, it bursts (a small
  charge) and a life is lost.

### Turrets and bolts

- A turret is a fixed half-disc with a material, on the ground, the cave wall or the roof.
- It sees the ship when the ship is within its range and the line to it is clear of rock.
- From first sight it waits (first value 3 s), then fires one bolt every 2 s while it still sees
  the ship, at the ship's present position, with a random error of up to about 8°.
- It doesn't fire while the factory is stopped, or once destroyed.
- A bolt is a slow shell (first value 40 m/s) that bursts on what it strikes, or after its time.
  Its charge gives mostly gas and little damage: the Asteroids gunship shell made weaker and
  gassier. Bolts don't damage turrets, the factory or the pod's stand.

### The factory

- Each slug that hits the factory stops all turrets: 4 s for the first hit, 2 s longer for each
  one after (first values).
- The factory has a damage total. Past it (about 10 hits), it goes critical: a 10 s countdown on
  the HUD, then a blast that destroys everything on the surface and in the upper cave.
- Critical with the pod on the tether: get above the atmosphere before the blast for the bonus.
  Caught in the blast: the life is lost.
- Critical without the pod: mission failed when it blows.

### Shield

- Held: a field of fixed radius round the ship's centre of mass. Shells and bolts that reach it
  bounce off it without bursting; gas parcels are turned back at it. The push goes into the field
  and not the ship (a cheat with momentum, recorded by the ledger).
- It burns fuel at a fixed rate (first value: as much as the main engine at half thrust).
- While it is up the engines and the gun don't work, and the tractor beam lets go of nothing but
  takes nothing new.
- It doesn't cover the pod, and it does nothing against rock or buildings.

### Fuel

- One tank load is about 2 minutes of full thrust, as in Asteroids. Out of fuel, the ship falls.
- A fuel tank on the ground is a fixed body. While the beam is held on one within range, fuel
  moves to the ship at a fixed rate until the tank is empty (first value: one tank is half a ship's
  load). The tank isn't lifted.
- A tank that is destroyed explodes with what it still holds.

### Scoring

| For | Points |
|---|---|
| A turret destroyed | 750 |
| A fuel tank emptied | 300 |
| The pod carried out | 2000 |
| The factory critical, and out with the pod | 2000 more |
| Fuel left at the end | 1 per 0.01 kg |

First values, to tune. Top 10 with initials, as Asteroids (`scores.ts`).

## 4. Controls, HUD and view

- **Controls.** Turn left and right, thrust, fire, as Asteroids (Q/E, Space, and the option to
  swap). New: **tractor** and **shield**, each a key and a touch button. Keys to choose (§11).
- **HUD.** Score, lives, fuel, shells, a pod light (on the stand / on the tether / lost), the
  factory's countdown when critical, and "turrets stopped" with its time left.
- **View.** The camera follows the ship, as Lander's cave levels do, and widens a little to keep
  the pod in view when it is on the tether. Lander's pace (1× = half real time).

## 5. How to play and The physics

Two pages, as Asteroids. The physics page says what is real (gravity, the tether's spring, gas
pushing the ship, parts breaking by impulse) and what is a cheat (the shield, fuel through the
beam, the factory's link to the turrets).

## 6. Look and sound

Asteroids' look: black, simple lines, the black-and-white buttons. The pod glows. The shield is a
thin circle. Sound: to decide with the build.

## 7. Requirements

Priority: **M** must, **S** should.

**Game shell**
- **MTH-001** `[M]` A title screen with the game's name and buttons Play, How to play, The
  physics and High scores.
- **MTH-002** `[M]` Play at the fixed game pace, with a pause menu (Resume, Quit to title).
- **MTH-003** `[M]` Game over, initials and a top-10 table kept on the device.

**Level**
- **MTH-010** `[M]` A level is a generated scenario with fixed, undamageable ground from an
  outline, uniform gravity of 4 m/s², and no wrap.
- **MTH-011** `[M]` The first level has surface mountains, a factory, two other buildings, a cave
  to a pod chamber, turrets and fuel tanks, as §3.
- **MTH-012** `[M]` The generator fails if the cave is anywhere narrower than its declared
  least width.
- **MTH-013** `[S]` A level may be built from a hand-drawn outline file, as Lander's Cave 2.

**Ship, tether and pod**
- **MTH-020** `[M]` The ship is the Asteroids ship with a tractor unit, a tether unit, turning of
  about 7 rad/s², and a cannon firing slugs with no charge.
- **MTH-021** `[M]` Holding the tractor on the pod within the tether's length puts the pod on the
  tether; pressing it again lets go.
- **MTH-022** `[M]` With the tether unit lost, the pod can't be held.
- **MTH-023** `[M]` When the pod is destroyed a life is lost and a new pod is on the stand for the
  next ship.
- **MTH-024** `[M]` The level is complete when the ship is above the atmosphere's top with the pod
  on its tether.

**Turrets and factory**
- **MTH-030** `[M]` A turret fires only with a clear line to the ship inside its range, first
  after its wait from first sight, then at its rate, at the ship's present position with its
  spread.
- **MTH-031** `[M]` A destroyed turret doesn't fire, and stays destroyed for the level.
- **MTH-032** `[M]` A bolt that bursts 2 m from the ship changes the ship's velocity by a
  measurable amount and destroys no part of an undamaged ship. (Values tuned by Chloe.)
- **MTH-033** `[M]` A slug hitting the factory stops every turret for a time that grows with each
  hit.
- **MTH-034** `[M]` Past its damage total the factory counts down 10 s and explodes; the outcome
  follows §3 by where the ship and pod are.

**Shield and fuel**
- **MTH-040** `[M]` While the shield is held, a bolt bursting at the field neither damages the
  ship nor changes its velocity; fuel falls at the shield's rate; engines and gun don't work.
- **MTH-041** `[M]` With no fuel the shield doesn't come up.
- **MTH-042** `[M]` Holding the tractor on a fuel tank in range moves fuel to the ship until the
  tank is empty or the ship is full.
- **MTH-043** `[M]` A destroyed fuel tank explodes in proportion to what it holds.

**Lives and score**
- **MTH-050** `[M]` A life is lost when the cockpit is destroyed or no working engine is welded to
  it. Three lives.
- **MTH-051** `[M]` Scoring as §3.
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

1. **Playable cave:** the level generator and first level, the ship with tractor, tether and slug
   cannon, the pod, gravity, win and life-lost rules, the page and HUD. No enemies.
2. **Turrets and the factory:** fixed turrets, concussive bolts, stopping the turrets, critical
   and countdown.
3. **Fuel and shield.**
4. **Title, How to play, The physics, high scores.**
5. **Tuning after play;** Chloe's hand-drawn levels.

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

## 11. Open questions

1. **Leaving without the pod.** In the original, escaping a critical reactor without the pod
   still counts, for fewer points. This draft calls it mission failed (§2 step 7, §3). Follow the
   original (level done, no pod bonus), lose a life and replay, or game over?
2. **More levels.** After the first: Chloe's drawn layouts in order? The original's later twists
   (reversed gravity, walls seen only with the shield up): wanted, or not?
3. **Keys and buttons** for tractor and shield.
4. **Shells:** a limited magazine (120, refilled with each ship), or unlimited?
5. **Does the shield cover the pod** when it is close, or never?
6. **Turrets after a life is lost:** stay destroyed (as written), or come back?
7. **A demo pilot** behind the title, as Asteroids has? It would need an AI that can fly a cave
   with a pod, which is a lot of work; a recorded flight would be cheaper.
8. **Out of fuel:** the original ends the whole game. Here the ship just falls and the life is
   lost in the crash. Keep ours?
9. **Turret toughness:** one slug destroys a turret, as the original, or several?
10. **Doors** opened by shooting a panel (the original's later levels): wanted for later levels?
11. **Atmosphere:** is it only a height to reach, or should there be air (drag) below it?

## 12. Sources

- Thrust (video game), Wikipedia: https://en.wikipedia.org/wiki/Thrust_(video_game) (the
  article's text, pasted by Chloe)
- Thrust (BBC/Electron), Everygamegoing: https://www.everygamegoing.com/litem/Thrust-1/1289/
- Thrust instructions, 8BS: https://8bs.com/elecgame/thrust.htm
- Thrust manual (C64 rewrite), Lysator: https://www.lysator.liu.se/~peda/thrust/thrust-man.html
- Thrust, BBC Model B, 1986: http://bestretrogames.blogspot.com/2012/10/thrust-bbc-model-b-1986.html
