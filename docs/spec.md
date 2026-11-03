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
| Blocking decisions left open | Proposed defaults given (§14). Please confirm or override. |

## 2. Principles

1. **Headless first.** Everything the simulation can do, it can do from Node with no browser. The UI is a client of the core.
2. **Tests are the contract.** A behaviour exists only when an automated test demonstrates it.
3. **No cheating physics.** Ships move only because momentum is exchanged with represented matter (gas, shells, collisions). The code never sets a velocity or applies a force from nowhere.
4. **Conservation is measured, not assumed.** Every step publishes a ledger of mass, momentum, angular momentum and energy. Tests and the UI both read it.
5. **Determinism.** The same scenario, seed and command timeline produce the same result.
6. **One scenario format everywhere.** The same scenario file runs in a test, a CLI and the sandbox UI. An experiment saved from the UI can become a regression test.

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

- **LED-001** `[M · M1 · P]` After every step, the system shall record total mass, linear momentum, angular momentum about the world origin, and total energy split into kinetic, thermal and chemical.
- **LED-002** `[M · M1 · P]` The ledger shall attribute each change to its source: external field, reaction, removal at the world boundary, or numerical residual.
- **LED-003** `[M · M1 · P]` If an unattributed residual exceeds its profile tolerance, then the system shall record a conservation violation with step number, quantity, magnitude and the entities involved.
- **LED-004** `[S · M1 · B]` The system shall report per-step compute time for each subsystem and active counts of bodies, contacts, joints and gas parcels.

### 5.4 Simulation profile

- **PRF-001** `[M · M0 · U]` The system shall load a named profile declaring: timestep, solver iterations, tolerances for mass, momentum, angular momentum, energy and penetration, and limits for bodies, gas parcels and contacts.
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
- **ORC-002** `[M · M1 · S]` 1D elastic and inelastic collisions of two discs shall match the closed-form final velocities to within `tol.momentum`.
- **ORC-003** `[M · M1 · S]` An off-centre impact on a resting body shall produce linear and angular velocities matching the impulse equations.
- **ORC-004** `[M · M2 · S]` Mass, centre of mass and moment of inertia of compound assemblies shall match hand-computed values (parallel axis theorem).
- **ORC-005** `[S · M2 · S]` Where gravity is enabled, a two-body circular orbit shall keep its radius and period within tolerance for 10 orbits.
- **ORC-006** `[M · M3 · P]` A sealed box of gas at rest shall keep zero net momentum on the box and conserve total energy within tolerance.
- **ORC-007** `[M · M4 · S]` A rocket burning its full propellant shall reach a Δv within `tol.rocket` of the Tsiolkovsky prediction Δv = vₑ·ln(m₀/m₁), where vₑ is the measured mean exhaust velocity.
- **ORC-008** `[M · M4 · P]` The impulse on a ship over a burn shall equal, within tolerance, minus the momentum carried away by exhaust gas.
- **ORC-009** `[M · M5 · S]` Cannon shell momentum plus recoil momentum shall equal the momentum of the gas released, to within tolerance.

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

## 8. Sandbox UI Requirements

### 8.1 Time control

- **SBX-001** `[M · M1 · E]` The sandbox shall provide play, pause, single-step, step-N, and reset-to-start.
- **SBX-002** `[M · M1 · E]` The sandbox shall provide a time scale from at least 1/16× to 8×, implemented as more or fewer fixed steps, never a larger timestep.
- **SBX-003** `[S · M2 · E]` The sandbox shall keep a rolling history of snapshots so you can scrub back over at least the last 10 seconds of simulated time.
- **SBX-004** `[M · M1 · E]` If the simulation cannot keep up in real time, then the sandbox shall show the achieved time scale instead of silently dropping steps.

### 8.2 Creating and editing

