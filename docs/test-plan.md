# Mammoth Space Battles — Automated Test Plan

**Status:** Initial automated test strategy  
**Version:** 0.1  
**Date:** 2026-06-28

## 1. Purpose

This test plan defines how Mammoth Space Battles can be tested without human help. The game design depends on physical causality, conservation rules, damage propagation, ship construction, resource routing, and progression accounting, so the test strategy emphasises deterministic simulation harnesses, property checks, replayable scenarios, scripted agents, and machine-readable diagnostics rather than manual playtesting.

The plan is intended to modify implementation priorities where needed: every gameplay feature should expose enough deterministic state, diagnostic events, and scripted control surfaces to be testable by automation.

## 2. Testing Principles

- **Determinism first:** Every automated scenario shall be runnable with a fixed random seed, fixed initial state, fixed command stream, fixed simulation profile, and recorded time-step sequence.
- **Observable invariants:** Conservation of mass, momentum, energy accounting, capacity limits, connectivity, and geometry validity shall be measurable through diagnostic APIs or logs.
- **Headless execution:** The simulation, validator, economy, save/load, and scripted play loops shall run without a graphics device or human input.
- **Small before large:** Unit tests and focused physics fixtures shall prove local rules before broad acceptance scenarios combine them.
- **Golden replays for regressions:** Important scenarios shall produce stable event traces and tolerance-bounded metrics that can be compared in CI.
- **Presentation is testable separately:** Rendering shall be validated with screenshot, pixel-diff, and visual telemetry tests, but gameplay correctness shall not depend on rendering frames.
- **Failures must explain themselves:** Automated failures shall report seed, scenario ID, command stream, violated requirement IDs, measured values, tolerances, and a minimal reproduction artifact.

## 3. Required Testability Hooks

The design and implementation plan should include these hooks as first-class deliverables:

1. **Headless simulation runner** that loads scenario data, ship designs, scripted commands, simulation profiles, and random seeds.
2. **Deterministic replay recorder** that stores initial state, authored data versions, random seed, player or agent commands, and exact physics step sequence.
3. **Invariant monitor** that can assert conservation, stability, capacity, collision, geometry, and connectivity tolerances during a run.
4. **Scenario assertion language** for writing expected events, final-state predicates, metric bounds, and forbidden events.
5. **Diagnostic event stream** for contacts, impulses, forces, torques, reactions, resource transfers, link breaks, component damage, separations, manufacturing jobs, repairs, and economy transactions.
6. **State snapshot API** for querying bodies, assemblies, gas parcels, stores, links, jobs, asteroid bonds, fragments, and mission accounting.
7. **Scripted control API** that can issue the same commands available to the player, without bypassing control links or resource rules.
8. **Authoring validators** for component, material, reaction, recipe, scenario, ship design, and save data.
9. **Performance telemetry** for step time, active counts, broadphase pairs, contacts, gas parcels, fragments, jobs, and overload-policy activations.
10. **Replay minimizer** that can trim a failing long run to the smallest seed, command range, or scenario slice that still reproduces the failure.

## 4. Test Pyramid

| Layer | Goal | Examples | CI Frequency |
|---|---|---|---|
| Static validation | Reject invalid authored data and unsafe code paths before runtime | Schema validation, conservation checks for recipes, component geometry checks | Every commit |
| Unit tests | Prove isolated math, physics, resources, links, and economy rules | Vector math, inertia calculation, resource capacity, damage curve interpolation | Every commit |
| Property tests | Search broad state spaces for invariant violations | Random collisions, transfer chains, asteroid graph splits, save/load round trips | Every commit with bounded seeds; nightly with more seeds |
| Scenario tests | Exercise requirement-level behaviours with scripted fixtures | Acceptance scenarios AS-01 through AS-12 | Every commit for smoke subset; full suite nightly |
| Replay regression tests | Prevent drift in gameplay-significant traces | Golden traces for vertical slice scenarios | Every commit after feature stabilization |
| Agent playthrough tests | Confirm the loop can be completed by non-cheating scripted agents | Mine, return, repair, manufacture shell, profit/loss report | Nightly and release candidates |
| Performance and soak tests | Detect instability, leaks, and overload issues | Dense gas/explosion scenes, asteroid fields, long mining runs | Nightly and release candidates |
| Visual diagnostics tests | Verify presentation consistency with simulation telemetry | Exhaust direction, explosion expansion, COM overlay, link overlay | Pull request when rendering changes; release candidates |

## 5. Requirement Traceability

Each requirement should map to at least one automated check. The first implementation pass can group checks by subsystem:

