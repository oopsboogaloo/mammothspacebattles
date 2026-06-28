# Mammoth Space Battles — Implementation Plan

**Status:** Initial delivery plan  
**Source design:** `docs/ears-requirements.md` v0.1  
**Planning date:** 2026-06-28

## 1. Planning Goals

This plan translates the EARS requirements into a staged implementation roadmap. It prioritizes a playable, testable vertical slice before broad content, economy, progression, and advanced environmental systems.

The primary planning assumptions are:

- Build a deterministic two-dimensional simulation core before presentation polish.
- Prefer small, measurable prototypes for unsettled physics decisions.
- Keep conservation, replay, and diagnostics visible from the start.
- Ship features only when they can be exercised by automated tests or acceptance scenarios.

## 2. Workstreams

### 2.1 Simulation Foundation

Scope:

- Dynamic body state, mass properties, force and torque accumulation.
- Bounded time stepping and pause/time-scale behavior.
- Material definitions, capacity limits, and mutable store mass.
- Momentum, mass, and energy accounting diagnostics.

Primary requirements:

- PHY-001 through PHY-014.
- MAT-001 through MAT-006.
- NFR-001, NFR-002, NFR-006, NFR-007, and NFR-008.
- DBG-001, DBG-003, and DBG-004.

Key deliverables:

- Simulation profile schema with step limits, tolerances, and entity limits.
- Body/component data model with recalculated mass, center of mass, and rotational inertia.
- Integrator prototype and validation tests for isolated momentum conservation.
- Diagnostic counters and conservation-violation logging.

### 2.2 Collision, Contact, Damage, and Separation

Scope:

- Collision detection and contact resolution for ship components, projectiles, gas parcels, and asteroid children.
- Local trauma, integrity, broken components, broken links, and detached assemblies.
- Safe fallback handling for invalid geometry.

Primary requirements:

- COL-001 through COL-007.
- DMG-001 through DMG-013.
- SHP-011 through SHP-016.
- LNK-008.

Key deliverables:

- Collision geometry primitives for the first component set.
- Contact solver supporting off-center impulses and angular momentum.
- Damage model for components, connectors, and asteroid bonds.
- Assembly splitting algorithm that preserves fragment momentum.

### 2.3 Ship Design, Validation, and Persistence

Scope:

- Two-dimensional construction area, component placement, link creation, control mapping, and design metadata.
- Validation, estimates, save/load, and migration warnings.

Primary requirements:

- SHP-001 through SHP-010.
- LNK-001 through LNK-007.
- VAL-001 through VAL-008.
- SAV-001, SAV-002, and SAV-004.

Key deliverables:

- Ship design document format.
- Component/link palette for the basic ship.
- Overlap, connectivity, launch-blocking, and warning validation.
- Saved-design loader with version compatibility checks.

### 2.4 Propulsion, Controls, and Gas Parcels

Scope:

- Fuel and oxidizer stores, injection, combustion, hot gas parcels, exhaust persistence, and thrust through gas contact.
- Manual rotation controls and optional flight-assistance command generation.

Primary requirements:

- THR-001 through THR-012.
- CTL-001 through CTL-008.
- VIS-001 and VIS-005.
- AS-01 through AS-04.

Key deliverables:

- Configurable reaction rule for the first fuel/oxidizer pair.
- Main engine and maneuvering thruster components.
- Gas parcel collision/merging/culling prototype.
- Control mapping for forward, left-turn, and right-turn commands.

### 2.5 Weapons, Explosions, and Asteroids

Scope:

- Cannon firing, shell storage, propellant reactions, recoil, explosive shells, and chain reactions.
- Aggregate asteroids, bonds, fragmentation, minerals, and ore release.

Primary requirements:

- WPN-001 through WPN-013.
- AST-001 through AST-012.
- VIS-002 and VIS-003.
- AS-05 through AS-07.

Key deliverables:

- Cannon, shell, ammunition store, and firing-chamber implementation.
- Projectile collision and damage path.
- Simple aggregate asteroid authoring format.
- Fragmentation tests for mass and momentum conservation.

### 2.6 Mining, Manufacturing, Repair, and Economy Loop

Scope:

- Scoop capture, resource transfer, nanofactory jobs, repairs, shell manufacturing, sortie accounting, and post-sortie results.

Primary requirements:

- SCP-001 through SCP-008.
- MFG-001 through MFG-010.
- RPR-001 through RPR-009.
- GAM-001 through GAM-011.
- AS-08, AS-10, AS-11, and AS-12.

Key deliverables:

- Scoop component and compatible mineral store.
- Nanofactory job queue and recipe validation.
- Repair target selection and link-path checks.
- Minimal sortie report with gains, costs, losses, and net value.

### 2.7 Player Interface, Visualization, Replay, and Quality

Scope:

