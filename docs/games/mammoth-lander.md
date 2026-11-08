# Mammoth Lander: game spec

A lunar-lander mini game built on the Mammoth Space Battles physics. You fly the LAND twin-engine
ship down onto landing pads across six scenarios. Gravity, real exhaust gas, contacts and breaking
welds decide every landing and every crash.

Status: draft for review, 8 November 2026. Requirement IDs (LND-…) move into `docs/spec.md` when a
milestone is scheduled.

## 1. Decisions so far

| Question | Decision |
|---|---|
| Ship | The LAND twin-engine ship: two engines, Q and E. Both together lift; one alone turns. |
| Session | 3 lives per game. A crash costs a life; a landing banks its score and a fresh ship starts. |
| Terrain | One fixed, hand-made layout per scenario, so it can be learned and scores compare fairly. |
| Controls | Two big touch buttons (left and right thumb, one per engine). Q and E on a keyboard. |
| Speed | Fixed at 1× (half real time). A pause button, no speed buttons. |
| High scores | Top 10 per scenario on this device, with 3-letter initials. |
| Graphics | Simple lines: terrain as a line, pads as bright lines with their multiplier. |

## 2. Flow

1. **Title screen.**
   - The title "MAMMOTH LANDER" over a slow fly-by of the Easy terrain.
   - "Tap to start".
2. **Scenario select.**
   - Six cards: Easy, Medium, Hard, Cave, Orbital, Emergency.
   - Each card shows a one-line description, its best score and the initials that set it.
   - A "High scores" button opens the tables.
3. **Play.**
   - The first ship starts at the scenario's start point.
   - After each landing or crash there is a short pause (about 2 s, or a tap) showing the result.
   - Then the next ship starts at the start point.
4. **Game over** after the third crash, or when every pad has been landed on (see LND-012).
   - Shows the total score, the landings, and fuel used.
5. **New high score.** If the total makes the top 10, enter 3 initials with big touch letter pickers.
   Then the table, with the new entry highlighted.
6. **Again or menu.** Play the same scenario again, or go back to scenario select.

## 3. Rules

### Ships and lives

- **Lives:** 3 per game.
- **A crash** costs a life.
- **A landing** banks the score and keeps every life.
- **Each new ship** starts at the scenario's start point, with that scenario's start velocity and a
  full tank.
- **The world carries on between ships.** Wreckage, parked ships and loose debris stay where they
  are (LND-020).

### Landing

The existing judge (FLT-005…FLT-008) decides, extended to several pads (LND-010):

- **Land:** touch a pad slower than the scenario's touchdown limit, then come to rest within its
  tilt limit.
- **Crash:**
  - touching anything that isn't a pad;
  - touching a pad too fast;
  - coming to rest too tilted;
  - the ship breaking apart.
- **A landed ship stays parked on its pad.** That pad is then *claimed* (LND-012).

### Scoring

Each landing scores:

> (100 base + up to 100 for a soft touchdown + up to 100 for fuel left) × the pad's multiplier

- **Pads:** each shows its multiplier as ×2, ×3, ×4 or ×5. Smaller and harder pads have bigger
  multipliers.
- **Cave:** the multiplier rises with depth.
- **Claimed pads:** proposal: landing on one again pays ×1. Clearing every pad gives a
  1,000-point bonus and ends the game (LND-012).
- **Game total:** the sum of the landings, plus the clear bonus.

### Crashes, explosions and wreckage

- **A crash is physical.** A hard enough hit breaks the ship's welds. The tank ruptures and its
  propellant burns in a blast (LND-021). The flash, dust and flying parts show it.
- **Wreckage stays** for the next 3 ships, crashed or landed, then fades away in a puff of dust
  (LND-022). Until then it is ordinary physics: you can hit it, push it, or land on it if it lies
  flat. Landing on wreckage is a crash, because it isn't a pad.

## 4. Controls, HUD and camera

### Controls

- **Touch:** two large buttons in the bottom corners. Holding one fires that engine. They work at
  the same time.
- **Keyboard:** Q is the left engine and E the right; arrow keys also work.
- **Pause:** a pause button, or P / Esc.

### HUD

Large and readable on an iPad:

- **Flight readout:** height above the nearest pad, vertical and sideways speed, tilt.
- **Fuel:** a bar plus kilograms. It flashes when below 15%.
- **Game status:** lives left, score, and the scenario name.
- **Speed and tilt warnings:** each readout turns red when it is over the scenario's limit, so you
  know before touchdown.

