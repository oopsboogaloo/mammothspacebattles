# Mammoth Asteroids: game spec

An Asteroids mini game built on the Mammoth Space Battles physics (mini game 2 of the roadmap,
`docs/spec.md` §12.1). You fly the LAND twin-engine ship, now with a railgun on its nose, in a
wrap-around arena of drifting rubble asteroids. You break the rocks with the railgun and collect
their gold by flying into it. The rocks pull each other and you with gentle gravity. They break
along their welds and chip each other when they collide. Your ship takes damage the same way
Lander's does.

Status: agreed 10 November 2026, from Chloe's brief and three rounds of questions (§10). The
requirement IDs (MAS-…) are this game's own. The engine changes the game needs are requirements in
`docs/spec.md` (§8 of this doc). Design and plan: `mammoth-asteroids-design.md`.

## 1. Decisions

| Question | Decision |
|---|---|
| Ship | The game's own ship (Chloe's sketch, 11 November 2026): a cockpit with a railgun on its nose, a battery, two generators, two magazines, and a fuel tank as each wing. A main thruster and four small ones: it turns where it is, and can brake. It replaced Lander's LAND ship, which the game started with. |
| Arena | One fixed screen: the whole arena is the view, as in the classic game. It wraps exactly at the screen's edges, with no hidden margin. Something leaving one edge shows at the other at once. |
| Arena size | 160 m high; its width follows the screen's shape (about 213 m on an iPad in landscape, 284 m at 16:9), within 1.2–2.2 × the height. |
| Levels | Level N has N asteroids, each holding 2 or 3 gold pieces. A level is cleared when every gold piece has been collected. |
| Gold | Can't be destroyed. Collected by touching it with the ship, once it can be seen: any gold not hidden inside an unrevealed larger fragment, whether or not it is still in a rock. |
| Gravity | Every joined group of rock pieces pulls as one, by its mass, from its centre: a whole rock, or a chunk or piece broken off it (from 11 November 2026, for the step time; before, every piece pulled on its own). Each rock's pull is about 1 m/s² at its surface (doubled on 11 November 2026 when Chloe asked for stronger gravity, and halved again the same day). Rocks pull each other; the ship pulls nothing. In the wrapped arena each rock pulls from its nearest copy (as now). |
| Rocks | The mining tuning (AST-008): light rock (6 kg/m²) of tough pieces with weak bonds, the bonds scaled down for these bigger pieces (800 N/m). Nine shells leave a rock in 8 chunks with 11 of its 20 pieces destroyed (one rock measured, with the stronger shell of 11 November 2026). Then the rock was made twice as tough, with a shell of twice the energy and more gas: 8 to 13 chunks, 7 to 12 pieces destroyed, the pieces leaving at 1 to 3 m/s. From level 2 the rocks start in rough orbit round each other. Rocks that collide break each other up. |
| Railgun | An explosive shell: the Mammoth scenario's, from the mining tuning, made more powerful (0.167 kg at 144 m/s, half as fast again as the 96 m/s it had until 11 November 2026, 0.1 kg of it charge with thirty-six times TNT's energy: the same blast as the 0.5 kg shell it was until 11 November 2026, when Chloe asked for three times the shells at a third of the weight; a 4 m blast, its blast making 5 kg more gas than the shell weighs (a cheat, recorded by the ledger: the shell's own gas is too little to push 100 kg pieces), about 2 shots a second, 120 shells). It bursts when it strikes, and the blast's gas pushes the rock's pieces apart. Each shot kicks the ship back about 0.36 m/s. A shell flies 144 m and is gone: less than the arena's height, so it can't come round and hit you. (First a light solid slug, which did nothing to the rocks; changed on 11 November 2026 after Chloe played.) |
| Life lost | The hull destroyed, or no working engine still welded to it (the duel's rule). Damage short of that is flown with. |
| Lives | 3. The wreck stays as debris for the rest of the level. The next ship beams in at a safe spot after about 2.5 s, protected from damage for 2 s. |
| Supplies | A full tank and magazine with every new ship and at every new level. |
| Repair | At a level clear, the surviving ship is swapped for a fresh one where it is. |
| Gunship | From level 3: the AI Gunship 3 beams in at 20 s, then once a minute. Gunships pile up if you don't kill them, three flying at the most. They get more skilled with each level. One hit damages you; it doesn't kill you outright. From level 9 the rocks stay at 8, and the gunships come sooner, more often and more skilled instead. |
| Speed | Lander's pace (1× = half real time), to be tuned after play. |
| Name | **Mammoth Asteroids**, on its own page, `asteroids.html`. |
| Look | Black, simple lines. Buttons: black rectangles with a white border and white sans-serif text (this game only; Lander keeps its own look). |

## 2. Flow

1. **Title screen.**
   - Behind it, an AI-flown ship plays the game for real: shooting rocks, chasing gold and
     dodging, level after level.
   - Over it, in white: **MAMMOTH ASTEROIDS**, and buttons **Play**, **How to play**,
     **The physics** and **High scores**.
2. **Play.** Level 1 starts: one asteroid, the ship at the centre.
3. **Level clear.** Once the last gold is collected: a "LEVEL N CLEAR" banner with the bonus. The
   level's rocks, debris and gunships beam out, the ship is repaired, and level N + 1's rocks
   beam in, away from the ship.
4. **Life lost.** The wreck stays where it is. After about 2.5 s the next ship beams in.
5. **Game over** when the third ship is lost. Shows the score and the level reached.
6. **New high score.** If it makes the top 10, enter 3 initials, then see the table with the new
   entry highlighted.
7. **Again or title.**

The pause menu (pause button, P or Esc) has **Resume** and **Quit to title**.

## 3. Rules

### The arena

- **Fixed and whole.** The camera never moves. The arena fills the screen (letterboxed only if the
  screen is very tall or very wide).
- **Perfect wrap** in both directions. What crosses an edge is already showing at the opposite
  edge. Collisions, gravity, blasts and the gunship's aim all work across the edges.

### Asteroids

- **Large rocks** about 12 m across their radius, of about 20 pieces welded along their shared
  edges, with one or two larger fragments (AST-007). A level's rocks start in rough orbit round each other, at 1 to 4 m/s, turning slowly; a lone rock drifts at 2–6 m/s.
- **Medium and small rocks** are what comes off when they break: chunks of welded pieces, and
  single pieces.
- **Breaking** is the weld model: hits and collisions load and damage the welds, and those past
  their limits break (AST-003). Pieces take damage from hits, and destroyed pieces leave as dust
  (DMG-007).
- **Gravity:** every piece pulls with its own mass. A large rock pulls about 1 m/s² at its surface.
  A broken-off chunk pulls by its own mass, so loose pieces fall back onto big rocks and chunks can
  re-collect. The ship is pulled, too: left idle it drifts in. Parts of one rock don't pull each
  other.
- **Gold:** each rock holds 2 or 3 gold pieces, denser than rock, drawn gold. They can't be
  damaged or destroyed, but their welds to the rock can break, so they come free.

### Gold and clearing a level

- **Collect** a gold piece by touching it with any part of the ship. Gold hidden inside an
  unrevealed larger fragment can't be collected until its seams show.
- **A collected piece** leaves the arena, and its welds to any rock go with it.
- **The level is cleared** when every gold piece of the level has been collected. You don't need
  to destroy the rocks, but you need to break most of them open, and clearing many makes the arena
  safer.

### The ship

- **Its parts,** welded together, with Lander's materials and bending welds (DMG-008):
  - the cockpit (the hull: the ship is lost with it), with the railgun on its nose;
  - the battery under the cockpit, and a generator each side of it (neither does anything yet:
    energy use is to come);
  - a magazine on each generator;
  - a fuel tank as each wing;
  - the main thruster under the battery, and two small thrusters on each wing, one facing back
    and one facing forward.
- **Controls:** left and right turn the ship where it is (one back thruster and the opposite front
  one). Both together are forward: the main thruster and both back ones. Reverse fires both front
  ones, to brake.
- **Handling:** 28.3 m/s² forward, 4.2 m/s² in reverse, 3.5 rad/s² turning: three times the LAND
  ship's acceleration at first, then half as much again for a stronger forward engine, and twice its turning. To tune after play.
- **Lost thrusters:** a thruster knocked off burns what is left in it, under a second, and then
  only drifts; the controls no longer reach it. Destroyed, it goes up in a small explosion.
  Either way its tank leaks where its line was (about 0.05 kg/s from a full tank), and the leak
  pushes the ship.
- **A lost wing:** a tank that comes away with its thrusters keeps feeding them. They burn, with
  no key held, for about 18 game seconds, and the tank leaks from the side that was joined to
  the ship. When the tank is empty the wing is dead, and no longer explodes if destroyed.
- **Damage:** a grazing hit on a small rock may survive, with damage. A damaged engine pushes
  less, a lost wing takes its tank and thrusters with it, and a damaged tank leaks (and its leak
  pushes). A destroyed magazine explodes violently and the ship is lost. A destroyed battery or
  tank explodes too, less so: the ship flies on, damaged.
- **The railgun** sits on the nose and fires forward. Each shot pushes the ship back.
- **Lost** when the hull is destroyed or no working engine is still welded to it.
- **The wreck stays** as ordinary debris until the level ends.
- **The next ship** beams in about 2.5 s after the loss. It appears at the spot near the centre
  that stays clearest of rocks for the next few seconds, at rest, pointing up. For 2 s it takes no
  damage, shown by flashing. Its welds can still break under a big enough load.
- **Supplies:** every new ship, and every ship at a level start, has a full tank (fuel economy
  cheat, FLT-010) and a full magazine (120 shells).

### Damage model

All the damage rules in one place. The core rules are the engine's (`docs/spec.md`, DMG and WPN);
the rest are this game's (MAS-027, MAS-031, MAS-036, MAS-037, MAS-041). The numbers, and why
they are what they are, are in the design notes (`mammoth-asteroids-design.md` §3).

**The rules every part follows**

- **Integrity.** Every part, weld and link has an integrity from 1 (whole) to 0 (DMG-001).
- **Hits.** A collision or a blast delivers energy to a part. What is beyond the part's threshold
  costs it integrity: (energy − threshold) ÷ toughness (DMG-002). The welds near the hit and the
  part's links lose the same.
- **At 0** a part is destroyed: it leaves in a puff of dust, and its welds and links go with it
  (DMG-003, DMG-007).
- **Welds** break when a load passes a limit (tension, compression, shear or torque). A load past
  30% of a limit bends the weld and leaves it weaker (DMG-008).
- **Leaks.** A damaged part that holds gas leaks through a breach, faster the more it is damaged
  and the fuller it is: 0.5 kg/s × (1 − integrity) × how full (DMG-004). The leak pushes the part.
- **Protection.** A new ship takes no damage for 2 s (it has no materials for that time). Its
  welds can still break under load.

**Materials**

| | Threshold | Toughness |
|---|---|---|
| The ship's parts, but for its tanks | 150 J | 3,000 J |
| The ship's tanks | 60 J | 500 J |
| A gunship's parts, but for its tank | 50 J | 600 J |
| A gunship's tank | 20 J | 100 J |
| Rock | 200 J | 40,000 J |
| Gold | cannot be damaged | |

A gunship's metal takes 1% of a blast's declared damage (`material.blast`). The ship's shell is
sized to crack rock 67 times as tough: taken whole, one shell destroyed 20 to 22 of a gunship's
22 parts and left nothing to see. The blast's gas, and the shell's own hit, act on it in full.

The ship's welds are 3 times Lander's (the gun's mount 6 times), so its own recoil and thrust do
not bend them.

**What happens to each part of the ship**

| Part | Damaged | Knocked off the ship | Destroyed |
|---|---|---|---|
| Cockpit | nothing more | the ship is lost | the ship is lost |
| Thruster (its head) | its thrust falls with its integrity: half at 50% | burns what is left in it (under a second), then is dead; its tank leaks where it was | a small explosion; its tank leaks where it was |
| Thruster's nozzle wall | no change to its flow | the nozzle is without that wall (effect on thrust not measured) | the same |
| Fuel tank | leaks from where it was first hit | leaks from the side that was joined | explodes if it has fuel in it; not if empty |
| Wing (a tank with its thrusters) | | its thrusters burn on, with no key held, until the tank is empty (about 18 game seconds) or the wing breaks up; the tank leaks from the side that was joined | |
| Magazine | nothing more | nothing more: the shells are counted on the gun | explodes violently: the ship is lost |
| Battery | nothing more | nothing more | a small explosion; the ship flies on, damaged |
| Generator | nothing more | the wing beyond it comes off with it | nothing more |
| Gun | nothing more | dead: the fire control no longer reaches it | no more shells |

- **The ship is lost** when its cockpit is gone, or no working engine is still welded to it
  (MAS-031). A lost ship's controls are cut: nothing of its wreck fires again.
- **A thruster's thrust** is its propellant flow, which is its full flow times its head's
  integrity. Measured with the three forward engines damaged alike: 28.3 m/s² whole, about 14 at 50%,
  about 7 at 25% (scaled from the 9.7 and 4.8 measured when it made 19.3 whole). One damaged thruster makes the ship pull to one side.
- **A cut fuel line** costs its tank 0.1 of its integrity, which is the hole it leaks through:
  about 0.05 kg/s from a full tank.

**Rocks**

- A rock breaks along its welds: a blast, a collision or another rock loads them until they go.
- A piece that is destroyed leaves a burst of gas that pushes its neighbours apart (MAS-027). The
  burst does no damage, so bursts don't chain.
- Gold cannot be damaged.
- Gold the ship can collect does not collide with the ship (MAS-024): a piece weighs about 105 kg,
  more than the ship. As a collision, at 12 m/s it took 21% off the gun; at 25 m/s 90%, with five
  welds broken and the ship thrown back at 13 m/s. Gold still hidden inside a larger fragment is
  rock to the ship, and collides.

**Weapons**

| | What it is | What a hit does |
|---|---|---|
| The ship's shell | 0.167 kg at 144 m/s; a charge of 151 kJ and 5.5 kg of gas; blast reaches 4 m | destroys rock pieces near the hit and pushes the rest apart; one puts a gunship out of the fight, destroying its tank and a part or two and leaving the other 20 as wreckage in pieces; never goes off against its own ship |
| A gunship's shell | 0.3 kg with a charge of 6 kJ; blast reaches 2 m | takes 35 to 75% off the part it strikes and 5 to 25% off those round it; destroys a tank it strikes or lands beside, which explodes; no single hit loses the ship |
| A destroyed magazine | 1 kg of TNT, reaching 6 m | takes the cockpit, both tanks, the battery, a generator and the main thruster |
| A destroyed battery | 0.05 kg of TNT, reaching 1 m | breaks four welds and damages four parts |
| A destroyed tank with fuel | 0.05 kg of TNT and its fuel, reaching 0.5 m | breaks about ten welds; the ship flies on |
| A destroyed thruster | 5 g of TNT (12 g for the main one) | damages the tank beside it a little |

### Gunships

- **From level 3:** a Gunship 3 beams in 20 s into the level, then another every minute after.
  They pile up if not killed, up to three flying at once: a gunship that is due waits until one of
  the three is destroyed, and the one after it is timed from when it came (decided by Chloe,
  11 November 2026: each gunship costs step time).
- **AI:** hunting you (AIP, Hunting mode), aiming across the edges. Its combat skill rises with
  each level.
- **From level 9** (decided by Chloe, 10 November 2026): the rocks stay at 8 a level, and the
  gunships make the later levels harder instead. Each level past 8, the first gunship comes 2 s
  sooner (down to 10 s), the next ones 5 s closer together (down to every 20 s), and their combat
  skill goes on rising past its earlier ceiling, to the pilot's best. The numbers are a first
  setting, to tune after play.
- **Shells:** 0.3 kg with a small charge (6 kJ, reaching 2 m). First a 0.15 kg solid slug, then
  0.3 kg, then the charge (all 11 November 2026: Chloe found them not effective). One hit takes
  35 to 75% off the part it strikes and 5 to 25% off those round it, and destroys a tank it
  strikes or lands beside, which explodes. No single hit loses the ship. Measured in tests.
- **Killed** like any ship: its hull destroyed or no working engine left. Its wreck stays as
  debris.
- **At a level clear** the remaining gunships beam out with the rocks. A gunship doesn't need
  killing to clear a level.
- **Beaming in** shows a brief ring at the spot first, so you have a moment's warning.

### Scoring

| What | Points |
|---|---|
| A gold piece collected | 500 |
| A rock weld broken by your slugs | 10 |
| A gunship destroyed | 1,000 |
| Level N cleared | 1,000 × N, plus 10 for each second under 2 minutes |

"By your slugs": the weld broke within a quarter of a second of one of your slugs touching that
rock.

**High scores:** top 10 on this device, with 3 initials, the score, the level reached and the
date.

## 4. Controls, HUD and view

### Controls

| | Keyboard | Touch |
|---|---|---|
| Left engine | Q, ←, Left Shift | bottom-left button |
| Right engine | E, →, Right Shift | bottom-right button |
| Both engines | both keys, or ↑ | both buttons |
| Fire | Space or W (hold to repeat) | a fire button, bottom centre |
| Pause | P or Esc | pause button |
| Self-destruct | | a button beside Pause, pressed twice |

As in Lander, the browser must not zoom the game (LND-030's rules).

### HUD

Along the top, in white sans-serif, kept small so the arena stays clear:

- score, level, and lives (as small ship outlines);
- gold left in this level ("GOLD 3 / 5");
- fuel bar, slugs left, and damage (the worst-hit part, as in Lander).

### View

- **The whole arena** at a fixed scale. The ship is about 15 px across on a laptop.
- **Copies across the edges** are drawn the same as the originals (gold, wreck colours, flashing
  included), so an object half over an edge reads as one object.
- **A faint starfield** behind (still, since the view never moves).

## 5. How to play and The physics

From the title screen, each with a Back button, in the game's black-and-white style:

- **How to play:** the goal (collect all the gold), the controls table, the rules for gold,
  lives, damage, gunships and scoring, and a few tips (shoot near gold to free it, mind the recoil,
  rocks pull you in).
- **The physics:** a short account of what is simulated: rigid welded parts, thrust from burning
  gas, the railgun's recoil, welds that bend and break, material damage, rocks breaking along their
  welds, every piece's gravity, the perfect wrap, and the conservation ledger. It says plainly
  where the game cheats: the fuel economy, gold that can't be destroyed, and the arena's two-axis
  wrap.

## 6. Look and sound

- **Black space, simple lines.** Rocks drawn as their pieces (dark grey, light edges), with
  cracks showing as bonds break. Gold is bright gold. The ship and gunships use the normal body
  drawing. Exhaust, dust and wisps stay as they are.
- **Beam in and out:** a brief expanding white ring.
- **Sound:** later.

## 7. Requirements

Priority: **M** must, **S** should.

**Game shell**
- **MAS-001** `[M]` A title screen with the game's name in white, over a live AI-played game, and
  buttons Play, How to play, The physics and High scores.
- **MAS-002** `[M]` A game screen with only the arena, the HUD, the touch buttons and pause.
- **MAS-003** `[M]` Play runs at the fixed game pace (1× = half real time), with no speed
  controls.
- **MAS-004** `[M]` A pause menu with Resume and Quit to title. P and Esc pause.
- **MAS-005** `[M]` A game-over screen, then initials if the score makes the top 10, then the
  table. High scores: top 10 with 3 initials, score, level and date, stored on the device and kept
  through a reload.
- **MAS-006** `[M]` Buttons are black rectangles with a white border and white sans-serif text.
- **MAS-007** `[M]` How to play and The physics pages, each with a Back button (§5).
- **MAS-008** `[M]` Its own page, `asteroids.html`, built and deployed with the site, with nothing
  leading back to the sandbox (as LND-060). The sandbox's start screen has a button that opens it.

**Arena**
- **MAS-010** `[M]` The arena is the whole view, fixed. Its height is 160 m, and its width follows
  the screen's shape, within 1.2–2.2 × the height.
- **MAS-011** `[M]` The arena wraps in both directions at the view's edges, with no hidden margin.
  An object over an edge shows on both sides at once, drawn the same on both.
- **MAS-012** `[M]` Collisions, gravity, blasts and the AI's sight and aim work across the edges
  (FLT-015, FLT-016).

**Asteroids and gold**
- **MAS-020** `[M]` Level N starts with N large rocks, 8 at most (levels 8 and up have 8), placed away from the ship and each other,
  drifting and turning, each with 2 or 3 gold pieces. The same level from the same seed is laid
  out the same.
- **MAS-027** `[S]` Where a rock's piece is destroyed, a burst of gas pushes the pieces round it
  apart. It does no blast damage, so one burst doesn't set off the next.
- **MAS-026** `[S]` A level of two or more rocks starts with them in rough orbit round each
  other: each moving across the line to their centre of mass, at the speed that would hold a
  circle, all turning the same way, with no momentum overall.
- **MAS-021** `[M]` Rocks break along their welds and take damage from hits and collisions,
  through the ordinary weld and damage rules.
- **MAS-022** `[M]` Rock pulls by its mass, about 1 m/s² at a large rock's surface: each joined
  group of pieces as one source (AST-011), so a broken-off chunk pulls by its own mass. Rocks pull
  each other and not themselves.
- **MAS-023** `[M]` Gold can't be damaged or destroyed (AST-010).
- **MAS-024** `[M]` The ship touching a gold piece not hidden in an unrevealed larger fragment
  collects it: it leaves the arena, its welds go with it, and it scores 500. The ledger records
  what leaves under `boundary`.
  Collecting is no collision: gold the ship can collect passes through the ship's parts, and is
  collected as soon as their outlines meet. Nothing is pushed or damaged.
- **MAS-025** `[M]` When every gold piece of the level has been collected, the level is cleared:
  bonus, then the level's rocks, debris and gunships beam out, the ship is swapped for a fresh one
  in place, and the next level beams in.

**Ship and lives**
- **MAS-030** `[M]` The ship is the game's own (a cockpit, battery, two generators, two magazines,
  two fuel tanks, five engines), with Lander's materials and bending welds, and a railgun on its
  nose (an explosive shell, about 0.36 m/s of kick a shot). Its welds are stronger than Lander's
  (3 times; the gun's mount 6 times), so the recoil of a whole magazine does it no harm.
- **MAS-031** `[M]` The ship is lost when its hull is gone or no working engine is still welded to
  it. 3 lives a game.
- **MAS-032** `[M]` A lost ship's wreck stays until the level ends. The next ship beams in about
  2.5 s later, at rest, at a clear spot, and takes no damage for 2 s.
- **MAS-033** `[M]` Every new ship has a full tank and magazine.
- **MAS-034** `[S]` The ship flashes while protected.
- **MAS-035** `[M]` Left and right each fire one back thruster and the opposite front one, turning
  the ship where it is. Both together fire the main thruster and both back ones. Reverse fires
  both front ones. About 28.3 m/s² forward, 4.2 m/s² in reverse and 3.5 rad/s² turning.
- **MAS-036** `[M]` A destroyed magazine explodes violently: the ship is lost. A destroyed battery
  explodes too, and the ship flies on damaged.
- **MAS-038** `[S]` The ship's cockpit is filled light blue, so the way the ship faces shows.
- **MAS-039** `[S]` A self-destruct button beside Pause, for a ship left with too few engines to
  fly usefully. A second press within 3 seconds confirms. The cockpit and every charge aboard go
  off, and the ship is lost as any other is: it costs a life.
- **MAS-037** `[M]` An engine no longer welded to the ship, or destroyed, has its fuel line cut.
  One that still exists burns what is left in it (under a second) and is then dead. A gun knocked
  off the ship no longer fires. Destroyed, it
  goes up in a small explosion. The tank it was fed from leaks where the line left it. A wing
  lost whole (a tank with its thrusters) burns on from its tank, with no key held, and leaks from
  the side that was joined to the ship, until the tank is empty or the wing breaks up. A tank
  with fuel in it explodes when destroyed; an empty one does not.

**Gunships**
- **MAS-040** `[M]` From level 3, a Gunship 3 with a Hunting AI beams in at 20 s and every 60 s
  after, at a clear spot away from the player, after a brief ring warning. Three fly at the most:
  one that is due waits until another is out of the fight.
- **MAS-041** `[M]` Its combat skill rises with the level. Its shells damage the ship without
  destroying it in one hit; a hit on a tank destroys the tank.
- **MAS-043** `[M]` From level 9, where the rocks stop growing, each level brings the first gunship
  2 s sooner (10 s at the least) and the rest 5 s closer together (20 s at the least), and the
  gunships' combat skill rises on to 1.
- **MAS-042** `[M]` A gunship destroyed (hull gone or no engine) scores 1,000. Its wreck stays
  until the level ends.

**Scoring and HUD**
- **MAS-050** `[M]` Scoring as in §3.
- **MAS-051** `[M]` The HUD shows score, level, lives, gold left, fuel, slugs and damage.
- **MAS-052** `[M]` Touch: left, right, reverse and fire buttons, working together (multi-touch).
  Reverse is beside the left button and fire beside the right one.
- **MAS-053** `[S]` An option in the pause menu, kept with the browser and shared with Mammoth
  Lander, swaps left and right: a left control then turns the ship right.
  Keyboard as in §4.

**Demo**
- **MAS-060** `[M]` The title screen's game is played by an AI pilot flying the ship through
  its controls: it shoots the nearest rock, chases the nearest visible gold, and avoids what is
  about to hit it (AIP-020). When it clears a level, the next one starts; when it loses its last
  ship, the demo starts again.

**Game logic**
- **MAS-070** `[M]` The game lives in the world, like Lander's, so a run and a replay agree
  (DET-001).

## 8. Engine changes (in `docs/spec.md`)

Agreed with Chloe on 10 November 2026, because they change physics the sandbox and Lander share:

- **FLT-015** Collisions across the wrap edge. Contacts use the nearest copy of each body, only
  in wrapped worlds. Lander's duplicated terrain past its edges (`seam`) is removed in the same
  change, and Lander's tests re-run.
- **FLT-016** Blasts (WPN) and the AI pilot (sight, aim, the gravity it predicts, avoiding things)
  measure from the nearest copy in wrapped worlds. Gas and the tractor beam don't yet.
- **AST-009** A generated asteroid may give every piece gravity in proportion to its mass
  (`gravity: {G, core}`), felt by the other rocks.
- **AST-010** A generated asteroid's gold may be indestructible (`goldIndestructible`): its
  pieces carry no material, so nothing damages or removes them (DMG-002).
- **AIP-020** A new AI pilot mode, **clearing**: shoot the nearest rock, chase the nearest visible
  gold, avoid collisions. A first step toward the planned Mining mode.

Everything else exists already: the welded generator with gold and larger fragments (AST-001…007),
the weld and damage rules, the railgun (WPN-008), the Gunship 3 and its Hunting pilot, spawning
ships mid-game (SCN-010), the duel's "out of the fight" rule (DUEL-001), wrapping (FLT-012) and
gravity (FLT-011, FLT-014).

Anything more found during the build that would change shared physics, such as solver shortcuts
for speed, goes back to Chloe before it is made.

## 9. Milestones

1. **Engine:** collisions across the edge, wrap-aware blasts and AI, per-piece gravity,
   indestructible gold. Lander unchanged in play.
2. **Playable:** the game logic, the ship with its railgun, levels, gold, lives, scoring, the
   page, the HUD and touch.
3. **Gunships** from level 3.
4. **Title and pages:** the AI demo, How to play, The physics, high scores.
5. **Tuning after play.**

## 10. Answered (10 November 2026)

| Question | Answer |
|---|---|
| Collisions across the edge | Fix in the shared solver, only for wrapped worlds; remove Lander's seam copies. |
| Gravity of rocks that break | Every piece pulls by its mass. |
| Gravity in a wrapped world | From each rock's nearest copy, as now (the pull flips at half the arena, where it is ~0.02 m/s²). |
| Indestructible gold | Gold has no material (a generator option). |
| What else must respect the wrap | Blasts and the AI; gas and the tractor later. |
| View | The whole arena on one fixed screen, shaped like the screen. |
| Railgun | An explosive shell (the mining tuning's), a kick of about 0.36 m/s. |
| Life lost | Hull gone or no working engine. |
| Fuel and ammo | Refilled with each new ship and each level. |
| Collecting gold | Any visible gold, by touch. |
| Rocks per level | N rocks, 8 at most, 2–3 gold each. |
| After a loss | The wreck stays; a safe spawn with 2 s of protection. |
| Gunship | Gunship 3, AI, more skilled each level; they pile up, three at the most. From level 9: sooner, more often, more skilled. |
| Speed | Lander's pace; tune after play. |
| Scoring | Gold, rock welds, gunships, a clear bonus; top-10 table. |
| Name and style | Mammoth Asteroids; black-and-white buttons in this game only. |
| Demo | A new AI mode that clears rocks. |
| Repair | Fresh ship each level. |
| Controls | Q/E + Space; two thrust buttons and a fire button. |
| Gravity strength | About 1 m/s² at a large rock's surface. |
| Rock toughness | The mining tuning. |