- Flight HUD, designer feedback, diagnostics, replay, and performance budgets.

Primary requirements:

- UIF-001 through UIF-008.
- VIS-004 through VIS-006.
- SAV-003.
- DBG-002.
- NFR-003 through NFR-005.

Key deliverables:

- HUD for velocity, angular velocity, orientation, stores, command status, and known failures.
- Designer previews for thrust vectors, torque, resource paths, and control paths.
- Deterministic replay harness for acceptance scenarios.
- Performance profile for the reference vertical-slice scenario.

## 3. Milestones

### Milestone 0 — Project Scaffolding and Decisions

Exit criteria:

- Target platform, runtime, rendering approach, and test framework are selected.
- Simulation profile schema exists.
- Initial component/material/reaction data validation is runnable.
- Open decisions TBD-001, TBD-002, TBD-003, TBD-004, and TBD-008 have prototype-backed defaults.

Recommended acceptance checks:

- Load a minimal scenario with one dynamic body.
- Run fixed-step simulation deterministically for a known command sequence.
- Produce diagnostic output for body counts and conservation tolerances.

### Milestone 1 — Physics Kernel Prototype

Exit criteria:

- Bodies integrate linear and angular motion from forces and torques.
- Composite mass properties update when stores change.
- Collision/contact resolution supports off-center impulses.
- Conservation tests cover isolated linear and angular momentum.

Recommended acceptance checks:

- Apply an off-center impulse and verify translation plus rotation.
- Transfer resource mass between stores and verify center-of-mass movement.
- Pause and resume without advancing physical state while paused.

### Milestone 2 — Designer and Basic Ship Skeleton

Exit criteria:

- Player can place components and create structural, resource, and control links.
- Design validation reports launch-blocking errors and survivability warnings.
- A basic ship design can be saved, loaded, duplicated, and revised.
- Basic ship includes engine, maneuvering thrusters, tanks, metal store, scoop, cannon, ammunition store, nanofactory, structural elements, and armor placeholders.

Recommended acceptance checks:

- Reject overlapping solid components.
- Report missing required control or resource links.
- Show mass, center of mass, rotational inertia, and estimated thrust/torque authority.

### Milestone 3 — Physical Propulsion Vertical Slice

Exit criteria:

- Fuel and oxidizer parcels inject, react, form hot gas, collide with engine geometry, and escape as exhaust.
- Main engine translates the basic ship only through simulated gas interaction.
- Maneuvering thrusters rotate the ship by physical torque.
- Control release does not automatically cancel angular velocity.

Recommended acceptance checks:

- Pass AS-01, AS-02, AS-03, and AS-04 at prototype fidelity.
- Verify no direct angular-velocity setting occurs for normal steering.
- Verify resource consumption changes mass properties.

### Milestone 4 — Weapons and Local Damage

Exit criteria:

- Cannon fires a physical shell using propellant gas and produces recoil.
- Impacts apply local trauma to components, connectors, and asteroid bonds.
- Broken structural links stop transferring load and can split assemblies.
- Explosive shell damage can trigger neighboring shell reactions.

Recommended acceptance checks:

- Pass AS-05, AS-06, AS-09, and AS-11 at prototype fidelity.
- Verify detached assemblies retain momentum.
- Verify broken links block force, resource, or command transmission as appropriate.

### Milestone 5 — Asteroids, Mining, and Collection

Exit criteria:

- Aggregate asteroids are made from bonded children with materials and mineral content.
- Projectile impacts can break bonds and create independent fragments.
- Scoop captures eligible minerals or parcels through physical capture rules.
- Captured mass transfers to compatible stores without duplication.

Recommended acceptance checks:

- Pass AS-07 and AS-08.
- Verify represented asteroid mass and momentum remain within tolerance after fragmentation.
- Verify scoop overload can damage, rebound, or miss rather than teleporting material.

### Milestone 6 — Manufacturing, Repair, and Sortie Loop

Exit criteria:

- Nanofactory can manufacture compatible cannon shells.
- Repair jobs consume declared resources and restore supported components/connectors over time.
- Repair dependency failures are diagnosed.
- The game transitions from design to flight and back with inventory and ship condition.
- Post-sortie accounting reports gains, consumed resources, damage, losses, and net value.

Recommended acceptance checks:

- Pass AS-10 and AS-12.
- Verify repair cannot create unpaid mass or repair a missing detached component as empty space.
- Verify completed manufacturing output waits safely if no output capacity is available.

### Milestone 7 — Polish, Replay, and Performance Hardening

Exit criteria:

- Presentation matches simulated exhaust, explosions, fragments, and aggregated entities.
- Diagnostic visualization covers forces, centers of mass, thrust vectors, torque, structural loads, resource paths, and control paths.
- Deterministic replay reproduces gameplay-significant events within tolerance on supported platforms.
- Reference scenario meets target update rate and handles capacity limits with documented deterministic policies.