### Camera

- **Follows the ship.**
- **Zooms in** as the ship nears the ground, like the classic game, so the last few metres are
  readable (LND-031).

## 5. Scenarios

All but Orbital use flat-world gravity (down). Orbital uses the asteroid's own gravity (FLT-011).
Limits are starting values to tune in play.

| | Easy | Medium | Hard | Cave | Orbital | Emergency |
|---|---|---|---|---|---|---|
| Gravity | 1.6 m/s² down | 1.6 | 1.6 | 1.6 | asteroid's, about 1 m/s² at the surface | 1.6 |
| World | wraps, about 600 m wide | wraps, about 800 m | wraps, about 800 m | bounded | open space round the asteroid | wraps, as Hard |
| Fuel | plentiful (economy 20) | tight (economy 4) | tight (economy 4) | tight (economy 4) | moderate (economy 8) | Hard's, draining through a leak |
| Start | 120 m up, 15 m/s sideways | 150 m up, 10 m/s sideways | 150 m up, 10 m/s sideways | cave mouth, still | in orbit at about 60 m | as Hard, leak open |
| Touchdown limit | 2.0 m/s, 15° | 1.5 m/s, 12° | 1.2 m/s, 10° | 1.5 m/s, 12° | 1.5 m/s relative to the pad, 12° | 1.2 m/s, 10° |
| Pads | 5: wide ×2 to narrow ×5 | 6: valleys and mountain shelves | 6: narrow ledges and pits | 5: ×2 to ×6, deeper is more | 6: plateaus and crater floors | Hard's |

Fuel economy is the declared flight-test cheat (FLT-010): the tank lasts that many times longer at
the same weight and thrust.

### Easy

- **Terrain:** gently rolling lunar ground with a few low hills.
- **Pads:** several, from wide to narrow.
- **Start:** moving sideways at a comfortable height, so you can survey the pads before choosing one.
- **Wrap:** stay up long enough and the same ground comes round again.

### Medium

- **Terrain:** steep lunar peaks and spikes.
- **Pads:** on mountain sides and in valleys.
- **Fuel:** matters. A careless approach runs the tank dry.

### Hard

- **Terrain:** sheer, jagged mountains.
- **Pads:** narrow, on ledges, in pits, and under overhangs that force a sideways approach.
- **Tolerances:** tighter.

### Cave

- **Layout:** you start at the cave mouth.
- **Route:** stalactites and stalagmites make a winding route before even the first pad.
- **Pads:** deeper ones score more (multipliers up to ×6).
- **World:** bounded, no wrap.
- **Fuel:** a concern. Getting deep and back down safely is the challenge.

### Orbital

- **The asteroid:** a very large, slowly spinning rock, about 150 m across, turning once every
  5–10 minutes. It has mountains, plateaus and crater floors.
- **Pads:** fixed to the surface, so they move with the spin. Landing is judged on speed relative
  to the pad (LND-011).
- **Start:** the ship is in a circular orbit and must burn to come down.
- **Gravity:** the asteroid's own, pulling toward its centre. "Up" is away from the asteroid, and
  tilt is measured from there.

### Emergency

- **Terrain:** Hard's.
- **The leak:** the ship starts with a breach in its tank. The leak drains fuel and its jet pushes
  the ship, using the existing leak physics (LND-040).
- **Warnings:** a flashing red EMERGENCY banner. With sound, a siren (LND-051).
- **Plan:** land fast before the tank empties, while fighting the push.

## 6. Look and sound

- **Graphics:**
  - Terrain is a single bright line on black. Cave walls are two lines.
  - Pads are thicker coloured lines, with their multiplier above.
  - Parked ships and wreckage use the normal body drawing.
  - The exhaust plume, dust and wisps stay as they are.
- **Sound (later milestone):**
  - engine roar per engine, louder with throttle;
  - touchdown thump;
  - crash and explosion;
  - low-fuel beep;
  - the Emergency siren.

## 7. Requirements (draft)

Priority: **M** must, **S** should.

**Game shell**
- **LND-001** `[M]` A title screen and a scenario select with the six scenarios. Each shows its best
  score.
