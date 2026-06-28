# Mammoth Space Battles — Initial Technical Design

**Status:** Draft design derived from EARS requirements 0.1
**Version:** 0.1
**Date:** 2026-06-28
**Source:** [`docs/ears-requirements.md`](./ears-requirements.md)

## 1. Design Goals

Mammoth Space Battles is a two-dimensional physics-first space-combat, ship-design, mining, salvage, and repair game. The design prioritises visible physical causality over arcade shortcuts: ships move because represented gas, collisions, recoil, gravity, and structural loads exchange momentum with simulated bodies.

The first implementation should prove the full causal loop in a small vertical slice before expanding content breadth:

1. Build a ship from components and typed links.
2. Simulate mass properties, centre of mass, inertia, thrust, torque, recoil, damage, and separation.
3. Break asteroids into conserved fragments and collectible resource parcels.
4. Collect resources with physical momentum transfer.
5. Spend gathered resources on repair or shell manufacturing.
6. Return results to the design and maintenance phase.

## 2. Architecture Overview

The game is divided into deterministic simulation systems, authored-data validation, presentation, and game-flow orchestration.

```text
+-----------------------+      +-----------------------+
| Design / Maintenance  | ---> | Scenario Bootstrap    |
| - ship editor         |      | - instantiate bodies  |
| - validator           |      | - load profile/data   |
+-----------+-----------+      +-----------+-----------+
            ^                              |
            |                              v
+-----------+-----------+      +-----------+-----------+
| Post-Sortie Economy   | <--- | Deterministic Sim     |
| - rewards/costs       |      | - physics             |
| - inventory updates   |      | - resources/damage    |
+-----------------------+      | - manufacturing       |
                               +-----------+-----------+
                                           |
                                           v
                               +-----------+-----------+
                               | Presentation / UI     |
                               | - render state        |
                               | - diagnostics         |
                               | - player commands     |
                               +-----------------------+
```

### 2.1 Core Layers

| Layer | Responsibility | Examples |
|---|---|---|
| Authored data | Declarative definitions and validation | materials, components, reactions, recipes, scenarios, simulation profiles |
| Simulation state | Canonical deterministic runtime state | bodies, assemblies, gases, contacts, links, jobs, resource stores |
| Simulation systems | Mutate simulation state in fixed steps | integration, collision, damage, combustion, gravity, manufacturing |
| Game-flow state | Transitions between phases | design, launch, flight, return, salvage, loss |
| Presentation | Non-authoritative rendering and UI | HUD, designer overlays, exhaust visuals, diagnostics |

### 2.2 Design Principle

Simulation systems may use approximations, but approximations must be explicit, deterministic, and conservative with respect to represented mass and momentum. Presentation may aggregate visuals, but it must not invent gameplay effects.

## 3. Simulation Profiles

A `SimulationProfile` declares numerical constraints and overload behaviour. All tolerances and capacity limits referenced by requirements are read from the active profile.

```text
SimulationProfile
- id
- fixed_step_seconds
- max_substeps_per_frame
- real_time_budget_ms
- overload_policy
- max_dynamic_bodies
- max_gas_parcels
- max_contacts
- max_bonds
- max_links
- max_fragments
- momentum_tolerance
- angular_momentum_tolerance
- mass_tolerance
- energy_accounting_tolerance
- penetration_tolerance
- constraint_error_tolerance
- projectile_ccd_speed_limit
- gravity_significance_threshold
```

### 3.1 Overload Policies

Initial policies should be implemented in priority order:

1. **Slow simulation time:** keep all physics steps but expose reduced time scale to presentation.
2. **Deterministic aggregation:** merge eligible parcels/fragments while preserving total mass, composition, momentum, and thermal energy.
3. **Deterministic culling:** only remove entities whose profile-defined gameplay effect is negligible and whose removed quantities are accounted for in diagnostics.
4. **Pause with diagnostic:** stop advancing simulation if no safe policy can preserve required interactions.

## 4. Core Data Model

### 4.1 Bodies

`Body` is the base unit of motion and collision.

```text
Body
- id
- body_type: component | asteroid_child | shell | gas_parcel | mineral_parcel | fragment | background_proxy
- mass
- center_of_mass_local
- position_world
- linear_velocity
- orientation
- angular_velocity
- inertia_tensor_2d
- collision_shape
- material_id
- integrity
- temperature
- contents[]
- owning_assembly_id?
```

Bodies are independent when they are not constrained into an assembly. Assemblies compute aggregate mass, centre of mass, linear momentum, angular momentum, and rotational inertia from member bodies and intact structural relationships.

### 4.2 Components

`ComponentDefinition` defines authored properties; `ComponentInstance` stores runtime condition.

