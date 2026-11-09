# Mammoth Lander: game spec

A lunar-lander mini game built on the Mammoth Space Battles physics. You fly the LAND twin-engine
ship down onto landing pads across six scenarios. Gravity, real exhaust gas, contacts and breaking
welds decide every landing and every crash.

Status: agreed, 8 November 2026. Requirement IDs (LND-…) move into `docs/spec.md` when a
milestone is scheduled.

## 1. Decisions so far

| Question | Decision |
|---|---|
| Ship | The LAND twin-engine ship: two engines, Q and E. Both together lift; one alone turns. |
| Session | 3 ships per game. Each flies once, landed or crashed; when all three have flown, that is the score. |
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
4. **Game over** when all three ships have flown, or when every pad has been used (see LND-012).
   - Shows the total score, the landings, and fuel used.
5. **New high score.** If the total makes the top 10, enter 3 initials with big touch letter pickers.
   Then the table, with the new entry highlighted.
6. **Again or menu.** Play the same scenario again, or go back to scenario select.

## 3. Rules

### Ships

- **Ships:** 3 per game. Each flies once.
- **A landing** banks its score; **a crash** scores nothing.
- **The game ends** when all three have flown (changed 8 November 2026 after play: rounds were
  too long when only crashes counted).
- **Each new ship** starts at the scenario's start point, with that scenario's start velocity and a
  full tank.
- **The world carries on between ships.** Wreckage, parked ships and loose debris stay where they
  are until the game ends (LND-020).

### Landing

The existing judge (FLT-005…FLT-008) decides, extended to several pads (LND-010):

- **Land:** touch a pad slower than the scenario's touchdown limit, then come to rest within its
  tilt limit.
- **Crash:**
  - touching anything that isn't a pad;
  - touching a pad too fast;
  - coming to rest too tilted;
  - the ship breaking apart.
- **A landed ship stays parked on its pad.** That pad is then *used*: it is closed for the rest of the game (LND-012).

### Scoring

Each landing scores:

> (100 base + up to 100 for a soft touchdown + up to 100 for fuel left) × the pad's multiplier

- **Pads:** each shows its multiplier as ×2, ×3, ×4 or ×5. Smaller and harder pads have bigger
  multipliers.
- **Cave:** the multiplier rises with depth.
- **Used pads:** a pad landed on is closed for the rest of the game. It is drawn dim, with its
  multiplier struck out. Touching it counts as touching the ground. Using every pad gives a
  1,000-point bonus and ends the game (LND-012).
- **Game total:** the sum of the landings, plus the clear bonus.

### Crashes, explosions and wreckage

- **A crash is physical.** A hard enough hit breaks the ship's welds. The tank ruptures and its
  propellant burns in a blast (LND-021). The flash, dust and flying parts show it.
- **Wreckage stays for the whole game** (LND-022). It is ordinary physics: you can hit it or push
  it. Touching it is a crash, because it isn't a pad. A new game starts with clean terrain.

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
- **Game status:** ships left, score, and the scenario name.
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
| Fuel | economy 5 (cut from 20 after play) | tight (economy 4) | tight (economy 3.5) | tight (economy 4) | moderate (economy 8) | Hard's, draining through a leak |
| Start | 120 m up, 15 m/s sideways | 170 m up, 10 m/s sideways | 200 m up, 10 m/s sideways | cave mouth, still | in orbit at about 60 m | as Hard, leak open |
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
- **Pads:** narrow, on ledges and at the bottom of pits. (Overhangs need terrain that isn't a single line of heights: a later step.)
- **Tolerances:** tighter.

### Cave

- **Layout:** a cave about 500 m long, running down from its mouth 150 m into the rock. You start
  at the mouth, still.
- **Route:** a stalagmite or a stalactite between each pair of pads, so the way down weaves. The
  cave is 34 m high, and never under 12 m at its tightest (the generator checks).
- **Pads:** five, ×2 near the mouth to ×6 in the end chamber, each deeper than the last.
- **World:** bounded, no wrap. The rock over the cave is solid; the end wall closes it.
- **Drawing:** the floor and the roof are two lines (`lander.lines`), drawn as given.
- **Fuel:** a concern (economy 4). Getting deep and back down safely is the challenge.

### Orbital

- **The asteroid:** 150 m across, turning once in 7 minutes, with mountains, plateaus and crater
  floors. About 1,000 t, so the ship hardly moves it.
- **Built as:** one welded assembly of ordinary bodies: a core and a ring of wedges out to the
  surface (each convex, so the surface can be any shape). Parts of one assembly never collide with
  each other, and it moves as one rigid body. It is centred on its centre of mass, so it spins in
  place.
- **Gravity:** the core's own (FLT-011), about 0.9 m/s² at the surface, pulling toward its centre.
  The other parts carry a field of strength 0, so they feel none. "Up" is away from the asteroid,
  but the view never turns: under the asteroid you land upside down, part of the challenge.
- **Pads:** six, welded to the rock, so they move with the spin: two plateaus, two crater floors,
  a mountain top and the plain (×2 to ×5). Height, speed and tilt are measured in the nearest
  pad's own frame and relative to its motion (LND-011); for a level, still pad that is the world's.
- **Start:** a circular orbit 60 m up, moving the way the rock turns. You must burn to come down.
- **Fuel:** moderate (economy 8). Touchdown 1.5 m/s relative to the pad, 12°.

### Emergency

- **Terrain:** Hard's.
- **The leak:** the ship starts with a breach in its tank. The leak drains fuel and its jet pushes
  the ship with about a tenth of one engine's thrust, using the existing leak physics (LND-040). As built:
  the tank starts at 40% integrity with its hole facing sideways, the gas jetting out at 30 m/s:
  about 10 N of push (raised after play: 5.5 N could barely be felt), and a full tank leaks away
  in about 28 s on its own.
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
- **LND-012** `[M]` A pad landed on is used: it closes for the rest of the game, and touching it
  counts as touching the ground. Using every pad ends the game with a 1,000-point bonus.
- **LND-013** `[M]` Each landing is scored as in §3.

**Lives and the persistent world**
- **LND-020** `[M]` The world persists between ships. A new ship is added at the start point; the
  old one stays, parked or wrecked.
- **LND-021** `[M]` The LAND ship can break. Its parts have materials and its welds have break
  limits, so a hard impact breaks it apart. The tank ruptures and burns as a blast.
- **LND-022** `[M]` Wreckage and parked ships stay for the whole game. A new game starts clean.

**Controls and camera**
- **LND-030** `[M]` Two touch thrust buttons (multi-touch). Q/E and the arrow keys on a keyboard.
  The browser must not zoom the game: two thumbs moving apart are a pinch, so pinch and double-tap
  zoom are cancelled in the game, and if the page zooms anyway the game pauses until it is zoomed back.
- **LND-031** `[S]` The camera follows the ship and zooms in near the ground.

**Scenarios**
- **LND-040** `[M]` A ship may start with a breach (Emergency), using the existing leak physics.
  Its jet pushes with about a tenth of one engine's thrust.
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

## 10. Answered (8 November 2026)

1. **Used pads close.** A pad landed on can't be used again in that game. Using every pad ends
   the game with a 1,000-point bonus.
2. **Points:** 100 base, up to 100 for softness, up to 100 for fuel, and the 1,000 clear bonus
   are the starting values.
3. **Wreckage stays for the whole game.** So do parked ships. A new game starts clean.
4. **Orbital:** about 150 m across, one turn every 5–10 minutes.
5. **Emergency's leak:** its push is about a tenth of one engine's thrust.