- **LND-002** `[M]` A game screen without the sandbox's panels and tools: the world, the HUD, the
  touch buttons and pause.
- **LND-003** `[M]` Play runs at fixed 1× speed, with no speed controls.
- **LND-004** `[M]` A game-over screen, then initials entry if the score makes the top 10, then the
  table.
- **LND-005** `[M]` High scores: top 10 per scenario, with 3 initials, total, landings and date,
  stored on the device. They survive a reload.

**Landing and scoring**
- **LND-010** `[M]` The landing judge accepts several pads, each with its own multiplier. The
  verdict names the pad.
- **LND-011** `[M]` A pad may sit on a moving body, such as the orbital asteroid. Touchdown speed
  and rest are then measured relative to the pad, and tilt from the local "up".
- **LND-012** `[S]` A pad landed on is claimed. Landing on it again pays ×1. Claiming every pad
  ends the game with a bonus.
- **LND-013** `[M]` Each landing is scored as in §3.

**Lives and the persistent world**
- **LND-020** `[M]` The world persists between ships. A new ship is added at the start point; the
  old one stays, parked or wrecked.
- **LND-021** `[M]` The LAND ship can break. Its parts have materials and its welds have break
  limits, so a hard impact breaks it apart. The tank ruptures and burns as a blast.
- **LND-022** `[S]` Wreckage is removed, as dust, when the third ship after its crash starts.

**Controls and camera**
- **LND-030** `[M]` Two touch thrust buttons (multi-touch). Q/E and the arrow keys on a keyboard.
- **LND-031** `[S]` The camera follows the ship and zooms in near the ground.

**Scenarios**
- **LND-040** `[M]` A ship may start with a breach (Emergency), using the existing leak physics.
- **LND-041** `[M]` Terrain is authored as a line of points per scenario. The game builds the
  ground's polygons from it.
- **LND-042** `[M]` Terrain collides across the wrap seam. Today nothing collides across a seam
  (FLT-012's known limit), and a ship there would fall through the ground.

**Effects**
- **LND-050** `[S]` The EMERGENCY banner flashes red.
- **LND-051** `[S]` Sound effects, including the siren (later milestone).

## 8. What the engine needs (gaps found in the code)

1. **One pad only.** The landing judge takes a single fixed pad (`src/core/landing.ts`). It needs
   several pads with multipliers (LND-010) and pads on moving bodies (LND-011).
2. **The LAND ship can't break.** Its parts have no material, so nothing damages it. Crash physics
   needs materials and weld limits tuned so a gentle scrape survives and a hard hit doesn't
   (LND-021).
3. **No collision across the wrap seam** (LND-042). Fixed terrain needs its copy across the seam to
   collide.
4. **A crash pauses the run** (FLT-009). Here a crash plays out (explosion, debris), then the next
   ship starts in the same world (LND-020).
5. **The sandbox UI** is replaced by the game shell: title, select, HUD, touch buttons, scores
   (LND-001…005, LND-030).
6. **Terrain authoring:** a points-to-polygons builder (LND-041), and the six layouts.

Everything else exists: gravity bodies, wrapping, fuel economy, leaks with real thrust, gas plumes,
dust, wreckage physics and the smooth drawing.

## 9. Milestones (proposal)

1. **Easy, end to end.**
   - game shell, title, select and scores;
   - multi-pad judge;
   - lives, with the persistent world;
   - a LAND ship that can break;
   - touch buttons;
   - the wrap seam fix;
   - Easy's terrain.
2. **Medium, Hard, Emergency.** Their terrains, the starting breach, and the banner.
3. **Cave.** The bounded cave and depth scoring.
4. **Orbital.** Pads on a spinning body, relative-speed landing, orbit start.
5. **Sound.**

## 10. Open questions

1. **Claimed pads (LND-012):** is ×1 for a repeat landing and a bonus for clearing all pads right?
   Or should a landed pad be closed?
2. **Score numbers:** the base, softness and fuel points (100/100/100) and the clear bonus (1,000)
   are starting values.
3. **Wreckage:** removed when the third ship after the crash starts. Landed, parked ships stay all
   game. Is that right?
4. **Orbital's spin and size:** about 150 m across, one turn every 5–10 minutes. Too slow to notice,
   or about right?
5. **Emergency's leak:** how strong? Proposal: it empties the tank in about 60 s of game time on its
   own, and its push is about a third of one engine's.
