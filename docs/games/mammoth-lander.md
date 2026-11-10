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
   - Nine cards (since 10 November 2026): Easy, Medium, Hard, Cave, Cave 2, Emergency, Orbital,
     Binary, Heavy Orbital.
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
- **A landing** banks its score; **a crash** or **a stranded ship** scores nothing.
- **The game ends** when all three have flown (changed 8 November 2026 after play: rounds were
  too long when only crashes counted).
- **Each new ship** starts at the scenario's start point, with that scenario's start velocity and a
  full tank.
- **The world carries on between ships.** Wreckage, parked ships and loose debris stay where they
  are until the game ends (LND-020).

### Landing: physical (changed 9 November 2026 after play)

No speed limit and no crash for touching ground: the damage model decides what a hit does (LND-014).

- **Land:** come to rest on an open pad, standing on the legs (within the scenario's tilt), in one
  piece. Damage costs points, not the landing.
- **Crash:** the ship broken. A weld snapping or a part destroyed breaks it.
- **Rest anywhere else:** touching the ground, a used pad or wreckage is allowed. You can take off
  again. The ship is **stranded** when it comes to rest there with no fuel left, or when you tap
  **Abandon ship**; the next ship then comes (LND-015). The button shows only once the ship has
  stayed at rest for 4 s (it flicked up too early, at the top of a hop or while settling).
- **The welds bend before they break** (DMG-008). Dropped upright onto a pad (the ship's tests):

| Touchdown | What happens |
|---|---|
| up to about 2 m/s | no harm |
| 3 m/s | leg welds bent: about 15% damage |
| 4 m/s | badly bent: about 35% |
| about 4.5 m/s and up | a leg comes off: a crash |
| 10 m/s | the tank cracks and leaks |
| 15 m/s and up | the tank bursts |

- **The HUD's speed turns red above 2 m/s:** a guide to where damage starts, not a rule.
- **A landed ship stays parked on its pad.** That pad is then *used*: it is closed for the rest of
  the game (LND-012).

### Scoring

Each landing scores:

> (200 + up to 100 for fuel left) × the pad's multiplier × (1 − damage)

- **Damage:** the worst-hit part or weld of the ship, from 0 (whole) to 100%. A clean landing on a
  full tank on a ×2 pad scores 600; the same at 35% damage, 390.
- **Pads:** each shows its multiplier as ×2, ×3, ×4 or ×5. Smaller and harder pads have bigger
  multipliers.
- **Cave:** the multiplier rises with depth.
- **Used pads:** a pad landed on is closed for the rest of the game. It is drawn dim, with its
  multiplier struck out. Using every pad gives a 1,000-point bonus and ends the game (LND-012).
- **Game total:** the sum of the landings, plus the clear bonus.

### Crashes, explosions and wreckage

- **A crash is physical.** A hard enough hit breaks the ship's welds (LND-021).
- **The tank:** a damaged tank leaks (DMG-004); a tank damaged until it is destroyed bursts, and its
  propellant burns in a blast. Nothing else sets it off.
- **Engines:** a damaged engine fires with less force: its flow falls with its integrity.
- **Breaking up:** once a ship's turn ends, the keys reach none of it, the pieces broken off it
  included. Where it came apart, its feed lines snap, and a broken-off engine fires the little
  propellant left in it for a moment, then stops (LND-034).
- **The verdict waits:** after a crash, the CRASHED banner shows only after the wreck has played out
  for about 2.5 s, and the next ship waits that long too (LND-032).
- **Wreckage stays for the whole game** (LND-022). It is ordinary physics: you can hit it, push it
  or rest on it. A new game starts with clean terrain.

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

All but the asteroid levels (Orbital, Binary, Heavy Orbital) use flat-world gravity (down). Those use
the rocks' own gravity (FLT-011); Binary's two rocks also pull each other (FLT-014).
Limits are starting values to tune in play.

| | Easy | Medium | Hard | Cave | Orbital | Emergency |
|---|---|---|---|---|---|---|
| Gravity | 1.6 m/s² down | 1.6 | 1.6 | 1.6 | asteroid's, about 1 m/s² at the surface | 1.6 |
| World | wraps, about 600 m wide | wraps, about 800 m | wraps, about 800 m | bounded | open space round the asteroid | wraps, about 800 m |
| Fuel | economy 5 (cut from 20 after play) | tight (economy 2) | tight (economy 1.75) | tight (economy 2) | economy 4 | economy 4.5, draining through a leak |
| Start | 120 m up, 15 m/s sideways | 170 m up, 10 m/s sideways | 200 m up, 10 m/s sideways | cave mouth, still | in orbit at about 60 m | as Hard, leak open |
| Touchdown limit | 2.0 m/s, 15° | 1.5 m/s, 12° | 1.2 m/s, 10° | 1.5 m/s, 12° | 1.5 m/s relative to the pad, 12° | 1.2 m/s, 10° |
| Pads | 5: wide ×2 to narrow ×5 | 6: valleys and mountain shelves | 6: narrow ledges and pits | 5: ×2 to ×6, deeper is more | 6: plateaus and crater floors | 6: ledges, a pit, between twin peaks |

The levels added on 10 November 2026 (Cave 2, Binary, Heavy Orbital) are described below.

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
- **Fuel:** a concern (economy 2, halved after play: the end pads are just reachable). Getting deep and back down safely is the challenge.

### Cave 2

- **Layout:** drawn by hand (traced into `scripts/data/cave2.json`, 0.25 m a pixel): a cave about
  450 m across, its mouth open to the left. A passage of stalactites and stalagmites leads down to
  a lower gallery and round into a chamber that curls back on itself, with pad 6 on a ledge inside
  the curl. You start outside the mouth, still.
- **Pads:** six, scoring by their number: ×1 at the mouth to ×6 inside the curl, so the further
  along the cave, the more a landing is worth.
- **Built as:** one closed outline of air with overhangs (the curl), so the rock is a crust along the
  outline on its rock side, thinned where the rock is thinner (a spike's crust never reaches through
  into the air), and the view fills everything outside the outline (`solid: "outside"`). Narrowest
  passages on the route are about 20 m.
- **Fuel:** economy 2.25 (halved after play: the end pads are just reachable). Touchdown as Cave.

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
- **Fuel:** economy 4 (halved after play). Touchdown 1.5 m/s relative to the pad, 12°.

### Emergency

- **Terrain (its own since 10 November 2026):** sheer mountains in Hard's style but different:
  twin peaks with a ledge pad between them, a deep pit with a pad at the bottom, 800 m round.
- **The leak:** the ship starts with a breach in its tank. The leak drains fuel and its jet pushes
  the ship with about a tenth of one engine's thrust, using the existing leak physics (LND-040). As built:
  the tank starts at 40% integrity with its hole facing sideways, the gas jetting out at 30 m/s:
  about 10 N of push (raised after play: 5.5 N could barely be felt), and a full tank leaks away
  in about 28 s on its own.
- **The start (made more drastic 9 November 2026 after play):** the ship comes in at 25 m/s
  sideways (Hard: 10) and spinning at 1.5 rad/s, about a quarter turn a second (`start.spin`: the
  ship spins as one rigid body about its centre of mass). One engine stops the spin in about half a
  second. Fuel economy 4.5 (Hard: 3.5): the leak empties the tank in about 20 s whatever you do, and
  this gives about 4 s more burning to sort it out.
- **Warnings:** a flashing red EMERGENCY banner. With sound, a siren (LND-051).
- **Plan:** stop the spin, kill the sideways speed, and land fast before the tank empties, while
  fighting the push.

### Binary (10 November 2026)

- **The rocks:** two, 100 and 92 m across, 220 m apart, orbiting their common centre of mass about
  about once in 4½ minutes (6 before gravity was doubled). Each turns gently, one each way (6 and 7
  minutes a turn).
- **Gravity:** each core pulls with mu = G × its rock's mass (the same G for both, so the pulls are
  equal and opposite and the pair's centre of mass stays nearly still), about 1.2 m/s² at a surface
  (doubled after play).
  The rocks pull each other (FLT-014) and the ship; the ship pulls neither.
- **Pads:** three on each rock (×2 to ×5), riding with it.
- **Start:** in orbit 55 m over the larger rock, moving with it (a start 270 m out round the pair
  showed only empty space: the view can't zoom out that far). The other rock swings round into view.
- **Fuel:** economy 4 (halved after play).

### Heavy Orbital (10 November 2026)

- **The asteroid:** 180 m across and denser (about 2,000 t), with taller mountains, turning once in
  3 minutes (Orbital: 7), so its surface moves at about 3 m/s.
- **Gravity:** about 3 m/s² at the surface (doubled after play; Orbital: 0.9), against the ship's
  4 m/s² of thrust: little margin.
- **Pads:** six (×2 to ×5): plateaus, craters, a mountain top and a shelf.
- **Start:** a circular orbit 70 m up. **Fuel:** economy 5 (halved after play).

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
- **LND-014** `[M]` Landing is physical: no touchdown speed limit and no crash for touching ground.
  Landed is at rest on an open pad, on the legs, in one piece, scored down by the damage; a broken
  ship is a crash. The ship's welds bend (DMG-008), tuned so about 2 m/s does no harm and about
  4.5 m/s breaks a leg off.
- **LND-015** `[M]` A ship may rest off the pads and take off again. It is stranded (no score) when
  it rests there with no fuel left, or when the player abandons it.

**Lives and the persistent world**
- **LND-020** `[M]` The world persists between ships. A new ship is added at the start point; the
  old one stays, parked or wrecked.
- **LND-021** `[M]` The LAND ship can break. Its parts have materials and its welds have break
  limits, so a hard impact breaks it apart. Its tank leaks when damaged and bursts only when
  destroyed; a damaged engine fires with less force.
- **LND-022** `[M]` Wreckage and parked ships stay for the whole game. A new game starts clean.

**Controls and camera**
- **LND-030** `[M]` Two touch thrust buttons (multi-touch). Q/E and the arrow keys on a keyboard.
  The browser must not zoom the game: two thumbs moving apart are a pinch, so pinch and double-tap
  zoom are cancelled in the game, and if the page zooms anyway the game pauses until it is zoomed back.
- **LND-031** `[S]` The camera follows the ship and zooms in near the ground.
- **LND-032** `[S]` After a crash, the verdict shows only once the wreck has played out (about
  2.5 s), and the next ship waits that long too.
- **LND-034** `[S]` When a ship breaks up, the keys reach none of its parts. Its feed lines snap
  where it came apart, and an engine broken off fires its last propellant for half a second (game
  time) on a channel of its own.
- **LND-033** `[S]` A faint starfield drifts behind every scenario at three depths (parallax), so
  the ship's motion reads, above all in Orbital's open space.

**Scenarios**
- **LND-040** `[M]` A ship may start with a breach (Emergency), using the existing leak physics.
  Its jet pushes with about a tenth of one engine's thrust.
- **LND-041** `[M]` Terrain is authored as a line of points per scenario. The game builds the
  ground's polygons from it.
- **LND-042** `[M]` Terrain collides across the wrap seam. The ground runs from edge to edge, and a
  ship at an edge stands on the ground across it (FLT-015: bodies collide across the edges). Until
  10 November 2026 the levels carried copies of their first and last 30 m past the opposite edges
  instead.

**Effects**
- **LND-050** `[S]` The EMERGENCY banner flashes red.
- **LND-051** `[S]` Sound effects, including the siren (later milestone).

**Release**
- **LND-060** `[M]` The game has its own page (`lander.html`), to deploy on its own: the same game
  as `?game=lander`, opening on the title screen, with nothing that leads back to the sandbox (no
  "Back to the sandbox" button, no sandbox keys, and no diagnostics log even with `?diag=1`). Built
  with the site; on GitHub Pages it is
  `/mammothspacebattles/lander.html`.
- **LND-061** `[S]` Mission select has **How to play** (the goal, touch and keyboard controls,
  landing and scoring, a few tips) and **The physics** (a short account of what the game simulates:
  rigid parts, gas thrust, welds, damage, gravity, the ledger), each with a Back button.

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
