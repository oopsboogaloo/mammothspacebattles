# Moon Mammoth: design and plan

How the game in `moon-mammoth.md` is built: what the engine already does, what it lacks, the
mammoth's movement in the world, the level, the page, and the order of work. Written 15 November
2026 from a reading of the code at `0bb0045`. Nothing here is built. Line numbers are that commit's.

**Time.** As the other games: the page runs the world at `GAME_PACE = 0.5` (`state.ts:51`). The
spec's numbers are what the player sees. The scenario stores game time: times are half as long,
speeds twice, accelerations four times. So the spec's 9 m/s run is 18 m/s in the scenario, and its
25 m/s² gravity is 100 m/s².

## 1. What the code allows today

Each fact was read in the source.

| Fact | Where | What it means for us |
|---|---|---|
| A body can be a source of gravity, pulling as a uniform ball of a given radius. | `world.ts:62` (FLT-015) | The moon's gravity is there already: one fixed body at the centre. |
| Ground is made from an outline, and from islands of rock inside it. | `terrain.ts:28` (TER-007) | The moon is one island. Mammoth Thrust level 7 is built this way. |
| The rock is a crust of fixed quads, one for each stretch of outline, up to 15 m deep. | `terrain.ts:204` | A moon of about 300 stretches is about 300 fixed bodies: fewer than a Thrust level. |
| The rock's bodies get friction 0.9 and the default bounciness, 0.5. | `terrain.ts:243`, `world.ts:316` | See the next row. |
| A contact's bounciness is the larger of its two bodies'; its friction is the root of their product. | `physics.ts:472` | The mammoth would bounce off rock whatever its own value: the rock needs its own (§2.2). A mammoth with friction 0 has no friction on anything. |
| Shapes are discs, boxes and convex polygons. Disc against polygon is there, with speculative contacts against tunnelling. | `shapes.ts:6`, `collide.ts:1` | The mammoth's circle needs nothing new. |
| Last step's contacts are kept on the world, each with its normal and gap. | `world.ts:330` | "On the ground" is read from them. |
| Player input is control channels, sent as live input without resending the world to the worker. | `Lander.tsx:322`, `simClient.ts:53` | The moves are five channels. |
| A game lives in the world and runs inside the step. | `thrust.ts`, `world.ts:1798` | Moon Mammoth does the same, so a replay agrees. |
| Every change to momentum or energy must be booked to a source in the ledger. | `world.ts:1466`, `finishLedger` | The legs' work is booked under `power`, a move back to a flag under `boundary` (as Thrust's beam back). |
| The page's ledger can be off in play. | `Thrust.tsx:32` | Used here too. Tests keep it on. |
| The renderer already turns the whole drawing for Thrust's turning station. | `render.ts:1509` | The same turn, by the mammoth's place on the moon (§5.2). |
| The view draws the world moved on to a smoothed time. | `smooth.ts:43`, `View.tsx:286` | The mammoth's drawn place, and the turn, come from that world, so they agree. |
| The worker sends rock back as stubs. | `rockStubs.ts:16` | The moon's rock costs nothing to send after the first time. |
| Fixed bodies can be turned loose by the terrain code: taken out and put back free. | `terrain.ts:417` | The falling rocks are let go the same way. |

## 2. Engine changes

All optional: off unless a scenario declares them. Determinism hashes of every existing scenario
are unchanged, checked in each PR.

### 2.1 The mammoth's movement, `src/core/moon.ts` (new)

The largest piece. See §3.

### 2.2 Rock with its own bounciness, `src/core/terrain.ts`

`TerrainSpec.restitution?: number`, kept on `Terrain` and put on each piece of crust where it is
added to the world (`startTerrain` and `cutCrater`, four places). Absent: the default, as now. Moon
Mammoth sets 0.

### 2.3 A view that turns, `src/app/render.ts`

`RenderOptions.moon`: when set, `renderFrame` hands the frame to a new `src/app/moonRender.ts`
(§5.2) instead of `drawFrame`. Nothing else in `render.ts` changes.

### 2.4 Small ones

- `scenario.ts`: `world.moon` in the schema, validated, and passed to `createWorld`.
- `controller.ts`: a moon game plays on until it is finished, and takes no scrubbing snapshots
  (`undecided`, `afterStep`), as the other games.

## 3. The game in the world, `src/core/moon.ts`

### 3.1 Spec (scenario `world.moon`)

