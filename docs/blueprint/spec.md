# Blueprint designer — specification (draft for discussion)

Status: **draft, 16 November 2026.** Nothing is built yet. Mockups are in [`mockups/`](mockups/)
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
| Top bar | ☰ Blueprints menu · drawing name and state (PRESET / EDITING, ● unsaved) · undo/redo · overlay toggles (CoM, Thrust, Welds, Dims, Snap) · Fit · **▶ TRY IT** | all |
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
| Cockpit | 1 polygon | width, height, nose width, nose length | tractor (if fitted here): range, arc, force | material, mass | channels it drives |
| Engine | head + 2 nozzle walls | chamber width, chamber length, throat width, wall thickness, nozzle wall length, nozzle flare | flow (kg/s, the sketch's "burn rate"), mixture H₂:O₂, igniter, economy | material, mass (derived) | control channel / role, feeds (which tanks) |
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
| Width × height | bounding box (Thrust: 5.2 × 3.6 m) |
| Accel. forward / reverse | thrust of the engines in each role ÷ mass |
| Turn | net torque of the turn engines about the centre of mass ÷ moment of inertia |
| Thrust ÷ mass | in g |
| Full-burn time | propellant ÷ total flow of the forward engines |
| Joins | welds and parts (Thrust: 20 welds, 26 weld points, 17 components) |

**Thrust per engine.** Instant estimate from the engine's flow and the choked-throat model
(PRP-011: jet ṁ·c*·(1 + 1/γ)), corrected by a factor per engine type; plus a **Measure** button
that runs the real simulation headless in the worker for a second (as `docs/ship-designs.md`
measures) and replaces the estimates with measured values, marked as such. Recommended because the
real thrust depends on the nozzle walls in ways the formula misses (`docs/perf/gpu-gas-phase0.md`).

Overlays: centre of mass (marker as KSP's), thrust arrows sized by thrust, weld points, dimension
lines on the selection, grid snap. Later: centre of thrust, as KSP and its RCS Build Aid mod show.

## 8. Blueprints (mockup 04)

☰ BLUEPRINTS opens a drawer over the left of the screen: New blank, Duplicate, Rename, Export
(JSON file), Import, Delete; filter All / Mine / Presets; a card per blueprint with a thumbnail, its
mass, acceleration and engine count.

- **Presets** ship with the game and cannot be changed. Editing one asks once, then makes "<name>
  copy" and edits that. First preset: **Thrust 1**, exactly the Thrust ship. Later: Asteroids ship,
  Lander, Gunship 3, Mammoth (`docs/ship-designs.md`).
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
- controls as Mammoth Asteroids/Thrust (forward, turn, reverse, fire, tractor, shield), mapped to
  the engines by the role each engine has in its LINKS tab;
- nothing in the try-out changes the blueprint. Back returns to the blueprint exactly as left
  (selection, zoom, tab).

## 10. Later (designed for, not built now)

- Rotating components (handle + 15° snap) and triangular/wedge components to join at angles.
- Resizing by dragging handles on the blueprint (for now: by the SHAPE fields).
- Damage and repair: the blueprint of a damaged ship shows lost parts as dashed outlines to rebuild.
- Cost and build limits for the game proper.

## 11. Requirements (to be numbered BPD-xxx and traced to tests when agreed)

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
10. Thrust 1 is a preset identical to the Thrust game's ship (same bodies, joints and links).

## 12. Questions for you (with my recommendation)

1. **Engine as one component with six shape numbers** (recommended), rather than placing chamber,
   throat and walls separately. Separate pieces could come later as an "advanced" mode.
2. **Where it lives:** its own page, `blueprint.html`, like the games (recommended), reachable from
   each game later.
3. **Stats:** instant estimates plus a Measure button that runs the real physics (recommended), or
   estimates only.
4. **Engine roles for Try it:** each engine gets a role (forward, reverse, turn left, turn right,
   or a combination like the Thrust ship's front thrusters) chosen in LINKS, defaulting from where
   the engine sits relative to the centre of mass (recommended).
5. **Economy cheat:** keep the Thrust ship's ×66 fuel economy in the preset and show it as a BUILD
   field, or hide it from the player?
6. **Mixed preset list:** include the other five ships as presets in the first version, or Thrust 1
   only (as you asked) and add them after?

## Sources

- Apple Human Interface Guidelines, Sliders (pair a slider with a text field and stepper):
  <https://developer.apple.com/design/human-interface-guidelines/sliders>
- NN/g, Input steppers: <https://www.nngroup.com/articles/input-steppers/>
- W3C, Understanding WCAG 2.2 SC 2.5.8 Target Size (Minimum), 24 CSS px:
  <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>
- KSP wiki, Centre of mass and Centre of thrust markers: <https://wiki.kerbalspaceprogram.com/wiki/CG>,
  <https://wiki.kerbalspaceprogram.com/wiki/CoT>; RCS Build Aid: <https://github.com/m4v/RCSBuildAid>
- This repo: `docs/spec.md` §8 (sandbox UI principles), §9.5 (propulsion, PRP-011);
  `docs/ship-designs.md`; `docs/games/mammoth-asteroids.md` (28.3 m/s² forward, 4.2 reverse,
  3.5 rad/s² turn); `docs/games/mammoth-thrust.md` (about 7 rad/s² with the tractor and tether).