```text
ComponentDefinition
- id
- display_name
- category: structure | armour | engine | thruster | cannon | store | scoop | nanofactory | control | sensor
- geometry
- material_id
- dry_mass_policy
- explicit_mass?
- connection_ports[]
- damage_curve
- repair_recipe_id?
- functions[]
```

```text
ComponentInstance
- component_id
- definition_id
- transform_in_design
- integrity
- functional_efficiency
- local_damage_regions[]
- stores[]
- installed_programs[]
- cooldowns
- runtime_geometry_override?
```

### 4.3 Links and Bonds

Links are zero-mass graph edges with integrity, capacity, and failure modes. They may transfer commands, resources, manufacturing access, or structural load.

```text
Link
- id
- link_type: control | resource | manufacturing | structural
- endpoint_a
- endpoint_b
- direction: directed | bidirectional
- compatible_resource_types[]
- force_capacity
- torque_capacity
- flow_capacity
- signal_latency
- integrity
- damage_regions[]
```

Asteroid bonds are equivalent to structural links between asteroid children but use asteroid-specific strength, porosity, and mineral-composition parameters.

### 4.4 Resources

Resources are conserved quantities with mass and optional composition.

```text
ResourceType
- id
- category: fuel_feedstock | oxidiser_feedstock | fuel | oxidiser | metal | mineral | shell | reaction_gas | waste
- density
- phase: solid | liquid | gas | aggregate
- usable_directly
```

```text
StoreState
- resource_type
- quantity_mass
- usable_capacity_mass
- containment_effectiveness
- pressure?
- temperature?
```

Shells are both resources while stored and physical bodies when loaded/fired/released.

## 5. Simulation Step Pipeline

Each fixed simulation step runs systems in deterministic order. Systems should use stable IDs and deterministic iteration order.

1. **Command ingestion:** convert player/program inputs into requested component actions.
2. **Connectivity resolution:** check intact control/resource/manufacturing paths and capacities.
3. **Resource reservation and injection:** deduct reactants, propellants, job inputs, or ammunition from stores.
4. **Reaction and gas update:** ignite eligible fuel/oxidiser mixtures, create or update hot gas parcels.
5. **Force accumulation:** gravity, gas-surface impulses, contact impulses, structural constraints, scoop forces.
6. **Collision detection:** broad phase, narrow phase, continuous collision detection for fast bodies.
7. **Collision/contact resolution:** resolve impulses, friction, thermal exchange, penetration correction.
8. **Structural load propagation:** test links and bonds for tensile, compressive, shear, torque, and flow overload.
9. **Damage application:** convert trauma into integrity loss, break items, update functional efficiency and geometry.
10. **Fragmentation/separation:** split disconnected assemblies or asteroid aggregates into independent bodies/assemblies.
11. **Manufacturing and repair:** advance jobs using simulation time and accessible resources.
12. **Mass-property refresh:** recalculate mass, centre of mass, inertia, capacities, and derived statistics.
13. **Integration:** advance positions/orientations with bounded, profile-selected integration.
14. **Aggregation/capacity policy:** merge/cull only through documented conservative rules.
15. **Diagnostics:** log conservation, stability, capacity, and geometry violations in diagnostic builds.

## 6. Physics Design

### 6.1 Integration

The first prototype should use a semi-implicit Euler integrator with fixed time steps for simplicity, paired with strict step limits and diagnostic conservation checks. If gas/collision stiffness proves unstable, evaluate velocity Verlet or an impulse-based rigid-body solver with warm-started constraints.

### 6.2 Rigid Assemblies vs Flexible Structure

For the first vertical slice, use connected rigid bodies with breakable constraints rather than continuous flexible-body deformation.

- Components remain rigid until damaged geometry replaces or splits them.
- Structural links transfer force and torque up to limits.
- Excess load accumulates trauma and may break links or components.
- Disconnected groups become independent assemblies.

This satisfies the requirement that ships are not perfectly rigid unless their intact structure supports the load while keeping implementation scope manageable.

### 6.3 Collision

Collision uses:

- Spatial partitioning broad phase.
- Convex polygon/circle narrow phase for components, shells, children, and parcels.
- Continuous collision detection for shells and other profile-declared fast bodies.
- Contact manifolds with multiple points per body pair.
- Impulse resolution including off-centre torque, restitution, friction, and material response.

Gas parcels use lighter collision handling but still transfer momentum and thermal energy to solid surfaces.

### 6.4 Gravity

Gravity is split into two models:

1. **Local body gravity:** pairwise interactions above significance threshold.
2. **Background fields:** configured planets, moons, stars, and wormholes that apply force without necessarily being local collidable bodies.

Singular or undefined regions must use a finite limiting rule declared by the scenario or background-body definition.