```ts
interface MoonSpec {
  mammoth: string;                 // the disc's body id
  centre: Vec2;                    // the moon's centre: "up" is away from it
  size: { stand: number; duck: number };            // radii, m
  run: { speed: number; accel: number; brake: number; air: number };
  jump: { speed: number; cut: number; early: number; late: number };  // cut: share of rise kept on letting go
  roll: { speed: number; time: number; wait: number };
  slide: { brake: number; least: number };          // below `least` m/s a slide is a sit
  slope: number;                   // the steepest ground it stands on, as cos of the angle (0.5 = 60°)
  flags: { at: Vec2; time: number }[];              // in order; `time` is the leg that ends at it (0 for the start)
  reach: number;                   // how near a flag counts, m
  spikes: string;                  // id prefix of the spikes' bodies
  rocks?: { id: string; within: number }[];         // falling rocks: let go when the mammoth is within this of them
  view: { outline: Vec2[] };       // the moon's outline, for drawing
}
```

Channels: `left`, `right`, `jump`, `duck`, `roll`.

### 3.2 State

```ts
interface MoonState {
  phase: "waiting" | "running" | "won";
  flag: number;            // the last flag reached
  left: number;            // of the leg's time, s
  elapsed: number;         // the run's whole time, s
  tries: number;
  facing: 1 | -1;
  action: "idle" | "walk" | "turn" | "jump" | "fall" | "roll" | "sit" | "slide";
  since: number;           // when the action began, s: the page picks the frame from it
  grounded: boolean; lastGround: number; jumpAsked: number; jumpHeld: boolean; cut: boolean;
  rollUntil: number; rollReady: number;
  back?: { at: number; why: "time" | "spikes" | "rock" };   // for the page's note
  loose: string[];         // rocks let go this leg
}
```

### 3.3 The drive (before the contact solve)

Runs after the pilots and before `prepareBodies` (`world.ts:1434`), so the solver sees what the
legs did this step. In order:

1. **Frame.** `up` is the unit vector from the centre to the mammoth; `right` is `up` turned a
   quarter turn clockwise.
2. **Ground.** The mammoth is on the ground if one of last step's contacts with it has a gap under
   2 cm and a normal within `slope` of `up`. That contact's normal `n` gives the ground's own
   direction `t` (so it runs up and down slopes, not into them).
3. **Roll.** Asked for on the ground, with the wait passed: for `roll.time` its speed along `t` is
   set to `roll.speed × facing` and steering is ignored.
4. **Duck.** Held: the disc's shape becomes the ducked radius and its centre moves down by the
   difference, so it stays on the ground. Let go: it stands only if a standing disc there overlaps
   nothing fixed (tested with `collide` against the fixed bodies near it).
5. **Run.** Not rolling: its speed along `t` moves towards `run.speed × input` at `accel`, or
   towards 0 at `brake` with no input (at `slide.brake` while ducked). In the air: along `right`,
   at `air`, and never braked.
6. **Jump.** Asked for within `jump.early`, and on the ground within `jump.late`: its speed along
   `up` is set to `jump.speed`. Let go while rising: that speed is multiplied by `cut`, once.
