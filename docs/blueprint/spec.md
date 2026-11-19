# Blueprint designer — specification (draft for discussion)

Status: **draft, 16 November 2026; decisions of the same day in §14.** Nothing is built yet. Mockups are in [`mockups/`](mockups/)
(PNG, plus the HTML they are rendered from: `python3 make.py && node shoot.mjs` in that folder).
The ship in every mockup is drawn from the real Thrust ship (`scenarios/thrust-1.json`,
`world.thrust.ship`), so its shapes, weld points and centre of mass are true. Performance
numbers marked *est.* are placeholders until the calculations below exist.

> **Units (18 November 2026, docs/units-rescale-plan.md):** the game's units are now lengths ×4 and
> masses ×1024 against the figures in this document, time unchanged (speeds and accelerations ×4,
> forces ×4,096, energies and power ×16,384). The designer still works in the old units inside (its
> rules, and designs saved before, are as written here) and shows and takes the new ones: a 0.1 m wall
> reads 0.4 m, THRUST 1's 60.3 kg reads 61.7 t (with its welds), 36 m/s² reads 143 m/s². Figures
> below are in the old units unless they say otherwise.

## 1. Purpose

The part of Mammoth Space Battles where the player changes, tunes, reconfigures or repairs a
spacecraft, or designs one not yet built. It must:

1. show a ship as a blueprint and let you build one from components that snap and weld together;
2. show every property the game's physics uses for each component and weld, and let you change it;
3. show the numbers that matter for a decision (mass, size, acceleration, turn, centre of mass) and
   how an edit changes them, as you make it;
4. fly the design at once in a sandbox, and come straight back;
5. keep several blueprints, with the existing ships as read-only presets to copy.

Primary devices: desktop (mouse + keyboard, ≥ 1280×720) and iPad (touch, landscape 1180×820 and
up). Phone is not a goal.

## 2. Layout (one screen, never scrolls as a whole)

| Area | What | Mockup |
|---|---|---|
| Top bar | ☰ Blueprints menu · drawing name and state (PRESET / EDITING, ● unsaved) · **BUILD / CONTROLS** mode switch · undo/redo · overlay toggles (CoM, Thrust, Welds, Dims, Snap) · Fit · **▶ TRY IT** | all |
| Left: Components | Type picker ◀ ENGINES ▶, plus a row of 8 type tabs for direct access; a vertical list of component cards (line drawing, name, two key numbers, ＋ button); its own scrollbar with arrows; the list also scrolls by drag or wheel | 01, 02 |
| Centre: Blueprint | Grid (1 m major, 0.2 m minor), the ship, scale bar, title block, zoom buttons; a Performance table top right | 01–03 |
| Right: Properties | The selected component or weld: name and summary, then tabs (SHAPE · FUEL · BUILD · LINKS for an engine) so a type's fields fit without scrolling; derived readouts; Duplicate / Mirror / Remove | 01, 03 |
| Status bar | One line: what is selected and what you can do next, with keys | all |

Panels may scroll **inside** themselves (the component list, a long Properties tab); the page
never does. The Properties panel collapses (⇥) to give the blueprint the room.

Component types (left picker, in this order): **Cockpits, Engines, Tanks, Storage** (magazines,
cargo), **Weapons, Generators, Batteries, Utilities** (tractor projector, tether winch, shield
emitter, later others).

## 3. Interaction

### 3.1 Adding a component
Any of: drag a card onto the blueprint; double-click (double-tap) a card; select a card and press
＋ or Enter. Added without a drag, it lands at the nearest free snap place to the ship's right or
below, selected, so the next action can be moving it.

### 3.2 Moving, snapping, welding (mockup 02)
- While a component is dragged, its outline follows the pointer as a dashed ghost.
- **Snapping** (on by default; hold Shift, or turn Snap off, to place freely): when an edge comes
  within 0.25 m (screen: 16 px, whichever is larger) of another component's edge, the ghost jumps
  flush to it, and aligns its centre or ends with that edge if within the same distance. Guides
  (dashed green lines) show what it aligned to. Free placement snaps to the 0.05 m grid.
- Where it will weld is shown **before** release: green weld points, "SNAP · flush with Tank R".
  Red outline if it would overlap another component (release then cancels, with the reason).
- On release a weld is made between each pair of touching components, with weld points placed by
  rule: two points per shared edge, 0.1 m in from each end (one point if the shared edge is under
  0.3 m). Strength preset: Standard (the Thrust ship's: tension 22,950 N, compression 45,900 N,
  shear 16,050 N, torque 5,520 N·m, yield 0.3).
- Dragging a placed component moves it **with its welds broken** (they reform where it lands); the
  status bar says so.
- The Performance table shows what the drop would do (mass 61.2 → 67.3 kg, accel −2.6 m/s², …),
  and the centre of mass shows where it would move, with a warning when it moves off the line of
  thrust.

### 3.3 Selecting
Click/tap a component to select it (amber outline, handles; dimensions drawn on it when Dims is
on). Click a weld point to select that weld (mockup 03). Tab / Shift-Tab steps through components.
Esc deselects. Empty space deselects. A selected item's Properties replace the panel's content.

### 3.4 Pan and zoom
Wheel or pinch zooms about the pointer; drag on empty space (or two fingers, or Space-drag) pans;
Fit (Z) frames the ship. Zoom buttons are there for touch and discoverability.

### 3.5 Keys
`Del` remove · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `M` mirror ·
`[` `]` previous/next type · `/` search components · `Z` fit · `C T W D S` overlays · `Enter` Try it
· `Esc` deselect / cancel / back from Try it. Every button shows its key in its tooltip.

## 4. Number entry (every property)

Each field is the same control, following Apple's guidance to pair a slider with an exact value
field and steppers, and NN/g's that sliders are poor for exact values and steppers for big jumps:

```
LABEL ↺                       [ 1.20 m ]
[◀] ─────────●──────────── [▶]
```

- **Value box:** tap/click to type; Enter or leaving it commits, Esc reverts. Accepts units
  (`120 cm`, `1.2`), and simple sums (`1.2*2`). Out-of-range values are clamped, with the reason
  shown under the field.
- **Slider:** drag for coarse changes; ticks every 10%. Arrow keys nudge when focused; Shift for ×10.
- **◀ ▶ steppers:** one step each press, repeating when held (the step suits the field: 0.05 m,
  1°, 0.1 kg/s …).
- **Label scrub** (desktop): drag the label left/right to change the value, as in Blender and Figma.
- **↺** appears once a value differs from the component's default; ● marks it changed.
- Touch targets ≥ 44×44 px on iPad (Apple HIG 44 pt); ≥ 32 px on desktop, above WCAG 2.2's 24 px
  minimum.
- Every change is live on the blueprint and in Performance, and is one undo step per gesture (a
  whole slider drag is one step).

## 5. Components and their properties

A **component** is what the player places: one or more physics bodies welded together that the
editor treats as one. Every property maps to a field already in the scenario format
(`src/core/scenario.ts`), so a blueprint becomes a ship with no new physics.

