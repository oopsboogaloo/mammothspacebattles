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
- **Milestone:** `M0`–`M7` (§12).
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
- **SBX-002** `[M · M1 · E]` The sandbox shall provide a time scale from at least 1/16× to 8×, implemented as more or fewer fixed steps, never a larger timestep.
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

*Model as built (M3, DEC-04).* SPH with a Wendland C2 kernel (support h = 3 parcel spacings) and an ideal-gas equation of state per species, P = (γ − 1)·ρ·u in 2D (ρ in kg/m², P in N/m). Each step runs CFL-limited substeps. In each substep all impulses come from the state at its start, and each impulse's work, taken at the mean of the old and new velocities, is moved between kinetic and thermal energy. So momentum and angular momentum are conserved exactly and energy to rounding. Artificial viscosity (Monaghan α = 1, β = 2) is capped at the impulse that stops a pair closing. **Wall model (GAS-004):** a body surface is a mirror. Each parcel within h of a surface gets a ghost image, which the parcels on that face see. A ghost's impulse acts on the parcel and, equal and opposite along the same line, on the body, or on its free assembly as one rigid unit. At rest this presses on walls at the equation-of-state pressure, to within about 1% in SC-02. Parcels on opposite faces of a thin wall don't interact.

### 9.5 Gas-driven propulsion (M4)

Thrust must come from gas pushing on engine geometry. No component applies a direct force.

- **PRP-001** `[M · M4 · U]` A tank shall hold a resource with mass and shall update its assembly's mass as it drains.
- **PRP-002** `[M · M4 · S]` When an injector receives a non-zero command on its control channel, it shall draw fuel and oxidiser through intact feed links and emit parcels into its chamber. The rate is limited by command value, link capacity and supply.
- **PRP-003** `[M · M4 · S]` When fuel and oxidiser parcels meet ignition conditions, they shall react by a declared rule into hot product parcels, conserving mass and momentum and converting chemical to thermal energy as declared.
- **PRP-004** `[M · M4 · S]` A chamber with no opening shall produce no net thrust (ORC-006 applied to a chamber).
- **PRP-005** `[M · M4 · S]` A chamber with a nozzle shall produce thrust along the nozzle axis, emerging only from gas–wall impulses (ORC-008).
- **PRP-006** `[M · M4 · S]` A thruster mounted off the centre of mass shall produce torque, with no special-case code.
- **PRP-007** `[M · M4 · S]` Burning a ship's full propellant shall match the rocket equation (ORC-007).
- **PRP-008** `[M · M4 · S]` Changing nozzle geometry (length, flare, damage) shall change thrust magnitude, direction or efficiency as a consequence of gas–wall interaction.
- **PRP-009** `[M · M4 · S]` If a feed link is broken or a reactant runs out, then no new reaction gas shall be produced from that feed.
- **PRP-010** `[S · M4 · B]` A reference single-engine ship shall sustain thrust in real time within the parcel budget of GAS-008.

*Model as built (M4).*
- **Tanks** are stores. Propellant in a store counts toward its body's mass, and carries thermal energy (at 300 K) and chemical energy in the ledger.
- **An injector** is a component on a body. It is commanded through a control link on its channel and draws its mixture from its own stores, which feed links top up. At its outlet it emits parcels at up to `rate` × command kg/s. The injector recoils, so momentum is unchanged, and the parcel's thermal energy absorbs any kinetic energy the injection adds, so energy is unchanged.
- **The reaction is declared:** H₂ + 8 O₂ → H₂O releases 3.4×10⁷ J per kg of H₂, about 3,000 K in the products. (The real lower heating value is 1.2×10⁸ J/kg; the declared figure stands in for dissociation.) It burns completely in a step, in a parcel holding both reactants, if the parcel or any parcel within its smoothing length is at 800 K or more. With an igniter on, what an injector emits burns at once.
- **Thrust** is only gas on the chamber and nozzle walls.
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
- **FLT-009** `[M · M4b · E]` While a challenge runs, the sandbox shall show height, vertical and sideways speed, tilt and propellant; then the verdict with its reason and score, and a way to try again. This shall work by touch too.