| Requirement area | Automated test families |
|---|---|
| PHY, MAT, GRV | Conservation fixtures, integrator stability tests, gravity field tests, mass-property recalculation tests |
| COL, DMG | Collision impulse tests, continuous collision tests, local trauma tests, separation and safe-geometry tests |
| SHP, LNK, VAL | Designer data validation tests, link routing tests, launch-blocking tests, control/resource disconnection tests |
| THR, CTL | Thruster combustion fixtures, torque-from-offset tests, no-direct-angular-control tests, COM-shift tests |
| WPN, AMM, HAZ | Cannon recoil tests, shell acceleration tests, detonation and chain-reaction scenario tests |
| AST | Aggregate graph tests, bond-load tests, fragmentation conservation tests |
| RES, SCP | Resource transfer property tests, scoop capture momentum tests, capacity rejection tests |
| MFG, RPR | Manufacturing job state-machine tests, repair dependency tests, resource accounting tests |
| BAS | Basic ship fixture validation and launch smoke tests |
| UIF, VIS | UI state model tests, diagnostic overlay data tests, screenshot/pixel tests |
| GAM | Scripted sortie tests and economy ledger tests |
| SAV, DBG | Save/load round-trip tests, deterministic replay tests, diagnostic logging tests |
| NFR | Performance, capacity, frame-rate independence, and data validation tests |

## 6. Core Automated Test Methods

### 6.1 Unit and numerical tests

Unit tests should run against pure functions and tightly scoped subsystems:

- Mass, centre of mass, and inertia calculations for single bodies, composite ships, and asteroid aggregates.
- Force-to-acceleration and torque-to-angular-acceleration calculations.
- Collision impulse calculations for centre and off-centre contacts.
- Resource store capacity, mass transfer, routing, and broken-link rejection.
- Damage curves, integrity thresholds, broken-state transitions, and functional efficiency scaling.
- Recipe accounting for input mass, output mass, waste, energy, and time.
- Economy ledgers for sortie gains, consumed resources, repairs, losses, and net value.

Numerical tests should compare measured quantities against profile tolerances instead of expecting exact floating-point equality.

### 6.2 Property and fuzz tests

Property tests should generate many valid and near-invalid states, then assert invariants. Initial properties should include:

- Isolated collision fixtures preserve total represented mass and momentum within tolerance.
- Resource transfers never create negative quantities, exceed capacity, or duplicate mass.
- Breaking random links never allows commands, resources, or structural forces through the broken path.
- Asteroid bond graph splits create independent aggregates with the same total child mass and momentum.
- Save/load round trips preserve gameplay-significant state within tolerance.
- Random command streams never bypass control links, resource links, cooldowns, or component damage rules.
- Frame-step subdivision produces equivalent gameplay outcomes within tolerance.

The CI suite should run a bounded deterministic seed set, while nightly jobs expand seed counts and retain every failing seed as a regression.

### 6.3 Scenario tests

Scenario tests should load compact fixtures and run scripted command timelines. Each scenario should declare:

- Requirement IDs covered.
- Initial state and authored data versions.
- Random seed and simulation profile.
- Command timeline or scripted agent policy.
- Expected events and forbidden events.
- Final-state assertions and tolerance bounds.
- Diagnostic artifacts to save on failure.

The acceptance scenarios in the requirements should become executable scenario tests AS-01 through AS-12.

### 6.4 Scripted agents

The game can be tested without humans by using non-cheating scripted agents that operate only through player-facing commands and permitted sensor state. Recommended agents:

- **Control exercise agent:** Fires each mapped control and verifies command acknowledgement versus actual component activation.
- **Rotation agent:** Builds angular velocity, releases controls, counter-thrusts, and checks inertial continuation.
- **Mining agent:** Approaches an asteroid, fires, waits for fragments, activates scoop, and returns captured resources.
- **Repair agent:** Damages a known component, requests repair, verifies resource consumption and integrity recovery.
- **Sortie agent:** Executes the whole launch, mine, collect, manufacture, repair, return, and accounting loop.
- **Fault-injection agent:** Breaks links, damages components, empties stores, and verifies diagnosable failure reasons.

Agents should not read hidden state unless a diagnostic test mode explicitly marks the run as omniscient. This preserves UI and sensor requirements while still enabling automated play.

### 6.5 Metamorphic tests

Metamorphic tests compare related runs where the exact result is hard to predict:

- Translating or rotating an entire isolated fixture should not change relative physics outcomes.
- Doubling all masses and impulses in a fixture should preserve equivalent velocity changes where the model predicts it.
- Running the same scenario at different presentation frame rates should keep gameplay-critical outcomes within tolerance.
- Mirroring a ship and control mapping should mirror thrust, torque, collision, and damage outcomes.
- Reordering independent resource stores should not change total supplied mass except where the routing rule intentionally defines order dependence.

### 6.6 Visual and presentation tests

Most correctness should be proven headlessly, but the presentation layer still needs automation:

- Render deterministic scenes at fixed resolution and compare screenshots with tolerances.
- Verify exhaust sprites or particles originate from simulated gas exits and point along measured gas flow.
- Verify explosion visuals expand consistently with simulated gas and fragments.
- Verify diagnostic overlays draw centres of mass, thrust vectors, torque, structural loads, resource paths, and control paths from simulation telemetry.
- Use perceptual screenshot diffs for intentional art variation and strict pixel checks for debug overlays.

## 7. Acceptance Scenario Automation