- **SBX-010** `[M · M1 · E]` The sandbox shall provide a palette for spawning primitive bodies (disc, box, convex polygon) and, from the relevant milestone, components and gas emitters.
- **SBX-011** `[M · M1 · E]` The sandbox shall allow selecting, moving, rotating and deleting any body, while paused or running.
- **SBX-012** `[M · M1 · E]` An inspector shall show and edit the selected entity's properties (mass, material, velocity, spin, shape dimensions, integrity). Edits apply through a core command, so they are recorded and replayable.
- **SBX-013** `[M · M2 · E]` The sandbox shall allow attaching a component to an existing assembly with a joint, and detaching or deleting a component from it, while paused or running.
- **SBX-014** `[M · M2 · E]` When a component is added or removed, the system shall recompute the assembly's mass properties before the next step.
- **SBX-015** `[M · M2 · E]` The sandbox shall allow creating and deleting control and feed links between components.
- **SBX-016** `[M · M1 · E]` The sandbox shall provide an impulse tool: drag from a point on a body to apply an impulse there, with the magnitude shown before release.
- **SBX-017** `[S · M1 · E]` The sandbox shall provide undo and redo for edit operations.
- **SBX-018** `[S · M2 · E]` The sandbox shall allow binding keyboard keys to control channels, so you can fly an assembly by hand.
- **SBX-019** `[C · M2 · E]` The sandbox shall allow saving an assembly as a reusable prefab and spawning copies of it.

### 8.3 Seeing what's happening

- **SBX-030** `[M · M1 · E]` The sandbox shall provide pan, zoom and follow-selected camera controls.
- **SBX-031** `[M · M1 · E]` The sandbox shall provide toggleable overlays: velocity vectors, centres of mass, contact points and impulses, applied forces, and the world boundary.
- **SBX-032** `[M · M2 · E]` The sandbox shall overlay joint load as a fraction of its strength, colour-coded.
- **SBX-033** `[M · M1 · E]` The sandbox shall show live graphs of ledger totals and any probe, with a selectable time window.
- **SBX-034** `[M · M1 · E]` The sandbox shall show conservation violations (LED-003) visibly when they occur, and link each to the entities involved.
- **SBX-035** `[S · M3 · E]` The sandbox shall render gas parcels coloured by temperature or composition (selectable).
- **SBX-036** `[S · M1 · E]` The sandbox shall allow adding a probe by right-clicking an entity and choosing a quantity.
- **SBX-037** `[S · M1 · E]` The sandbox shall provide a ruler tool that reports distance and relative velocity between two points.

### 8.4 Quality

- **SBX-040** `[M · M1 · B]` The sandbox shall render at 60 fps with the reference sandbox scenario on the reference hardware (§14).
- **SBX-041** `[M · M1 · E]` The sandbox shall work in current Chromium, Firefox and Safari desktop browsers.
- **SBX-042** `[S · M1 · E]` The sandbox shall expose stable `data-testid` attributes on controls for E2E tests.
- **SBX-043** `[S · M1 · R]` The layout shall keep the simulation view dominant, with a collapsible toolbar, palette, inspector and graph panels.

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
- **GAS-005** `[M · M3 · S]` A sealed container of gas shall not move or spin from internal pressure alone (ORC-006).
- **GAS-006** `[M · M3 · S]` Gas released into vacuum shall expand freely, and its centre of mass shall keep the original velocity.
- **GAS-007** `[M · M3 · P]` When parcels leave the world boundary or are merged, the ledger shall record the mass, momentum and energy removed or combined.
- **GAS-008** `[S · M3 · B]` The `sandbox` profile shall support at least 2,000 active parcels in real time on the reference hardware.

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

| ID | Milestone | Scenario | Key checks |
|---|---|---|---|
| RS-01 | M1 | Two discs, head-on elastic collision | ORC-002 |
| RS-02 | M1 | Rod hit off-centre by a disc | ORC-003, COL-003 |
| RS-03 | M1 | Bullet vs thin wall at max speed | COL-004 |
| RS-04 | M1 | Box stack settles | COL-005 |
| RS-05 | M2 | Assembly with a weak joint, pulled apart by impulse | ASM-004, ASM-005 |
| RS-06 | M3 | Sealed box of hot gas | ORC-006, GAS-005 |
| RS-07 | M3 | Gas burst in vacuum | GAS-006 |
| RS-08 | M4 | Single-engine rocket, full burn | ORC-007, ORC-008 |
| RS-09 | M4 | Off-axis thruster spins a ship | PRP-006 |
| RS-10 | M4 | Engine attachment too weak for full thrust | ASM-004, PRP-005 |
| RS-11 | M5 | Ram an armoured vs an unarmoured tank | DMG-002, DMG-005 |
| RS-12 | M6 | Off-centre cannon fires | WPN-002, WPN-003 |
| RS-13 | M6 | Magazine chain reaction | WPN-007 |
| RS-14 | M7 | Shell fractures a spinning asteroid | AST-003 |

