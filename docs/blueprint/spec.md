# Blueprint designer — specification (draft for discussion)

Status: **draft, 16 November 2026; decisions of the same day in §14.** Nothing is built yet. Mockups are in [`mockups/`](mockups/)
(PNG, plus the HTML they are rendered from: `python3 make.py && node shoot.mjs` in that folder).
The ship in every mockup is drawn from the real Thrust ship (`scenarios/thrust-1.json`,
`world.thrust.ship`), so its shapes, weld points and centre of mass are true. Performance
numbers marked *est.* are placeholders until the calculations below exist.

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

- Rotating components (handle + 15° snap) and triangular/wedge components to join at angles.
- Resizing by dragging handles on the blueprint (for now: by the SHAPE fields).
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