7. **Spin.** Friction is 0, so the disc's spin is only for show: while rolling it turns at
   speed/radius (the sprite uses the body's angle); otherwise it is held at 0.
8. **Action.** `facing`, `action` and `since` are set from the above.

The change in the world's totals across the drive is booked under `power`.

### 3.4 The judge (after the step, where `runThrust` runs)

1. The clock starts at the first input. The leg's time counts down; the run's counts up.
2. Within `reach` of the next flag: `flag` goes up and `left` is the next leg's time. The last flag:
   `won`.
3. Sent back, if `left` is 0, a contact with a body whose id starts `spikes`, or a contact with a
   loose rock moving faster than 2 m/s: the mammoth is put at the last flag, at rest, standing;
   `left` is the leg's time; `tries` goes up; the leg's rocks are put back, fixed. Booked under
   `boundary`.
4. A rock within its distance of the mammoth is let go: taken out and added again free.

### 3.5 What is left to the physics

Gravity, every contact, landing, being blocked by a ledge, falling rocks' paths, and whether the
mammoth fits under a girder. The game sets the mammoth's velocity; it never moves it, except back
to a flag.

## 4. The level and the sprite sheet

### 4.1 `scripts/moon.ts` (new) writes `scenarios/moon-1.json`

- The surface is a function: radius against angle. A base of 80 m, a few long gentle waves (±1.5
  m), then features cut in or added at chosen angles: crater bowls (12 to 16 m wide, 3 to 4 m
  deep), boulders (1.5 m bumps), ledges (2.5 m steps with upright faces). Sampled every 1.5 m or so
  into the island's outline.
- Terrain: `{ outline: a square well outside, islands: [the moon], restitution: 0 }`.
- A fixed disc at the centre carries the gravity: `{ mu: g·R², radius: R }`.
- Spikes: fixed triangles `spike-…` in a row across a crater's floor, 4 to 6 m of them, so a jump
  from the slope clears them.
- Girders: fixed boxes `girder-…` floating 1.4 m above the ground.
- Rocks: fixed discs `rock-fall-…` on a girder or a ledge above the path.
- Flags: seven, every 60° or so clockwise from the top, the last just short of the first.
- The script checks the level before writing, as `scripts/thrust.ts` does: every spike row is
  narrower than a running jump, every girder gap is between the two heights, every ledge is lower
  than a jump.

The course, clockwise from the top: a flat start to learn the run; boulders to jump; a crater with
spikes; a ledge up and a drop; a girder to slide under; a rock that falls, to roll past; then
these in pairs (a girder straight after a crater, a rock over a ledge) to the finish.

### 4.2 The sprite sheet, `src/app/moon/mammoth.svg`

One SVG, a grid of 256 px frames, 8 across. The mammoth faces right and fills the frame's middle;
the circle it collides as is centred in the frame at a fixed size, so art and physics line up.

| Row | Animation | Frames | Plays |
|---|---|---|---|
| 0 | idle | 2 | looping, slowly |
| 1 | walk | 8 | looping, by distance run |
| 2 | turn | 3 | once |
| 3 | jump | 3 | rise, top, fall: by vertical speed |
| 4 | roll | 1 | turned by the body's angle |
| 5 | sit | 2 | once, holds the last |
| 6 | slide | 2 | looping |

`src/app/moon/sheet.ts` holds this table (rows, counts, rates), so new art with more frames is a
change to the table only. The placeholder is drawn by `scripts/moonSprites.ts` from a few shapes
(body, head, trunk, tusks, legs, helmet) moved per frame, and the SVG it writes is committed.

## 5. The page, `moon.html`

`src/app/moonMain.tsx` and `src/app/Moon.tsx`, modelled on `thrustMain.tsx` and `Thrust.tsx`: the
title over the moon, Play, the HUD, touch buttons, pause, the notes, the result. It uses the
sandbox's `View` underneath, as the other games do, so the worker, the smoothing and the test hooks
come with it. Added to `vite.config.ts`'s inputs.

### 5.1 Controls

Keys, touch buttons (the existing `Thrust` hold-button component) and the pad (`usePad`) each set
the five channels through `sendControl`.

### 5.2 Drawing, `src/app/moonRender.ts` (new)

One function, given a real canvas context, the drawn world, the camera and the viewport:

1. Black. The turn is the angle of the mammoth's `up` from the screen's up.
2. The context is moved to the screen's middle, turned, scaled by the zoom with y up, and moved to
   the camera. Everything after is drawn in world metres.
3. Stars: a hashed field, drawn at a third of the camera's movement.
4. The moon: its outline as one filled path (kept between frames), a lighter line on it, darker
   craters inside from a hash.
5. Spikes, girders, rocks: from their bodies. Flags: from the spec, coloured by `state.flag`.
6. The mammoth: the sheet's frame for `action` and `since`, drawn upright at the body's place,
   flipped by `facing`, and turned by the body's angle while rolling. The sheet is drawn once to a
   canvas when it loads, and frames are copied from that.

The camera is set by the page each frame (as `useFollowCamera` in `Thrust.tsx`): the mammoth's
angle round the moon exactly, and a height that eases towards the ground under it, so jumps don't
bob the view. Zoom from the screen's height: about 16 m of world top to bottom.

## 6. Plan

One PR each, each playable or testable on its own.

1. **Movement in the engine.** `moon.ts` (drive and judge without rocks), the terrain's
   bounciness, the schema, a small test scenario (a round moon with one ledge, one girder and one
   spike row). Unit tests for MMN-002 to MMN-052 and MMN-080, MMN-081, headless. No page.
2. **The page.** `moon.html`, the turning view, the placeholder sprite sheet, keys, touch and pad,
   HUD, pause, result. The test scenario is playable. Browser tests for MMN-001, MMN-060 to MMN-071.
3. **Level 1.** `scripts/moon.ts` and `moon-1.json`: the full lap with its flags and times.
4. **Falling rocks.** MMN-053, MMN-054, and their places in the level.
5. **Tuning** after Chloe plays: speeds, jump, roll, leg times.

## 7. To check when built

| What | Why it might bite | When |
|---|---|---|
| The disc catching on the joins between pieces of crust. | The crust is separate quads; a disc sliding along them at speed can catch a corner. If it does: more, shorter stretches, or the drive ignores a contact whose normal opposes the way it runs by less than a set amount. | Step 1 |
| Standing up under a girder. | The room test is the game's own, outside the solver. | Step 1 |
| A landing at 50 m/s from a long fall. | Speculative contacts should hold it; to be measured. | Step 1 |
| The ledger with the drive in. | The legs push on fixed rock, so momentum is not conserved between bodies: it must all land under `power`. | Step 1 |
| Step time with about 350 fixed bodies and one free one. | Should be far under budget. | Step 1 |
| The turn on a slow phone. | A turned drawing covers the screen's diagonal: about twice the pixels. | Step 2 |
| The view's turn when the mammoth is put back at a flag. | A jump of up to 60° round the moon in one frame: cut, or a quick ease. | Step 2 |
