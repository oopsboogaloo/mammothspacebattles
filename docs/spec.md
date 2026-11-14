# Mammoth Space Battles — Physics Sandbox Specification

**Status:** Draft for review
**Version:** 0.2
**Date:** 2026-11-03
**Supersedes:** `docs/ears-requirements.md` v0.1 (see git history at `5196811`)

## 1. Purpose and Direction

Mammoth Space Battles will eventually be a 2D space-combat, mining and ship-design game. Ships are built from physically simulated components and fight AI ships and asteroids.

**This version of the spec does not describe the game.** It describes the **physics sandbox** that comes first. In the sandbox we:

1. Build the simulation headless and test-first, so every behaviour is checked automatically.
2. Experiment interactively in a browser UI: spawn, edit, attach and remove bodies and components while the simulation runs.
3. Study collisions, acceleration, gas-driven propulsion, weapons and damage until they are correct, stable and fun to watch.

Game rules (economy, AI, missions, progression) are deferred to a later spec (§13). They will be built on the sandbox.

### 1.1 Changes from v0.1

| v0.1 problem | v0.2 response |
|---|---|
| ~200 requirements with no priority or order | Each requirement has a priority and a milestone (§3). |
| Requirements not tied to tests | Every requirement names how it is verified. Physics is checked against analytic oracles (§6.3). |
| Wording that can't be tested ("plausible", "sufficiently") | Replaced with numeric tolerances from the simulation profile (§5.4). |
| Simulation and UI not separated | The simulation core is headless and has no DOM dependency (§5). |
| Game and sandbox mixed together | Game rules deferred (§13). The sandbox is the product for now. |
| Blocking decisions left open | Decided in §14. |
| Prototype UI was hard to use | §8 now designs the UI around workflows, with a mockup gate, action budgets and usability tests. |

## 2. Principles

1. **Headless first.** Everything the simulation can do, it can do from Node with no browser. The UI is a client of the core.
2. **Tests are the contract.** A behaviour exists only when an automated test demonstrates it.
3. **No cheating physics.** Ships move only because momentum is exchanged with represented matter (gas, shells, collisions). The code never sets a velocity or applies a force from nowhere.
4. **Conservation is measured, not assumed.** Every step publishes a ledger of mass, momentum, angular momentum and energy. Tests and the UI both read it.
5. **Determinism.** The same scenario, seed and command timeline produce the same result.
6. **One scenario format everywhere.** The same scenario file runs in a test, a CLI and the sandbox UI. An experiment saved from the UI can become a regression test.
7. **Usability is a requirement.** The sandbox is designed around real experiment workflows, and those workflows are tested like physics is (§8).

## 3. Requirement Conventions

Requirements use EARS:

- **Ubiquitous:** The system shall `<response>`.
- **Event-driven:** When `<trigger>`, the system shall `<response>`.
- **State-driven:** While `<state>`, the system shall `<response>`.
- **Unwanted behaviour:** If `<condition>`, then the system shall `<response>`.
- **Optional feature:** Where `<feature>`, the system shall `<response>`.

Each requirement carries:

- **Priority:** `M` must, `S` should, `C` could.
- **Milestone:** `M0`–`M8` (§12).
- **Verification:** `U` unit test, `P` property/conservation test, `S` scenario test, `D` determinism test, `E` browser end-to-end test, `B` benchmark, `R` review only.

Format: **ID** `[priority · milestone · verification]` text.

All tolerances (`tol.*`) and limits (`limit.*`) come from the active simulation profile (§5.4).

## 4. Definitions

| Term | Definition |
|---|---|
| **World** | The complete serialisable simulation state at one instant. |
| **Step** | One fixed-duration advance of the world. |
| **Body** | A rigid object with mass, centre of mass, inertia, pose, velocities and collision shape. |
| **Assembly** | A set of bodies (components) held together by joints and simulated as one or more rigid groups. |
| **Component** | A body with a function: hull, tank, chamber, nozzle, injector, cannon, armour, beam, etc. |
| **Joint** | A breakable structural connection between two bodies, with strength limits. |
| **Link** | A non-structural, zero-mass connection carrying commands (control) or resources (feed). |
| **Gas parcel** | A small particle representing a packet of gas, with mass, composition, velocity and thermal energy. |
| **Scenario** | A file holding the initial world, profile, seed, command timeline and optional probes and assertions. |
| **Probe** | A named measurement recorded over time, e.g. a body's velocity or a joint's load. |
| **Ledger** | Per-step totals of mass, linear momentum, angular momentum and energy, with the change attributed to each source. |
| **Simulation profile** | Named numeric settings: timestep, tolerances, limits. |
| **Port** | A defined point on a component where a joint or link can attach. |
| **Prefab** | A saved assembly that can be spawned again. |
| **Oracle** | A known correct answer used by a test, e.g. an analytic solution or a conservation law. |

## 5. Architecture Requirements

### 5.1 Headless core

- **ARC-001** `[M · M0 · R]` The simulation core shall be a TypeScript module with no dependency on the DOM, canvas, timers or wall-clock time.
- **ARC-002** `[M · M0 · U]` The core shall expose `step(world, commands, profile) → world` (or an equivalent mutable form with identical results) as the only way to advance time.
- **ARC-003** `[M · M0 · U]` The core shall serialise any world to JSON and deserialise it without loss. Re-serialising shall produce the same bytes.
- **ARC-004** `[M · M0 · D]` The core shall draw all randomness from a seeded PRNG stored in the world state.
- **ARC-005** `[M · M0 · R]` The core shall use SI units (metres, kilograms, seconds, radians, joules) internally.
- **ARC-006** `[M · M0 · U]` The UI shall advance the simulation only through the core's step function, using a fixed timestep accumulator independent of frame rate.
- **ARC-007** `[M · M0 · U]` A CLI shall run a scenario headless for N steps or until an end condition, and write probes, ledger and final world to JSON.
- **ARC-008** `[S · M1 · U]` Where a Web Worker is available, the UI shall be able to run the core in a worker without code changes to the core.

### 5.2 Determinism

- **DET-001** `[M · M0 · D]` When the same scenario runs twice in the same runtime, the system shall produce bit-identical world snapshots after every step.
- **DET-002** `[M · M0 · D]` The system shall produce a stable hash of a world snapshot for comparing runs.
- **DET-003** `[S · M1 · D]` The core shall avoid engine-dependent transcendental functions (`Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp`, …) in the stepping path, or wrap them in a pinned implementation, so results match across browsers and Node.
  *Rationale:* ECMAScript only specifies these results as "implementation-approximated", and they do differ between platforms.
- **DET-004** `[M · M0 · D]` The iteration order of every collection that affects results shall be defined (e.g. by stable entity ID), never by object-key or hash order.

### 5.3 Ledger and diagnostics

- **LED-001** `[M · M1 · P]` After every step, the system shall record total mass, linear momentum, angular momentum about the world origin, and total energy split into kinetic, gravitational potential, thermal and chemical.
- **LED-002** `[M · M1 · P]` The ledger shall attribute each change to its source: internal exchange between energy forms (e.g. kinetic ↔ gravitational potential), external field, user edit, reaction, removal at the world boundary, or numerical residual.
- **LED-003** `[M · M1 · P]` If an unattributed residual exceeds its profile tolerance, then the system shall record a conservation violation with step number, quantity, magnitude and the entities involved.
- **LED-004** `[S · M1 · B]` The system shall report per-step compute time for each subsystem and active counts of bodies, contacts, joints and gas parcels.

### 5.4 Simulation profile

- **PRF-001** `[M · M0 · U]` The system shall load a named profile declaring: timestep, solver iterations, every `tol.*` and every `limit.*` referenced in this spec, at least `tol.mass`, `tol.momentum`, `tol.angularMomentum`, `tol.energy`, `tol.velocity`, `tol.pressure`, `tol.penetration`, `tol.rocket`, `limit.bodies`, `limit.gasParcels`, `limit.contacts`, `limit.maxSpeed`, `limit.minThickness` and `limit.minFragment`.
- **PRF-004** `[M · M0 · U]` If a profile omits a required value, then the system shall reject the profile and name the missing keys.
- **PRF-002** `[M · M0 · U]` The system shall ship a `test` profile (small, strict tolerances) and a `sandbox` profile (real-time, larger limits).
- **PRF-003** `[M · M3 · P]` If an entity limit would be exceeded, then the system shall refuse the spawn or apply a declared merge rule that conserves mass, momentum and energy, and shall record which it did.

## 6. Testing Requirements

### 6.1 Infrastructure

- **TST-001** `[M · M0 · R]` `pnpm test` shall run every non-browser test headless with one command, and `pnpm test:e2e` shall run the browser tests.
- **TST-002** `[M · M0 · R]` CI shall run typecheck, lint, unit, property, scenario and determinism tests on every pull request, and block merge on failure.
- **TST-003** `[M · M0 · R]` The whole headless suite shall complete in under 60 seconds on a CI runner. Longer runs go in a separate `pnpm test:slow`.
- **TST-004** `[S · M0 · R]` CI shall report line and branch coverage for the core. The target for the core is ≥ 90% lines.
- **TST-005** `[M · M0 · R]` Every requirement in this spec with a verification other than `R` shall be referenced by ID in at least one test name, e.g. `it('COL-003 off-centre impact changes spin', …)`.
- **TST-006** `[S · M0 · R]` A script shall list requirements that have no matching test.

### 6.2 Test layers

| Layer | What it checks | Example |
|---|---|---|
| Unit | One function or system in isolation | Mass properties of a compound shape |
| Property | A law over many random cases (seeded) | 1,000 random two-body collisions conserve momentum |
| Scenario | A scenario file runs and its assertions hold | Rocket burn reaches the Δv the rocket equation predicts |
| Determinism | Two runs produce equal hashes | Every scenario, run twice |
| Golden | Output matches a stored snapshot; updating it requires an explicit flag | Asteroid fracture pattern for seed 42 |
| E2E | Browser UI drives the core correctly | Place a thruster, press play, the body accelerates |
| Benchmark | Speed and scale limits | 2,000 gas parcels step in real time |

### 6.3 Physics oracles

Tests shall use independent oracles. Comparing the simulation with itself does not count.

- **ORC-001** `[M · M1 · S]` Free body: constant velocity and spin with no forces, to within float tolerance over 10,000 steps.
- **ORC-002** `[M · M1 · S]` 1D elastic and inelastic collisions of two discs shall match the closed-form final velocities to within `tol.velocity` (relative to the closing speed), and total momentum to within `tol.momentum`.
- **ORC-003** `[M · M1 · S]` An off-centre impact on a resting body shall produce linear and angular velocities matching the impulse equations.
- **ORC-004** `[M · M2 · S]` Mass, centre of mass and moment of inertia of compound assemblies shall match hand-computed values (parallel axis theorem).
- **ORC-005** `[S · M2 · S]` Where gravity is enabled, a two-body circular orbit shall keep its radius and period within tolerance for 10 orbits.
- **ORC-006** `[M · M3 · P]` For a sealed box of gas, the box-plus-gas system shall conserve total momentum, angular momentum and energy within tolerance, for any initial gas distribution. For a symmetric, equilibrated initial state, the box's own velocity shall also stay below `tol.velocity`.
- **ORC-007** `[M · M4 · S]` A rocket burning its full propellant shall reach a Δv within `tol.rocket` of the Tsiolkovsky prediction Δv = vₑ·ln(m₀/m₁), where vₑ is the measured mean exhaust velocity.
- **ORC-008** `[M · M4 · P]` The impulse on a ship over a burn shall equal, within tolerance, minus the momentum carried away by exhaust gas.
- **ORC-009** `[M · M6 · S]` For a cannon assembly fired from rest, the momenta of shell, cannon assembly and released gas shall sum to zero, to within `tol.momentum`.

### 6.4 Visual verification

- **TST-010** `[S · M1 · E]` The E2E suite shall capture screenshots of reference scenarios at fixed steps, for human review. Screenshot comparison shall not be the only check of any physics behaviour.
- **TST-011** `[S · M1 · U]` The renderer shall be callable with a world and camera to produce a frame without the UI shell, so render output can be tested on its own.

## 7. Scenario Format

- **SCN-001** `[M · M0 · U]` A scenario file shall contain: schema version, profile name, seed, initial world, a command timeline (step → commands), an end condition, probes, and assertions.
- **SCN-002** `[M · M0 · U]` The system shall validate a scenario against a schema and report every error with its JSON path before running.
- **SCN-003** `[M · M0 · S]` Assertions shall support: value at step, value within range over an interval, ledger residual below tolerance, an event occurred or did not occur, and an approximate comparison to a formula over probes.
- **SCN-004** `[M · M1 · S]` The test runner shall execute every scenario in `scenarios/` and fail on any failed assertion.
- **SCN-005** `[M · M1 · E]` The sandbox shall load, run and save scenarios in this same format.
- **SCN-006** `[S · M1 · E]` The sandbox shall export the current experiment, including commands recorded while playing, as a scenario. You can then add assertions to turn it into a test.
- **SCN-007** `[M · M0 · U]` If a scenario has an older schema version, then the system shall migrate it explicitly or reject it with a clear message.

*Format notes (M3).* A number in `world`, `timeline`, `end` or `assertions` can be `{"$param": "id"}` or `{"$expr": "formula over parameters"}` (e.g. `"boxMass * 0.22 / 0.84"`). `world.gas` lists rectangle fills (count, mass, temperature, composition, bulk velocity, jitter); `world.bounds` sets the world boundary for gas. Besides plain paths into the world, probes can read `gas.<field>` (totals over all parcels: `mass`, `momentum.x`, `temperature`, `removed.mass`, `wallImpulse`, …) and `assembly[id=X].<field>` (the assembly X belongs to, as one rigid body: `mass`, `momentum.x`, `velocity.x`, `angularVelocity`, `angularMomentum`, …). `ui.follow` names a body to select and follow. `world.challenge` declares a landing challenge (FLT-005): `{kind: "landing", ship, pad, maxSpeed, maxTilt}`; its status is at `challenge.status` for probes.

## 8. Sandbox UI Design

Usability was the weakest part of the earlier prototype, so this section designs the UI rather than just listing features. The physics is only useful if experiments are quick to set up, easy to see, and safe to undo.

Prior art studied: Algodoo (movable edge toolbars, a properties panel, a right-click menu on each object, plot-any-quantity) and the Box2D samples app (pause/single-step, debug-draw toggles, parameter tuning). We borrow from both, and add the ledger and the scenario round-trip.

### 8.1 User and context

- **Primary user:** you, experimenting with physics and ship designs. You are expert in the concepts, but come back after gaps and must not have to relearn the tool.
- **Primary device:** desktop browser, mouse/trackpad and keyboard, window ≥ 1280×720.
- **Secondary device:** tablet or phone, to open, run, watch and scrub scenarios. Editing on touch is a *could*.

### 8.2 Usability principles

These follow Nielsen's usability heuristics, made specific to this tool.

1. **The world is the main view.** The simulation view takes most of the screen. Panels dock to the edges and collapse.
2. **Direct manipulation.** You place, move, rotate, attach and push things by acting on them in the world, not by typing coordinates. You can still type exact values in the inspector.
3. **State is always visible:** play or pause, time scale, the active tool, simulated time, achieved speed, the selection, and any conservation violation.
4. **Safe to experiment.** Every edit can be undone. Reset to start is one key. Scrubbing back is always available.
5. **One tool at a time.** The active tool is highlighted and named in the status bar. `Esc` always returns to Select.
6. **Discoverable.** Every action appears in a command palette with its shortcut. Tooltips show shortcuts. An empty world shows a short "get started" hint.
7. **Explain, don't just fail.** When something doesn't happen (a thruster stays dark, an attach is refused), the UI says why.
8. **Readable numbers.** Values show SI units with sensible prefixes (e.g. `1.24 kN`, `3.5 m/s`) and consistent significant figures.

### 8.3 Core workflows

The UI is designed and tested around these tasks. The click counts are budgets: the E2E test for each workflow fails if the scripted path needs more steps.

| ID | Workflow | Budget |
|---|---|---|
| W1 | Open the sandbox and run a reference scenario | ≤ 3 actions from page load |
| W2 | Spawn two bodies, give one a velocity, watch them collide, read the impulse | ≤ 8 actions |
| W3 | Build a ship: hull + tank + chamber + nozzle, link feed and control, bind a key, fly it | ≤ 20 actions |
| W4 | Delete or detach a component mid-flight and watch the mass properties update | ≤ 3 actions |
| W5 | Add a probe to a quantity, graph it, and measure with the ruler | ≤ 5 actions |
| W6 | Save the experiment as a scenario, reload it, and get the same result | ≤ 4 actions |
| W7 | A conservation violation appears: find the step and the entity responsible | ≤ 3 actions from the warning |
| W8 | Pause, scrub back 5 s, change a value, and resume from there (branching the run) | ≤ 5 actions |
| W9 | Build a twin-engine ship (hull, tank, wing, two engines), link both engines, give each its own key, and fly it, steering by throttling one engine | ≤ 28 actions |

### 8.4 Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰ Scenario: rocket-test*   ⏮ ⏯ ⏭ ×1 ▾   t=12.350 s  speed 0.98×   ⚠ 0     │ top bar
├────┬───────────────────────────────────────────────────────┬─────────────┤
│ ↖  │                                                       │ INSPECTOR   │
│ ✥  │                                                       │ Nozzle #7   │
│ ＋ │                 simulation view                       │ ─ Shape     │
│ ⛓  │            (pan, zoom, follow; overlays)              │ ─ Material  │
│ ↯  │                                                       │ ─ Joints    │
│ 🔗 │                                                       │ ─ Links     │
│ ◎  │                                  [overlays ▾] [⊕ fit] │ ─ Live      │
│ 📏 │                                                       │             │
├────┴───────────────────────────────────────────────────────┴─────────────┤
│ ▁▂▃▅▇ graphs: momentum · energy · probe:nozzle.thrust  ◀━━━━━━●━━━━▶ scrub│ bottom drawer
├──────────────────────────────────────────────────────────────────────────┤
│ Attach: drag a component onto a highlighted port · Esc to cancel          │ status bar
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** scenario menu (new, open, save, export as test, recent), time controls, time scale, sim clock, achieved speed, violations badge.
- **Left tool rail:** Select, Move/Rotate, Spawn, Attach, Impulse, Link, Probe, Ruler. Spawn and Attach open a palette flyout of bodies and components, with search.
- **Right inspector:** properties of the selection, grouped and collapsible. Shows "Nothing selected" with world settings when empty.
- **Bottom drawer:** graphs and the timeline scrub bar. Collapsed by default to a thin scrub bar.
- **Status bar:** a one-line hint for the active tool and its next step.

### 8.5 Interaction model

| Tool | Key | Mouse action | Result |
|---|---|---|---|
| Select | `V` | Click; shift-click; drag a box | Select. The first click selects the assembly, a second click drills into the component (like groups in drawing tools). |
| Move/Rotate | `M` | Drag body; drag rotate handle; shift snaps 15° | Moves while paused. While running, drag applies a spring force so physics is not broken (no teleporting). |
| Spawn | `S` | Pick from palette, click or drag to set initial velocity | A new free body appears with the velocity shown as an arrow. |
| Attach | `A` | Drag a component from the palette or the world onto an assembly | Valid ports glow and the ghost shows green or red. On release a joint is created with default strength. |
| Impulse | `I` | Drag from a point on a body; length = magnitude | Applies the impulse on release. A preview shows magnitude and resulting Δv and Δω. |
| Link | `L` | Drag from a port to a port | Compatible ports highlight. Incompatible ones are dimmed, with a tooltip saying why. |
| Probe | `P` | Click entity → choose quantity | Adds a graph series and an on-world label. |
| Ruler | `R` | Drag between two points | Shows distance, relative velocity and closing speed, updated live. |