| Scenario | Automation approach | Key assertions |
|---|---|---|
| AS-01 Unassisted rotation | Script right-turn press and release on the basic ship | Reactants decrease, exhaust appears, angular velocity increases, angular velocity persists after release |
| AS-02 Counter-thrust | Start with known angular velocity, command opposite turn | Opposing thruster activates and angular momentum moves toward zero or reversal |
| AS-03 Variable centre of mass | Drain or leak an asymmetric tank, then repeat a thruster pulse | Centre of mass and inertia change; later acceleration/torque differ predictably |
| AS-04 Damaged engine | Run baseline thrust, damage nozzle/chamber, repeat thrust | Geometry changes are used; thrust magnitude, direction, leakage, or stability changes |
| AS-05 Cannon recoil | Fire an off-centre cannon in isolation | Shell and ship momenta are equal/opposite within tolerance; ship angular momentum changes |
| AS-06 Magazine chain reaction | Damage one stored shell in a live ammunition store | Detonation event occurs through gas/heat/fragments; neighbouring shells may react by local interactions |
| AS-07 Asteroid fragmentation | Shoot rotating aggregate asteroid | Bonds break, disconnected groups become independent, mass/momentum remain conserved |
| AS-08 Mining and collection | Scoop a released mineral fragment | Capture respects relative speed/load; store gains mineral mass; combined momentum is conserved |
| AS-09 Structural failure under thrust | Use intentionally weak engine attachment and command full thrust | Link trauma accumulates, attachment breaks, detached engine retains momentum |
| AS-10 Repair dependency failure | Break nanofactory and request repair | Repair does not begin; UI/state reports unavailable nanofactory dependency |
| AS-11 Broken resource link | Break thruster resource link and command thrust | No reactant transfer crosses the link; normal combustion does not sustain |
| AS-12 Profitable sortie | Script mining, collection, resource use, damage, return | Post-sortie ledger includes gains/costs and applies net result to next design state |

## 8. CI and Release Gates

### 8.1 Pull request gate

A pull request should pass:

1. Formatting and linting.
2. Authored-data validation.
3. Unit tests.
4. Bounded property tests with fixed seeds.
5. Headless smoke scenarios for the basic ship and first vertical slice.
6. Save/load round-trip tests for current save version.
7. Deterministic replay smoke test on the current platform.

### 8.2 Nightly gate

Nightly jobs should add:

1. Expanded property-test seed set.
2. Full AS-01 through AS-12 suite.
3. Scripted sortie agents.
4. Long-run soak tests.
5. Performance benchmark comparisons.
6. Visual regression tests for canonical scenes.
7. Replay minimization for any newly failing seed.

### 8.3 Release gate

Release candidates should require:

1. All pull request and nightly gates passing.
2. No unresolved conservation, capacity, or geometry violations in diagnostic logs.
3. Performance within the release profile on reference hardware.
4. Save migration tests from all supported prior versions.
5. Golden replay compatibility decisions documented when intentional physics changes alter traces.

## 9. Failure Artifacts

Every failing automated run should save:

- Scenario ID and requirement IDs.
- Random seed, simulation profile, authored data hashes, and platform details.
- Initial state, command stream, and physics step sequence.
- Event trace around the first failed assertion.
- State snapshot before and after the failure.
- Invariant measurements versus tolerances.
- Optional screenshot or short deterministic replay capture for visual failures.

## 10. Plan and Design Implications

This test plan changes the implementation plan in the following ways:

1. **Build the headless runner before the full UI.** The earliest playable prototype should also be an executable test fixture.
2. **Define simulation profiles early.** Tolerances, maximum counts, and overload policies are needed before conservation and performance tests can be meaningful.
3. **Make diagnostics part of the architecture.** Event streams, invariant monitors, and state snapshots should not be bolted on after the physics engine is complex.
4. **Treat the basic ship as a permanent test fixture.** It should be authored in validated data and used by smoke tests, acceptance scenarios, and replay tests.
5. **Keep control scripts honest.** Automated agents should use the same commands and sensor limits as players except in explicitly diagnostic tests.
6. **Prefer data-driven fixtures.** Ships, asteroids, recipes, materials, and scenarios should be loadable in small deterministic test cases.
7. **Design for replay drift management.** Physics improvements may intentionally change traces, so the plan needs tools for updating golden metrics while preserving invariant checks.

## 11. Initial Test Backlog

1. Create a headless simulation test executable with fixed seed and fixed step support.
2. Add schema and authored-data validation for materials, components, reactions, recipes, ships, asteroids, and scenarios.
3. Add invariant monitor checks for mass, linear momentum, angular momentum, capacity, penetration, and geometry validity.
4. Implement unit tests for mass properties, resource stores, links, damage curves, and economy ledgers.
5. Implement property tests for transfers, collisions, link breaks, asteroid splits, and save/load round trips.
6. Convert AS-01, AS-05, AS-08, AS-10, and AS-11 into the first automated acceptance smoke suite.
7. Build the scripted sortie agent for AS-12 after mining, repair, manufacturing, and return conditions exist.
8. Add performance telemetry and thresholds for the first vertical slice.
9. Add visual regression scenes for exhaust, explosions, fragments, and diagnostic overlays once rendering exists.
10. Require failure artifacts for all CI scenario and property-test failures.