## 7. Propulsion and Weapons

### 7.1 Thrusters

Thrusters are chambers/nozzles that inject fuel and oxidiser parcels through intact resource links. Combustion creates hot gas parcels with conserved represented mass and momentum. Thrust emerges from gas-surface collision impulses against engine geometry and escaping exhaust.

Key implementation notes:

- No direct force should be applied for normal thrust.
- Damaged injector/chamber/nozzle geometry changes gas collision results.
- Leaks are represented as gas escaping through damaged geometry.
- Manoeuvring thrusters generate torque naturally when their force line misses the current centre of mass.

### 7.2 Cannon

Cannons reuse the same reaction and gas-pressure model as thrusters but include a loaded shell body in a chamber/barrel constraint.

Firing sequence:

1. Validate control, shell access, propellant access, cooldown, and cannon condition.
2. Move one shell resource from ammunition store into physical loaded-shell state.
3. Inject propellants into the chamber.
4. Combustion gas accelerates shell through contact/pressure.
5. Recoil transfers equal and opposite momentum through cannon contact and structural attachments.
6. Obstruction or damaged containment may cause rupture, misfire, or gas release.

### 7.3 Explosions

Explosions are not radial damage events. They are conversions of stored reactants into hot gas parcels and represented fragments. Nearby damage results from gas pressure, heat transfer, and fragment/contact collisions.

## 8. Damage and Structural Failure

Damage is local and cumulative.

```text
TraumaEvent
- target_id
- location_world
- impulse
- mechanical_energy
- thermal_energy
- damage_type
- source_id
```

Damage processing:

1. Map trauma to local region on component, link, bond, shell, or asteroid child.
2. Compare against elastic limits and material toughness.
3. Reduce integrity through the target damage curve.
4. Recompute functional efficiency.
5. Replace or degrade geometry where required.
6. Break targets at zero integrity.
7. Rebuild connectivity graphs and separate disconnected groups.

Stores with breaches release contents as gas parcels, resource parcels, shells, or aggregate representations depending on contents and pressure.

## 9. Asteroid Design

Asteroids are aggregates of child bodies connected by bonds.

```text
AsteroidAggregate
- id
- child_ids[]
- bond_ids[]
- mineral_distribution
- porosity
- stability_rating
```

Fragmentation is graph-based:

1. Collision or load applies trauma to children and bonds.
2. Overloaded bonds break.
3. Connected-component analysis finds disconnected child groups.
4. Each group becomes a new aggregate with conserved mass and momentum.
5. Pulverised children become collectible mineral parcels or documented aggregate dust.

Rotational and tidal loads should periodically test bonds so asteroids can shed mass without direct weapon impacts.

## 10. Mining, Scooping, Manufacturing, and Repair

### 10.1 Mining and Collection

Mining emerges from asteroid fragmentation. Valuable material exists in child composition and released parcels.

Scoops apply capture forces or contact interactions rather than teleporting parcels. Successful collection transfers parcel mass and composition to compatible stores through intact resource links, while conserving combined momentum of ship plus parcel.

### 10.2 Manufacturing

Nanofactory jobs are deterministic state machines.

```text
ManufacturingJob
- id
- factory_id
- recipe_id
- target_id?
- reserved_inputs[]
- progress_seconds
- required_seconds
- output_state: pending | blocked_for_capacity | completed
```

Jobs require intact factory, installed program/recipe, accessible inputs, and output capacity. Completion pauses if output cannot be placed without losing accounted mass.

### 10.3 Repair

Repair consumes declared resources over simulation time. It can restore surviving components/connectors but cannot repair empty space unless a separate replacement job exists. Any repair that changes mass distribution or connectivity triggers mass-property and assembly recalculation.

## 11. Ship Designer

The ship designer is both an editor and a physical preview tool.

Required views:

- Component placement and overlap validation.
- Link routing by type, endpoints, direction, capacity, and integrity.
- Current total mass, centre of mass, and rotational inertia.
- Control mapping table.
- Resource path and manufacturing path overlays.
- Thrust and torque preview per control input.
- Structural load margin estimates.
- Launch-blocking errors vs survivability warnings.

A physically valid but fragile design may launch unless it has blocking errors such as overlapping solid geometry.

## 12. Flight UI and Diagnostics

The flight UI must distinguish requested commands from actual component activation. Failure reasons should be diagnosable when ship sensors/connectivity permit.

HUD/diagnostic information:

- Linear velocity, angular velocity, orientation.
- Fuel, oxidiser, metal, ammunition, and capacity.
- Active leaks, fires, reactions, broken links, detached assemblies, and critical failures.
- Component integrity, efficiency, temperature, and connectivity.
- Optional diagnostic overlays for forces, centres of mass, thrust vectors, torque, structural loads, resource paths, and control paths.