Recommended acceptance checks:

- Replay at least one full vertical-slice run from initial state, inputs, random seed, and time-step sequence.
- Profile active bodies, contacts, bonds, links, gas parcels, and fragments.
- Validate authored data before release-mode use.

## 4. First Vertical Slice Backlog

The first vertical slice should be completed in this order:

1. Define simulation profiles, materials, resources, reactions, and component schemas.
2. Implement dynamic bodies, fixed-step integration, force/torque accumulation, and mass-property recalculation.
3. Implement collision primitives, off-center impulses, and local trauma.
4. Implement component assemblies, connectors, link integrity, and assembly splitting.
5. Implement the ship designer data model, validation, save/load, and the basic ship reference design.
6. Implement fuel/oxidizer stores, injectors, reaction gas parcels, engine geometry contact, and exhaust lifecycle.
7. Implement manual controls for main thrust and rotation, including control-path and resource-path checks.
8. Implement cannon shell storage, firing, projectile motion, impact damage, and recoil.
9. Implement aggregate asteroid bonds, fragmentation, mineral release, and scoop capture.
10. Implement nanofactory shell manufacturing and repair jobs with resource accounting.
11. Implement flight HUD, designer diagnostics, scenario transition, and post-sortie reporting.
12. Add deterministic replay and automated acceptance scenarios AS-01 through AS-12.

## 5. Prototype Spikes for Open Decisions

The following spikes should be time-boxed before productionizing their dependent systems:

| Spike | Resolves | Output |
|---|---|---|
| Physics solver comparison | TBD-003, TBD-008, TBD-009 | Recommendation for integrator, contact solver, and structural model. |
| Gas parcel scale and lifecycle | TBD-004, TBD-013 | Parcel count budget, merge/split rules, culling rules, and exhaust fidelity target. |
| World scale and controls | TBD-002, TBD-011, TBD-018 | Ship size, speeds, time acceleration, input response, and accessibility defaults. |
| Chemistry and recipes | TBD-006, TBD-007 | First fuel/oxidizer/mineral/metal/ammunition recipe set. |
| Sensor and information model | TBD-012 | HUD visibility rules and diagnostic/omniscient-mode separation. |
| Mission and economy model | TBD-014 | First mining sortie, return conditions, reward/cost formulas, and progression stub. |
| Connector representation | TBD-016 | Decision on abstract links versus routed local-damage geometry for the first playable build. |
| Repair replacement scope | TBD-017 | Rule for whether in-flight manufacturing can replace missing components. |

## 6. Test Strategy

Testing should be layered as follows:

- **Unit tests:** vector math, mass properties, stores, resource routing, validators, recipes, and damage curves.
- **Property tests:** conservation of mass, linear momentum, angular momentum, and capacity constraints across randomized transfers and separations.
- **Scenario tests:** automated runs for AS-01 through AS-12 using fixed seeds and time-step sequences.
- **Golden replay tests:** deterministic replay of representative runs on supported platforms.
- **Performance tests:** reference scenario budgets for bodies, gas parcels, contacts, bonds, links, and fragments.
- **Authoring validation tests:** component, material, reaction, recipe, and scenario data validation in release-blocking mode.

## 7. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Gas-pressure propulsion is too expensive or unstable. | The core fantasy may not run in real time. | Prototype parcel scale early, add physically accountable aggregation, and keep diagnostics visible. |
| Flexible structural simulation grows too complex. | Ship damage and breakage may block vertical-slice progress. | Start with connected rigid bodies and breakable constraints unless prototypes prove a better approach. |
| Conservation requirements conflict with gameplay readability. | Players may not understand outcomes. | Build diagnostic visualizations and HUD reasons alongside mechanics. |
| Advanced chemistry and thermal systems expand scope. | First playable build may slip. | Use one validated reaction set and defer phase-change detail until after the vertical slice. |
| Determinism is added too late. | Replay and debugging become expensive to retrofit. | Capture seeds, input logs, configuration, and bounded step sequence from Milestone 0. |
| Economy balance masks physics bugs. | Players may exploit accounting errors. | Keep sortie accounting separate from conservation tests and validate every transfer. |

## 8. Definition of Done for the First Playable Build

The first playable build is done when:

- A player can design or load the basic ship, validate it, launch it, fly it, fire its cannon, damage an asteroid, collect a mineral, manufacture or repair something, and return to a post-sortie report.
- Movement, rotation, cannon recoil, fragmentation, collection, and repair respect the conservation tolerances declared in the active simulation profile.
- AS-01 through AS-12 run as automated acceptance scenarios.
- Diagnostic replay can reproduce a vertical-slice run from initial state, commands, configuration, random seed, and time-step sequence.
- The known deferred features and open decisions are documented with explicit follow-up milestones.