## 12. Milestones

Each milestone ends with: all its `M` requirements passing tests, its reference scenarios loadable in the sandbox, and a short demo note.

| Milestone | Delivers | Exit criteria |
|---|---|---|
| **M0 Foundation** | Repo layout, core skeleton, world serialisation, PRNG, profile, scenario schema and runner, CLI, CI, determinism harness | `pnpm test` green in CI. An empty scenario runs headless and hashes identically twice. |
| **M1 Rigid bodies + sandbox v1** | Integrator, collisions, ledger, sandbox UI with time control, spawn/edit/delete, impulse tool, overlays, graphs | RS-01…RS-04 pass. You can build and run them in the sandbox. |
| **M2 Assemblies** | Compound bodies, joints with limits, splitting, links, attach/detach in the UI, optional gravity | RS-05 passes. Components can be attached and removed live. |
| **M3 Gas** | Gas parcels, pressure, wall interaction, boundary accounting, parcel rendering | RS-06, RS-07 pass. GAS-008 benchmark met. |
| **M4 Propulsion** | Tanks, feeds, injectors, reactions, chambers, nozzles, key bindings | RS-08…RS-10 pass. A ship can be flown by hand in the sandbox. |
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

Proposed defaults. **Please confirm or change each.**

| ID | Decision | Proposed default | Why |
|---|---|---|---|
| DEC-01 | Platform | Browser (TypeScript + Vite), deployed to GitHub Pages. Core also runs in Node. | Already set up. Headless testing in Node is free. |
| DEC-02 | Physics engine | **Custom core in TypeScript**, not a library. | Gas-driven thrust needs tight control of gas–wall impulses and the ledger. Rapier is cross-platform deterministic in WASM, but makes per-parcel accounting harder. Revisit if M1 collision work stalls. |
| DEC-03 | Structure model | Rigid components joined by breakable joints (not deformable bodies). | Much simpler. It still allows bending-by-breaking and splitting. |
| DEC-04 | Gas model | Soft-sphere particles with pairwise pressure forces (DEM/SPH-like), with each parcel's thermal energy setting its pressure. | Pairwise forces give exact momentum conservation (GAS-002). It scales with a spatial grid. |
| DEC-05 | Timestep | 1/240 s fixed for `sandbox`, with substeps for gas if needed. | Gas parcels move fast. A small step keeps nozzle contact stable. Tune in M3. |
| DEC-06 | World scale | Ships 5–30 m, gas parcels 0.05–0.2 m radius, max speed 2 km/s. | Keeps parcels much smaller than engines while staying within budget. Tune in M3–M4. |
| DEC-07 | Test tools | Vitest (unit, property, scenario), fast-check (property), Playwright (E2E, Chromium in CI). | Standard, fast, TypeScript-native. |
| DEC-08 | Rendering | Canvas 2D first. Move to WebGL only if parcel rendering misses 60 fps. | Simplest path. Rendering stays behind an interface (TST-011). |
| DEC-09 | Reference hardware | A 2020-era mid-range laptop (4-core CPU, integrated GPU), Chromium. | Needed to make SBX-040 and GAS-008 testable. |
| DEC-10 | Cross-browser determinism | Same-runtime bit-exactness is a must. Cross-browser is a should (DET-003). | Cross-browser requires a custom trig library. Worth it before replays or multiplayer, not before. |

## 15. References

- EARS: Mavin et al., "Easy Approach to Requirements Syntax (EARS)", IEEE RE'09, pp. 317–322 — https://alistairmavin.com/ears/
- ECMAScript `Math` functions are implementation-approximated — https://tc39.es/ecma262/#sec-function-properties-of-the-math-object
- Cross-platform `Math.sin` differences — https://tc39.es/archives/bugzilla/285/
- Rapier determinism guarantees — https://rapier.rs/docs/user_guides/javascript/determinism
- Tsiolkovsky rocket equation — https://en.wikipedia.org/wiki/Tsiolkovsky_rocket_equation
- Erin Catto, "Iterative Dynamics with Temporal Coherence" (sequential impulses), GDC 2005 — https://box2d.org/publications/