Sensor limits should be enforced by game mode and component capability. Omniscient debug views are allowed only when explicitly enabled.

## 13. Save, Replay, and Determinism

Saved ship designs are separate from active flight saves.

Design saves include:

- Component type, placement, geometry overrides, condition, contents, programs, and links.
- Authored data version and migration metadata.

Flight saves include sufficient state to resume bodies, assemblies, gases, reactions, damage, jobs, random seeds, environmental forces, and time-step sequence.

Diagnostic replay records:

- Initial state.
- Player commands.
- Simulation profile.
- Authored-data hashes.
- Random seed.
- Fixed-step sequence.

Deterministic replay should reproduce gameplay-significant events within declared tolerance on supported platforms and versions.

## 14. Authored Data and Validation

All release data must pass validation before normal play.

Validation checks include:

- Component geometry is non-degenerate and has valid material/mass data.
- Stores have valid capacities and resource compatibility.
- Links, ports, controls, recipes, reactions, and programs reference existing definitions.
- Reactions and recipes account for input mass, output mass, waste, energy, and time.
- Scenario background gravity fields avoid undocumented singularities.
- Basic ship reference configuration satisfies its required components, controls, links, armour, and vulnerabilities.

## 15. Vertical Slice Plan

### Milestone 1 — Deterministic Physics Sandbox

- Fixed-step simulation loop.
- Bodies with mass, inertia, collision geometry, position, velocity, orientation, and angular velocity.
- Off-centre forces and impulses.
- Conservation diagnostics.

### Milestone 2 — Ship Components and Links

- Component placement model.
- Structural, control, and resource links.
- Mass-property calculation.
- Basic design validation.

### Milestone 3 — Gas-Derived Propulsion

- Fuel/oxidiser stores and injection.
- Reaction gas parcels.
- Engine gas contact and exhaust.
- Main thrust and manoeuvring torque.

### Milestone 4 — Cannon and Damage

- Shell storage and loading.
- Gas-pressure firing and recoil.
- Local trauma, integrity, and broken links.
- Damaged engine or cannon behaviour.

### Milestone 5 — Asteroid Fragmentation and Collection

- Aggregate asteroid children and bonds.
- Bond overload and graph separation.
- Mineral parcel release.
- Scoop capture and momentum-conserving storage transfer.

### Milestone 6 — Nanofactory and Repair

- Manufacturing jobs.
- Repair jobs.
- Shell manufacture.
- Resource accounting and blocked outputs.

### Milestone 7 — Sortie Loop

- Launch selected valid design.
- Mine/fight/repair in flight.
- Return/recovery rules.
- Post-sortie gains, costs, losses, and next-phase inventory.

## 16. Basic Ship Reference Design

The first reference ship should include:

- Rear main engine.
- Fuel and oxidiser tanks linked to main engine, manoeuvring thrusters, cannon, and nanofactory where applicable.
- Left-facing and right-facing manoeuvring thrusters mounted away from centreline.
- Forward cannon with fire control and ammunition store.
- Metal store.
- Scoop linked to compatible stores.
- Nanofactory with repair and shell-manufacturing programs.
- Structural members sufficient for nominal thrust and recoil.
- Armour shielding at least one critical component.
- Intentional vulnerabilities: exposed links, ammunition hazards, detachable engine mount, or unarmoured control/manufacturing dependency.

## 17. Major Open Decisions

The requirements intentionally defer several choices. The design recommends answering them through prototypes in this order:

1. Target platform, reference hardware, update rate, and world scale.
2. Physics solver/integrator and tolerances.
3. Gas parcel scale, merging, splitting, lifetime, and off-screen handling.
4. Structural model details for load propagation.
5. Chemistry and resource recipes.
6. Sensor model and flight-assistance sophistication.
7. Mission economy, return conditions, and progression pacing.
8. Whether electrical power, coolant, data buses, crew, or routed connector geometry belong in the first playable version.

## 18. Requirement Traceability

| Design area | Primary requirement groups |
|---|---|
| Simulation profiles and deterministic loop | PHY, NFR, DBG |
| Material and resource conservation | MAT, RES |
| Gravity and environmental fields | GRV |
| Contact, collision, and damage | COL, DMG |
| Ship designer and validation | SHP, LNK, VAL |
| Propulsion and controls | THR, CTL |
| Weapons and explosions | WPN, AMM, HAZ |
| Asteroids and fragmentation | AST |
| Mining and collection | SCP |
| Manufacturing and repair | MFG, RPR |
| Basic ship | BAS |
| Flight UI and visual diagnostics | UIF, VIS |
| Game loop and progression | GAM |
| Saving and replay | SAV, DBG |