| Component | Bodies | SHAPE | FUEL / FUNCTION | BUILD | LINKS |
|---|---|---|---|---|---|
| Cockpit | 1 polygon | width, height, nose width, nose length | CONTROLS: the ship's controls, bindings, rules and wiring (§10); tractor if fitted here | material, mass | — |
| Engine | head + 2 nozzle walls | chamber width, chamber length, throat width, wall thickness, nozzle wall length, nozzle flare | flow (kg/s, the sketch's "burn rate"), mixture, igniter, fuel efficiency | material, mass (derived) | feeds (which tanks); CONTROLS: its mixer lines (§10) |
| Tank | 1 box | width, height | H₂ and O₂ capacity (derived from volume, editable), fill at start | material, mass, explodes when destroyed (charge) | feeds out |
| Magazine | 1 box | width, height | shell count, shell mass | material, mass, explosive charge | which gun it feeds |
| Railgun | 1 box | width, length | speed, reload | material, mass | fire channel |
| Generator / Battery | 1 box | width, height | output / capacity (when power is modelled) | material, mass | — |
| Tractor projector, tether winch | 1 box | width, height | beam range, arc, force; tether length, stiffness | material, mass | channel |
| Shield emitter | 1 box | width, height | radius, burn, hit burn | material, mass | channel, tanks it burns from |

Engine geometry, as the Thrust ship's main thruster stands (mockup 01): head 1.2 × 0.15 m,
chamber 1.2 × 1.35 m (`injector.chamber`), walls 0.10 m thick and 1.10 m long, splayed about 12.8°,
exit 1.70 m across their outsides, flow 7.776 kg/s, mixture 1 : 8, economy 66. Side thrusters: head
0.8 m, walls 0.70 m at about 9.7°, flow 1.45 kg/s. The editor rebuilds the head, the two wall
polygons and their two internal welds from the six SHAPE numbers; the internal welds are not shown
as separate welds.

All components are axis-aligned rectangles for now except the cockpit, and the engine's walls,
which are part of the engine. Engines can face up or down (front thrusters face down: angle π).

## 6. Welds (mockup 03)

A **weld** is the join between two components: one or more weld points (the scenario's joints)
with one set of limits. Selecting one shows: the two components (as chips that select them), the
number of points and their spacing, a strength preset (Light / Standard / Heavy / Custom), the four
limits and yield, which way it is weakest, roughly what acceleration it holds, and, after a Try it,
the peak load it saw. Actions: Unweld (keeps the parts, removes the join), Remove weld.

## 7. Performance table and overlays

Shown top right, always, for the whole ship (full tanks and magazine), with the change since the
last save in green/red, and the projected change while dragging:

| Row | How |
|---|---|
| Mass | sum of bodies + contents + shells (Thrust: 61.2 kg) |
| Width × height | bounding box (Thrust: 5.6 × 3.65 m) |
| Accel. forward / reverse | from the mixer: the engines Forward (or Reverse) drives, ÷ mass |
| Turn | from the mixer: net torque of what Turn left / right drives, about the centre of mass, ÷ moment of inertia |
| Thrust ÷ mass | in g |
| Full-burn time | propellant ÷ total flow of the forward engines |
| Joins | welds and parts (Thrust: 20 welds, 26 weld points, 17 components) |

**Thrust per engine.** Instant estimate from the engine's flow and the choked-throat model
(PRP-011: jet ṁ·c*·(1 + 1/γ)), corrected by a factor per engine type; plus a **Measure** button
that runs the real simulation headless in the worker for a second (as `docs/ship-designs.md`
measures) and replaces the estimates with measured values, marked as such. Recommended because the
real thrust depends on the nozzle walls in ways the formula misses (`docs/perf/gpu-gas-phase0.md`).
A first estimate for the Thrust ship shows the gap: taking each side thruster as about 128 N and
the main about 1,475 N (from the measured 28.3 and 4.2 m/s²), and the moment of inertia from the
parts' shapes (about 133 kg·m²), one turn control gives about 4.0 rad/s², against the "about 7"
in `docs/games/mammoth-thrust.md`. Mockup 07 shows the estimate; Measure would settle it.

Overlays: centre of mass (marker as KSP's), thrust arrows sized by thrust, weld points, dimension
lines on the selection, grid snap. Later: centre of thrust, as KSP and its RCS Build Aid mod show.

**Fuel efficiency** (the scenario's `economy`, ×66 on the Thrust ship) is an ordinary FUEL field,
not a cheat: in the game world the propellant isn't really hydrogen and oxygen (it will be made
from crystals the player collects), and the ships are far lighter than real ones.

## 8. Blueprints (mockup 04)

☰ BLUEPRINTS opens a drawer over the left of the screen: New blank, Duplicate, Rename, Export
(JSON file), Import, Delete; filter All / Mine / Presets; a card per blueprint with a thumbnail, its
mass, acceleration and engine count.

- **Presets** ship with the game and cannot be changed. Editing one asks once, then makes "<name>
  copy" and edits that. The only preset for now is **Thrust 1**, exactly the Thrust ship: the gold
  standard (easy to fly, vulnerable, and it blows apart nicely). The other ships in
  `docs/ship-designs.md` wait until they are rebalanced against the improved model.
- **Mine** are kept in the browser (localStorage) and saved automatically on every change, with
  undo history for the session. Export/Import moves them between devices.
- A blueprint is the existing ship format (`bodies`, `joints`, `links`, plus the control mix) with a
  small header (name, revision, created/edited), so it drops into a scenario unchanged.

## 9. Try it (mockup 05)

▶ TRY IT (or Enter) opens the sandbox in the same page in under a second:

- the ship, fully fuelled and armed, at rest in the middle; no gravity; edges wrap as Asteroids;
  one rock to the side to fly round and shoot; stars for a sense of motion;
- a top bar: **◀ BACK TO BLUEPRINT (Esc)**, Refuel & reset (R), Pause (Space), rock on/off;
- gauges: fuel, shells, speed, spin, parts lost; the control keys shown;
- the blueprint's own controls and mixer (§10), with their keys and game-controller bindings;
- nothing in the try-out changes the blueprint. Back returns to the blueprint exactly as left
  (selection, zoom, tab).

## 10. Controls: owned by the cockpit (mockups 07, 08)

**The controls belong to the cockpit** (Chloe's idea, 16 November 2026). It is where the pilot
sits, and the game already works this way: the hull is the cockpit, and a part knocked off it no
longer answers the controls (MAS-038, `src/core/arcade.ts`). So:

- **Select the cockpit** (mockup 08): its Properties get a CONTROLS tab listing each control, its
  keys (the player's, shared by every ship) and what it drives in this ship, the rules, and the checks; **⤢ Open mixer (K)** opens the full
  view below. Its wiring shows on the blueprint as dashed lines from the cockpit to each part it
  drives, like a wiring diagram.
- **Select an engine or device:** its CONTROLS tab (which replaces LINKS) shows its own lines, with
  the same line editor as the mixer, so it can be wired from either end.
- **The mixer view** (mockup 07) is the cockpit's controls laid out wide, because a matrix of
  every driven part against every control doesn't fit a side panel. The top bar's
  BUILD / CONTROLS switch opens it too.
- Later, a ship with two cockpits (a pilot and a gunner) would have two sets of controls, each
  wired to its own parts; losing one cockpit loses only its controls.

### The mixer view

The player decides how their controls drive their engines and devices: nothing is guessed, because
players will build ships nobody can predict. **BUILD / CONTROLS** in the top bar switches mode
(B / K). The blueprint stays in the middle; the panels change:

- **Left: Controls.** The player's controls: name, kind (*analog*, 0–100%, from a stick or
  trigger; or *hold*, on/off), and their bindings as chips (keys, game-controller buttons, sticks,
  triggers). **The controls and their bindings are the player's, one set for every ship**, kept
  with the player's settings, not in a blueprint; ＋ on a control binds one more (press it), and
  the change applies to all ships. ＋ New control adds one (Strafe, Boost, Brake …) for all ships;
  a ship that doesn't wire it ignores it. What a blueprint stores is only its **wiring**: the
  mixer's rows and lines, and the rules it uses.
  **Rules** sit under the list: the Thrust ship's is *Turn left + Turn right are opposites: held
  together they cancel and count as Forward*.
- **Bottom of the centre: the Mixer**, a matrix: a row for everything that can be driven (each
  engine, gun, tractor, tether, shield), a column for each control. A cell holds a line's weight
  and, in orange, what eases it. Click an empty cell to add a line; click a filled one to edit it.
  A NOW column shows each row's throttle while testing.
- **Right: the selected row's lines**, as an RC transmitter's mixer screen (EdgeTX): each line is
  *control × weight*, optionally *eased by* another control (× (1 − amount × that control)). The
  row takes the **largest** of its lines (or their sum, or least). A sentence says what it does in
  words: "Fires fully on Turn right. Fires on Forward, except while Turn left is held."
  Mirror to BR, Copy lines and Throttle limit are there.
- **Test by holding the keys** (or ● on a control): engines on the blueprint show their throttle
  and a plume; the centre of mass shows the result (green arrow and turn arc).
- **Response** replaces Performance: for each control, and for what is held now, the acceleration
  ahead, sideways and the turn, estimated, with Measure (§7). Checks under it: every engine driven
  by something; Forward and Reverse don't turn the ship; Turn left and right mirror each other.
  Problems show in orange with the row that causes them; they warn, never forbid.
- Drag a control from the left onto an engine on the blueprint to add a line at 100%.

**The Thrust ship's mix in these terms** (`src/core/arcade.ts`, `steerValues`, MAS-054), which the
Thrust 1 preset must reproduce exactly:

| Driven | Lines (largest wins) |
|---|---|
| Main thruster | Forward 100% |
| Thruster BL | Turn right 100% · Forward 100% eased by Turn left 100% |
| Thruster BR | Turn left 100% · Forward 100% eased by Turn right 100% |
| Thruster FL | Reverse 100% · Turn left 100% eased by Forward 50% |
| Thruster FR | Reverse 100% · Turn right 100% eased by Forward 50% |
| Railgun, tractor, shield | Fire, Tractor, Shield: on |

with the rule that Turn left and Turn right held together cancel and count as Forward (so "Turn
right" in a line is the net turn, right less left). Bindings as the game's: Forward ↑, A, right
trigger, stick up; Reverse S, ↓, B, left trigger; Turn left Q, ←, left Shift, left Ctrl, stick;
Turn right E, →, right Shift, right Ctrl, stick; Fire Space, W, X, right bumper; Tractor Z, /, Y;
Shield X, ., left bumper (`src/app/Thrust.tsx`). Self-destruct stays a game button, not a control.

The data: the player's `controls` (names, kinds, bindings), stored once in their settings; and
each blueprint's `mix` (its rules, and per driven channel its lines and how they combine). It generalises today's `SteerMix` and `MixRow` (both in
`arcade.ts`); the games could later take a blueprint's mix instead of their fixed one.

## 11. Later (designed for, not built now)

- (Built: turning by a handle and resizing by dragging, §18; trapezoids and triangles, §17.)
- Damage and repair: the blueprint of a damaged ship shows lost parts as dashed outlines to rebuild.
- Cost and build limits for the game proper.

## 12. Requirements (to be numbered BPD-xxx and traced to tests when agreed)

1. The editor fits one screen at 1280×720 and up, and at iPad landscape (1180×820), with no page
   scrolling.
2. Components can be added by drag, double-click/tap and the ＋ button.
3. Components snap edge-to-edge and weld on release; the welds are shown before release.
4. Every component and weld property in the ship format can be read and changed in Properties.
5. Each number has a typed value, a slider and ◀ ▶ steppers; targets ≥ 44 px on touch.
6. Mass, size, acceleration, turn and centre of mass update on every edit, and show the change.
7. Every edit is undoable.
8. Presets are read-only; Duplicate makes an editable copy; blueprints persist across reloads and
   can be exported and imported.
9. Try it flies the current design, fuelled, in a wrapping gravity-free field with one rock; Esc
   returns to the unchanged blueprint.
10. Thrust 1 is a preset identical to the Thrust game's ship (same bodies, joints and links), and
    its mix gives the same engine values as `steerValues` for every combination of controls.
11. Every engine and device's controls are set by the player in Controls mode; none is guessed.
    Each control can be tested in the editor, showing the ship's response.
12. The sandbox's start screen links to the designer (`blueprint.html`), beside the games.

## 13. Open questions

1. Controls mode: are *eased by* lines and *opposites* rules enough for the mixes you have in mind?
   EdgeTX also has curves (gentle near centre) and delays; they can be added as line options.
2. (Decided: see §14.) Key bindings are the player's, one set for every ship.

## 14. Decisions (16 November 2026, Chloe)

- An engine is one component, shaped by its six numbers.
- Its own page, `blueprint.html`, as the games; linked from the main sandbox.
- Estimates plus a Measure button.
- Each engine's controls are set by the player, never guessed; the control-linking UI needs care,
  as the Thrust ship's mix shows (§10).
- Fuel efficiency is part of the game world, not a cheat: an ordinary property.
- Thrust 1 is the only preset for now: the model ship.
- The controls belong to the cockpit (§10).
- *Eased by* lines and *opposites* rules are enough to start; see how they go.
- **Key bindings are the player's: one set, shared by every ship.** A ship stores only its wiring
  (the mixer). Binding a key in the designer changes it for all ships.

## 15. As built (16 November 2026)

The page is `blueprint.html`, linked from the sandbox's start screen. Code: `src/app/blueprint/`
(model, store, view, panels, controls, Try it), and the core mixer `src/core/mixer.ts`.

| Built | Tests |
|---|---|
| The core mixer: rows of lines, eased lines, opposites, largest / sum / least, limit; in the world step and in scenarios (`world.mix`). The Thrust mix as lines equals `steerValues` for every combination tried. | BPD-010, BPD-011 |
| Thrust 1 preset: the game's ship exactly (ids without `p{n}-`), 17 components, 20 welds of 26 points, 61.2 kg, 5.6 × 3.65 m. | BPD-012, BPD-013 |
| Engine shape from and to six numbers; flow sets the parcel size and the head's store. | BPD-014 |
| Welds by touch: two points 0.1 m in from the ends of a shared side (one if under 0.3 m), as the preset's. Only sides that face each other and share length weld or snap. | BPD-015 |
| Estimated response per control; properties for every part. | BPD-016 |
| Page: one screen at 1280×800 and iPad landscape; select, type, slider, held steppers, label scrub, undo/redo (one step per gesture); weld strength; blueprints drawer; Try it and back. | BPD-017 to BPD-021 |
| Add (drag from the list, double-click, ＋), drag parts, snapping with a green / blue / red preview and weld points, Duplicate, Flip; a warning when the ship is in pieces. | BPD-022, BPD-023 |
| Controls: BUILD / CONTROLS, the player's controls and keys (one set for every ship, bound by pressing a key), the mixer table, a part's lines in words, rules, checks, testing by holding keys. | BPD-024 |

Differences from the design above:

- **Editing a preset makes the copy at once and says so** (a message), rather than asking first:
  one less step, and undo is there.
- **New parts are made from the Thrust 1 preset's parts** (11 in the list). Cockpit shape editing,
  the tractor and tether on a second cockpit, and power for generators and batteries are not built.
- **New engines draw fuel from every tank** (fuel lines are plumbing, not controls); their controls
  stay unwired until the player wires them.
- **Measure (§7), built the same day:** ⏱ Measure (in Performance and Response) runs the real
  physics in a worker, as the design log measures (each control held from rest, no gravity;
  acceleration between 0.5 and 1.5 s, turn between 0.5 and 1.0 s), in about 2.5 s. Measured figures
  show ✓ and stay until the ship or its wiring changes; a design measured before shows its figures
  again. Thrust 1 measures 36.1 m/s² forward, 9.8 reverse and 9.28 rad/s² each way, as
  `docs/ship-designs.md` ("Nozzle walls": 36.1 and 9.8; the 28.3 and 4.2 in older notes are out of
  date). The instant estimate now takes 206 m/s exhaust for a walled engine (76 m/s without walls),
  from the same notes, and comes within 1% (35.9, 9.8, 9.24). Test: BPD-025.
- **Panel toggles (asked for 16 November 2026, for a Galaxy Fold):** two icons in the top bar, as
  most editors have them: at its left end one shows or hides the left panel (components or
  controls), at its right end one the right panel (properties); each is a window outline with that
  side filled while the panel is open. `\` toggles both. A hidden panel gives its width to the
  blueprint. Below 1000 px wide the panels start hidden and open over the blueprint rather than
  narrowing it. The top bar drops its words for icons as it narrows. ▾ folds the performance or
  response table to its header. Kept in the browser. Test: BPD-026.
- **Weld loads from Try it (built 16 November 2026):** while the ship flies, each weld's worst
  load as a share of its limit (and which way: tension, compression, shear or torque) and whether
  it broke are kept for the blueprint as flown. Back on the blueprint the weld points take their
  colour (green, amber from 50%, red from 80%, a cross if broken), the weld panel's LAST TRY-OUT
  shows the figure, and a message names the hardest-worked weld or how many broke. Read each frame
  from the flying world, so a peak between frames can be missed. Test: BPD-028.
- **A game controller in Try it (built 16 November 2026):** as Mammoth Thrust's: the stick turns as
  far as it is pushed; forward is the stick up, the right trigger or A; reverse the stick down, the
  left trigger or B; X or the right bumper fires, Y is the tractor, the left bumper the shield;
  Start pauses. It sets the player's controls, which the blueprint's wiring mixes. Test: BPD-029.
- **Try it, larger, with touch (16 November 2026):** the field is 120 × 75 m (was 60 × 37.5) and
  still wraps; the view follows the ship, showing 60 m of it, and goes on past an edge with it as
  Mammoth Thrust's does. On a touch screen it has Mammoth Thrust's buttons (L and R in the corners,
  both together forward through the wiring; REV, SHIELD, FIRE, BEAM), and FWD for a ship wired
  without that rule (`?touch=1` shows them with a mouse). Tests: BPD-031, BPD-032.
- **Only what is welded to the cockpit answers (16 November 2026):** in Try it and Measure the
  games' damage rules apply (MAS-037, MAS-038, MTH-062; now `src/core/shipRules.ts`, a world's
  `shipRules`): an engine not welded to the cockpit has its fuel line cut, burns off what its own
  store holds on a channel of its own, held on, and is then dead; one still joined to a tank that
  came off with it burns on from that tank until it is empty; the tank leaks where the line left
  it; anything else controlled loses its control links. With no cockpit nothing answers. The
  estimate leaves such parts out, the checks name them, and the mixer's NOW shows them at 0%.
  Test: BPD-030.
- **Components never overlap (16 November 2026):** moving, adding, mirroring and flipping were
  already refused where they would overlap; now a property edit that would push a part into
  another is refused too, with the parts in its way named, and the value goes back. Overlaps that
  are already there (an imported design, or the preset's railgun standing through its shield
  emitter, as in the game's ship) are outlined in red and named under Performance. Test: BPD-035.
- **Actions A, B and C (16 November 2026):** the player's controls are the four movements and Action
  A, B and C (on the keys and pad buttons that were Fire, Tractor and Shield; saved bindings and
  blueprints move over). Each ship wires the actions to what it carries: Thrust 1 has A on the
  railgun, B on the tractor beam, C on the shield. On screen (Try it's touch buttons and its key
  legend) an action is named by the largest thing it drives in that ship (FIRE for a gun, SHIELD,
  BEAM, else the part's name), or by the player's own name for it in that ship, set under the
  action in Controls mode (blank: automatic). Test: BPD-034.
- **Mirror (built 16 November 2026):** ⇋ Mirror on a selected part makes its mirror image across the
  ship's middle line (x = 0): shape, nozzle and internal welds reflected, welded where it touches,
  fed if an engine, named for the other side (BL → BR, L → R) and wired as the mirror of the
  original (turn left and turn right swapped). Refused, with the reason, if that side is taken or
  the part sits on the middle line. Test: BPD-027.

## 16. OG parts and regular parts (16 November 2026, Chloe)

The Thrust game's ship stays as it is: the preset **THRUST OG**, every part an OG part
(`cockpit_og`, `railgun_og`, `magazine_og`, …, the component's `part`), listed under each type
after the regular parts, headed "OG · as Thrust has them". OG parts are never changed; the final
game won't offer them. The **regular parts** start as copies of them and are improved as problems
are found; **THRUST 1** is the same ship built from them.

Improvements so far:

1. **Magazines hold the shells.** In the game the railgun carries its 120 shells (20 kg, on the
   nose) and the magazines hold nothing. A regular magazine stores shells (60 each in THRUST 1;
   "Shells stored" under Function) and passes them to the railguns welded to it, one at a time, by
   an ammo link (WPN-015); the regular railgun holds none of its own. A magazine knocked off the
   ship feeds nothing, and takes its shells with it: the gun draws from the fullest magazine each
   time, so the two empty together and losing one loses half what is left. A magazine blows up
   when destroyed only while it holds shells. Same mass; the centre of mass 0.33 m further back
   and the turn 9.9 rad/s² instead of 9.3 (Measure; forward and reverse unchanged).
2. **The railgun stands on the shield emitter** instead of 0.12 m through it, welded to its top
   (two points). Without its 20 kg of shells it no longer sways there: Measure gives the same
   figures as before the lift, nothing breaking.
3. **Renaming:** click the blueprint's name in the top bar (a preset is renamed as your own copy),
   as well as Rename in the Blueprints drawer.

## 17. The Mastodon Gun Ship, double engines, trapezoids and triangles (16 November 2026, Chloe)

From Chloe's drawing (1 m to its scale bar; `mastodonPreset` in `model.ts`): a preset made of the
regular parts. Symmetrical about the middle line, 6.3 × 2.45 m, 73.9 kg:

- The cockpit (Thrust's, without the beam) over a centre fuel tank (1.2 × 0.65 m).
- A magazine each side (0.4 × 1.4 m, 100 shells), a railgun standing on each.
- A trapezoid fuel tank each side: its long side (1.4 m) on the magazine, its short (0.7 m) on the engine.
- A **double engine** each side, then a trapezoid **mount** out to an outer railgun.
- Wiring: each engine's rear nozzle on Forward, its front nozzle on Reverse. Turning, one engine's
  rear and the other's front nozzle at a quarter. The four railguns are on Action A; the two
  magazines feed all four.
- Measured: 30 m/s² forward and back, 8.9 rad/s² turning, nothing breaking; full burn 39 s.

**Double engine** (the Engines list): one part with two heads back to back, each with its own
nozzle walls, injector and channel (`heads` on the component). It welds to the ship by its heads.
A property change applies to both heads, which stay back to back.

**Trapezoids and triangles** (`form` on the component; the new Frames type, and the trapezoid
tank under Tanks):

- Their properties are Base, Top (a trapezoid's) or Apex along (a triangle's, from the middle of
  the base), Height, and Turn in quarter turns. The base is on the bottom at Turn 0.
- At every turn their straight sides stay exactly square to the grid, so they weld like boxes:
  welds still form only along sides that are square to the grid.
- Resized, their mass and what they hold go with their area. Mirrored, they turn the other way.

Also: a part added from the list now gets its control links, so the wiring reaches it in Try it.
Before, an added engine or gun never fired there. And a shared side of exactly 0.3 m welds at two
points, as the rule says.

Tests: BPD-038 (the Mastodon, the double engine, Try it), BPD-039 (trapezoids and triangles),
BPD-040 (control links on added parts).

## 18. Turning and resizing on the blueprint (16 November 2026, Chloe)

The selected part shows handles (Build mode):

- **A round handle above it turns it**, about its centre, in 15° steps (Shift: 1°). The **Angle**
  property (every part, Shape tab) does the same with a typed value, slider or steppers.
  - A trapezoid's or triangle's **Turn** (quarter turns) is a separate property: it turns the
    outline in place.
- **Squares on its corners and sides resize it**: a box part, or a trapezoid or triangle (along its
  own axes), when it is one body.
  - The corner or side opposite the one dragged stays where it is, at any angle.
  - Sizes snap to 5 cm (Shift: 1 cm).
  - What it weighs and holds goes with its area.
  - Engines and the cockpit keep their own Shape fields.
- One undo step per drag.
- A part never turns or grows into another: it stops at the last place it fitted, and the page
  says what was in the way.

Welds and snapping now work at any angle. Two sides that face each other, lie on the same line
(within 1 mm) and share more than 2 cm weld, by the same points as before. A dragged part snaps
flush to a side at any angle, and to two sides at once when they face different ways. Square
sides weld and snap exactly as before.

Tests: BPD-041 (turning, welding and snapping at an angle), BPD-042 (resizing).

## 19. Design rules, step 1: tanks and magazines (16 November 2026)

The rules of `design-rules-proposal.md` §1–3, as approved, are built in `src/app/blueprint/rules.ts`.
They apply to the regular tanks (box and trapezoid) and magazines; the OG parts keep their
figures.

- **What it holds goes with its inner area:** the outline moved in by the wall on every side.
  - A tank holds 3.89 kg of propellant per m² (H₂ : O₂ 1 : 8).
  - A magazine holds 480 shells per m², rounded down after a 10⁻⁶ tolerance.
- **Its dry mass goes with its wall area:** 4.35 kg per m² for a tank, 15.8 kg per m² for a magazine.
- **Wall thickness is a setting** (Build tab): 0.02–0.3 m, at most a quarter of the smaller side,
  0.1 m by default. In proportion to it go:
  - the container's material (threshold and toughness);
  - its welds: each weld is quality × k × the thinner wall it joins, with Light, Standard and Heavy
    at ×0.5, ×1 and ×2;
  - its weight.
  - Thicker walls leave less room inside.
- **Size limits:** a tank 0.3–3 m each way, a magazine 0.3–2 m. A typed size past them is refused;
  a dragged one stops at them.
- **Its explosion goes with what it can hold.** A magazine with no shells left still doesn't go off.
- **Readouts:** what it holds, dry mass, and strength against Thrust's.

**At the defaults THRUST 1 is unchanged:** 61.2 kg, 36.1 m/s² forward, 9.85 rad/s² turning, every
weld Standard. The Mastodon, its parts now sized by the rules, is 78.5 kg with 5.3 kg of propellant
and 115 shells in each magazine: 28.6 m/s² forward and back, 8.6 rad/s² turning.

Tests: BPD-043 (Thrust's figures at Thrust's sizes; inner areas; exactly 60 shells), BPD-044 (wall
thickness, welds, size limits).

## 20. Design rules, step 2: power (16 November 2026)

The rules of `design-rules-proposal.md` §4, as approved (core: PWR-001…PWR-004, `src/core/power.ts`).

*Figures as first set, in the core's units; rebalance v1 (§32, 18 November 2026) replaced them with
real-world ones.*

- **Battery:** 2,700 kJ per m² of outline (THRUST 1's: 1,620 kJ), 3.3 kg per m², 0.2–2 m each way.
  It starts full; its charge explodes in proportion to its capacity.
- **Generator:** up to 400 kW per m² (THRUST 1's pair: 448 kW), 3.6 kg per m², 0.3–2 m each way.
  - It burns the ship's propellant at 1,000 kJ per kg, only while the batteries have room.
- **What draws power:**
  - the shield: 400 kW while up, and 1.25 kJ per N·s of each hit, at least 25 kJ;
  - each railgun shot: 3.5 kJ (to be raised);
  - the tractor beam: 10 kW while on;
  - the tether: 5 kW while held.
- **A ship with no battery or generator has no power system** and runs as before power existed:
  the games' own ships, THRUST OG, and the Mastodon (which carries neither).
- **Measured:** THRUST 1 holding its shield up burns fuel through its generators within 5% of
  THRUST OG's direct burn. With its generators off, the battery alone holds the shield up about 4 s.
- **On screen:**
  - battery and generator readouts on their parts (Function tab);
  - battery and generator gauges in Try it;
  - in the games, battery charge and generator load bars on the HUD, shown only for a ship that
    has a power system.

Tests: BPD-045, and `tests/core/power.test.ts`.

## 21. Play a design in a game (16 November 2026, Chloe; for debugging)

**Play in…** (top bar) saves the blueprint and opens Mammoth Thrust, Asteroids or Lander with
`?blueprint=1` (`src/app/playtest.ts`).

- Every level that game loads carries the blueprint's ship in place of its own.
- Its parts are numbered as the game's ships are (`p{n}-…`) and laid out round its cockpit.
- Its hull, gun, beam and tank are named for the game.
- Its own wiring drives it: Actions A, B and C on the game's fire, beam and shield controls.
- The game's title (Lander: its level list) and pause menu offer **Back to blueprint**.
- Opened normally, the games are unchanged. This is not the players' path.

Test: BPD-046.

## 22. The gun and the bullet magazine (16 November 2026, Chloe)

The Mastodon carries no power system, so its railguns had no energy to fire. It now carries
chemically propelled guns.

- **Gun** (Weapons):
  - It fires bullets launched by their own propellant, so it needs no power.
  - Its muzzle speed comes from its barrel's length, its height: 150 m/s at 0.7 m (600 m/s from
    2.8 m in the game), going as the square root of the length. The propellant's push over the
    barrel gives v² ∝ length.
  - *As first set (16 November 2026): 100 m/s at 0.7 m, slower than the railgun of then (144 m/s).*
  - *Chloe, 19 November 2026: 50% faster (the Mastodon's bullets bounced off everything): 31 MJ a
    bullet in the game, from 13.7.*
  - *Chloe, 19 November 2026: projectiles are discs.* The bullet is a disc of the area of the 0.22 m
    square it was (0.99 m across in the game), and so is THRUST 1's railgun shell (0.52 m across, the
    area of its 0.5 × 0.42 m box). A disc has no corners to catch and tumble on, and is the cheaper
    shape to collide (disc–polygon, one contact point, an exact broad-phase circle). Saved designs'
    shells and bullets are made discs as they load (`withCurrentRules`). Other projectiles may have
    other shapes later.
  - Its muzzle moves with the barrel's end.
- **Bullet magazine** (Storage):
  - It follows the magazine's rules (§19), but a bullet's cartridge takes twice the room: 240
    bullets per m² of inner area, against 480 shells.
  - It feeds the guns welded to it. Bullets and railgun shells don't mix.
- **The Mastodon:** four guns and two bullet magazines, 57 bullets each.

Test: BPD-047.

## 23. Engines with chambers (16 November 2026, Chloe)

Every regular engine now has a real chamber (design rules §5, the geometry half). THRUST OG's
engines, a head and two flared walls whose chamber is a 9 cm slab, are kept as they are. So is the
double engine, whose heads are box chambers.

- **A rocket** (`buildRocket`, the component's `rocket`): a head, two chamber walls, two throat
  pieces closing the chamber to a throat narrower than it, and two nozzle walls. Each is welded to
  the one before, Standard for its 0.1 m walls.
  - Each throat piece and nozzle wall is also welded to the head, at the same point (Chloe, 16
    November 2026). Welded only in a chain, the light pieces two or more welds from the head could
    not hold their angles under the chamber's pressure, and the walls flapped, closed the throat and
    broke away (55° in a 10 s flight). Held by the head as well, they stay within 0.2°, as THRUST OG's
    walls do (0.08°).
  - Its shape is set in Shape: chamber width and length, head depth, throat, nozzle length and
    flare, and wall thickness.
  - What follows is shown:
    - chamber pressure, ṁ · c* ÷ throat;
    - the area ratio;
    - L*, the chamber's area over the throat;
    - the chamber walls' margin against their welds.
- **In flight:**
  - The physics finds the enclosed chamber and holds its gas as one volume, at the pressure the
    throat sets; its walls carry that pressure into their welds.
  - The jet is the throat's, so at the same burn rate an engine pushes as THRUST OG's does.
  - The nozzle's gain and the L* penalty come with the nozzle physics (§5, still to do).
- **THRUST 1:**

  | Engine | Chamber | Throat | Nozzle | Area ratio | Pressure |
  |---|---|---|---|---|---|
  | Main | 1.2 × 0.2 m | 0.8 m | 1.1 m to the same 1.5 m exit | 1.87 | 1,143 N/m |
  | Light thrusters | 0.8 × 0.1 m | 0.5 m | 0.7 m to the same 0.84 m exit | | |

  - Each engine keeps its mass: the head gives up what the new walls weigh.
  - The wing tanks are 0.8 m tall, not 1.0, to make room for the light thrusters' chambers.
- **Measured against THRUST OG:**

  | | THRUST OG | THRUST 1 |
  |---|---|---|
  | Weight | 61.2 kg | 58.8 kg |
  | Fuel | 8.10 kg | 6.08 kg |
  | Forward | 36.1 m/s² | 37.4 m/s² (36.1 with working nozzles, §27) |
  | Reverse | 9.8 m/s² | 10.2 m/s² (9.7, §27) |
  | Turn | 9.3 rad/s² | 11.3 rad/s² (9.8, §27) |

  The ship is lighter, and lightest at its wings.

Test: BPD-048.

## 24. The Stegodon (Chloe's sketch, 16 November 2026)

A lighter gunship (`stegodonPreset`), using the Mastodon's cockpit for scale. It is the first angled
layout.

- **Down the middle:**
  - the cockpit;
  - a bullet magazine across the ship (1.2 × 0.3 m, 24 bullets);
  - a fuel tank (1.2 × 0.95 m, 2.9 kg);
  - a trapezoid taper to a 0.3 × 0.9 m boom;
  - a small double engine across the tail. It is the smallest engine yet: 0.3 m heads, 0.4 m
    nozzles, 0.5 kg/s each. It fires left and right to steer.
- **Each side:**
  - **A main engine,** a rocket (0.8 × 0.6 m chamber, 0.25 m throat, 1.0 m nozzle, 3.4 kg/s),
    angled out 36.87°: the slope of the cockpit's top corners. Its head and chamber wall lie along
    that slope and weld there. Rockets now weld by their chamber walls as well as their heads, so an
    angled engine can lie along the ship.
  - **A triangular side magazine** in the wedge between the engine and the cockpit (20 bullets).
  - **A gun** outboard of the engine, on a triangular mount that welds its upright side to the
    engine's angled one.
- **Wiring, as drawn:**
  - forward fires both main engines;
  - a turn alone fires the tail;
  - forward with a turn fires one main engine and the opposite side of the tail.
  - There is no reverse. The guns are on Action A. It has no power system.
- **Measured:** 44.1 kg; 31.8 m/s² forward (26.2 with working nozzles, §27); 6.0 rad/s² turning on the tail alone.
  - Forward with a turn is much stronger: 24 rad/s², one main engine being far off the centre of
    mass.
  - Held for 1.4 s it spins the ship to 35 rad/s, and the turning main engine's head-to-chamber
    weld breaks under the twist.
- A container that can hold nothing has no explosive charge (the taper is a frame).

Test: BPD-049.

## 25. The Phiomia (16 November 2026, Chloe)

The simplest ship (`phiomiaPreset`), using the Mastodon's cockpit for scale.

- **Down the middle:**
  - the cockpit;
  - a fuel tank on its top, as wide (0.6 × 0.7 m, 0.78 kg);
  - a spine (0.15 × 0.9 m) up to a crossbar (1.7 × 0.15 m). Both are frames: structure only.
- **At each end of the crossbar, a small rocket** hanging down, firing past the cockpit's sides:
  - 0.5 m chamber, 0.35 m long; 0.25 m throat; 0.5 m nozzle; 0.3 kg/s.
  - Its head is level with the crossbar and welded to its end.
- **Wiring:**
  - forward fires both engines;
  - a turn fires the engine on its own side: Left, the left engine (Chloe, after flying it). The
    cockpit hangs below the engines, so Left swings the cockpit to the left, the engines' end to
    the right (clockwise). The other presets turn the other way: their cockpit is at the front.
  - forward with a turn fires that engine alone.
  - There is no reverse, no weapon and no power system.
- **Measured:** 12.6 kg; 11.6 m/s² forward (THRUST OG: 36); about 4.9 rad/s² turning, both ways alike.
  With working nozzles (§27): 7.4 m/s² forward and 2.8 rad/s² turning, and forward alone no longer
  turns it (its jets no longer cling to one side of the throat).
  - The tank gives about 80 s of full forward, at the game's fuel economy of 66.
  - It holds together: no weld breaks in a 20 s flight, forward and turning, and its parts stay
    within 1.3° of each other.
  - A turn held for many seconds spins it up past 30 rad/s, and an engine then tears off the
    crossbar, as it would from any of the presets.
- **Why a 0.25 m throat, not the sketch's narrower one:**
  - The exhaust is gas parcels about 0.07 m across, so a 0.15 m throat is two parcels wide. The jet
    through it is lumpy and clings to one side.
  - Both engines are exact copies in a deterministic simulation, so they cling to the same side, and
    the errors add up instead of cancelling.
  - With a 0.15 m throat, forward alone turned the ship at 2.6 rad/s² and pushed it sideways at
    2.3 m/s². At 0.25 m those are 0.2 rad/s² and 0.25 m/s².
  - The narrowest throat a small engine should have is about four parcels (0.25 m).

Test: BPD-050.

## 26. The Loxodon (16 November 2026, Chloe)

A light transport and lander (`loxodonPreset`), using the Mastodon's cockpit for scale.

- **Each side of the cockpit:**
  - **A side tank:** a trapezoid 0.275 m wide, its 0.75 m base along the cockpit's side and its
    0.5 m top along the engine's.
  - **An engine** outboard of it: a 0.5 m square housing (head, 0.3 m chamber, throat pieces) and
    a 0.45 m nozzle flared out to 0.54 m. The nozzles hang 0.33 m below the cockpit: they are its
    legs. 0.4 kg/s; throat 0.25 m (§25).
  - **A top tank** over the engine and the side tank, up to three quarters of the way up the
    cockpit's sloping corner, its roof straight from there to the engine's outer top corner.
    - It is a thin wedge, about 0.19 m deep at most, so 0.1 m walls would fill it: its walls are
      0.05 m.
- **Wiring, gentle for landing:**
  - forward fires both engines;
  - a turn alone runs the far engine at 40%;
  - forward with a turn runs both, the near one eased to half, so the ship keeps lifting as it
    turns.
  - There is no reverse, no weapon and no power system.
- **Measured:** 12.1 kg; 14 m/s² forward, going straight (the lander levels' gravity is 1.6);
  4.6 rad/s² turning alone, both ways alike; 5.8 rad/s² forward with a turn. With working nozzles
  (§27): 13.7 m/s² forward, 4.5 rad/s² turning.
  - 0.57 kg of fuel: about 47 s of full forward.
  - It holds: no weld breaks in a 20 s flight, and its parts stay within 0.01° of the cockpit.
- **Two rule fixes it needed:**
  - **A tank's inside** (`innerArea`) is now the outline cut back by each wall. A short side the
    walls swallow drops out. Before, any such side made the inside zero: the top tank held
    nothing. Every earlier part's figures are unchanged.
    - Mastodon's `tank-l` at a 0.3 m base, 0.05 m top, 0.3 m height and 0.075 m walls now holds
      its true 0.0034 m² inside; before, it read as empty.
  - **Into the physics** (`centredShip`, used by Try it, the measurements and Play in): each
    polygon part's outline goes about its centroid, and its welds' anchors move to match.
    - The world moves a polygon to its centroid but takes weld anchors as given. An outline drawn
      about any other point (a form's bounding box; the Mastodon's cockpit) started with its welds
      out of place, and the first step jolted the parts into line.
    - At rest, the Loxodon's engines jolted 5.1°, the Phiomia's 2.9°, the Stegodon's 1.2°. Now
      nothing moves.
    - The games' own ships are untouched. The same flaw is in the core and moves the Mammoth's
      nose 0.84 m back in its first step: a fix there is for Chloe to decide.

Test: BPD-051.

## 27. Working nozzles (16 November 2026, Chloe)

The regular rockets' nozzles now work (design rules §5; `docs/spec.md` PRP-012). Only the new
engines change: **the OG engines, the double engine and every game's ships keep the throat's jet,
exactly as before** (THRUST OG measures 36.10 m/s² forward either way).

- `buildRocket` declares each rocket's nozzle on its head (`injector.nozzle`: length, half-angle and
  its two walls); `instantiate` renames the walls with the part.
- In flight the exhaust leaves at the nozzle's exit, faster and cooler; the nozzle's pressure loads
  its walls' welds. If a nozzle wall comes off, the jet leaves at the throat again.
- **Measured alone**, each rocket is within −4% to +8% of the textbook nozzle. The throat jet it
  replaces ran 23–41% over its own theory, more for narrow throats, so the presets change:

  | | Before | With working nozzles |
  |---|---|---|
  | THRUST 1 forward / reverse / turn | 37.4 m/s² / 10.2 / 10.5 rad/s² | 36.1 / 9.7 / 9.8 (THRUST OG: 36.1 / 9.8 / 9.3) |
  | Stegodon forward | 28.8 m/s² | 26.2 |
  | Phiomia forward / turn | 11.6 m/s² / 4.9 rad/s² | 7.4 / 2.8 |
  | Loxodon forward / turn | 14.0 m/s² / 4.6 rad/s² | 13.7 / 4.5 |
  | Mastodon (double engines) | 37.9 m/s² | 37.9 (unchanged) |

- The L* rule and the pressure ceilings followed (§28).

Tests: PRP-012 (`tests/core/nozzle.test.ts`, `tests/app/nozzle.test.ts`).

## 28. Pressure ceilings and the L* rule (17 November 2026, Chloe)

The trade-offs for a powerful engine (design rules §5 and §8, decisions 7 and 8). Thrust is about
chamber pressure × throat width × the nozzle's factor, so more thrust takes a bigger throat (a
bigger, heavier engine), a better nozzle, or more pressure. Pressure now has a price:

- **Walls hold pressure:** 2 × 25,700 N/m × thickness ÷ span (the thin-wall rule). A long, thin-walled
  tank holds the least.
- **A pressure-fed engine** runs its chamber at most at its weakest feeding tank's hold ÷ 1.5, and at
  most at what its own walls hold. The **burn rate stops at that ceiling** (its slider's top), and an
  edit that lowers the ceiling (thinner or longer tank walls, a narrower throat) brings the flow
  down and says so.
- **Properties** shows each rocket's pressure ceiling, what sets it and how much of it it uses, its L*,
  and how completely it burns.
- **The L* rule:** below an L* of 0.30 m a chamber burns √(L* ÷ 0.30) of its propellant's energy,
  never under 70% (`injector.efficiency`; the rest stays as heat). Measured, a 0.1 m main chamber on
  THRUST 1 (L* 0.15, 71%) gives the main engine about 79% of its push: some of the heat still
  pushes as the plume's pressure. THRUST 1's light thrusters' chambers are now 0.19 m (L* 0.304).

| Ship | Ceiling (set by) | Its engines now | Most flow |
|---|---|---|---|
| THRUST 1 | 2,284 N/m (wing tanks) | main 50%, light 16% | main 15.5 kg/s (7.8), light 9.7 (1.51; 1.45 until 18 November) |
| Stegodon | 2,856 (its tank) | 56% | 6.1 (3.4) |
| Phiomia | 4,895 (its tank) | 3% | 10.4 (0.3) |
| Loxodon | 1,577 (top tanks, 0.05 m walls) | 12% | 3.35 (0.4) |

- At its ceiling THRUST 1's main engine doubles its push: the ship goes from 36.1 to 61.7 m/s²
  forward. To triple it, the wing tanks need 0.15 m walls: about 23% less fuel and 43% more dry
  mass.
- THRUST 1 flew as before: 36.1 m/s² forward, 9.7 rad/s² turning, 58.8 kg (at the time; for its
  figures since the light thrusters went to 1.51 kg/s, see the note after §31).

Tests: BPD-052 (`tests/app/pressure.test.ts`).

## 29. The drop test and what it found (17 November 2026, Chloe)

Chloe: THRUST OG's damage is "incredibly good". Dropped on Thrust's first level, one engine part takes
a hit, the engine fires and the part falls off: enough to make flying annoying without crippling the
craft. THRUST 1 just bounces, it looks too bendy, and the light presets are nearly indestructible.

**The drop test** (`dropTest`, `src/app/blueprint/droptest.ts`; `pnpm drop` prints the table) lets each
preset fall on Thrust's first level with no input, as it falls in the game and 8 m/s harder:

| Ship | Landing | Energy lost (J) | Through contacts | Biggest hit (J) | Integrity lost | Welds broken | Most flex before a break |
|---|---|---|---|---|---|---|---|
| THRUST OG | 12.8 m/s | (its engine fires after) | 3,772 | 445 | 0.16 | 4: battery–main, battery–hull, main nozzle wall b, generator–battery | 0.4° |
| THRUST 1 | 12.7 m/s | 4,843 | 394 (8%) | 69 | 0 | 0 | 23.6° (main nozzle wall) |
| MASTODON | 13.0 m/s | 4,810 | 1,058 (22%) | 236 | 0.03 | 4 (tank–magazine) | 0.6° |
| STEGODON | 12.5 m/s | 3,703 | 406 (11%) | 27 | 0 | 0 | 47.6° (tail engine) |
| PHIOMIA | 13.3 m/s | 1,103 | 478 (43%) | 123 | 0 | 0 | 14.4° (nozzle wall) |
| LOXODON | 13.2 m/s | 1,071 | 316 (29%) | 60 | 0 | 0 | 3.0° |

Energy is with each part's whole mass (fuel, shells and chamber gas too); a hit is half a pair's
contact energy for the step, as the damage rule takes it.
A part is damaged only by a hit over its threshold (150 J for hull and engine parts) in one step, and
a weld only breaks when its load passes its limits.

**What it found:**

1. **The damage rule only sees contacts.** THRUST 1 loses about 4,800 J landing, but only 8% passes
   through its contacts with the ground; the rest is taken up inside the ship, by the welds as its
   parts bend. No hit reaches 150 J. THRUST OG takes its landing through its contacts (445 J on its
   nozzle wall) and breaks.
2. **The rockets are the cause.** Rebuilding only THRUST OG's main engine as a rocket drops its contact
   energy from 3,692 to 358 J and nothing breaks. Without the star welds it is a little better (28–35%),
   but not much.
3. **Parts bend while their welds are barely loaded.** THRUST 1's main nozzle wall turns 23° over about
   30 steps on landing, its welds at 2–18% of their limits, and stays bent (about 9.5°) while the ship
   rests on it: the contact's position correction wins over the weld's. THRUST OG's nozzle wall stays
   true (0.4°) until its weld overloads, then snaps.
4. **THRUST OG's damage is a property of the solver as it is.** With more solver iterations (10 is the
   game's), THRUST OG loses 10 welds (40 iterations) or 13 (160), and THRUST 1 starts breaking. So the
   OG ship's feel depends on today's solver: any change to it must keep THRUST OG's drop as it is
   (BPD-053 pins it).
5. **Light ships are tough for free.** The damage threshold (150 J a part) and weld limits (22,950 N at
   0.1 m walls) don't depend on a ship's mass, but a landing's energy does; a weld costs nothing.
6. **Tried and dropped:** each chamber wall and throat piece as one piece (5 bodies an engine, not 7):
   no change (354 J, 27°). Heavier chamber pieces: hits over 150 J again, but contacts chattered.
   Single-point welds, lighter nozzle walls: no better. Welded parts turning with their group: no change.

**The cause, found and fixed (DMG-009):** the solver's last act on velocities each step is the
contacts' restitution. A part that strikes something is stopped there on its own, after its welds
were solved; the welds then drag the rest of the ship to a stop over the next steps, bending the part
and taking the impact where damage never sees it. Solving the same welds again after the restitution
everywhere made THRUST 1 land like THRUST OG, but changed the games (six of their tests). So it is a
weld's choice: **stiff welds** are solved again after the contacts; every weld the designer makes is
stiff when it goes into the physics (`physicsShip`), except welds on OG parts. Worlds without stiff
welds solve exactly as before: every game test passes, and THRUST OG's drop is to the digit what it was.

| Ship (game landing) | Before | With stiff welds |
|---|---|---|
| THRUST OG | 4 welds, 0.16 integrity, 0.4° | the same |
| THRUST 1 | nothing; 8% through contacts; bends 24° | battery's welds tear, its engine fires and kicks it up (as THRUST OG's does); 0.51 integrity; bends 1° |
| MASTODON | 4 welds | 7 welds |
| STEGODON | nothing; its tail bends 48° | nothing; 39° |
| PHIOMIA | nothing; 14° | nothing; 20° |
| LOXODON | nothing | nothing |

**Then:** welds weigh something (§30), and the light ships' welds are Light.

Tests: BPD-053, DMG-009 (`tests/app/droptest.test.ts`).

## 30. Welds weigh something (17 November 2026, Chloe)

"Welds shouldn't be free": the light ships were near-indestructible because a Standard weld held a
12 kg ship as firmly as a 60 kg one, at no cost.

- **A weld point is a fillet bead of the walls' own material** (`weldPointMass`): a right triangle
  with legs quality × the thinner wall, at the walls' 6.8 kg/m². Strength grows with the weld's
  quality, its metal with the square:

  | Weld (0.1 m walls) | Strength | Mass a point |
  |---|---|---|
  | Light | ×0.5 | 0.0085 kg |
  | Standard | ×1 | 0.034 kg |
  | Heavy | ×2 | 0.136 kg |

- **Only the welds between parts weigh** (`weldMasses`): half of each point on each part it joins, in
  the ship's mass (Performance, Measure) and in the physics. Welds inside a part are in its mass, and
  welds on OG parts are free: THRUST OG weighs 61.2 kg as ever.
- **The weld's panel** shows what it weighs, and what each strength would.
- **The Phiomia and the Stegodon have Light welds** between their parts (Chloe's choice).

| Ship | Mass (welds) | Dropped on Thrust's first level |
|---|---|---|
| THRUST OG | 61.20 kg (free) | as ever: 4 welds |
| THRUST 1 | 60.26 kg (1.43) | its battery's welds tear, its engine fires |
| MASTODON | 60.42 kg (1.30) | 7 welds |
| STEGODON | 44.36 kg (0.29, Light) | 5 welds: its tank, taper and centre magazine come away, and the tail with them |
| PHIOMIA | 12.68 kg (0.05, Light) | 2 welds: its tank comes off the cockpit, and everything above it |
| LOXODON | 12.59 kg (0.44) | nothing (it lands on its nozzles) |

Tests: BPD-054 (`tests/app/weldmass.test.ts`).

## 31. Weld sizes by ship size (17 November 2026, Chloe)

"There should be a rule that there is a minimum number of components before medium, and higher still
before heavy welds can be added."

- **By the ship's number of parts** (`WELD_UNLOCK`): under 8, Light welds only; from 8, Standard;
  from 15, Heavy.
- **The weld panel** shows the sizes the ship can't use yet greyed out, with what they need ("Needs a
  ship of 8 parts or more (this one has 6)").
- **Stepping down** (`capWelds`): an edit that leaves a weld stronger than the ship may now use (parts
  removed, a weld set by its limits) brings it down to the strongest size allowed, and the designer
  says so. Welds on OG parts are left as they are.
- **The presets:** the Phiomia (6 parts) and the Loxodon (7) are Light; the Stegodon (14) is Light by
  choice (§30); the Mastodon (14) and THRUST 1 (17) are Standard. The Loxodon, now Light, still
  loses nothing when dropped: it lands on its nozzles.

Tests: BPD-055 (`tests/app/weldsize.test.ts`).

**THRUST 1's light thrusters, 18 November 2026 (Chloe):** reverse, and flying on the light thrusters
alone when the main engine is lost, felt lacking against THRUST OG's. Their flow is raised from 1.45
to 1.51 kg/s each (`LIGHT_RATE`), which brings reverse to THRUST OG's: 9.82 m/s² (THRUST OG 9.81, 9.43
before). Forward is 35.7 m/s² (THRUST OG 36.1) and turning 9.9 rad/s² (9.3).

## 32. Rebalance v1: the pilot, the railgun, real-world power (18 November 2026, Chloe)

As agreed in `docs/rebalance-v1.md`; figures in the game's units (the designer keeps the core's
inside: `src/app/blueprint/rules.ts`). Only the regular parts change: THRUST OG is as it was.

- **The pilot:** a woolly mammoth cow, 4 t, in every regular cockpit (`PILOT`). Her mass is the
  cockpit's, counted once (`Component.pilot`); the cockpit's Mass field is without her, and a
  read-only Pilot field shows her. PERFORMANCE shows the ship with and without her: THRUST 1
  65.71 t, 61.71 t without.
- **The railgun's shell:** 40 kg at 1,200 m/s (28.8 MJ; it was 171 kg at 576 m/s), its size going
  with its mass (0.5 × 0.42 m). A shot draws its energy at 40%: 72 MJ, and follows the muzzle speed
  when it is set.
- **Magazines:** 256 shells in THRUST 1's (the same mass as the 60 old ones); the blast as before.
  Bullet magazines are unchanged: a bullet is the old shell's mass, taking twice its room.
- **Battery:** 450 Wh/kg, THRUST 1's 3.32 GJ (2.048 t); about 46 shots. Its blast is as before.
- **Generators:** 12.5 kW/kg, 25.6 MW each, from 7 MJ a kg of propellant (about 3.7 kg/s each at full).
- **Shield:** up, it drains THRUST 1's battery in 20 s (166 MW); with its generators running, about
  29 s. Each hit costs the energy it brings at 25% (PWR-004 `hitEfficiency`: ½ μ v², the closing
  speed along the contact, μ the reduced mass of what struck and the whole ship): a new shell,
  about 115 MJ.
- **Tractor:** the beam 60 MW, the tether 20 MW.
- **Measured with the pilot:** THRUST 1 134 m/s² forward (it was 144), 9.8 rad/s² turning; the
  Phiomia about 22.6 m/s² forward (29.6), the Loxodon about 41 (56).

- **Saved designs:** one saved or imported from before the rebalance (a regular cockpit with no
  pilot) is brought up to it as it loads (`rebalanceV1`): its regular railguns' and magazines' old
  shells become the new ones (a railgun at the old 144 m/s goes to the new speed; another speed is
  kept), its pilots go aboard, and every rule is applied again.
- Resizing a part keeps its pilot's mass as it is: only the part's own goes with its area.
- **Shield emitter (Chloe, 18 November 2026, after the rebalance):** THRUST 1's is 3 t (it was
  0.31 t) and twice the tether winch's size, two winches side by side: 4.4 × 1.6 m, its bottom
  where it was, the railgun lifted onto it. THRUST 1 is then 68.40 t full, 64.40 t without the
  pilot; 129 m/s² forward, 9.5 rad/s² turning. The parts round it are to be rearranged later.
- **After the first play (Chloe, 18 November 2026; `docs/rebalance-v1.md`):** THRUST 1 carries 100
  shells, 50 in each of two 1.25 m square magazines (walls 0.31 m, a quarter of the side; armour
  and welds 78%); the generators are 50 kW/kg (102 MW each), holding the shield up; and a crash is
  one shield hit, not one for each bounce of the elastic field (PWR-004). THRUST 1: 47.96 t full,
  43.96 t without the pilot; 184 m/s² forward, 11.6 rad/s² turning.
- **After the second play (Chloe, 18 November 2026):** the shield draws twice as much while up
  (332 MW: THRUST 1's battery in 10 s alone, about 26 s with its generators), and each hit costs
  its energy at 12.5% (twice as dear).
- **The Phiomia's and Loxodon's engines (Chloe, 19 November 2026):** both struggled with the 4 t
  pilot aboard. The Phiomia's flow is doubled (0.6 kg/s each in the designer's units): 44.9 m/s²
  forward in the game, 4.9 rad/s² turning, its beams still holding. The Loxodon's is 50% up (0.6):
  61.8 m/s² forward, 6.1 rad/s² turning.
- **The shield by its emitter's area (Chloe, 19 November 2026; `SHIELD`, `shieldSpec` in rules.ts):**
  only the area counts, as for every part. A field of radius R needs an emitter of at least 7.04 m² ×
  (R ÷ 17.8 m)² in the game; its oversize (area ÷ that least) makes it efficient:
  - draw while up: 664 MW × (R ÷ 17.8 m) ÷ oversize (with the field's edge);
  - hit efficiency: 6.25% × oversize, at most 50%;
  - mass: 426 kg per m² (THRUST 1's 3 t);
  - an emitter too small for the field asked of it projects only what it can: the radius is cut.
  The emitter's Function tab shows the least area for its field, its draw and its hit efficiency.
  **Several emitters make one shield** (Chloe, 19 November 2026; SHD-007): their areas are summed,
  and every emitter gets the shield of that total, at the largest field radius asked of any (setting
  one's radius sets them all). In the game the first that can holds the one field and the others
  stand by, drawing nothing; one takes over if that one is lost. Two of THRUST 1's emitters: half
  the draw and twice the efficiency.
  THRUST 1 keeps the least (7.04 m², 3 t): 664 MW (its battery alone 5 s, with its generators about
  7 s), hits at 6.25%. Twice the area halves the draw and doubles the efficiency (14 m², 6 t: the
  shield it had before); four times (28 m², 12 t), its generators hold it up.
- **THRUST 1's layout (Chloe, 19 November 2026):** the shield emitter is just under the cockpit, as
  wide as it (4.8 × 1.47 m in the game), with the battery and the main engine moved down 1.47 m
  under it; the railgun stands on the cockpit's top, 1.6 m lower than it was. 48.03 t full, 44.03 t
  without the pilot; 184 m/s² forward.
- **Saved designs load with today's rules** (`withCurrentRules`): every rule is applied again as
  a design is loaded or imported, so the figures that follow from them (power, the shield, the
  railgun's shot, the tractor, what containers hold, the pilot) are today's however they have been
  retuned since it was saved. Nothing the player sets is touched: those figures are read-only.

Tests: BPD-036, BPD-043, BPD-045, BPD-047, BPD-050, BPD-051.

## Sources

- Apple Human Interface Guidelines, Sliders (pair a slider with a text field and stepper):
  <https://developer.apple.com/design/human-interface-guidelines/sliders>
- NN/g, Input steppers: <https://www.nngroup.com/articles/input-steppers/>
- W3C, Understanding WCAG 2.2 SC 2.5.8 Target Size (Minimum), 24 CSS px:
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
- KSP wiki, Centre of mass and Centre of thrust markers: <https://wiki.kerbalspaceprogram.com/wiki/CG>,
  <https://wiki.kerbalspaceprogram.com/wiki/CoT>; RCS Build Aid: <https://github.com/m4v/RCSBuildAid>
- EdgeTX manual, Mixes (weight, offset, add / multiply / replace lines):
  <https://manual.edgetx.org/bw-radios/model-select/inputs-mixes-and-outputs/mixes>
- This repo: `src/core/arcade.ts` (`steerValues`, `MixRow`); `docs/spec.md` §8 (sandbox UI principles), §9.5 (propulsion, PRP-011);
  `docs/ship-designs.md`; `docs/games/mammoth-asteroids.md` (28.3 m/s² forward, 4.2 reverse,
  3.5 rad/s² turn); `docs/games/mammoth-thrust.md` (about 7 rad/s² with the tractor and tether).