*Model as built (M4b).*
- **The landing judge only reads the world.** It never pushes on anything, so the ledger is unchanged. Its verdict is also an event (`landed` or `crashed`) in the event log.
- **Feeds and injectors under gravity.** Moving propellant between stores at different heights, or from a store to an outlet, changes gravitational potential energy: the pump's work. The ledger records it as a transfer, like the angular momentum such moves change. Before, it showed as an energy residual whenever gravity was on.
- **Large bodies and gas.** The gas's wall grid covers only cells near gas, and a body still too big for that is tested against every parcel. A ground no longer costs a second a step, and gas no longer passes through a body bigger than the grid could hold. The far field ignores fixed bodies: gas far from everything that moves leaves, even over the ground.
- **Welds don't warm start.** Each step's weld impulses start from zero; contacts still warm start, which stacks need (COL-005). Reapplying last step's weld impulse after the load had changed made the velocity solve create kinetic energy. A landed ship was pushed back up off the pad, and a 6 m/s crash gained up to 19 J in a step, which the ledger reported. Weld loads come from each step's own impulse, so ASM-004 breaks are unchanged.
- **Fuel economy is declared, not hidden (FLT-010).** The FT ship keeps LAND's 8.1 kg of propellant and its handling, and makes 19 parts in 20 of its exhaust from nothing. The ledger's `supply` source records the made mass, its momentum (it is made moving with the engine) and its energy. Every other conservation check is unchanged.
- **Gravity from asteroids is one way (FLT-011).** Rocks pull the ship and the gas, but not each other, and the ship doesn't pull them. They are 2–9 t against the ship's 27 kg, so the ship's pull on them would be tiny anyway, and without mutual pull they keep drifting slowly instead of falling together. The pull is softened inside each rock (`core`), so nothing blows up near a centre. Surface gravity is 0.5–1.2 m/s², against the ship's 4 m/s² of thrust, so you can always climb away.
- **Wrapping (FLT-012).** Whole assemblies wrap, never single parts, so welds never see a jump. Gas within the far field (10 m) wraps with them. Gas near an assembly that is straddling an edge waits outside until the assembly wraps and takes it, so a chamber half over the edge keeps its gas. Any other gas crossing an edge wraps on its own; none is lost at the edges. Known limit: **nothing collides across the seam.** A ship and a rock on opposite sides of an edge pass through each other until one of them wraps. The arena is 240 × 160 m and the rocks drift at 0.1–0.3 m/s, so this is rare.
- **The LAND ship stands on two splayed legs** welded to its wing. They give it a wide stance, so it is harder to tip over on touchdown.
- **Gas out of the plane (GAS-009).** A 2D world is a slab that never thins, so gas trapped in a pocket (under the wing, between the legs and the pad, between the two engines) stays there. In 3D the pocket is open at the front and back. That kept hot exhaust (about 2,800 K) under a landed ship, pushing it up by about 8% of its weight for well over a second, so it bobbed and never settled. LAND gives its world a depth of 2 m: gas older than 0.1 s, outside the engines' interiors, now spreads out of the plane, and the cushion is gone within about 0.4 s of cutoff. Whole parcels leave rather than parcels thinning. Thinning parcels, down to a twentieth of their neighbours' mass, were flung fast and ran out of thermal energy under the push of heavy neighbours. That forced the substep-halving retries, which made firing near the ground slower than before, and the clamps created energy (3 mJ in one step) that the ledger reported. Thrust in open space is about 3% lower, against 1–2% run-to-run jet noise, because exhaust just past the nozzle exit now thins; the chamber and nozzle themselves are declared closed. Firing near the ground costs about 1.5× a step in open space, down from 2.8×. The ground effect while firing remains. Other scenarios have no depth and are unchanged.

### 9.6 Damage (M5)

- **DMG-001** `[M · M5 · U]` Every component, joint and link shall have an integrity between 0 and 1.
- **DMG-002** `[M · M5 · S]` Contact energy above a material threshold shall reduce integrity at the struck component, following a declared damage rule.
- **DMG-003** `[M · M5 · S]` When integrity reaches 0, a component shall stop functioning, and a joint or link shall break.
- **DMG-004** `[M · M5 · S]` A damaged store shall leak its contents as parcels through the breach, at a rate depending on breach size and pressure.
- **DMG-005** `[M · M5 · S]` Armour struck first shall absorb contact before the component behind it is affected.
- **DMG-006** `[S · M5 · S]` Damage to chamber or nozzle geometry shall change the shape that gas collides with.

### 9.7 Weapons (M6)

- **WPN-001** `[M · M6 · S]` A cannon shall accelerate a shell body using gas pressure in its chamber and barrel. Shot speed is not a configured constant.
- **WPN-002** `[M · M6 · S]` A firing shall conserve momentum between shell, cannon assembly and gas (ORC-009).
- **WPN-003** `[M · M6 · S]` A cannon mounted off the centre of mass shall impart spin to its ship on firing.
- **WPN-004** `[M · M6 · S]` Recoil load shall pass through the cannon's joints, which may break (ASM-004).
- **WPN-005** `[M · M6 · S]` A shell may carry separated fuel and oxidiser. When an impact fuze triggers or the shell is damaged enough, the reactants shall mix and react, releasing hot gas.
- **WPN-006** `[M · M6 · P]` Explosions shall damage only through represented gas, fragments and contacts. There is no radial damage formula.
- **WPN-007** `[S · M6 · S]` Stored shells shall be able to detonate in a chain reaction from neighbouring explosions.

### 9.8 Asteroids (M7)

- **AST-001** `[M · M7 · U]` An asteroid shall be an assembly of child bodies joined by breakable bonds, with per-child mineral composition.
- **AST-002** `[M · M7 · S]` A seeded generator shall produce asteroids with declared size, porosity and bond strength. The same seed gives the same asteroid.
- **AST-003** `[M · M7 · S]` An impact shall load nearby bonds, break those over their limit, and split the asteroid into independent parts with conserved mass and momentum.
- **AST-004** `[S · M7 · S]` Spin fast enough to overload bonds shall shed children without an impact.
- **AST-005** `[S · M7 · S]` Children below `limit.minFragment` shall become conserved mineral parcels.

## 10. Performance Requirements

- **NFR-001** `[M · M1 · B]` A benchmark command shall report steps per second for each reference scenario, and CI shall record results per commit.
- **NFR-002** `[S · M1 · B]` CI shall warn when a benchmark regresses by more than 20% against the main branch.
- **NFR-003** `[M · M1 · U]` Broad-phase collision shall scale sub-quadratically (e.g. a uniform grid or sweep-and-prune), verified by a benchmark at 100, 1,000 and 5,000 parcels.

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