Global keys: `Space` play/pause · `.` step · `Shift+.` step 10 · `Home` reset to start · `[` `]` time scale · `F` follow selection · `Z` zoom to fit · `Del` delete · `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo · `Ctrl+D` duplicate · `Ctrl+K` command palette · `Esc` back to Select · `?` shortcut sheet.

Right-click on any entity opens a context menu with the common actions for that entity type, such as probe, delete, detach, duplicate, follow, and save as prefab.

### 8.6 Requirements — time control

- **SBX-001** `[M · M1 · E]` The sandbox shall provide play, pause, single-step, step-10 and reset-to-start, via both buttons and keys.
- **SBX-002** `[M · M1 · E]` The sandbox shall provide a time scale from at least 1/16× to 8×, implemented as more or fewer fixed steps, never a larger timestep. Normal speed, shown as 1×, is half real time: the pace the game plays well at. The speeds shown run from 1/8× to 16× (1/16 to 8 times real time), with fine steps either side of 1×.
- **SBX-003** `[M · M2 · E]` The sandbox shall keep a snapshot history so you can scrub back over at least the last 10 s of simulated time.
- **SBX-004** `[M · M2 · E]` When you edit while scrubbed back, the sandbox shall discard the future after that point and continue from the edited state. A single undo restores the discarded future.
- **SBX-005** `[M · M1 · E]` If the simulation cannot keep up in real time, then the sandbox shall show the achieved time scale instead of silently dropping steps.

### 8.7 Requirements — creating and editing

- **SBX-010** `[M · M1 · E]` The sandbox shall provide a searchable palette of primitive bodies (disc, box, convex polygon) and, from the relevant milestone, components, gas emitters and saved prefabs.
- **SBX-011** `[M · M1 · E]` The sandbox shall allow selecting, moving, rotating, duplicating and deleting any body, while paused or running.
- **SBX-012** `[M · M1 · E]` While running, moving a body by drag shall apply a bounded spring force, not set its position directly, and the ledger shall attribute the impulse to "user".
- **SBX-013** `[M · M1 · E]` Every edit shall go through a core command, so it is undoable, recorded in the command timeline, and replayable.
- **SBX-014** `[M · M2 · E]` The sandbox shall allow attaching a component to an assembly by dragging it onto a compatible port, with a live preview showing whether the placement is valid and why not.
- **SBX-015** `[M · M2 · E]` The sandbox shall allow detaching or deleting a component from an assembly while paused or running. Detached parts keep their momentum.
- **SBX-016** `[M · M2 · E]` When a component is added or removed, the system shall recompute the assembly's mass properties before the next step and show the change in the inspector.
- **SBX-017** `[M · M2 · E]` The sandbox shall allow creating and deleting control and feed links by dragging between ports, highlighting compatible ports only.
- **SBX-018** `[M · M1 · E]` The impulse tool shall preview the impulse magnitude and the resulting Δv and Δω before release.
- **SBX-019** `[M · M1 · E]` The sandbox shall provide undo and redo for every edit, with at least 200 levels.
- **SBX-020** `[M · M2 · E]` The sandbox shall allow binding keys to control channels, and shall show the current bindings in an on-screen legend while flying.
- **SBX-021** `[S · M2 · E]` The sandbox shall allow saving an assembly as a prefab and spawning copies of it.
- **SBX-024** `[M · M4b · E]` Long faces shall offer attachment ports about every metre (the centre, then every 1 m out to 0.25 m from the corners), so one wing can carry several parts.
- **SBX-025** `[M · M4b · E]` A newly placed engine shall get a control channel no other injector uses (`main`, then `main-2`, …), so each engine can have its own key.
- **SBX-022** `[S · M1 · E]` The sandbox shall show a right-click context menu per entity with its common actions.

### 8.8 Requirements — inspector

- **INS-001** `[M · M1 · E]` The inspector shall group properties (Identity, Shape, Material, Motion, Contents, Joints, Links, Live values) in collapsible sections that remember their state.
- **INS-002** `[M · M1 · E]` Editable values shall support both typing and dragging to scrub, and shall show units.
- **INS-003** `[M · M1 · E]` Derived values (e.g. mass from density × area) shall be shown read-only, with a tooltip explaining how they are derived.
- **INS-004** `[M · M1 · E]` If an entered value is invalid (e.g. negative mass), then the inspector shall reject it inline with a reason and keep the previous value.
- **INS-005** `[M · M1 · E]` Where several entities are selected, the inspector shall edit shared properties together and show "mixed" where they differ.
- **INS-006** `[M · M4 · E]` A functional component shall show its status and, when inactive, the reason (e.g. "No feed: link #12 broken", "Tank empty", "No control binding").

### 8.9 Requirements — seeing what's happening

- **SBX-030** `[M · M1 · E]` The sandbox shall provide pan (drag empty space or middle-drag), zoom to the cursor (wheel or pinch), zoom to fit, and follow selection.
- **SBX-031** `[M · M1 · E]` The sandbox shall provide toggleable overlays for velocity vectors, centres of mass, contact points and impulses, applied forces, joint load, link paths and the world boundary, with a legend for the active overlays. The centre-of-mass overlay also marks each welded assembly's overall centre of mass, propellant included, with a larger symbol.
- **SBX-032** `[M · M2 · E]` Joint load shall be shown as a fraction of its strength, using colour plus line thickness.
- **SBX-033** `[M · M1 · E]` The sandbox shall show live graphs of ledger totals and probes, with a selectable time window, hover readout, and a cursor synced to the scrub bar.
- **SBX-034** `[M · M1 · E]` When a conservation violation occurs, the sandbox shall increment the top-bar badge. Clicking an entry shall jump to that step and select the entities involved.
- **SBX-035** `[S · M3 · E]` The sandbox shall render gas parcels coloured by temperature or composition (selectable), with a colour scale shown.
  - *Plume (added 2026-11):* by default, gas coloured by temperature is drawn as a plume rather than dots.
    - **Drawing:** each parcel is a soft blob as wide as the space its parcel has (from a count of parcels on a 0.4 m grid), drawn at a quarter of the screen's resolution, blurred, and stretched over the scene. Gas that has spread out draws bigger and fainter.
    - **Colours:** hot gas glows and adds light, white-yellow above about 2,700 K through orange and red; gas below 800 K is faint grey smoke laid over the scene.
    - **Switch and fallback:** the switch beside the colour scale gives dots. Composition colours, and canvases that can't draw images (test recorders), use dots.
    - **Cost:** it is drawing only: physics and replays are unchanged. In headless Chromium without a GPU, Gunship 2 firing draws at 47 fps as a plume against 54 as dots.
- **SBX-036** `[M · M1 · E]` Hovering any entity shall show a compact readout of its type, mass, speed and spin.
- **SBX-037** `[S · M1 · E]` The sandbox shall keep an event log (collisions above a threshold, joint breaks, ignitions, violations). Clicking an event jumps to its step.
- **SBX-038** `[M · M1 · R]` Overlays and status colours shall be distinguishable by colour-blind users, using a colour-blind-safe palette plus shape or line-style redundancy.

### 8.10 Requirements — onboarding and discoverability

- **UX-001** `[M · M1 · E]` On first load, the sandbox shall show a scenario picker listing the starter scenarios SC-01–SC-03 first (§11.1), then the other reference scenarios, with thumbnails and one-line descriptions, plus "Empty world".
- **UX-002** `[M · M1 · E]` The sandbox shall provide a command palette (`Ctrl+K`) that lists every action with its shortcut and runs it.
- **UX-003** `[M · M1 · E]` Every toolbar control shall have a tooltip with its name and shortcut.
- **UX-004** `[M · M1 · E]` The status bar shall always show a hint for the active tool's next step.
- **UX-005** `[S · M1 · E]` The sandbox shall remember panel layout, overlay toggles and the last scenario between visits, per browser.
- **UX-006** `[M · M1 · E]` If loading a scenario fails, then the sandbox shall show the validation errors with their JSON paths and keep the current world untouched.
- **UX-007** `[M · M1 · E]` The sandbox shall warn before discarding unsaved changes.

### 8.11 Requirements — quality and accessibility

- **SBX-040** `[M · M1 · B]` The sandbox shall render at 60 fps with the reference sandbox workload RS-00 (§11) on the reference hardware (§14). UI panels shall not block simulation rendering.
- **SBX-041** `[M · M1 · E]` The sandbox shall work in current Chromium, Firefox and Safari desktop browsers. The E2E suite shall run on Playwright's Chromium, Firefox and WebKit engines.
- **SBX-042** `[M · M1 · E]` Every interactive control shall expose a stable `data-testid` and an accessible name.
- **SBX-043** `[M · M1 · E]` Every action shall be reachable by keyboard, with a visible focus indicator.
- **SBX-044** `[M · M1 · R]` Text and controls shall meet WCAG 2.2 AA contrast in the default dark theme.
- **SBX-045** `[S · M1 · E]` At widths below 900 px, the sandbox shall switch to a compact layout: the world, time controls and scrub bar, with panels as bottom sheets.
- **SBX-047** `[M · M4b · E]` On phones and tablets the sandbox shall support the whole build-and-fly workflow by touch alone. The tools are a strip along the bottom and the parts palette a strip above it. Tap to place or attach, drag to link, and on-screen hold-to-fire buttons for every control channel, several at once. W3 and W9 run at phone (390 px) and tablet (820 px) widths.
- **SBX-046** `[S · M1 · E]` UI animations shall respect `prefers-reduced-motion`. This does not affect the simulation.
- **PAD-001** `[S · M10 · U]` A game controller with the browser's standard layout shall be read each frame: its buttons by name, the left stick as the D-pad past half its travel, a trigger past 0.3, every connected pad together.
- **PAD-002** `[S · M10 · E]` The three games shall be playable with a controller (12 November 2026). In flight the pad holds the game's controls (below) and Start pauses. Out of flight (a title, a menu, paused, game over) the D-pad or stick steps through the buttons on screen, A presses the one chosen, and Start resumes a paused game. A button still held when flight begins does nothing until it is let go.
- **PAD-003** `[S · M10 · E]` In Mammoth Asteroids and Mammoth Thrust a controller's stick and triggers throttle (Chloe, 13 November 2026): the stick turns as far as it is pushed past a small dead zone, and forward (stick up or right trigger) and reverse (stick down or left trigger) are as strong as they are pushed or pulled; the buttons and D-pad give full. The keys stay on or off.
  - *Lander:* the stick, D-pad, bumpers or triggers are the left and right controls; A is both engines.
  - *Mammoth Asteroids and Mammoth Thrust:* the stick or D-pad turns; A, the right trigger or D-pad up is forward; B, the left trigger or D-pad down is reverse; X or the right bumper fires. In Thrust, Y or the left bumper is the tractor.

### 8.12 Usability verification

- **UXV-001** `[M · M1 · E]` Each workflow W1–W8 shall have a Playwright test that performs it through the UI within its action budget, as soon as its milestone is reached.
- **UXV-002** `[M · M0 · R]` Before building M1's UI, a clickable HTML mockup of the layout and workflows W1–W3 shall be reviewed and approved by you.
  *Status:* mockup v1 in review — https://claude.ai/artifact/D9BPSqnT6GdytJLs4U9ixa (private to the owner).
- **UXV-003** `[M · M1 · R]` At the end of each milestone, you shall try the new workflows unaided. Every friction point gets an issue labelled `ux`, and `ux` issues shall be triaged before the next milestone starts.
- **UXV-004** `[S · M1 · E]` The E2E suite shall capture a screenshot of every panel in its main states (empty, selected, error) for each milestone review.

## 9. Physics Requirements

### 9.1 Rigid bodies and integration (M1)

- **PHY-001** `[M · M1 · U]` Every body shall have mass, centre of mass, moment of inertia, position, orientation, linear velocity, angular velocity and collision shape.
- **PHY-002** `[M · M1 · S]` The integrator shall be symplectic (e.g. semi-implicit Euler) and stable for the profile's limits.
- **PHY-003** `[M · M1 · U]` A force applied away from the centre of mass shall produce both linear acceleration and torque.
- **PHY-004** `[M · M1 · U]` No system other than the integrator shall write to velocity or position, except contact and joint solvers applying equal and opposite impulses.

### 9.2 Collisions (M1)

- **COL-001** `[M · M1 · U]` The system shall detect contact between discs, boxes and convex polygons, including multiple contact points.
- **COL-002** `[M · M1 · P]` Contact resolution shall apply equal and opposite impulses at the contact point, accounting for mass, inertia, restitution and friction.
- **COL-003** `[M · M1 · S]` An off-centre impact shall change both linear and angular momentum (ORC-003).
- **COL-004** `[M · M1 · S]` A projectile up to `limit.maxSpeed` shall not pass through a body of thickness ≥ `limit.minThickness` (continuous collision detection).
- **COL-005** `[M · M1 · S]` Resting and stacked bodies shall not interpenetrate by more than `tol.penetration` and shall settle without jitter.
- **COL-006** `[M · M1 · U]` The system shall record each contact's impulse and the energy lost to it, for damage (§9.6) and for overlays.

### 9.3 Assemblies and joints (M2)

- **ASM-001** `[M · M2 · U]` An assembly shall compute its total mass, centre of mass and inertia from its components and their contents (ORC-004).
- **ASM-002** `[M · M2 · U]` When a store's contents change, the system shall update the assembly's mass properties before the next step.
- **ASM-003** `[M · M2 · S]` Each joint shall have tensile, compressive, shear and torque limits, and shall record its current load.
- **ASM-004** `[M · M2 · S]` When a joint's load exceeds a limit, the system shall break it.
- **ASM-005** `[M · M2 · P]` When broken joints split an assembly, each part shall become its own assembly, and the total momentum and angular momentum of the parts shall be conserved.
- **ASM-006** `[M · M2 · U]` Links shall have zero mass. Control links carry command values on channels. Feed links carry named resources up to a flow rate.
- **ASM-007** `[S · M2 · S]` Where gravity is enabled, the system shall apply point-mass gravity between bodies above a mass threshold, and from fixed background sources (ORC-005).
- **ASM-008** `[M · M10 · S]` A joint may be turned (`turn: {rate, min, max, target}`): its rest angle shall move toward the target at the rate, inside the limits, and the joint shall hold its bodies at that angle as a weld does, carry load and break as one (ASM-003, ASM-004). The work of turning is booked under `power`. *For Mammoth Thrust's turret mount; agreed with Chloe, 12 November 2026.*
- **ASM-009** `[M · M10 · U]` A control link may be switched off for a time (`off`): whole, it carries nothing to an engine, a gun or a tractor until it is switched on again (Mammoth Thrust's shock).

### 9.4 Gas parcels (M3)

- **GAS-001** `[M · M3 · U]` A gas parcel shall have mass, species composition, position, velocity, thermal energy and radius.
- **GAS-002** `[M · M3 · P]` Parcels shall exchange momentum only through pairwise equal-and-opposite interactions, so total momentum is conserved to float precision.
- **GAS-003** `[M · M3 · S]` Parcels at higher density and temperature shall push apart more strongly, producing pressure that increases with density and temperature.
- **GAS-004** `[M · M3 · S]` Parcels hitting a body shall exchange momentum and energy with that body at the contact point, according to a declared wall model.
- **GAS-005** `[M · M3 · S]` A sealed container of gas shall gain no net momentum or spin from internal pressure, beyond the exchange with its own gas (ORC-006).
- **GAS-006** `[M · M3 · S]` Gas released into vacuum shall expand freely, and its centre of mass shall keep the original velocity.
- **GAS-007** `[M · M3 · P]` When parcels leave the world boundary or are merged, the ledger shall record the mass, momentum and energy removed or combined.
- **GAS-008** `[S · M3 · B]` The `sandbox` profile shall support at least 2,000 active parcels in real time on the reference hardware.
- **GAS-009** `[M · M4b · P]` In a world given a depth out of the plane (`bounds.depth`), gas that has left its engine shall spread out of the plane as a cloud in vacuum would. Each step a parcel's chance of staying in the plane shall be multiplied by 1/(1 + x), x = c·dt/depth with c its sound speed. It shall leave whole once that chance falls below its own fixed threshold (from its id), so every parcel keeps its mass. The ledger shall record what leaves at the boundary. Gas inside an engine's declared interior (`injector.chamber`), which is closed in 3D, shall not leave.
- **GAS-011** `[S · M8 · E]` Gas that leaves the gas model inside the world (out of the plane, or far from everything) shall carry on for about a second as a simple particle, a *wisp*: it moves on under the uniform field, grows to three times its size, cools and fades out, its mass fading with it. A wisp shall bounce off solid bodies (restitution 0.3) and push them. The gas has already left the ledger's books, so what a wisp gives a body shall be recorded as coming in through the boundary. *Built November 2026 (Gunship 3):* at most 8,000 wisps; a Gunship 3 firing both engines keeps about 3,000. *Mammoth Asteroids (November 2026):* a wisp lasts 0.4 s there, so a ship that crosses the wrapped arena's edge under thrust does not meet its own tail at the other side.

*Model as built (M3, DEC-04).* SPH with a Wendland C2 kernel (support h = 3 parcel spacings) and an ideal-gas equation of state per species, P = (γ − 1)·ρ·u in 2D (ρ in kg/m², P in N/m). Each step runs CFL-limited substeps, drift–kick–drift: parcels and bodies move half the substep, all impulses come from the state there, and they move the rest with the new velocities (second order in the substep, so thrust doesn't depend on it). Each impulse's work, taken at the mean of the old and new velocities, is moved between kinetic and thermal energy. Heat turned into motion comes from the two parcels by their pressure terms (P/ρ²), so a cold parcel doesn't pay for its neighbour's push; heat made comes by each parcel's share of the impulse. So momentum and angular momentum are conserved exactly and energy to rounding. Artificial viscosity (Monaghan α = 1, β = 2) is capped at the impulse that stops a pair closing. **Wall model (GAS-004):** a body surface is a mirror. Each parcel within h of a surface gets a ghost image, which the parcels on that face see. A ghost's impulse acts on the parcel and, equal and opposite along the same line, on the body, or on its free assembly as one rigid unit. At rest this presses on walls at the equation-of-state pressure, to within about 1% in SC-02. Parcels on opposite faces of a thin wall don't interact.

### 9.5 Gas-driven propulsion (M4)

Thrust must come from gas pushing on engine geometry. No component applies a direct force.

- **PRP-001** `[M · M4 · U]` A tank shall hold a resource with mass and shall update its assembly's mass as it drains.
- **PRP-002** `[M · M4 · S]` When an injector receives a non-zero command on its control channel, it shall draw fuel and oxidiser through intact feed links and emit them into its chamber: as parcels, or into the gas the chamber holds as one volume (PRP-011). The rate is limited by command value, link capacity and supply.
- **PRP-003** `[M · M4 · S]` When fuel and oxidiser parcels meet ignition conditions, they shall react by a declared rule into hot product parcels, conserving mass and momentum and converting chemical to thermal energy as declared.
- **PRP-004** `[M · M4 · S]` A chamber with no opening shall produce no net thrust (ORC-006 applied to a chamber).
- **PRP-005** `[M · M4 · S]` A chamber with a nozzle shall produce thrust along the nozzle axis, emerging only from the gas: gas–wall impulses (ORC-008), and, for a chamber held as one volume (PRP-011), its jet's recoil and the exhaust pushing on its throat.
- **PRP-006** `[M · M4 · S]` A thruster mounted off the centre of mass shall produce torque, with no special-case code.
- **PRP-007** `[M · M4 · S]` Burning a ship's full propellant shall match the rocket equation (ORC-007).
- **PRP-008** `[M · M4 · S]` Changing nozzle geometry (length, flare, damage) shall change thrust magnitude, direction or efficiency as a consequence of gas–wall interaction.
- **PRP-009** `[M · M4 · S]` If a feed link is broken or a reactant runs out, then no new reaction gas shall be produced from that feed.
- **PRP-010** `[S · M4 · B]` A reference single-engine ship shall sustain thrust in real time within the parcel budget of GAS-008.
- **PRP-011** `[S · M4 · S]` While an engine's own walls enclose its chamber up to the throat, with nothing else inside, the system shall hold the gas there as one well-mixed volume. It shall let the gas out through the throat as a choked jet of parcels, push on the chamber's walls with its pressure, and keep mass, momentum and energy exact. When the chamber stops being enclosed, its gas shall become parcels where the chamber was.

*Model as built (M4).*
- **Tanks** are stores. Propellant in a store counts toward its body's mass, and carries thermal energy (at 300 K) and chemical energy in the ledger.
- **An injector** is a component on a body. It is commanded through a control link on its channel and draws its mixture from its own stores, which feed links top up. At its outlet it emits parcels at up to `rate` × command kg/s. The injector recoils, so momentum is unchanged, and the parcel's thermal energy absorbs any kinetic energy the injection adds, so energy is unchanged.
- **The reaction is declared:** H₂ + 8 O₂ → H₂O releases 3.4×10⁷ J per kg of H₂, about 3,000 K in the products. (The real lower heating value is 1.2×10⁸ J/kg; the declared figure stands in for dissociation.) It burns completely in a step, in a parcel holding both reactants, if the parcel or any parcel within its smoothing length is at 800 K or more. With an igniter on, what an injector emits burns at once.
- **Thrust** is only gas on the chamber and nozzle walls.
- **Chambers held as one volume (PRP-011, added 2026-11).** An engine's chamber, from its outlet to its throat, holds its gas as one well-mixed volume when the engine's own welded walls enclose it and nothing else is inside. The chamber is found from the welds' rest geometry inside the declared interior (`injector.chamber`): the throat is its narrowest cross-section, and the chamber is the free space flooded from the outlet up to it.
  - **In:** the injector's propellant goes straight into the volume and burns there (PRP-003, fast chemistry). Its mass counts toward the engine body's mass, like a store's, and its energy is in the ledger.
  - **Pressure** is the gas law over the chamber's area, P = (γ − 1)·U/A, per metre of depth, as for parcels.
  - **Out:** gas leaves through the throat as a choked jet, ṁ = ρ*·c*·w with the throat's sonic state (T* = 2T₀/(γ + 1)). It is released as parcels just past the throat, moving at c*·(1 + 1/γ) relative to the engine: the jet's momentum flux ṁ·c* plus the throat's pressure P*·A* = ṁ·c*/γ. Each parcel carries the throat's stagnation enthalpy (γ·u* + c*²/2) as heat plus motion. The engine recoils, and the volume pays the parcel's energy, so momentum and energy are exact.
  - **The throat plug:** a wall across the throat, moving with the engine, keeps exhaust out of the chamber and takes the exhaust's push back on the throat. Thrust is the jet's recoil plus that push, plus the nozzle walls. The recoil alone is the ideal choked throat's thrust, ṁ·c*·(1 + 1/γ), at any parcel size; LAND's engines measure 1.05 of it in open space (the plug and the nozzle walls add the rest). Before (to 2026-11-07), parcels left at c* and the throat pressure reached the engine only through the parcels just released, which at the game's detail carried about 40% of it (docs/perf/gpu-gas-phase0.md §15).
  - **Thrust is higher than before.** A chamber full of parcels made about 80% of the ideal (151 against 188 m/s effective exhaust speed in Gunship 2), losing the rest to the parcels' numerical viscosity. So Gunship 2 climbs about 26% faster and turns about 30% faster on one engine, and LAND climbs off the pad faster.
  - **Walls feel the pressure:** P on each wall, summing to zero over the closed chamber, so it moves nothing but loads the welds (ASM-004).
  - **Spilling:** if a wall breaks off, a body enters the chamber, or the engine is wrecked, the gas becomes parcels spread over where the chamber was, again exactly. Parcels found inside an enclosed chamber join its volume.
  - **Not held:** a gun's breech, because its gas has to push the shell. RS-08 and RS-16 declare no interior and still fill their chambers with parcels.
  - **Cost:** the gas in a chamber was more than half of an engine scene's parcels, and the densest. Gunship 2 with both engines firing went from 47 to 8 ms a step, and LAND from 11 to 3.
- **Joints feel the gas.** The impulse a weld must pass on, because gas pushes its assembly as one rigid body, is added to its load one step later.
- **Far field:** `bounds.farField` removes exhaust that has flown farther than that from every body, and the ledger records it at the boundary.

### 9.5b Flight trials (M4b)

Ships built from the M4 parts, flown by hand. Steering here comes from throttling engines differently: there is no attitude-control component yet.

- **FLT-001** `[M · M4b · S]` With two engines either side of the centre of mass at equal throttle, a ship shall accelerate along its axis with spin no more than jet noise (RS-16).
- **FLT-002** `[M · M4b · S]` Firing only one of two engines shall turn the ship's nose toward the idle engine's side, with the torque coming only from gas on the firing engine's walls (RS-16).
- **FLT-003** `[M · M4b · P]` A ship coasting with no engine firing and nothing touching it shall keep its spin and its angular momentum about its centre of mass (RS-16).
- **FLT-004** `[S · M4b · S]` Unequal thrust shall load the welds between the engines and the hull, and the joint-load overlay shall show it (RS-16).
- **FLT-005** `[M · M4b · S]` A scenario may declare a landing challenge: a ship, a fixed pad, the fastest touchdown and the largest tilt allowed. The world shall judge it after every step, as part of its state, so a run, a replay and a scrub reach the same verdict at the same step. It shall report the ship's height above the pad, its velocity, its tilt and the propellant left (RS-17).
- **FLT-006** `[M · M4b · S]` Touching anything but the pad, or touching the pad faster than the limit, shall be a crash, with the reason in words (RS-17).
- **FLT-007** `[M · M4b · S]` A ship that comes to rest on the pad (under 0.3 m/s and 0.3 rad/s for 0.5 s, allowing bounces off the pad shorter than 0.1 s) within the tilt limit shall have landed, with a score: up to 500 for propellant left and up to 500 for a soft touchdown (RS-17).
- **FLT-008** `[M · M4b · S]` A ship that comes to rest on the pad tilted beyond the limit shall have crashed (RS-17).
- **FLT-010** `[M · M4b · S]` An injector may declare a fuel economy (a flight-test cheat): its stores then supply 1/economy of each parcel's mass, so propellant lasts that many times as long at the same thrust and the same starting weight. The ledger shall record the mass, momentum and energy made this way under its own source, `supply`, so the checks stay exact for everything else.
- **FLT-011** `[M · M4b · S]` A body may carry gravity (`mu` = G·M, `core`). Every other free body and gas parcel shall accelerate toward it at mu·r/(r² + core²)^1.5, recorded as a field. Bodies with gravity feel none, so asteroids keep the slow paths they are given.
- **FLT-012** `[M · M4b · S]` A world may wrap round at its bounds. A free assembly whose centre of mass leaves them shall come back at the opposite side whole, with the gas near it, and the ledger shall record what the move changes under `boundary`. Gravity acts from a source's nearest copy. The view shall draw the copies it overlaps, and the seam faintly, so flying across shows no edge.
- **FLT-013** `[M · M4b · S]` The flight-test scenario (RS-18, **FT**) shall fly the LAND ship, with the same weight and tank and an economy of 20, among drifting, spinning asteroids with gravity in a wrapped arena. Nothing ends the run; collisions are ordinary contacts, and welds break only past their limits.
- **FLT-014** `[S · M5 · S]` A body carrying gravity may also feel it (`gravity.feels`): it is then pulled by every other source as any free body is, but never by a source in its own welded assembly, so two rocks can orbit each other. Without it, sources feel no gravity (FLT-011).
- **FLT-015** `[M · M10 · U]` A source of gravity may pull as a uniform ball (`gravity.radius`): mu/r² outside the radius, strongest at its surface, and inside falling in a straight line to nothing at its centre (mu·r/radius³). *Mammoth Thrust's asteroid level (Chloe, 13 November 2026): the ball is the asteroid, its caves not modelled.*
- **FLT-015** `[M · M9 · P]` In a wrapped world, bodies shall collide across the edges: a contact uses the nearest copy of each body, so a pair meeting across an edge (or a corner) moves exactly as the same pair would away from the edges, and the ledger stays exact. A world that doesn't wrap is unchanged. (Mammoth Asteroids; it replaces Lander's duplicated terrain past its edges.)
- **FLT-016** `[M · M9 · S]` In a wrapped world, a blast's reach and everything an AI pilot measures (what it sees, what it aims at, the gravity it predicts, what it avoids) shall use the nearest copy. Gas and tractor beams don't yet.
- **FLT-009** `[M · M4b · E]` While a challenge runs, the sandbox shall show height, vertical and sideways speed, tilt and propellant; then the verdict with its reason and score, and a way to try again. This shall work by touch too.

*Model as built (M4b).*
- **The landing judge only reads the world.** It never pushes on anything, so the ledger is unchanged. Its verdict is also an event (`landed` or `crashed`) in the event log.
- **Feeds and injectors under gravity.** Moving propellant between stores at different heights, or from a store to an outlet, changes gravitational potential energy: the pump's work. The ledger records it as a transfer, like the angular momentum such moves change. Before, it showed as an energy residual whenever gravity was on.
- **Large bodies and gas.** The gas's wall grid covers only cells near gas, and a body still too big for that is tested against every parcel. A ground no longer costs a second a step, and gas no longer passes through a body bigger than the grid could hold. The far field ignores fixed bodies: gas far from everything that moves leaves, even over the ground.
- **Welds don't warm start.** Each step's weld impulses start from zero; contacts still warm start, which stacks need (COL-005). Reapplying last step's weld impulse after the load had changed made the velocity solve create kinetic energy. A landed ship was pushed back up off the pad, and a 6 m/s crash gained up to 19 J in a step, which the ledger reported. Weld loads come from each step's own impulse, so ASM-004 breaks are unchanged.
- **A weld carries at most its limits, inside the solve.** Each weld's impulse is capped at its limits × the timestep while the solve runs, and a weld held at a cap breaks at the end of the step, its load reported as the impulse it would have needed. Before, a breaking weld's excess impulse was taken back after the solve, but the welds next to it had been solved against the full impulse, so an off-centre hit on a chain of parts could gain up to 13% in kinetic energy, which the ledger reported. A random joints test (ASM-005) found it on CI. Every capped update lowers kinetic energy or leaves it, so breaking can't create energy; welds below their limits solve exactly as before.
- **Fuel economy is declared, not hidden (FLT-010).** The FT ship keeps LAND's 8.1 kg of propellant and its handling, and makes 19 parts in 20 of its exhaust from nothing. The ledger's `supply` source records the made mass, its momentum (it is made moving with the engine) and its energy. Every other conservation check is unchanged.
- **Gravity from asteroids is one way (FLT-011).** Rocks pull the ship and the gas, but not each other, and the ship doesn't pull them. They are 2–9 t against the ship's 27 kg, so the ship's pull on them would be tiny anyway, and without mutual pull they keep drifting slowly instead of falling together. The pull is softened inside each rock (`core`), so nothing blows up near a centre. Surface gravity is 0.5–1.2 m/s², against the ship's 4 m/s² of thrust, so you can always climb away.
- **Rocks that pull each other (FLT-014, Mammoth Lander's Binary).** Every part of a rock feels the other rock's core (each part by its own mass, so the whole rock accelerates as one), and its own core never. With each core's mu proportional to its rock's mass, the pulls are equal and opposite, so the pair's centre of mass stays put; it drifts about 7 m in 6 minutes because each part feels the other core at its own position, not at its rock's centre. The pulls are recorded under `field` like any other gravity.
- **Wrapping (FLT-012).** Whole assemblies wrap, never single parts, so welds never see a jump. Gas within the far field (10 m) wraps with them. Gas near an assembly that is straddling an edge waits outside until the assembly wraps and takes it, so a chamber half over the edge keeps its gas. Any other gas crossing an edge wraps on its own; none is lost at the edges. Bodies collide across the edges (FLT-015, below), and a tractor's beam and tether reach the nearest copy (14 November 2026, for Mammoth Thrust's wrapping levels); gas and wisps don't yet, so exhaust blown over an edge meets nothing until it wraps.
- **Collisions across the edges (FLT-015).** The contact search gives every body whose box crosses an edge a ghost box one width (or height, or both at a corner) back across; a body's box against another's ghost is a pair with that shift, kept once, with the nearest copy. The contact is then built with the second body at its position + shift (its lever arms, the discs' time of impact and the surface anchors all measured from that copy), and position correction separates the pair through the same copy (`wasm/solver/src/lib.rs`, the only change to the Rust). Impulses depend on velocities and lever arms only, so the pair moves as it would away from the edges: a property test compares 100 random disc pairs and 100 box pairs at each edge and corner with the same pair mid-world, equal to 7 decimal places. Linear momentum and energy are kept as in any contact. Angular momentum about the origin is not: the two sides of the contact are a world apart, as when a body wraps, and the ledger records the change under `contact`. A contact record carries the shift (`Contact.shift`; `point` is on the first body's side), and damage takes the second body's hit point as `point − shift`. Two bodies touch through one copy at a time, so together they must be narrower than the world. A world that doesn't wrap takes the old path: every scenario's world hash after 200 steps was unchanged by this, the wrapped ones included (measured 10 November 2026, before Lander's copies of its ground past the edges were taken out; they are no longer needed).
- **Blasts and pilots across the edges (FLT-016).** A blast measures to each body's nearest copy, so its damage reaches across an edge (its gas does not: gas doesn't cross yet). A shell also arms by its distance to its gun's nearest copy. A pilot takes every point it measures to (other ships, obstacles, a station's body, a waypoint, a shell coming at it) as the copy nearest its own ship, and gravity from each source's nearest copy, so it sees, aims, avoids and flies the short way round. A world that doesn't wrap takes the points as they are: all 46 scenarios give the same world hash after 400 steps as before (measured 10 November 2026).
- **The LAND ship stands on two splayed legs** welded to its wing. They give it a wide stance, so it is harder to tip over on touchdown.
- **Gas out of the plane (GAS-009).** A 2D world is a slab that never thins, so gas trapped in a pocket (under the wing, between the legs and the pad, between the two engines) stays there. In 3D the pocket is open at the front and back. That kept hot exhaust (about 2,800 K) under a landed ship, pushing it up by about 8% of its weight for well over a second, so it bobbed and never settled. LAND gives its world a depth of 2 m: gas older than 0.1 s, outside the engines' interiors, now spreads out of the plane, and the cushion is gone within about 0.4 s of cutoff. Whole parcels leave rather than parcels thinning. Thinning parcels, down to a twentieth of their neighbours' mass, were flung fast and ran out of thermal energy under the push of heavy neighbours. That forced the substep-halving retries, which made firing near the ground slower than before, and the clamps created energy (3 mJ in one step) that the ledger reported. Thrust in open space is about 3% lower, against 1–2% run-to-run jet noise, because exhaust just past the nozzle exit now thins; the chamber and nozzle themselves are declared closed. Firing near the ground costs about 1.5× a step in open space, down from 2.8×. The ground effect while firing remains. Other scenarios have no depth and are unchanged.

### 9.6 Damage (M5)

- **DMG-001** `[M · M5 · U]` Every component, joint and link shall have an integrity between 0 and 1.
- **DMG-002** `[M · M5 · S]` Contact energy above a material threshold shall reduce integrity at the struck component, following a declared damage rule.
- **DMG-003** `[M · M5 · S]` When integrity reaches 0, a component shall stop functioning, and a joint or link shall break.
- **DMG-004** `[M · M5 · S]` A damaged store shall leak its contents as parcels through the breach, at a rate depending on breach size and pressure.
- **DMG-005** `[M · M5 · S]` Armour struck first shall absorb contact before the component behind it is affected.
- **DMG-006** `[S · M5 · S]` Damage to chamber or nozzle geometry shall change the shape that gas collides with.
- **DMG-008** `[S · M8 · S]` A weld may declare a yield: a load beyond that share of its limits shall cost it integrity, down to 1 − (share − yield) ÷ (1 − yield), so it is left weaker and breaks sooner. The worst load sets it; bending doesn't heal.
- **DMG-009** `[M · M10 · U]` A body may have holes it vents gas through (`vents: {from?, rate, holes, parcel?, radius?}`): each hole emits the gas held by the body named (or its own; welded to it) at a steady rate times the hole's `size` (default 1), in parcels of `parcel` kg and `radius` m, as parcels moving out of the hole, with the body giving each its push, mass, momentum and energy conserved as a leak's (DMG-004). Mammoth Thrust's power plant leaks coolant this way.
- **DMG-007** `[M · M8 · S]` A non-fixed body that reaches 0 integrity shall leave the world in the step it is destroyed, with its welds and links, its stores and anything it holds. The ledger shall record its mass, momentum and energy as leaving through the boundary. Where it was, a burst of harmless dust shall drift off and fade over 20–30 s: 10–80 grains by its size, glowing for the first half second, coloured by what it was (rock, gold, hull). Dust has no mass, touches nothing and is outside the books. A pilot destroyed with its body lets go of its controls. *Added November 2026: destroyed asteroid pieces and ship parts used to stay as dark wreckage.*

*Model as built (M5).*
- **Only bodies with a material take damage.** A body's `material` is a threshold and a toughness, both in joules. A body without one can't be damaged, so the scenarios written before M5 (LAND, FT and the reference set) behave exactly as before. In FT you still bounce off asteroids, and welds still break only past their limits. Examples (`MATERIALS`): hull (50 J, 600 J), tank (20 J, 100 J), armour (100 J, 4000 J). The inspector sets one per part, or a custom pair.
- **The damage rule (DMG-002).** After each step, each pair of touching bodies shares the kinetic energy its contacts turned into heat that step (COL-006), half to each body. A body with a material loses (share − threshold) ÷ toughness of its integrity. A perfectly elastic bounce loses no energy, so it does no damage. Damage only reads the contacts. It never pushes on anything, so motion and the ledger are the same with or without materials.
- **Welds and links share the damage.** A weld on a struck body loses the same integrity, scaled by its anchor's distance from the hit: all of it at the struck point, none a body radius away. A damaged weld's limits are its limits × its integrity, so it breaks more easily. A link loses what either end loses.
- **Failure (DMG-003).** At 0 a body is wreckage. It keeps its shape, mass and motion, its injector stops (status "Destroyed"), and its welds and links break. A weld or link at 0 breaks. Events: `damage`, `destroyed`, `joint.break` (quantity `damage`) and `link.break`.
- **Armour (DMG-005)** is a material with a high threshold and toughness, welded in front of what it protects. A ram touches the armour, not the part behind it, so the armour takes the damage. In RS-11 a 40 kg ram at 10 m/s destroys a bare 10 kg tank, which takes about 150 J. Behind an 8 kg plate, the tank is untouched; the plate takes about 200 J and loses 2.5%.
- **Shown in the view.** Wreckage is drawn dark with an orange cross. The Damage overlay puts an integrity bar over each damaged part, coloured blue above 50%, yellow above 20% and orange below, with the percentage beside it.
- **Leaks (DMG-004).** A damaged body holding gas leaks it through a breach: where it was first hit, or the top of its outline if it was damaged by hand. A store's pressure is proportional to how full it is (a fixed volume at a fixed temperature), and the breach widens as integrity falls. So the leak is LEAK_RATE × (1 − integrity) × (gas mass ÷ gas capacity), with LEAK_RATE = 0.5 kg/s. It comes out as 2 g parcels at 10 m/s, spread across a breach width of 0.5 m × (1 − integrity). Each parcel is made exactly as an injector makes one, so the leak is a jet: it pushes the body the other way, and the ledger stays clean. Gas then expands as gas does: oxygen at 300 K leaking into vacuum spreads at a few hundred m/s. Only stores of gas species leak. A breach pressed against another body stays shut until it moves off. A tank holding both hydrogen and oxygen leaks a burnable mix, which hot gas can light (PRP-003).
- **A solve that gains energy is redone cold.** Contacts still warm start (COL-005), but reapplying last step's impulses can make the solve gain energy, and the welds don't always take it back within the iterations. A ship coming apart on a rock gained up to 13 J a step, and plain FT gained 0.19 J landing hard. If a step's contact and weld solve gains more than the ledger allows (`tol.energy` + 10⁻⁵ of the kinetic energy), it is solved again from the same velocities with every contact starting from zero. Every update then lowers kinetic energy or leaves it. Contacts on parts whose assembly broke apart last step don't warm start at all. The warm-start overshoot had also been counted as heat, so hits did too much damage.
- **Breakable flight test (FT-B).** FT's ship with materials and weld limits set by two sliders. Material strength scales every part's threshold and toughness (hull 50 J and 600 J, tank 20 J and 100 J at 1×). Weld strength scales the default weld limits. At 1× and 8 m/s onto a rock, legs snap off and the tank is wrecked and leaks. At 0.2× and 0.1× the ship comes apart. At 50× and 100× it bounces off whole.
- **Damaged engines (DMG-006).** An engine is made of wall bodies welded together (chamber, throat, nozzle). A wall at 0 integrity is wreckage, so its welds break and it drifts off, and the exhaust meets the shape that is left. Wreckage loses its welds and links however it reached 0, including integrity set by hand. In RS-08 with the left nozzle wall wrecked, the climb drops from 7.4 to 5.8 m/s after 2 s and the rocket spins at 1.6 rad/s instead of 0.2. Known limit: an engine's declared interior (GAS-009) stays where it was, so gas there still doesn't spread out of the plane.

### 9.7 Weapons (M6)

- **WPN-001** `[M · M6 · S]` A cannon shall accelerate a shell body using gas pressure in its chamber and barrel. Shot speed is not a configured constant.
- **WPN-002** `[M · M6 · S]` A firing shall conserve momentum between shell, cannon assembly and gas (ORC-009).
- **WPN-003** `[M · M6 · S]` A cannon mounted off the centre of mass shall impart spin to its ship on firing.
- **WPN-004** `[M · M6 · S]` Recoil load shall pass through the cannon's joints, which may break (ASM-004).
- **WPN-005** `[M · M6 · S]` A shell may carry an explosive charge (part of its mass, with declared chemical energy). Once armed (clear of the gun that loaded it), when it strikes something hard enough the charge shall detonate, turning its energy exactly into shrapnel and hot gas. *(Amended 2026-11: it was separated fuel and oxidiser mixing on impact.)*
- **WPN-006** `[M · M6 · P]` Explosions shall damage through represented gas, fragments and contacts, plus one declared blast term: every damageable body within a small blast radius takes a share of the charge's energy that falls off with distance and with the part of the view it fills. *(Amended 2026-11 by decision: it was gas, fragments and contacts only, with no radial damage formula.)*
- **WPN-007** `[S · M6 · S]` Stored shells shall be able to detonate in a chain reaction from neighbouring explosions.
- **WPN-008** `[M · M8 · S]` A railgun (`magazine.railgun`: channel, launch speed) shall launch its next shell from the muzzle along the bore, the step its channel is on and its reload has passed, with no propellant gas: the gun gives the shell its launch speed relative to the muzzle and takes the equal and opposite push, so momentum and angular momentum are exact; the shell's mass leaves the magazine as when a cannon loads. The energy comes from the ship's power, recorded in the ledger under `power`. *Added November 2026 as a stand-in for the gas cannon on Gunship 3: firing the gas cannon while thrusting hard pressed the 1 kg shell back against the breech, crushing its propellant, and a single step then took 5–18 s (the duel froze). The gas cannon stays for Gunship 2 and the cannon tests, to come back to.*
- **WPN-009** `[M · M10 · S]` A turret (`turret`: a turned joint, a railgun, a target, range, wait, hold, aim, spread) shall, while its target (a body named by the scenario, or by a game each step) is in range with a clear line past every fixed body, pick a bearing inside its joint's arc, turn to it, and fire its railgun only once the joint is on that bearing; then hold, and pick again. Aim `random` takes the bearing from the turret's own seeded generator; aim `ship` takes the target's present bearing with a random error within the spread. Its first shot comes no sooner than its wait after first sight. It is not a pilot.
- **WPN-010** `[M · M10 · U]` A turret may name a battery (`charge: {shots, capacity}`). Each shot shall take one from it, and with none the turret shall not fire. A generator (`generator: {battery, burn}`) that is whole and has fuel shall burn it and refill the battery to its capacity. The turret fires only while its gun, carriage, mount and battery are joined by unbroken joints. Burnt fuel is booked under `boundary`. *A first, simple rule: there is no power model yet.*
- **WPN-011** `[M · M10 · U]` A turret may be without power (`powered: false`): it then turns and fires nothing, as when it is off (Mammoth Thrust's power plant sets it).
- **WPN-012** `[M · M10 · U]` A turret may name the parts its power comes in through (`nodes`): any one destroyed or off its assembly, it can't fire. It is *online* while it is on, powered (WPN-011) and able to work: its aim can turn (the turning joint and its two bodies at least 30% whole), and its gun, barrel, nodes and battery are whole and on it. Mammoth Thrust draws an electric turret's two power nodes green while it is online and red while it isn't (Chloe, 14 November 2026).
- **WPN-013** `[M · M10 · U]` A turret's battery may stand apart, joined by a cable that can't be cut (`cabled`): it need only be whole, not on the turret's assembly. A turret with a battery is online only while it holds a shot. A generator fed through feed links (a pipe from a tank) runs only while *online*: whole, and with more than 1 g of fuel in the stores that reach it through whole links; it keeps no fuel of its own. Mammoth Thrust draws a generator's light green or red by that, and a capacitor's bar by its charge, red when empty (Chloe, 14 November 2026).

*Model as built so far (M6, first look).*
- **A gas cannon test (GUN).** A free-floating 100 kg cannon sits 20 m from the FT-B ship and is aimed at it. It is a breech block holding a charge of hydrogen and oxygen, welded to two barrel walls, with a solid 0.3 × 0.36 m shell in the 0.4 m bore. At 0.5 s (or on F) the breech injects the whole charge in 0.05 s and lights it. The hot gas drives the shell, and the cannon recoils. With the defaults (0.1 kg charge, 5 kg shell, 3 m barrel), the shell leaves at 28.7 m/s and the cannon recoils at 1.46 m/s. Without the asteroids' gravity, the momenta of shell, cannon and gas sum to zero within 10⁻⁶ (ORC-009). The shell can't be damaged; the ship's strengths are FT-B's sliders.
- **Magazines.** A body may carry a magazine: shells counted as part of its mass, and loaded one at a time at a set place in its own frame (a cannon's bore). A shell loads once that place is clear and the body's injector hasn't fired for the reload time. Loading during a shot fired two shells at once. A loaded shell becomes a body of its own, moving with that point of the carrier, and the carrier gives up its mass and the momentum it carries. Mass and momentum stay exact; the small change in angular momentum and kinetic energy, as the mass moves from the carrier's centre to the bore, is recorded as a transfer, like feeds.
- **Magazine stop (added 2026-11).** A loaded shell sat loose in the bore, so turning or accelerating rolled it out, and the magazine then loaded another (two lost in three seconds of hard turns in Gunship 2). A magazine may now declare a `stop`: a block welded across the bore just in front of the shell.
  - **Loading:** the stop comes out of the carrier's own mass when a shell loads, as the shell does, so mass and momentum stay exact.
  - **Firing:** when the cannon is about to fire (commanded, with its control link and propellant), in that step and before the charge fires, the stop goes back into the carrier (event `unlatched`). A cannon that can't fire keeps its stop in. Momentum is kept exactly. Spin keeps only the stop's motion relative to the carrier, so it doesn't depend on how fast they drift together. The small change in angular momentum, as the stop's mass moves to the carrier's centre, is recorded as a transfer, as when a shell loads. Kinetic energy the merge loses becomes heat.
  - **Gunship and Gunship 2** carry a 0.3 kg stop. Through the same three seconds of turns the shell stays within a few centimetres of its seat, then fires at 44 m/s. If the stop's weld breaks, it is debris and the shell is free.
- **Explosive shells (WPN-005, WPN-006, added 2026-11).** A shell may carry an `explosive` charge: kg of its mass, with chemical energy E = charge × heat (TNT's 4.2 MJ/kg by default, divided by the gas scale like all chemical energy), counted in the ledger in the shell and in shells still in a magazine. *Mammoth Asteroids (November 2026):* a charge may make more gas than its shell weighs (`gas`, kg, made from nothing when it bursts and recorded under the ledger's `supply`, as an engine's economy is): a 0.5 kg shell's own gas is too little to push 100 kg rock pieces, however hot. A charge may also be `safe`: it never goes off against the assembly of the gun that fired it. A material may take only a share of a blast's declared damage (`material.blast`, 0 to 1, default 1): hits, fragments and the blast's gas act on it in full.
  - **Arming:** a shell loaded from a magazine remembers its gun and arms once it is clear of that gun's assembly. A shell declared in a scenario names its gun (`from`).
  - **Detonation:** an armed shell detonates when a contact's impulse would change its speed by more than `arm` (5 m/s by default).
  - **Shrapnel:** the casing (mass − charge) breaks into up to 8 square fragments along the shell's outline (6 by default), thrown outward with 70% of E (the Gurney share). They are bodies, and damage what they hit by the ordinary contact rule. A fragment that would start inside something isn't made; the casing is shared among the rest. More, smaller fragments amid the blast gas were more than the gas step could follow, hence the cap of 8.
  - **Blast gas:** the charge becomes CO₂ gas carrying the rest of the energy, half as outward motion and half as heat. It is held one step (`world.blasts`, counted in the ledger) and released where the shell's footprint has moved to, by then about half a metre behind the fragments. Released at once, gas pressed against fragments flying apart was more than the gas step could follow.
  - **Blast damage:** every body with a material within the blast `radius` (2 m by default) takes E × the share of the view from the blast its outline fills (at most a half) × (1 − distance ÷ radius), through the ordinary damage rule, welds and links near the hit included. It ignores cover: a part behind another still takes it.
  - **Exactness:** mass, momentum and energy are exact through the burst. Fragments and gas come in opposite pairs; the gas's heat is what E leaves. The shift of mass from the shell's centre changes angular momentum and potential energy a little, recorded as a transfer.
  - **Measured, cannon test:** a 0.3 kg charge (12.6 kJ in the sandbox's gas scale) wrecks 7 of the target ship's parts, against 1 for a solid shell, with no violations.
  - **Asteroids: rock material.** Asteroid pieces now take damage as `rock` (threshold 10 J, toughness 200 J), so a blast or hit wrecks the pieces at it and breaks their welds there (DMG-002, DMG-003). Measured in GS-X with one explosive shell on the 5 m rock: three pieces at the blast are wrecked and the far side is untouched; without the material, nothing is wrecked and the six bonds that break are spread across the rock.
  - **Cracks start at the hit.** With weak bonds (2,000 N/m) the welds, solved as rigid links, carried each hit across the whole rock and most bonds broke by bending far from it. Real rock is the other way round: bonds strong enough to hold the rock together, and crushing where it is struck. The rubble scenarios now use 100,000 N/m and let the rock material do the cracking. Measured in GS-X over four explosive hits: every bond that breaks is on or next to the struck piece (52% before), and the ledger is clean; solid shells: 100% (72% before).
  - **Known limit:** once in four detonations on weak rock, the blast gas lodged in the cracks between pieces; the pieces closed on it, the gas step ran out of substeps, and the ledger reported 0.5 kJ (crushed gas, §10.1).
  - **Scenarios:**
    - *Cannon test: explosive shell (GUN-X):* the cannon test with sliders for the charge, fragments and blast radius.
    - *Gunship 2: explosive shells vs rubble (GS-X):* Gunship 2, alone among GS-R's four rubble asteroids, firing explosive shells. Sliders for the charge, fragments and radius, and the asteroids' pieces and bond strength.
- **Gunship (GS).** The FT-B ship with a 2 m gas cannon welded to its nose (breech 15 kg, barrel walls 4 kg each) and a magazine of 30 shells of 2 kg (up to 100). The ship's tank refills the charge through two feed links in 0.5 s. F fires; the engines have three times FT's injector rate to carry the extra 43 kg. Three unmanned copies of the ship drift 12–30 m away, and three of FT's asteroids 30–55 m out pull everything gently. Sliders: charge, shell mass, barrel length, number of shells, reload time, and FT-B's material and weld strength for every ship. The cannon's mount weld follows the weld slider, so a weak mount can tear off under recoil.
  - With the defaults, a shot leaves at about 44 m/s and kicks the 108 kg ship back by 0.86 m/s (1.4 m/s with 10 shells aboard).
  - One hit dents a target. A 6 kg shell on a 0.3 kg charge breaks one apart. Weak ships (0.3× material, 0.2× welds) shatter.
  - The arena doesn't wrap: a shell that went round the arena came back and hit the ship that fired it.
  - The cannon burns its propellant with the engines' 20× economy (FLT-010), as a more efficient propellant. The breech holds exactly one shot's draw, a 20th of the charge, so holding F longer can't fire a bigger shot. The tank refills it in 0.5 s.
- **Gunship 2 (GS2).** A more agile layout:
  - the engines 0.45 m further out each, 1.45 m from the middle;
  - the hull and tank between them, hull above tank, under a 3.9 m wing;
  - the cannon on the wing, 1.5 m lower than the Gunship's, with the same barrel;
  - 15 shells.

  It weighs 78 kg against 108 kg, with a moment of inertia of 75 kg·m² against 100. The centre of mass is at the cannon's base. Half a second on one engine spins it to 2.0 rad/s, against the Gunship's 1.0. The original Gunship is unchanged apart from the cannon's economy.
- **Gunship 3 (GS3, November 2026).** Gunship 2 was hard to fly. Gunship 3 is the same layout with:
  - *lean-burning engines:* 1 kg of hydrogen to 47 of oxygen (Gunship 2: 1 to 8), four times the mass flow (6 kg/s each) in parcels four times heavier (4 g). Each kilogram carries a quarter of the heat, so the exhaust leaves at about half the speed (99 m/s against 195, measured 2–4 m behind the ship) and each engine pushes twice as hard (574 N against 282). Full thrust gives 12.8 m/s² against 7.2. The economy is 80× (Gunship 2: 20×), so the tank lasts as long;
  - *welds twice as strong* (10,000 N tension, 20,000 compression, 6,000 shear, 4,000 N·m torque at weld strength 1);
  - *a faster gun:* 1 kg explosive shells (Gunship 2: 2 kg solid) at about 96 m/s against 45. First a gas cannon on a 0.4 kg charge; since November 2026 a railgun (WPN-008), which fires the instant F is pressed and never stalls the step. It carries 40 and reloads in 0.25 s (Gunship 2: 15, 1 s). A 0.35 kg charge gave 94 m/s but its first shot clamped crushed gas (32 J, reported by the ledger; see *crushed gas* below); 0.4 kg fired 20 shots clean;
  - *a 15 m tether* (TRC-003).

  It weighs 90 kg with its 40 shells. The base, tractor and AI scenarios now fly Gunship 3; the older scenarios keep Gunship 2. The exhaust's tail (GAS-011) applies everywhere.
- **The Mammoth (MAM, November 2026).** A big ship for a woolly mammoth pilot, built from separate parts welded together:
  - *cockpit:* a 4 × 6 m hull with a semicircular nose of radius 2 m, 8 m long in all (room behind the seat for an airlock and stores, not yet modelled inside);
  - *a 2 m square generator and a 2 m square battery* behind it. They are structure for now: there is no power model yet;
  - *two tanks,* one each side, each holding fuel and oxidiser (1.5 kg H₂, 12 kg O₂) and feeding all four engines, so either can run the ship;
  - *four lander engines,* two a side on outriggers: the front pair 7 m from the middle, the rear pair 5.5 m, so the front exhaust clears the rear pods (in line, it blasted them and lost a fifth of the thrust). Each burns 2.75 kg/s at 1 : 8 with 20× economy, in 12 g exhaust parcels (Gunship 3: 4 g): a third as many parcels, so a step with all four engines on costs about 4.9 ms instead of 7.5, for the same thrust; left Q works both left engines, right E both right ones;
  - *a railgun in the nose,* with 0.5 kg explosive shells (Gunship 3: 1 kg) carrying the same 0.3 kg charge, so the 40 shells weigh 20 kg, not 40;
  - *a tractor projector and a separate tether generator* at the tail (TRC-007), with a 25 m tether that breaks at 40,000 N and a 1,600 N beam.

  It weighs about 280 kg. Full thrust gives about 8.2 m/s² in open space, like the lander's 8.0, but being four times as long it turns about half as fast: half a second on one side spins it to about 0.8 rad/s, against the lander's 1.6. Matching that would need the engines about 10 m out or most of the mass at the middle. With one engine out, or one each side, a pilot tapping the stronger side holds the heading within about 1° at half thrust; with both on one side out it can only spin.
- **Crushed gas.** When a step's substeps can't keep a parcel's thermal energy from going negative, they are halved, up to 20 times. A parcel crushed between two parts closing on each other needed ever shorter substeps: a million in one step, 150 s, as a big shell smashed the ship. Now a halving that doesn't cut the shortfall by at least a quarter stops the retries. Each step also has a budget of 8,000 substeps, retries included. Past it the step finishes in one substep and clamps, and the ledger reports the energy clamped (1.3 J in that shot). *Since November 2026* the energy the clamp makes up is recorded as a correction, and the crushed parcels leave the gas (out of the plane) at the end of the step, becoming tail wisps. Before, the ledger reported it as a violation: with destroyed pieces leaving (DMG-007), blast gas was often crushed as the rest of a rock closed in, 100–170 J a step in GS-X, and Gunship 3's first shot at a 0.35 kg charge clamped 32 J.

### 9.8 Asteroids (M7)

- **AST-001** `[M · M7 · U]` An asteroid shall be an assembly of child bodies joined by breakable bonds, with per-child mineral composition.
- **AST-002** `[M · M7 · S]` A seeded generator shall produce asteroids with declared size, porosity and bond strength. The same seed gives the same asteroid.
- **AST-003** `[M · M7 · S]` An impact shall load nearby bonds, break those over their limit, and split the asteroid into independent parts with conserved mass and momentum.
- **AST-004** `[S · M7 · S]` Spin fast enough to overload bonds shall shed children without an impact.
- **AST-005** `[S · M7 · S]` Children below `limit.minFragment` shall become conserved mineral parcels.
- **AST-006** `[M · M7 · U]` A generated asteroid may hold valuable mineral pieces: `gold` of its pieces, chosen at random from its seed, are gold. They are denser than the rock and much tougher, and they are drawn gold once they can be seen.
- **AST-007** `[M · M7 · U]` A generated asteroid may hold `compounds` larger fragments: a few neighbouring pieces joined by hidden seams much stronger than its bonds, so they hold and are drawn as one piece. Once one has taken enough damage, its seams shall show and take ordinary bond limits, so it can be broken up further; a gold piece inside it shows then. So shall a larger fragment one of whose hidden seams breaks.
- **AST-008** `[M · M8 · S]` Mining by railgun, from the physics alone: in the Gunship 3 scenarios a rubble asteroid's first explosive hit shall damage it round the hit without destroying a piece, a few more shall knock pieces off and split it, and by about the eighth it shall be in several chunks, most of its pieces still there to mine. *Tuned November 2026 by shooting asteroids of four shapes eight times each (1 kg shells at 96 m/s, 0.3 kg charge, 2 m radius) while varying the rock and the bonds:* rock toughness 200 J let each hit destroy two to seven pieces (vaporised, nothing to mine); bond strength made no difference while pieces were that weak (their bonds broke by damage, not load). Tough rock (threshold 100 J, toughness 20,000 J) with weak bonds (3,500 N/m) does it: pieces survive hits, and the blast's push breaks the bonds. A side effect: a ship's exhaust blowing on a rock from close by can now crack a bond (the AI patrol cracks a few in a minute). Measured: hit 1 damages 3–6 pieces and destroys none (on two of four shapes it also knocks one or two edge pieces off); the rock splits by hit 3–4; by hit 8 it is in 4–10 chunks, having lost 1–4 of its 12 pieces.
- **AST-009** `[M · M9 · U]` A generated asteroid may give every piece gravity in proportion to its mass (`gravity: {G, core}`: mu = G × the piece's mass, felt by other rocks as FLT-014), so a rock's pull follows its pieces as it breaks. (Mammoth Asteroids.)
- **AST-010** `[M · M9 · U]` A generated asteroid's gold may be indestructible (`goldIndestructible`): its pieces carry no material, so nothing damages or removes them, while their welds still break.
- **AST-011** `[M · M9 · U]` A generated asteroid's pieces may pull as one (`gravity: {G, joined: true}`): the pieces welded together are one source at their centre, with their mu together, softened by half their reach from it; a piece that breaks off is a source of its own. From a distance the pull is the same as the pieces'. (Mammoth Asteroids, for its step time.)

*Model as built so far (M7, first look: AST-001…003).*
- **Generator (AST-002).** `generateAsteroid` cuts a lumpy convex outline (11 points at 0.75–1.1 × the radius) into the requested number of convex pieces. The pieces are Voronoi cells around seeded points, relaxed twice towards their centroids so they come out of similar size. Each piece is a body of mass density × area. Neighbours are welded at the middle of their shared edge, with the weld's axis across the border. Limits: tension and shear `bond × edge length`, compression 4×, torque `bond × length² / 4`. The same seed gives the same asteroid. A scenario declares one in `world.asteroids` ({id, seed, pieces, radius, density, bond, material, position, velocity, angle, angularVelocity}); `material` is given to every piece, and the asteroid scenarios use `rock`, so sliders can set pieces and bond strength. Mineral composition (the rest of AST-001) is not modelled yet.
- **Fracture is the weld rules (AST-003).** A hit loads the bonds near it. Those past their limit break, and the pieces split into separate parts with mass and momentum conserved (ASM-005). Because each piece is welded to several neighbours, a weak hit cracks bonds without anything coming off. Repeated hits on one spot chip pieces away.
- **Scale.** A 2 kg shell at 44 m/s carries about a thousandth of the momentum of a 25 t rock at 5 m/s. Bonds weak enough for a shell's load to break them (about 1,000–2,000 N/m) break across the whole rock, so a shell now chips rock through its material instead: the rubble rocks are 100,000 N/m, and the collision rocks, which must survive 3 m/s, 300,000 N/m. Each scenario has its own default, and a "× bond strength" slider.
- **Scenarios.**
  - *Gunship: rubble asteroids (GS-R)*: the gunship among four 3–5 m asteroids of 100 kg/m², 12 pieces at 100,000 N/m, in rock. A solid shell wrecks the piece it strikes, which comes away; the rest of the rock holds.
  - *Asteroid collision (AST-C)*: rocks of about 25 t and 17 t, 20 pieces at 300,000 N/m, with closing speed and offset sliders. At 3 m/s they chip; at 12 m/s both shatter, in 67 broken bonds.
  - These asteroids have no gravity: how gravity should split with a rock is still open.
- **Speed.** Finding which side of a weld each part is on searched every joint from every part. With 200 bonds that was 13 ms a step. Each part's welds are now listed once per pass, and the search stops as soon as it closes a loop: 1.8 ms. The collision scenario runs at about 2.3 ms a step. The rubble scenario runs at 5–10 ms a step while firing: its 100 bonds are solved every step.
- **Gold (AST-006).** `gold` pieces (default 0), picked with the asteroid's own random stream after its shape, so adding minerals never changes the outline or the pieces. A gold piece is `goldDensity` (default 2) times as dense as the rock. When the asteroid has a material, gold takes 5 times its threshold and 10 times its toughness (50 J and 2,000 J for rock), so it survives hits that wreck the rock round it. It is drawn dark gold with a bright edge.
- **Larger fragments (AST-007).** `compounds` (default 0) groups of `compoundSize` (default 3) pieces, each grown from a random piece through its bonds. Their seams are welds `seamStrength` (default 20) times as strong as an ordinary bond, holding the ordinary limits aside. They are drawn without the seams, orientation marks or damage bars, so the fragment reads as one. When it has lost `reveal` (default a quarter) of its integrity, weighted by mass, one of its pieces is wrecked, or one of its hidden seams breaks (overload, or a piece detached), its seams show: the welds take their ordinary limits (as damaged as they already are), its pieces are drawn as they are (gold included), and `compound.reveal` is raised. Revealing changes no motion, so the ledger is untouched.
- **Every piece pulls (AST-009).** With `gravity: {G, core?}` each piece is a source with mu = G × its mass (gold by its own, heavier, mass), softened by `core` (default: the piece's bounding radius), and `feels` set, so it is pulled by other rocks' pieces and never by its own rock's (FLT-014). A rock alone stays exactly at rest; from 40 m a 6 m rock pulls within 5% of G·M/r²; a piece cut loose falls back, and the rock toward it. The pull between two pieces is not quite equal and opposite when their cores differ; like all gravity it is recorded under `field`.
- **Indestructible gold (AST-010).** With `goldIndestructible` a gold piece carries no material, so contacts and blasts never damage it and it is never removed. Its welds still break: by load, and by the damage done to the rock pieces they join.
- **Rocks that pull as one (AST-011).** With `joined` on a source's gravity, the step gathers the joined sources of each welded assembly into one: at their mu-weighted centre, with the sum of their mu, and a core of half the assembly's reach from that centre (the furthest member's distance plus its own core). Members are not pulled by their own group; everything else is. Measured on a 6 m rock: 40 m away the pull is within 2% of the pieces' pull, 15 m away within 10%, and just off the surface it is between a half and all of it (the softening). Two joined rocks pull each other equal and opposite to within 5%. A scenario without `joined` is unchanged: all 47 give the same world hash after 400 steps. *What it saves (Mammoth Asteroids, level 8, Node on the cloud build machine, 11 November 2026):*

  | Gunships flying | Per-piece gravity, ms a step | Joined, ms a step | No rock gravity, ms a step |
  |---|---|---|---|
  | 0 | 2.92 | 2.13 | 2.19 |
  | 1 | 4.07 | 3.14 | 3.12 |
  | 2 | 5.08 | 3.86 | 3.85 |
  | 3 | 5.76 | 4.56 | 4.46 |

  Measured while the rocks were still whole (8 sources in place of 160). As rocks break up, each chunk is a source, so the saving shrinks: with every piece loose it is the per-piece cost again.
- **What it costs (Mammoth Asteroids' performance probe, `node scripts/asteroids-probe.ts`).** Levels 1–6 as that many 12 m, 20-piece rocks with every piece pulling, drifting at 2–5 m/s in a wrapped 284 × 160 m arena, with the LAND ship firing both engines throughout; 1,200 steps after 240, in Node on the cloud build machine (not an iPad), 10 November 2026. Budget: 6 ms a step.

  | Level | Bodies | Sources | Mean step, ms | Worst step, ms | Mean without rock gravity, ms |
  |---|---|---|---|---|---|
  | 1 | 39 | 20 | 0.93 | 4.0 | 1.00 |
  | 2 | 59 | 40 | 1.29 | 3.4 | 1.13 |
  | 3 | 79 | 60 | 1.34 | 4.7 | 1.29 |
  | 4 | 92 | 73 | 2.09 | 6.5 | 1.81 |
  | 5 | 119 | 100 | 2.37 | 5.3 | 1.86 |
  | 6 | 139 | 120 | 2.96 | 7.4 | 2.15 |

  | 8 | 179 | 160 | 3.74 | 6.8 | 2.37 |
  | 10 | 216 | 197 | 4.69 | 11.1 | 3.54 |
  | 12 | 259 | 240 | 5.67 | 13.8 | 3.55 |

  (Levels 8–12 over 600 steps.) Level N had N rocks with no upper limit, and gravity's cost grows with sources × bodies, so the mean passes the budget a little after level 12 on this machine, sooner on a slower one. **Decided (Chloe, 10 November 2026):** rocks are capped at 8 a level (MAS-020), and levels past 8 get harder through sooner, more frequent and more skilled gunships (MAS-043); what more gunships cost is measured when they are built. If per-piece gravity still proves too costly with the game running, the agreed fallback is one source per joined group of pieces (design §1.3).

  The mean is within the budget up to level 12; rock gravity is about 0.8 ms of level 6's step. Single steps reach 7.4 ms. The gravity loop was rewritten for this on plain numbers with no objects made (the same arithmetic: every scenario's hash is unchanged); before that level 6 took 3.4 ms. The probe has no slugs, gunship or game logic yet, and an iPad is slower than this machine, so it is repeated when the game runs.
- **In the scenarios.** GS-R, GS-X and TRC give every asteroid one gold piece, and one or two larger fragments (two in the first and third asteroid, one in the others). TRC's asteroids are light (6 kg/m²), so that the pieces they break into can be towed: rock pieces are 5–97 kg, gold 17–121 kg, and larger fragments 25–158 kg, against the tether's limit of about 96 kg (1.2 × the ship). Whole asteroids are too heavy, and so are the heaviest pieces of the 6 m boulder. Measured with GS-X's first explosive shell: the struck larger fragment shows its seams at once, and the ledger is clean. GS-R's solid shells reveal one after 14 hits.
- **Not yet.** Spin shedding (AST-004) needs loads for welds in loops. Dust (AST-005) needs pressureless particles.

### 9.8b Tractor beam and tether (M7)

Salvage: a ship pulls loose objects in with a beam and tows them home on a tether, to use or to sell.

- **TRC-001** `[M · M7 · U]` A ship's tractor shall project a beam while its control is on: a wedge (default 30°, 50 m) from a declared point, along a declared direction in the ship's frame. Without its control link, or once its body is wreckage, it does nothing.
- **TRC-002** `[M · M7 · P]` The beam shall pull every free assembly in the wedge toward its origin with a total force (default 400 N) shared equally between them, and pull the ship toward each with an equal and opposite force, so momentum and angular momentum are unchanged.
- **TRC-003** `[M · M7 · S]` When an assembly no bigger than the ship and at most a declared multiple of its mass (default 1.2) has its centre of mass within the tether's length (default 15 m) of the ship's, the beam shall stop and a tether shall take its piece nearest the ship. Heavier or bigger assemblies are only pulled.
- **TRC-004** `[M · M7 · P]` The tether shall be a stiff, damped spring (Hooke's law) of the declared length between the ship's centre of mass and the cargo's, acting along the line between them only, so the cargo swings freely round the ship without spinning it, and stays within about a metre of that length under normal flying. *Changed November 2026: it used to run from the tractor's origin at the ship's tail, so a swinging cargo spun the ship, which made it almost impossible to fly.*
- **TRC-005** `[M · M7 · U]` Pressing the control again shall let the cargo go. The beam shall not return until the control has been released and pressed afresh.
- **TRC-006** `[M · M7 · U]` A tether whose force passes its declared maximum shall break, raising `tether.break`.
- **TRC-007** `[S · M7 · U]` A tractor may name a separate body as its tether generator. While that body is gone, wrecked or no longer on the ship, the beam still pulls but no tether is made, and a tether already made lets go (`tether.release`).
- **TRC-008** `[M · M10 · U]` A tractor may siphon (`siphon: {rate, into}`): while its beam is on, the nearest body in the wedge that is marked `siphon` and holds propellant (not one of its own ship's) shall give that propellant to the named tanks at the rate, shared between the resources as the source holds them, until the beam is off, the source is empty or the tanks are full, conserving mass (booked under `transfer`). The siphon doesn't pull the source, and `only` (TRC-011) doesn't limit it.
- **TRC-009** Withdrawn (12 November 2026): `only` (TRC-011) does what `capture: false` was for.
- **TRC-010** `[M · M10 · S]` A tether may come to its length gradually (`tether.payOut`, m/s): taking cargo nearer or further than its length, it shall start at the distance the cargo was taken at and pay out, or reel in, at that rate to its length, so the two are neither thrown apart nor snatched together. With a reach (`tether.reach`, m) it shall take cargo from that far off, further than its length. Without them the tether takes cargo within its length and is that length at once (TRC-003, TRC-004). *Added 12 November 2026 while building Mammoth Thrust: a 34 kg pod taken at 9 m on a 12 m tether was pushed off with 6,000 N, which tore the tractor unit from the ship. The reach and the reeling in were asked for by Chloe after playing: picking the pod up was too hard.*
- **TRC-011** `[M · M10 · U]` A tractor may name its cargo (`only`: body ids): its beam shall then pull, and its tether take, those bodies and nothing else. *Asked for by Chloe after playing Mammoth Thrust: the tether was taking the wreckage of earlier ships.*
- **TRC-014** `[S · M10 · U]` A tractor may set its beam's top speed (`maxSpeed`): its pull on each assembly in the beam fades in a straight line from full, while the assembly isn't closing on the ship, to nothing at that closing speed, and its reaction on the ship with it. *Chloe, 14 November 2026: what the beam pulled in arrived fast enough to wreck the ship. Mammoth Thrust's is 3 m/s.*
- **TRC-013** `[S · M10 · U]` A tractor that names its cargo may still pull anything (`pullAny`): its beam then pulls whatever is free in its wedge, and only its tether is limited to the bodies named. *Chloe, 13 November 2026, to try the beam on everything again.*
- **TRC-012** `[M · M10 · U]` A tractor may name a separate body as its beam's generator (`beamFrom`). While that body is gone, wrecked or no longer on the ship, there shall be no beam, and a tether already made shall let go.

*Model as built (first look).*
- **Where it acts.** Tractors run once per step, after gravity and before contacts, as velocity changes on both ends. Each pull is a pair along the line between its two points, so momentum and angular momentum are exact. The ship and the cargo are assemblies; the welds share each pull in the contact solve, so a hard yank loads them.
- **Beam.** Pieces count when their centre of mass is in the wedge. Each assembly in the beam gets an equal share of the force, split between its pieces in the wedge by mass. Fixed bodies and the ship's own assembly are ignored; gas is not pulled.
- **Tether.** A spring of constant `stiffness` (default 2,000 N/m) with damping `damping` × critical (default 0.7) for the two assemblies' effective mass along the line. It is solved implicitly (backward Euler), with the effective mass of both whole assemblies, so it is stable however stiff. It pushes as well as pulls, so cargo caught while closing fast is held off at its length rather than hitting the ship. Past `maxTension` (default 20,000 N; 10,000 N in TRC), pulling or pushing, it carries its maximum for that step and breaks.
- **Ledger.** The ship powers the beam and the tether. The kinetic energy they add or take (the spring's stored energy and its damping included) is recorded under a new ledger source, `tractor`. Mass, momentum and angular momentum stay checked as before.
- **Events.** `tractor.on`, `tractor.off`, `tether.engage` (with the distance), `tether.release`, `tether.break` (with the force).
- **On screen.** The beam is a faint teal wedge. The tether is a line that warms from teal to red as its force nears the limit, dashed while it pushes. The inspector shows the mode, the cargo and the force.
- **Scenario: *Gunship 2: tractor beam and tether (TRC)*.** Gunship 2 (80 kg, 3.3 m from its centre of mass to its far edge) with a tractor at its tail, aimed backwards, on T. To pick up: an 80 kg ball half the ship's size, a 40 kg asteroid fragment, and an 18 kg derelict of three welded parts. A 6 m rock is too heavy to tow, so the beam pulls the ship to it. Three rubble asteroids to fly round, and a fixed base platform to bring cargo back to. Sliders for the beam force, tether length and breaking force. No gravity.
- **Measured.** Holding T from the start, the beam takes the ball on the tether at 20 m after 2.2 s (the tether was 20 m then; it is now 15 m, shortened for Gunship 3. With a 30 m tether, as first built: 1.6 s, and the ball stayed between 29.2 and 30.2 m under full thrust), with the ledger clean. The step takes about 4 ms.

### 9.8c Home base (M7)

The first piece of the game loop (§9.9): a base to bring what is mined back to.

- **BAS-001** `[M · M7 · S]` A base shall be a large asteroid with its own gravity (FLT-011), stronger the bigger it is, with a landing pad, an egg-cup collector, a control tower and a dome grouped on one side of its surface.
- **BAS-002** `[M · M7 · U]` A collector shall take loose cargo (no ship parts, small enough for its cup) that comes within its reach on a tether of its own, one piece at a time, the nearest first.
- **BAS-003** `[M · M7 · U]` While a ship still holds the same cargo, both tethers shall act, so ship, cargo and collector are connected; the collector's tether shall have much more give than the ship's.
- **BAS-004** `[M · M7 · U]` The collector shall reel its cargo in. Reeled in all the way, the cargo is captured: it leaves the world and its mass is counted as delivered, by mineral.

*Model as built (first look).*
- **Collector (`src/core/collector.ts`).** A component on a fixed body, with a `mouth` (the reel point, low in the cup).
  - *Taking cargo:* it takes the nearest piece of any free assembly with no ship parts (tractor, injector, magazine, collector) and no larger than `maxExtent` (default 3 m) that comes within `range` of the mouth (default 10 m). Its rest length starts at that distance, so taking it is no jolt.
  - *Tether:* the ship's implicit spring (TRC-004) with the collector's end fixed: `stiffness` 200 N/m (a tenth of a ship's), damping at critical. It breaks past `maxTension` (5,000 N).
  - *Reeling and capture:* the rest length shortens at `reel` (2 m/s). At zero, with the piece's edge within `capture` (2 m) of the mouth (its centre within 2 m plus its own reach, so a big piece resting in the bowl counts), the whole assembly is captured: taken out at the end of the step, with its welds and links. Its whole mass, stores included, is added to the collector's `delivered`, by mineral (`rock` for none). Events: `collector.engage`, `collector.break`, `cargo.collected`.
  - *Ledger:* the collector is fixed, so its pull is external. Its impulse and angular impulse, with the energy it adds or takes, go under `tractor`. Captured cargo leaving the world goes under `boundary`, like gas leaving.
  - *Reach:* first built with a 25 m reach, it took the loose shell in the parked ship's barrel 17 m away and tipped the ship over. 10 m keeps it to the cup.
- **Scenario: *Home base: mine and deliver (BASE)*.**
  - *The base asteroid:* a fixed 60 m rock (16-sided, flat-topped) with `gravity` mu 5,408 m³/s², core 10 m: about 1.9 m/s² at the surface, against Gunship 3's 12.8 m/s² at full thrust (Gunship 2: 6.9).
  - *On its 60 m plateau:* the pad at the centre, where gravity is straight down (off-centre, the plateau slopes against the pull and a parked ship slid). The egg cup (stem, floor, walls flared outward so the biggest cargo it takes reaches the bowl) to the right; a control tower and a dome to the left.
  - *Mining asteroids:* three rubble asteroids (TRC's light rock, gold and larger fragments) on circular orbits 140, 175 and 210 m from the base's centre, at 5–6 m/s.
  - *The ship:* Gunship 3 (Gunship 2 until November 2026) with the tractor on T, parked on the pad.
  - *Sliders and graphs:* sliders for the collector's reach and reel speed. Graphs of gold and rock delivered.
  - *Measured:* the parked ship stays put for 10 s, and the orbits hold to within 3% over that time. A step takes about 3 ms. The ledger is clean.
- **Not yet.** The base is fixed and indestructible, and buildings are plain fixed bodies with no function. Delivered material is counted but can't be spent. Recipes, building and ship upgrades are the next steps (§9.9).

### 9.9 Logged for later (not scheduled)

Found flying FT-B. A crash broke the tank off the ship, damaged but whole, and it still fed both engines while the ship still answered the keys. Today a link (ASM-006) joins its two ends wherever they are: it breaks only if an end is wrecked or the link's own integrity reaches 0. Nothing here has requirement IDs or a milestone yet.

- **Links that run through welds.** A feed or control link should follow the ship's structure, so it is cut when the ship splits between its ends.
  - *Option A (simplest):* a link works only while its two ends are in the same assembly, connected through welds. No authoring needed; any split that separates the ends cuts it.
  - *Option B (explicit routing):* a link names the welds it runs through (`via: ["w-wing-tank", …]`), and is cut when any of them breaks. Weld damage near a hit (DMG-003) can then cut a fuel line without the parts separating, and two links between the same parts can take different routes.
  - *Option C (pipes as parts):* the line is a run of thin bodies that can be hit and broken like anything else. The most physical, and the most to build.
  - Suggested: A as the default, B as an option for ships that declare routes. Open questions: does a cut feed spill what was in the line (a leak at the break, DMG-004), and should the sandbox draw link routes?
- **A cockpit.** A square component that stands for the pilot, where every control channel starts. Controls reach a component only while it is connected to a working cockpit. With the cockpit wrecked or broken off, the rest of the ship takes no commands, and its engines stop or keep their last setting (to decide). This is also where an AI pilot (§13) would sit later.
  - Open questions: is the connection the assembly (as in option A) or routed control links (as in B)? Can a ship have more than one cockpit, and which one wins? Should a cockpit take damage like any part, and does losing it count as a crash in challenges such as LAND?

- **Energy residuals in violent crashes.** Found with four Gunship 2 ships firing, when the player's ship ploughed into a target (welds and feed links breaking, leaks, damage). Steps through the crash show energy residuals of 1–4 mJ (tolerance 1 mJ), and one of 344 J in the step where the gun's feed link broke. Mass and momentum stay exact. It happens with or without chambers held as one volume (PRP-011), so it predates them. To investigate: contacts while welds break, leaks, and link breaks in the same step.

- **A home base, and the game loop.** Logged November 2026. With tractors (TRC), mineable asteroids holding gold (AST-006, AST-007) and ships that fly and fight, most of a basic game loop is here. The big missing piece is a base.
  - *The base asteroid.* A much larger asteroid, with more gravity because it is bigger: the first use of a body's gravity (FLT-011) at a scale where landing and take-off matter. Everything below is grouped together on one side of its surface.
  - *A landing pad*, for the ship to land on and refuel at (as in LAND).
  - *An egg-cup collector.* A cup-shaped structure open to the sky. Cargo that comes close to it gets a tether from the collector, the same model as a ship's (TRC-004). The ship can then let go of its own tether, and the collector holds the cargo and reels it in (a tether whose rest length shortens over time) until it settles in the cup, where it is captured and counted. Decided: while the ship and the collector both hold the cargo, both tethers act, so all three are connected; the collector's tether has much more give (a far softer spring) than the ship's, so it doesn't fight the ship. Captured means reeled in all the way: kept simple.
  - *Buildings for the look and the loop.* An airport-like control tower, and a dome-like structure, as the first buildings.
  - *The loop.* The ship flies out to the asteroids, mines valuables, brings them back, and spends them to improve the base or the ship.
  - *Progression.* The usual crafting tree: more materials unlock new buildings, which unlock new recipes, which need new materials from more dangerous places.
  - *Ship design is part of it.* Recipes unlock parts, and the player builds and refits ships from them in the sandbox's builder.
  - Needs, roughly in order: the base asteroid with gravity and the pad; the collector (a fixed tether that reels in, and a capture rule); a store of what has been delivered, kept with the world (these three are built: §9.8c); then recipes, buildings and part unlocks. More minerals than gold, and asteroids that are harder to reach, come with the tree.

### 9.10 AI pilots (M8, phases 1–3 built)

Enemy and neutral ships flown by the computer. For now they fly the gunship (Gunship 3 since November 2026), but nothing in the pilot may assume that ship: it must be able to fly any ship built from the parts in this spec. Specified November 2026; the plan comes next.

**Principles**
- **AIP-001** `[M · M8 · U]` A pilot shall fly only through the ship's control channels, as a player does: the same engines, cannon and tractor, the same physics, no forces or knowledge a player's ship doesn't have. It never moves bodies or changes the world directly.
- **AIP-002** `[M · M8 · D]` Pilots shall run inside the core's step, as a pure function of the world (their own state included) and the world's PRNG, at a fixed decision rate. A world with pilots replays, scrubs, branches and runs in the worker exactly as one without (DET).
- **AIP-003** `[M · M8 · U]` Each ship's channels shall be its own (for example `e1.left`), so many ships, flown by pilots or by the player, never share a control.
- **AIP-004** `[M · M8 · S]` A pilot shall learn the ship it is given before flying it: what each channel does to the ship's acceleration and turn rate, how fast its shells leave the barrel, where its beam and tether are. It learns this from the ship's design (its parts, engines, cannon and tractor, and where they sit about the centre of mass), and learns again when the ship changes (a part lost, a store empty). Trying its controls in a private copy of the world (calibration) is a fallback for ships whose design doesn't say enough.

**Skills**
- **AIP-005** `[M · M8 · S]` A pilot shall have a flight skill and a combat skill, each from 0 (novice) to 1 (ace), independent of each other.
  - *Flight skill* sets: how often it decides (reaction time), how precisely it holds a heading and a speed (control noise), how hard it manoeuvres (share of the ship's thrust and turn rate it uses), how far ahead it looks for collisions, and how well it allows for its own momentum when stopping.
  - *Combat skill* sets: aim error, how well it leads a moving target (from none to a full intercept solution with the shell's speed and both ships' motion), how tightly it waits for a firing solution before firing, how fast it reacts to being fired on, and how it chooses targets.

**Capabilities** (the building blocks every behaviour uses)
- **AIP-006** `[M · M8 · S]` *Thrust allocation:* turn a wanted acceleration and turn rate into channel commands between 0 and 1, from the calibration, doing the best the engines allow. Gunship 2 has no side thrusters, so it must turn to point its thrust; another ship might strafe.
- **AIP-007** `[M · M8 · S]` *Attitude:* turn to and hold a heading, without overshooting more than the flight skill allows.
- **AIP-008** `[M · M8 · S]` *Fly to a point:* arrive at a point and stop there (or pass through it at a set speed), allowing for gravity, with a speed limit. Within a tolerance that shrinks with flight skill.
- **AIP-009** `[M · M8 · S]` *Keep station:* hold a position, or an offset from a moving body (escorting, waiting by a rock).
- **AIP-010** `[M · M8 · S]` *Avoid collisions:* look ahead along its path for bodies (asteroids, other ships, the base) and steer round them. The look-ahead grows with flight skill.
- **AIP-011** `[M · M8 · S]` *Aim at a moving target:* point the cannon where a shell will meet the target, from both ships' positions and velocities, the measured muzzle speed, and gravity when it matters.
- **AIP-012** `[M · M8 · S]` *Fire control:* fire only when the aim error is within the skill's tolerance, the target is in range, the line of fire is clear of rocks and friends, and a shell is loaded.
- **AIP-013** `[M · M8 · S]` *Tractor and tether:* turn the beam onto a chosen piece, hold the button until the tether takes it, tow it to a point without breaking the tether (keeping the force under its limit), and let it go there.
- **AIP-014** `[S · M8 · S]` *Housekeeping:* watch propellant and shells, and go home (or stop fighting) when low.

**Behaviour modes**
- **AIP-015** `[M · M8 · S]` A pilot shall have one behaviour mode at a time, set in the scenario and changeable while running:
  - **Ignoring:** flies a route of waypoints in turn (looping or not), and ignores the player and every other ship, apart from not hitting them.
  - **Evading:** does what its *underlying* mode says (by default Ignoring), but when the player comes within a threat distance and is closing, it moves away until the distance is safe again, then carries on. Evading is a modifier on another mode.
  - **Mining:** picks an asteroid, keeps a safe distance from it and shoots it until pieces break off, picks a piece small enough to tow, tethers it and tows it to the sector's exit, and leaves with it: it has gone home. All slowly and carefully: low speeds, wide margins.
  - **Cautious:** goes about its route, but keeps its nose toward the player while the player is near. It fires on the player only after the player has fired toward it: a player's shell whose path passes within 4 ship widths of it, or any hit. The rage lasts a minute, then it calms down.
  - **Hunting:** attacks any ship it sees that isn't on its side, and pursues it: closes to firing range, keeps there, and fires.
  - **Mad:** irrational. It changes to a random other mode every minute (from the world's PRNG, so replays agree), and may turn on its own side.
- **AIP-016** `[M · M8 · S]` *Seeing:* a pilot knows about ships and rocks within its detection radius, rocks or no rocks in the way. Sides: each ship belongs to a side (the player's, or a named faction); Hunting attacks other sides only, and Cautious and Evading react to the player. (Later, line of sight, so that hiding behind rocks becomes stealth play.)

**Sandbox and tests**
- **AIP-017** `[M · M8 · E]` The sandbox shall show each pilot's mode, skills and current intention (target, waypoint, state) in the inspector, and optionally draw its plan (route, aim point, line of fire) as an overlay. Mode and skills can be changed live.
- **AIP-018** `[M · M8 · B]` Pilots shall be cheap: their decisions cost under 0.2 ms per ship per step on average, calibration excepted (done once, or rarely, and spread over steps).
- **AIP-019** `[M · M8 · S]` Each capability and each mode shall have a scenario test with a measurable pass, for example:
  - fly through five waypoints within a tolerance;
  - hit a target drifting across at a set speed in a set share of shots, rising with combat skill;
  - a miner delivers a rock to a collector;
  - a cautious ship holds fire until fired on, then returns fire;
  - an evader keeps its distance from a pursuing ship;
  - a mad ship changes mode every 60 s.

- **AIP-020** `[M · M9 · S]` A pilot may be in **clearing** mode (Mammoth Asteroids' demo): it collects visible gold within reach by flying into it slowly, otherwise shoots the rock pieces welded to the nearest gold to free it, otherwise the nearest rock, always avoiding collisions, through its own channels only.
- **Clearing (AIP-020), as built.** Loose gold (a visible gold piece on its own, or with one other piece on it) is collected by keeping station on it with no offset, at 1.2 m/s at most over the last 10 m, without steering round it or what lies within 10 m of it. With none loose it targets the rock piece welded to gold that is nearest (hidden gold counts), from 50 m, and backs off when the rock comes within 10 m of that distance. With no gold in any rock, the nearest rock piece. The other modes are unchanged: all 47 scenarios give the same world hash after 600 steps. Measured in Mammoth Asteroids' demo over four games: first gold collected in 20–65 game seconds in three of them; out of ships in 60–140 s; a level is rarely cleared.

*Model as built (phase 1: foundations; `src/core/pilot.ts`).*
- **Where it lives.** A `pilot` component on one body of a ship (for now: a computer built into it), flying that body's whole assembly. It runs at the start of each step, after the step's commands, every `interval` steps (default 8: 30 decisions a second). It sets only its own channels, so a player's key on the same channel is overridden. Its state (goal, what it has learned, what it last commanded) lives in the world, so saves, replays and branches carry it.
- **Its channels (AIP-003)** are those whose every control link leads into its own assembly. Scenarios give AI ships their own channel names (`e1.left`); a channel shared with another ship is left alone.
- **Learning the ship (AIP-004).**
  - *From the design:* each engine channel (an injector, not on a body with a magazine, so never the cannon's charge) pushes opposite its injector's direction, from its outlet. That gives the direction and the turning arm about the centre of mass.
  - *Strength:* a deliberate underestimate from the design (the injector's rate × 100 m/s), corrected in flight. Each decision it compares the acceleration and turn it saw (gravity taken out) with what its lagged commands should have given (engines answer in about 0.08 s), and adjusts each active channel's thrust (normalised least mean squares). It skips steps when anything touches the ship, or it is towing.
  - *Measured:* Gunship 2's left engine gives about 285 N; turning 90°, the pilot learns 284 N from a design guess of 150 N.
  - *Relearning:* it relearns the geometry when the ship's parts change, keeping what it has learned of channels that remain.
- **Thrust allocation (AIP-006).** Wanted body-frame force and torque become channel commands in [0, 1] by bounded least squares (clamped coordinate descent), with the torque weighted most. A ship whose engines all push one way can't push sideways, so it turns its thrust axis toward the force it wants and throttles up as it comes round (full when aligned, none past 60°).
- **Attitude (AIP-007).** A cascaded law: the heading error asks for a turn rate (capped at 0.8–2 rad/s by skill), and the rate error for an angular acceleration (capped at 2–6 rad/s²). Gunship 2 turns by firing one engine, which also pushes it, so gentle turns cost less unwanted thrust. It turns 90° and settles within 2° in 3 s.
- **Velocity and hover.**
  - *Gravity:* the force it wants is mass × (a correction toward the wanted velocity − gravity). Gravity is the uniform field plus every source (FLT-011), known from the world as a player's instruments would.
  - *Throttle errors:* an error along the thrust axis is fixed by throttle alone, always.
  - *Turning errors:* an error across the axis, or one needing braking, means turning the ship round. It lets small ones be, within a tolerance of 0.15–0.5 m/s by skill, with hysteresis to twice that. Without this, every overshoot set Gunship 2 spinning round to brake, which made the next overshoot.
  - *Trim:* a slow integral along the thrust axis, built only near the wanted velocity and unwound fast on overshoot, takes out steady errors such as a hover sinking.
  - *Measured:* it hovers 30 m above the base at under 0.15 m/s, holding height within 1 m, and reaches 5 m/s within its tolerance at flight skill 0.3 and 1.
- **Skill (AIP-005), so far:** flight skill sets the share of thrust and turn it uses, its gains, turn caps and tolerances. Combat skill waits for phase 3; the human failings model for phase 5.
- **Commands and sandbox.** `pilot.set` gives a pilot a new goal or skills; it keeps what it has learned. The inspector shows its intent, skills, commands and learned thrust.
- **Scenario: *AI pilot: first flight (AI-1)*.** A second Gunship 2 (`e1-*`, channels `e1.*`) with a pilot, 40 m over the base, with a timeline of goals: hover; 6 m/s right; 6 m/s left and up; point the nose at the horizon; hover. The player's ship waits on the pad. Slider: AI flight skill.
- **Cost (AIP-018):** a decision takes far under the 0.2 ms-per-step budget (tested); the scene runs at about 3.5 ms a step with gas.

*Model as built (phase 2: navigation and Ignoring).*
- **Fly to a point (AIP-008).** It flies at the fastest speed it could still stop from in the distance left: a half turn (π ÷ its turn-rate cap, plus 0.3 s), then braking at its share of the thrust less gravity. It aims to stop inside its tolerance (1–3 m by skill). It can also pass through a point at cruise speed (4–12 m/s by skill, or set).
  - *Measured:* 60 m off in open space, it stops within 2 m with no overshoot past 4 m. Under the base's gravity, 40 m across, it settles within 3 m.
  - *The fix that made this work:* the velocity loop's gain had to come down below the turning loop's (0.4–1 per second against a turn of about a second). Otherwise, near the mark under gravity, it kept flipping round.
- **Routes.** Waypoints in turn, passed through at cruise speed; the last one is stopped at unless the route loops. A waypoint counts as reached within twice its tolerance (4–8 m).
- **Keep station (AIP-009).** It holds an offset from a body, moving with it, and closes on the mark gently (speed ∝ the gap). On a mark drifting at 1.6 m/s it stays within 3.5 m and on average within 0.6 m/s of its speed.
  - *Throttle trim:* it now works only under gravity. In open space it wound up and overshot.
- **Avoid collisions (AIP-010).**
  - *Obstacles:* every other assembly, fixed or not, as a circle round its parts. Its own shells, loaded or fired, and their fragments are recognised by name and ignored.
  - *Looking ahead:* along the velocity it wants, over 3–7 s by skill. Anything it would pass closer than the clearance (both sizes plus 3–5 m) gets two responses:
    - a sideways push away from the closest approach;
    - a cap on the speed it may close on it at: what it could still stop from in the room left.
  - *First tries:* the push alone was too weak against a 9 m/s approach, and the AI ship hit the player's. Ignoring anything inside its own outline, meant to skip its loaded shell, also ignored a ship that came that close.
- **Ignoring mode (AIP-015).** `mode: "ignoring"` with a `route`: it flies the route, looping, and ignores everyone, apart from steering round them.
- **Overlay (AIP-017).** "AI plans": each pilot's waypoints as rings, a dashed line to where it is going, and a red ring round what it is steering past. The flight pad no longer shows buttons for channels a pilot flies.
- **Scenario: *AI pilot: patrol among the rocks (AI-2)*.** An AI Gunship 2 in Ignoring mode flies a loop of five waypoints through TRC's rubble asteroids, routed close to the rocks and past the player's ship. Sliders: AI flight skill, cruise speed.
  - *Measured:* at flight skill 0.3, 0.7 and 1, it goes round the whole loop and on in 60 s, with no contact with anything and no ledger violations, at about 6 ms a step with gas.

*Model as built (phase 3: combat, November 2026).*
- **Sides and seeing (AIP-016).** A pilot's `side` defaults to "enemy"; a ship with no pilot is the player's. It sees ships within `detect` (150 m). A ship, until cockpits exist, is an assembly with a working pilot or tractor, or a working engine and gun together: a gun or engine broken off on its own is debris.
- **Its gun.** The body with a magazine whose fire channel is its own (AIP-003): never a channel shared with another ship. Only Hunting and Cautious work the trigger.
- **Aiming (AIP-011).** The bore points where a shell meets the target: a quadratic intercept from both ships' positions and velocities and the muzzle speed, which it learns from its own shots (starting from 40 m/s; Gunship 2 measured 45). It allows for 30–100% of the target's motion by combat skill, plus an aim error of up to 4° at skill 0, steady for a second at a time. To point the bore it turns the thrust axis by the angle between them in the design (none for the gunships). While aiming it still thrusts along the nose, which holds its distance against the recoil.
- **Fire control (AIP-012).** It fires a 0.1 s pulse when a shell is loaded, the target is within 100 m, the aim is within 0.6°–4° by skill, and the line of fire is clear of everything but the target. Debris lighter than a fifth of its own ship doesn't count, and nor does a round still loaded in a bore.
- **Hunting.** It closes on the nearest foe to a stand-off of 35–55 m (by skill), matching its velocity, then attacks: aims and fires. It breaks off past the stand-off plus 40 m, or above 6 m/s relative.
  - *Measured* (Gunship 2s, 45 m apart, 10 s): 3–6 shots and 2–3 hits at combat skill 0, 0.5 and 1, against a target still or drifting at 3 m/s; ledger clean.
- **Cautious.** It flies its route; with the player within sight it stops and watches them. A foreign shell in flight whose path passes within 4 ship widths in the next 3 s, or a hit, starts a minute's rage: it attacks whoever fired.
- **Evading.** It flies its route, and runs (straight away, at 6–14 m/s by flight skill) from a foe within 60 m that is closing, until it is 100 m clear.
- **Found on the way.** Fuel fed out of a spinning tank carried spin energy that went unrecorded (a 3 mJ violation each step once a ship broke up); it is now a recorded transfer.
- **Next:** the combat-duel scenario (mini game 3), then phase 4 (Mining, Mad, the tractor and sector exits).

*Decided (November 2026).*
- **Who flies.** The pilot will be a creature, often a small woolly mammoth, sitting in a cockpit: a component still to design (§9.9). Until then the pilot is a computer built into the ship, on the ship as a whole.
- **Learning a ship** from its design is fine (AIP-004).
- **Seeing** is a detection radius to start; line of sight later, for stealth play (AIP-016).
- **Fired toward:** a shell passing within 4 ship widths. A cautious ship's rage lasts a minute.
- **Human failings:** low skill should both react slowly and make mistakes on purpose. How to model these simply is for the design: options include deciding from a delayed view of the world, deciding less often, noise on aim and controls, and occasional deliberate errors (misjudged distance, firing early), each scaled by (1 − skill) and drawn from the world's PRNG.
- **Sectors:** ships will come and go through a sector's exits (to specify). A miner tows its rock to an exit and leaves; it has gone home.
- **Mad** may hunt its own side.

### 9.11 Combat duel (mini game 3, M8)

Your Gunship 3 against an AI Gunship 3 among the asteroids: the first playable fight.

- **DUEL-001** `[M · M8 · S]` A scenario may declare a duel (`world.duel`): the player's ship and the enemy ships, each named by a body (its hull, or its pilot's body). A ship is out of the fight once that body is gone or nothing still welded to it is a working engine. The player wins when every enemy is out, and loses when they are; the verdict is judged after every step, in the world, and then stays. Events `duel.won` (with a score) and `duel.lost`.
- **DUEL-002** `[M · M8 · E]` The sandbox shall show each ship's health (the share of its parts still welded to its hull) and the time, and on the verdict a banner (won, with the score, or lost, with why) and a button to fight again.
- **DUEL-003** `[M · M8 · S]` A duel shall name bodies in the world.
- **DUEL-004** `[M · M8 · S]` A duel may be first to a number of kills (`kills`). Until then a knocked-out ship comes back: what is left of it bursts into dust, and a fresh copy, as it was at the start, appears at rest `respawn` m (default 90) from the surviving ship, at the first clear spot off the survivor's line of fire (shells still in flight along it would meet the new ship). The verdict waits `delay` s (default 3) after the deciding kill. Respawns are recorded as crossing the boundary. *AI-3 is first to 3 (slider), with a 3 s delay.*

*Model as built (November 2026).*
- **Score on a win:** 1,000 a kill, less 500 for each time you were knocked out, plus up to 500 for speed (none after 5 minutes).
- **Scenario: *Combat duel (AI-3)*.** The player's ship at the origin; an AI hunter 90 m away, off to one side so that the first shot is not a free hit (Hunting, combat skill 0.4 and flight skill 0.7 by default, both on sliders), among the four rubble asteroids of AI-2.
  - *Measured:* against a player who does nothing it closes in, holds off and fires; the first explosive shell that hits knocks the player out, at about 11 s, with the ledger clean. About 5.5 ms a step with the railgun (WPN-008); with the gas cannon, firing while thrusting could take 5–18 s a step.
- **Next:** balance (one hit is often enough: armour, more welds, or smaller blasts), several enemies, and Cautious or Evading ships as bystanders.

### 9.13 Ground that can be cratered (M10)

Ground made from an outline, which explosions and shells cut into, for Mammoth Thrust (`docs/games/mammoth-thrust-design.md` §11). Asked for by Chloe, 12 November 2026: physics-led play wants scenery that can be destroyed. Off unless a scenario declares `world.terrain`, and craters off unless it declares `terrain.craters`.

- **TER-001** `[M · M10 · S]` Ground may be given as one closed outline of the open space above and inside it (`world.terrain.outline`, clockwise, the rock on its left). Its rock shall be a crust of fixed bodies along the outline on its rock side, 15 m deep or as deep as the rock is. A crater is a disc of open space added to that: the rock inside it shall be gone, and the crust made afresh round it, so that craters on craters dig as deep as anyone digs, and through to a cave. A crater wholly in open space, or wholly inside another, changes nothing and isn't kept.
- **TER-002** `[M · M10 · S]` An explosion shall leave a crater where it went off, of radius `blast` (default 0.6) × the reach of its blast (the charge's declared radius), no bigger than `most`. One whose crater would be smaller than `least` leaves none.
- **TER-003** `[M · M10 · S]` A shell with no charge that strikes the ground shall be spent: it leaves the world, through the boundary. It shall leave a crater of radius `bullet` where it struck, or none if `bullet` is 0. Nothing else that strikes the ground leaves a crater.
- **TER-004** `[M · M10 · U]` A crater shall be drawn as open space: where the game draws the rock, plain black cut into it.
- **TER-005** `[M · M10 · B]` No more than `limit` craters shall be kept (default 250), nor more than `small` of them under 1 m (default 150): past that, new ones are not made. With 250 craters a level shall still step inside the budget.

- **TER-006** `[M · M10 · S]` A fixed body may be anchored to the ground (`anchored: {mass, group?}`). When a crater reaches its outline it shall come loose: a free body of that mass from then on, at rest where it is, with its welds kept, so that what is built on it goes with it. Those of one group shall come loose together, welded to each other. The mass that comes loose enters through the boundary. *Asked for by Chloe, 12 November 2026: let the physics rule.*
- **TER-007** `[M · M10 · U]` The ground may have islands of rock in its open space (`terrain.islands`: closed outlines, counter-clockwise, so the rock is on their left as the outline's is), crusted, cratered and drawn as the rest of the rock. *An asteroid floating in the open.*
- **TER-008** `[M · M10 · U]` In a world that wraps round (FLT-012), stretches of the ground's outline that lie along the world's edges are where the open space goes on round to the other side: they get no crust. Mammoth Thrust's levels wrap this way, with no walls at their sides.

- *The rock that was in a crater* leaves as dust, which is only drawn. The rock is fixed and has no mass in the ledger, so cutting it changes no total.
- *What stands on the ground* and is anchored (Mammoth Thrust's turret bases and the pod's stand) comes loose as soon as a crater touches it (TER-006). Half undermined, it is a free body resting on what rock is left, and tips or not as its weight falls. Fixed bodies that aren't anchored stay where they are.
- *What it costs* (Node, the build machine, Mammoth Thrust's level 1): cutting a crater takes 4 ms on average with 250 there already, 13 ms at worst. With 250 craters (584 rock bodies, where the level starts with 38) a step takes 1.9 ms with the ship falling and 3.7 ms with it thrusting, against 1.3 and 1.9 with none, and 6 ms allowed.
- *Mammoth Thrust keeps craters for explosions* (Chloe, 12 November 2026): `bullet` 0 and `least` 1 m there, so slugs and the turrets' bolts leave none. With a crater for each, three turrets firing every 2 s would have used the 150 small craters allowed in a few minutes, and 351 craters put a step over budget (6.4 ms thrusting).
- *Not done:* impacts of anything but shells (a ship or the pod crashing) leave no crater; Chloe may want that later.

### 9.12 Shield (M10)

A field round a ship that is a real surface, for Mammoth Thrust (`src/core/shield.ts`). Chloe's design, 14 November 2026, in place of the first plan (a declared cheat that reflected shells and gas and let rock through): a small, light generator on the ship; held on, a disc grows from nothing round the ship; it doesn't touch its own ship but everything else meets it, so it turns back objects, debris and gas, and the ship, rigidly joined to it, comes down on it against rock. The engines and gun don't work while it is up. It burns fuel fast, and more for every hit.

- **SHD-001** `[M · M10 · U]` A shield generator (`shield: {channel, radius, grow, burn, from, hitBurn, minHit, blocks, mass, to, at}`) shall put up its field while its channel is on, its control link is whole, it and the part `to` are still on one ship and the tanks `from` on that ship hold fuel: a disc body that starts 0.05 m across and grows at `grow` m/s to `radius`, centred at `at` in `to`'s frame. It shall burn `burn` kg/s from those tanks while up, and for each new contact with the field `max(minHit, hitBurn × impulse)` kg more. Otherwise the field shall be gone.
- **SHD-002** `[M · M10 · S]` The field shall be welded rigidly to `to` (nothing breaks the weld) and have no material: as part of the ship's assembly it doesn't collide with the ship, and everything else (rock, debris, shells, the pod) collides with it as with any body.
- **SHD-003** `[M · M10 · S]` Gas shall meet the field as it meets any body.
- **SHD-004** `[M · M10 · S]` The declared blast term (WPN-006) of a blast whose centre is outside a field shall not damage the bodies inside it.
- **SHD-005** `[M · M10 · P]` While a field is up the control links of its ship's channels `blocks` (the engines and the gun) shall be off (ASM-009), each marked as the shield's, and back on when it goes; the field's mass, coming and going, its growth and the fuel it burns shall be booked under `boundary`, so the ledger closes.
- *Measured* (Mammoth Thrust's ship, 0.8 kg/s, field 3.35 m and 2 kg): a 1 kg rock at 10 m/s comes back at about 4 m/s and costs 0.1 kg more; the ship falling 8 m onto rock with it up stops on the field, nothing touching the rock or breaking. Falling at 22 m/s it stops too, but the cockpit takes the whole blow through the weld, and three of the ship's own welds on the right broke. It doesn't bounce off rock: the engine's restitution is lost through the weld (a light body welded to a heavy one), so the ship stops dead on the field. A field grown while the ship is close to rock throws the ship off it.
- A step with the field up and the ship falling takes 0.8 ms (level 1).

## 10. Performance Requirements

- **NFR-001** `[M · M1 · B]` A benchmark command shall report steps per second for each reference scenario, and CI shall record results per commit.
- **NFR-002** `[S · M1 · B]` CI shall warn when a benchmark regresses by more than 20% against the main branch.
- **NFR-003** `[M · M1 · U]` Broad-phase collision shall scale sub-quadratically (e.g. a uniform grid or sweep-and-prune), verified by a benchmark at 100, 1,000 and 5,000 parcels.
- **NFR-004** `[S · M4 · P]` The system shall step the gas as independent clusters: gas that cannot reach another cluster's gas, or the same free assembly, within the step. Each cluster shall have only the bodies it can reach and its own substeps. The results shall not depend on the order the clusters are stepped in.

### 10.1 Gas performance: baseline and future options (not scheduled)

These are options for later, when a game needs more gas than the sandbox does. None is scheduled, and none is a requirement yet. Each would become one, with a benchmark, when it is taken up.

**Baseline** (measured 2026-11-04, headless Node on the development container, `sandbox` profile):
- One parcel for one substep costs about 1.8 µs. That is steady from 1,000 to 4,000 parcels, so cost grows with the number of parcels.
- A step's gas cost is therefore about parcels × substeps per step × 1.8 µs. Real time at 240 steps/s allows 4.2 ms a step: about 2,300 parcel-substeps.

| Gas | Substeps per step | Parcels in real time |
|---|---|---|
| 300 K gas at rest | 3 | about 750 |
| 3,000 K gas | 8 | about 300 |
| A firing engine's jet | about 24 | about 100 |

FLY, LAND and FT run at about 0.4–0.5× real time while firing (about 140 parcels).

**The bottleneck is the global substep.** Every parcel takes the substep the fastest gas anywhere needs (§9.4: CFL over all parcels and the smallest smoothing length). A few parcels at over 100 m/s in a nozzle set it for all the slow gas around them. GAS-008 (2,000 parcels in real time) holds for slow gas with some of the options below. It does not hold for engine exhaust without the first.

**Where the time goes** (measured with the phase timings in `stepGas`, Gunship 2 with both engines firing: 403 parcels, 35 substeps a step, 47 ms of gas a step against 4.2 ms for real time):

| Phase, every substep, every parcel | ms a step | Share |
|---|---|---|
| Neighbour search: sort into cells, list the pairs | 16.8 | 35% |
| Impulses and energy | 15.4 | 32% |
| Wall contacts and mirror ghosts | 11.5 | 24% |
| Density, drift, setup, write-back | 3.2 | 7% |

So per-parcel substeps cut only the impulses unless the neighbour and wall-contact searches stop being rebuilt every substep.

**What was tried** (2026-11):
- **Verlet lists** (Step 1 of an earlier plan): exact, but no faster (0.6–1.3×), because rebuilding the lists was not where the time went. Dropped.
- **Hot-loop tuning with bit-identical results:** walls filed only in grid cells that hold gas, a radix sort, no allocations per contact. 1.1–1.3× faster.
- **WebAssembly:** the neighbour search ported to C and compiled to WebAssembly found the same pairs bit for bit, but ran only 1.25–1.45× faster, and SIMD made it slower (the loop is scattered loads). Not worth a second implementation of the gas.
- **Per-parcel substeps, estimated first:** in Gunship 2 parcels need 8–64 substeps a step, mostly 16–32, so power-of-two levels would save only 1.3–1.6× there before the limiter neighbouring levels need (Saitoh & Makino 2009). They pay where a few fast parcels sit in a large calm cloud.
- **Where the parcels were:** of about 400 parcels in Gunship 2 firing, about 230 sat in the chambers, slow but hot; the nozzles held about 15; the rest was the plume.

**Plan, agreed 2026-11** (each its own change, exact conservation and replays kept):
1. **Chambers held as one volume** (PRP-011). Done: 4–6× in engine scenes.
2. **A finer neighbour grid:** dropped after step 1. With the chambers held, Gunship 2 firing has about 180 parcels, mostly the sparse plume: about 400 candidate pairs a substep for 53 real ones (it was 17,700 for 3,200). The time is now the fixed cost of each substep (filing about 75 walls, sorting) and the rest of the step. Those were trimmed instead, with results bit-identical: Gunship 2 firing about 7.5 ms a step, LAND about 3 ms (real time is 4.2 ms).
   Tried after that, and not kept:
   - **A substep from the signal velocity** (sound plus how fast neighbours close or part, with guards against reaching a wall or another stream unseen) instead of sound plus each parcel's own speed. In LAND it was more accurate (climb after 1 s 4.20 m/s, converged about 4.1–4.15, the current rule 4.40) with 28% fewer substeps. But in Gunship 2 it saved only 9% of substeps and its own checks cost more than that. Counting only closing speed was faster but 25% off (gas that expands within a substep pushes too hard with its start-of-substep pressure).
   - **More caching** (mass properties per shape, mixtures and chemical energy per composition, gas cells sorted by column): results identical, no measurable change.
   - So the current rule's time error is about 6% on LAND's climb, and the cost is now spread evenly over each substep's work: about 30 substeps a step in a firing scene. The remaining large lever is more cores.
3. **The simulation on a background thread** (a Web Worker). Done:
   - **How it works:** while playing, the page hands the worker runs of steps (up to 30 ms each) and draws the latest world meanwhile. The worker keeps its own copy of the world, so the page sends one only after it changed its own (an edit, undo, scrub or single step). Each run returns the new world, the graphs' samples and any snapshots.
   - **Same results:** stepping goes through one function, `runSteps`, on the page and in the worker. A run is taken in only if the sandbox hasn't changed since it was sent. If an edit makes the run in flight stale, the page steps that frame itself, so dragging never stalls the run.
   - **Fallback:** `?worker=0`, or a browser without workers, steps on the page as before.
   - **Measured** in Chromium, Gunship 2 with both engines firing: the simulation runs at 0.57× real time against 0.47× on the page, the page draws at 60 fps against 44, and its worst frames are 33 ms against 50. 0.57× is all the physics allows on that machine (about 7.5 ms a step), so the scene's own cost is now the limit.
4. **Gas clusters** (NFR-004). Done. Helper threads for them were tried, measured, and removed (10 November 2026):
   - **Clusters:** each step the gas splits into clusters that can't meet within the step. Two parcels are in one cluster if they are within their smoothing lengths, plus twice how far they can move relative to each other in the step, plus how far their own pressure could push each from rest (about c²·dt²/h, at most what gas expanding into vacuum covers, 2c·dt/(γ − 1)). A fixed body several pooled clusters reach is listed once. A free assembly they could reach joins them; a fixed body can't change, so it goes with every cluster that reaches it. Clusters under 32 parcels go together. Each cluster is stepped with only its own parcels and bodies, at its own substeps. The far field still sees every body.
   - **Cost:** splitting costs about 5% of the gas step. A four-ship fleet (Gunship 2 with the target ships' engines wired to the same keys) is one cluster while the ships are close, and three or four once their plumes draw apart.
   - **Helper threads (removed):** the simulation worker could hand clusters to helper threads (`?helpers=N`), with results taken back in cluster order so they were the same bit for bit. On the 4-core development machine the fleet stepped no faster with them: 27–30 ms a step alone, 42–49 with one helper, 47–62 with two. Copying the clusters out and back cost about 7 ms a step, and helpers ran about 30% slower per parcel on shared cores. They were off by default, and went when the gas's state moved toward the WebAssembly module's memory (`docs/perf/rust-trial.md`), which jobs passed as plain objects stood in the way of.
   - **What would make threads pay:** sharing memory (SharedArrayBuffer) instead of copying, which needs cross-origin isolation headers that GitHub Pages can't set (a service-worker shim can). With the gas held in the module's memory that becomes possible. Not scheduled.
5. **Per-parcel substeps: parked.** Measured with the chambers held, they would save nothing in any current scene. Parcel-substeps a step, the shared substep against per-parcel power-of-two levels: Gunship 2 firing 5,925 against 6,207; LAND 1,657 against 2,032; SC-02 10,648 against 15,488; RS-07 38,400 against 49,152. The plume's speeds are within about 2× of each other, and levels round up to powers of two. They would pay for a hot jet into a large, calm cloud (a station full of air), which no scene has yet.

The plume is kept as parcels: retiring supersonic exhaust once it is clear of the ship is a later option.

**Options**, roughly in order of likely gain. Gains are estimates until measured.

| Option | Likely gain | Cost and risk | Keeps exact replays? |
|---|---|---|---|
| **Per-parcel substeps** (local or block time-stepping): fast parcels take short substeps, slow ones long. | 3–5× in engine scenes, where most gas is slow | Hardest to keep exactly conserving. Pairs that cross time-step levels must be synchronised; standard in astrophysical SPH. | Yes, if levels are assigned deterministically |
| **Larger parcels.** Cost scales as 1/size³: more parcels per area, and smaller substeps. | About 3× for 1.4× larger | Cheap to try. The nozzle flow is already not resolution-converged (§9.5), and jets would wobble more. | Yes |
| **Simulation in a Web Worker**, off the main thread, so physics no longer shares it with drawing and the UI. | 1.5–2× physics per frame | Moderate plumbing (messages or shared state); no physics change | Yes |
| **Several CPU cores**, splitting the gas spatially. | 2–4× on 4–6 core phones and tablets | Needs SharedArrayBuffer, hence cross-origin isolation headers. GitHub Pages cannot set them; a service-worker shim can. Per-parcel sums must keep a fixed order. | Yes, with fixed summation order |
| **WebAssembly with SIMD** for the gas loop. | 1.5–3× | A port of `gas.ts`; WebAssembly floating point is deterministic | Yes |
| **Neighbour lists kept for several substeps** (Verlet lists with a skin) instead of re-sorting every substep. | Most of the search cost | Small and safe | Yes |
| **GPU (WebGPU) gas.** | 10–100× parcels | Results are not guaranteed identical across GPUs, which breaks replay, scrub and DET tests. Suited to cosmetic gas (visual smoke) over a coarser, exact CPU gas. | No |
| **Game-level budgets:** full detail only near what matters (ships, impacts), and merging or thinning distant gas. The far field (§9.5) and GAS-009 already do some of this. | Bounds cost by design | Design work; merging must follow PRF-003's conserving merge rule | Yes |

**Suggested order when needed:**
1. Profile a substep to see where the time goes.
2. Take the safe wins: Verlet lists and the Web Worker.
3. Add per-parcel substeps.
4. Use several cores.

Together these plausibly give 10× or more with exact replays kept. Cosmetic GPU smoke can come after.

**Superseded direction (November 2026):** exact replay of the gas is to be given up for gas on the GPU (WebGPU), with 4× detail and the rest kept as headroom for battles. See [`docs/gpu-gas-plan.md`](gpu-gas-plan.md); not yet built. Phase 0 (the reference battle and a WebGPU spike) found it no-go as first designed: each substep has a fixed GPU cost far above the budget ([`perf/gpu-gas-phase0.md`](perf/gpu-gas-phase0.md)). Two further spikes (each gas cluster as one GPU work-group, then with its neighbour search in on-chip memory) met the same wall: the gas's many small substeps, each a chain of stages, not its parcel count. Recommended next: a gas method with far fewer substeps, tried on the CPU first; whether to pause the GPU work is open.

## 11. Reference Scenarios

These live in `scenarios/` and serve as both tests and sandbox starting points.

### 11.1 Starter scenarios

Three scenarios are built into the sandbox and appear first in the scenario picker. Each is the simplest experiment that demonstrates one core idea. Each has adjustable parameters, a known correct answer, and a test that checks it.

- **SCN-008** `[M · M1 · E]` A scenario may declare parameters (name, unit, range, default). The sandbox shall show them as sliders/fields in a "Scenario" panel, and changing one shall reset and rerun the scenario.
- **SCN-009** `[M · M1 · S]` Tests shall run each starter scenario at its defaults and across a seeded sweep of its parameters, checking the expected results below.
- **SCN-010** `[M · M1 · E]` Each starter scenario shall open with the overlays, probes and graphs that show its key result already switched on, plus a one-paragraph "what to look for" note.

#### SC-01 — Elastic collision of two discs (M1)

| | |
|---|---|
| **Setup** | Disc A: radius 0.5 m, mass 1 kg, at x = −3 m, velocity +2 m/s. Disc B: radius 0.5 m, mass 3 kg, at x = +3 m, velocity −1 m/s. Head-on along the x-axis. Restitution 1, friction 0, no gravity. |
| **Parameters** | Both masses (0.1–100 kg), both velocities (−20 to +20 m/s), restitution (0–1), impact offset (0–0.9 × sum of radii). |
| **Expected** | After contact, A = −2.5 m/s and B = +0.5 m/s, from vₐ' = ((mₐ−m_b)vₐ + 2m_b·v_b)/(mₐ+m_b). Total momentum stays −1 kg·m/s and kinetic energy stays 3.5 J. With restitution e < 1, energy lost = ½·μ·(1−e²)·v_rel², where μ is the reduced mass. With an offset, momentum is still conserved and the discs leave at an angle. |
| **Shown** | Velocity vectors, contact impulse, graphs of each disc's velocity, total momentum and total kinetic energy. |
| **Checks** | ORC-002, COL-002, LED-001. |

#### SC-02 — Gas in a box (M3)

| | |
|---|---|
| **Setup** | A free square box, 2 m inside, walls 0.1 m thick, mass 10 kg. Inside: about 500 gas parcels (a 22 × 22 lattice) with 0.5 kg of gas in total, at 300 K. Velocities are random (seeded) and mirror-symmetric, so net momentum is zero. |
| **Parameters** | Parcel count (50–2,000), gas mass, temperature (50–3,000 K), box mass, initial layout (uniform, or all packed in the left half). |
| **Expected** | Uniform start: the box stays still (speed < `tol.velocity`), the gas stays spread evenly, and total momentum and energy are conserved. Left-half start: the gas expands to fill the box, the box rocks as gas hits the far wall, and box-plus-gas momentum stays zero. Wall pressure matches the gas model's equation of state to within `tol.pressure` once settled. |
| **Try** | Delete a wall while it runs. The gas escapes and the box recoils away from the gap. This is SC-03 discovered by hand. |
| **Shown** | Parcels coloured by temperature, box velocity, graphs of box momentum, gas momentum, their sum, and measured vs predicted wall pressure. |
| **Checks** | ORC-006, GAS-002, GAS-003, GAS-004, GAS-005. |

#### SC-03 — Simplest rocket: a box of hot gas with a hole (M3)

The simplest possible rocket has no fuel, no chemistry, no injector and no controls. It is a sealed box pre-filled with hot gas, with one hole.

| | |
|---|---|
| **Setup** | The SC-02 box, with a 0.4 m gap centred in its left wall. 1,000 parcels, 1 kg of gas, at 1,000 K. Nothing outside. |
| **Parameters** | Hole width (0.1–1.0 m), hole position along the wall (centred to offset), gas mass, temperature, box mass. |
| **Expected** | Gas jets out of the hole and the box accelerates to the right. Box momentum equals minus the momentum of the escaped gas, to within `tol.momentum` (ORC-008). The box's final Δv matches the rocket equation Δv = vₑ·ln(m₀/m₁), using the measured mean exhaust velocity (ORC-007). A centred hole gives no spin. An offset hole gives spin, with angular momentum conserved. A wider hole gives a shorter, stronger burst with the same total impulse, within tolerance. |
| **Shown** | Parcels, box velocity vector, graphs of thrust (box force), box speed vs the rocket equation prediction, and remaining gas mass. |
| **Checks** | ORC-007, ORC-008, PRP-005, PRP-006. |

**Path to a real engine (M4).** Each step is one change from the last and becomes its own scenario:

1. SC-03, plus a flared nozzle on the hole. Compare thrust with the plain hole.
2. Replace the pre-filled gas with an injector that feeds hot gas from a tank, controlled by a key.
3. Replace the hot gas with fuel and oxidiser that react in the chamber (RS-08).

### 11.2 All reference scenarios

| ID | Milestone | Scenario | Key checks |
|---|---|---|---|
| RS-00 | M1+ | Sandbox performance workload: 200 rigid bodies in continuous collision, one followed selection, all overlays on, graphs open. From M3, add 2,000 gas parcels. From M4, add one ship under thrust. | SBX-040, GAS-008 |
| RS-01 | M1 | **SC-01** Two discs, elastic collision | ORC-002 |
| RS-02 | M1 | Rod hit off-centre by a disc | ORC-003, COL-003 |
| RS-03 | M1 | Bullet vs thin wall at max speed | COL-004 |
| RS-04 | M1 | Box stack settles | COL-005 |
| RS-05 | M2 | Assembly with a weak joint, pulled apart by impulse | ASM-004, ASM-005 |
| RS-05b | M2 | Spinning three-part assembly sheds a pod mid-flight | SBX-015, SBX-016, ASM-005 |
| RS-06 | M3 | **SC-02** Gas in a box | ORC-006, GAS-005 |
| RS-07 | M3 | Gas burst in vacuum | GAS-006 |
| RS-07b | M3 | **SC-03** Simplest rocket: box of hot gas with a hole | ORC-007, ORC-008 |
| RS-08 | M4 | Single-engine chemical rocket, full burn | ORC-007, ORC-008 |
| RS-09 | M4 | Off-axis thruster spins a ship | PRP-006 |
| RS-10 | M4 | Engine attachment too weak for full thrust | ASM-004, PRP-005 |
| RS-16 | M4b | Twin-engine ship: both engines, then the left one only, then coasting | FLT-001…FLT-004 |
| RS-17 | M4b | **LAND** Twin-engine lander on a pad, 1.6 m/s² gravity, limited propellant | FLT-005…FLT-008 |
| RS-18 | M4b | **FT** Flight test: the LAND ship with 20× fuel economy among drifting asteroids with gravity, in a 240 × 160 m wrapped arena | FLT-010…FLT-013 |
| RS-11 | M5 | Ram an armoured vs an unarmoured tank | DMG-002, DMG-005 |
| RS-12 | M6 | Off-centre cannon fires | WPN-002, WPN-003 |
| RS-13 | M6 | Magazine chain reaction | WPN-007 |
| RS-14 | M7 | Shell fractures a spinning asteroid | AST-003 |

## 12. Milestones

### 12.1 Roadmap: mini games, then the main game

Logged November 2026. The work builds towards a few playable mini games, each a slice of the bigger game, and then a minimum viable version of the main game that combines them.

| Step | What it is | State, and what it needs |
|---|---|---|
| **Mini game 1: Lander** | Land a ship on a pad under gravity (FLT-005). | Done (LAND). |
| **Mini game 2: Asteroids** | Clear waves of asteroids. | In progress (M9): **Mammoth Asteroids**, `docs/games/mammoth-asteroids.md` (spec) and `mammoth-asteroids-design.md` (design and plan). |
| **Mini game 3: Combat duel** | A duel with an AI ship among the asteroids. | First version built (AI-3, §9.11), on AI pilots phases 1–3 (§9.10). |
| **Mini game 4: Thrust** | Fly a cave past turrets, take a pod on the tether and carry it out. | Draft spec (12 November 2026): **Mammoth Thrust**, `docs/games/mammoth-thrust.md` (spec) and `mammoth-thrust-design.md` (design and plan). The engine changes are agreed (12 November 2026): ASM-008, WPN-009, WPN-010, TRC-008, SHD-001…005 (M10). **The MVP is built** (12 November 2026): two levels, the ship, the pod, lives, the level's top, and the page `thrust.html`, with TRC-010. **Turrets are built too** (step 5: ASM-008, WPN-009, WPN-010). **The ground can be cratered** (TER-001…005). **Fuel through the beam is built** (step 7: TRC-008). **Level 3 and the electric turret** (13 November 2026, from Chloe's drawing). **The power plant** (13 November 2026, Chloe's design: DMG-009, WPN-011, ASM-009). **The shield** (14 November 2026, Chloe's design: SHD-001…005, a real surface). **Level 3, the canyon** (14 November 2026, Chloe's drawing; the winding cave is now level 4). **Level 5, the asteroid** (14 November 2026, Chloe's drawing, replacing the first design). |
| **Main game MVP** | A small economy with a tech and crafting tree; the home base (§9.8c); some kind of sector selection; mining in each sector, with combat threats in the more dangerous sectors. | Needs the rest: Mining and Mad pilots, sectors with exits (ships come and go), spending what is delivered (recipes, buildings, ship upgrades), and the cockpit with its mammoth pilot (§9.9). |

*AI pilot plan (M8), one PR per phase.* 1: foundations (pilots in the step, per-ship channels, learning the ship from its design and correcting in flight, thrust allocation, attitude). 2: navigation and Ignoring (fly to a point, routes, station keeping, collision avoidance, inspector and overlay). 3: combat (detection, sides, leading the target, fire control; Hunting, Cautious, Evading). 4: Mining and Mad (tractor control, a minimal sector exit). 5: skill model and tuning (a delayed view of the world and unsteady hands first; deliberate mistakes later), against the speed budget.

### 12.2 Milestones

Each milestone ends with: all its `M` requirements passing their stated verification (tests for `U`/`P`/`S`/`D`/`E`/`B`, a recorded review for `R`), its reference scenarios loadable in the sandbox, and a short demo note.

| Milestone | Delivers | Exit criteria |
|---|---|---|
| **M0 Foundation** | Repo layout, core skeleton, world serialisation, PRNG, profile, scenario schema and runner, CLI, CI, determinism harness, clickable UI mockup | `pnpm test` green in CI. An empty scenario runs headless and hashes identically twice. UI mockup approved (UXV-002). |
| **M1 Rigid bodies + sandbox v1** | Integrator, collisions, ledger, sandbox UI shell (layout, tools, inspector, overlays, graphs, command palette, undo) | RS-01…RS-04 pass (SC-01 built in). W1, W2, W5–W7 E2E tests pass. You have reviewed it unaided (UXV-003). |
| **M2 Assemblies** | Compound bodies, joints with limits, splitting, links, attach/detach/link tools, scrub-back and branching, optional gravity | RS-05 passes. W4 and W8 E2E tests pass. |
| **M3 Gas** | Gas parcels, pressure, wall interaction, boundary accounting, parcel rendering | RS-06, RS-07, RS-07b pass (SC-02 and SC-03 built in). GAS-008 benchmark met. |
| **M4 Propulsion** | Tanks, feeds, injectors, reactions, chambers, nozzles, key bindings, component status reasons | RS-08…RS-10 pass. W3 E2E test passes. A ship can be flown by hand in the sandbox. |
| **M4b Flight trials** | Ships of increasing complexity built from the M4 parts and flown by hand. First: a twin-engine ship steered by throttling one engine. Ports along long faces, a control channel per engine. Then a landing challenge under gravity. | RS-16 and RS-17 pass. W9 E2E test passes. FLT-009 E2E test passes. |
| **M5 Damage** | Integrity, damage rules, leaks, armour | RS-11 passes. |
| **M6 Weapons** | Gas-driven cannon, shells, fuzes, explosions | RS-12, RS-13 pass. |
| **M7 Asteroids** | Aggregate asteroid generator and fracture | RS-14 passes. |
| **M8 AI pilots** | Pilots that fly any ship through its controls: calibration, thrust allocation, flying, aiming, firing, tractor; skills; modes Ignoring, Evading, Mining, Cautious, Hunting, Mad (§9.10) | Every AIP scenario test passes. A Hunting Gunship 2 fights the player in the sandbox. |
| **M9 Mammoth Asteroids** | Collisions across wrap edges, wrap-aware blasts and AI, rocks whose every piece pulls (or that pull as one), indestructible gold, the clearing pilot, and the game (`docs/games/mammoth-asteroids.md`) | FLT-015, FLT-016, AST-009, AST-010, AST-011, AIP-020 tests pass; the game's MAS tests pass; review `docs/reviews/M9.md`. |
| **M10 Mammoth Thrust** | A joint that turns, turrets with a simple power rule, fuel through the tractor beam, a shield, and the game (`docs/games/mammoth-thrust.md`, `mammoth-thrust-design.md`). | The game's MTH requirements and ASM-008, WPN-009, WPN-010, TRC-008 to TRC-012, TER-001…006 and SHD-001…005 pass; `docs/reviews/M10.md`; Chloe has played it. |

## 13. Deferred: Game Layer

These are deliberately out of scope until the sandbox reaches M7. v0.1 of the spec (git history) contains draft requirements for most of them.

- AI-controlled enemy ships built from the same components and flown only through their control channels.
- Scooping and mining collection.
- Nanofactory manufacturing and repair.
- Ship designer as a separate game mode (the sandbox editor may grow into it).
- Sorties, economy, progression, missions.
- Sensors and limited information.
- Flight assistance software.

## 14. Decisions

**Confirmed 2026-11-03.** Change a decision by editing this table in a PR.

| ID | Decision | Proposed default | Why |
|---|---|---|---|
| DEC-01 | Platform | Browser (TypeScript + Vite), deployed to GitHub Pages. Core also runs in Node. | Already set up. Headless testing in Node is free. |
| DEC-02 | Physics engine | **Custom core in TypeScript**, not a library. | Gas-driven thrust needs tight control of gas–wall impulses and the ledger. Rapier is cross-platform deterministic in WASM, but makes per-parcel accounting harder. Revisit if M1 collision work stalls. |
| DEC-03 | Structure model | Rigid components joined by breakable joints (not deformable bodies). | Much simpler. It still allows bending-by-breaking and splitting. |
| DEC-04 | Gas model | Soft-sphere particles with pairwise pressure forces (DEM/SPH-like), with each parcel's thermal energy setting its pressure. | Pairwise forces give exact momentum conservation (GAS-002). It scales with a spatial grid. |
| DEC-05 | Timestep | 1/240 s fixed for `sandbox`. Gas takes CFL-limited substeps (Δt ≤ 0.25·h ÷ (sound speed + parcel speed)), halved and retried if a parcel's thermal energy would go negative. | Gas moves at the speed of sound: 300 K air needs about 22 substeps per step at 500 parcels in a 2 m box. *Tuned in M3.* |
| DEC-06 | World scale | Ships 5–30 m, gas parcels 0.05–0.2 m radius, max speed 2 km/s. | Keeps parcels much smaller than engines while staying within budget. Tune in M3–M4. |
| DEC-07 | Test tools | Vitest (unit, property, scenario), fast-check (property), Playwright (E2E: Chromium on every PR, Firefox and WebKit on every PR or nightly if too slow). | Standard, fast, TypeScript-native. |
| DEC-08 | Rendering | Canvas 2D first. Move to WebGL only if parcel rendering misses 60 fps. | Simplest path. Rendering stays behind an interface (TST-011). |
| DEC-09 | Reference hardware | A 2020-era mid-range laptop (4-core CPU, integrated GPU), Chromium. | Needed to make SBX-040 and GAS-008 testable. |
| DEC-11 | UI framework | **Preact + signals** for panels, plain Canvas 2D for the world view, CSS custom properties for theming. Testing with Playwright and Testing Library. | Panels need real components (inspector, palette, menus). Preact is small and React-compatible. Signals update fine-grained live values without re-rendering the whole UI each frame. |
| DEC-12 | Theme | Dark by default, light optional. | Physics overlays read better on dark. Light mode helps for screenshots and in daylight. |
| DEC-13 | Gas speed in the sandbox | The `sandbox` profile's gas is 100× "heavier" (`gasScale` 100): specific energies at a given temperature are 1/100, so sound and exhaust are 10× slower. All conservation laws, the rocket equation and thrust-from-gas still hold. The `test` profile keeps real gas, so the oracles check real physics. | Real gas needs about 20 substeps per step and runs at about 0.1× real time in the browser; heavy gas lets a ship's engine run at about real time. Chosen 2026-11-03. |
| DEC-10 | Cross-browser determinism | Same-runtime bit-exactness is a must. Cross-browser is a should (DET-003). | Cross-browser requires a custom trig library. Worth it before replays or multiplayer, not before. |

## 15. References

- EARS: Mavin et al., "Easy Approach to Requirements Syntax (EARS)", IEEE RE'09, pp. 317–322 — https://alistairmavin.com/ears/
- ECMAScript `Math` functions are implementation-approximated — https://tc39.es/ecma262/#sec-function-properties-of-the-math-object
- Cross-platform `Math.sin` differences — https://tc39.es/archives/bugzilla/285/
- Rapier determinism guarantees — https://rapier.rs/docs/user_guides/javascript/determinism
- Nielsen, "10 Usability Heuristics for User Interface Design" — https://www.nngroup.com/articles/ten-usability-heuristics/
- Algodoo UI (edge toolbars, properties panel, per-object menu, plotting) — https://en.wikipedia.org/wiki/Algodoo
- Box2D samples app (pause/single-step, debug draw, parameter tuning) — https://box2d.org/documentation/samples_app.html
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/
- Tsiolkovsky rocket equation — https://en.wikipedia.org/wiki/Tsiolkovsky_rocket_equation
- Erin Catto, "Iterative Dynamics with Temporal Coherence" (sequential impulses), GDC 2005 — https://box2d.org/publications/
