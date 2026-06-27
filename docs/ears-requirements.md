# Mammoth Space Battles — EARS Requirements Specification

**Status:** Initial concept specification  
**Version:** 0.1  
**Date:** 2026-06-27

## 1. Purpose

This document defines the initial requirements for a two-dimensional space-combat and ship-design game inspired by *Asteroids*. The game is distinguished by physically simulated spacecraft, propulsion, weapons, damage, asteroid fragmentation, resource gathering, and manufacturing.

The intended core loop is:

1. Design or modify a ship.
2. Launch the ship into a simulated environment.
3. Fly, fight, mine, salvage, and gather resources.
4. Return with a profit or survive long enough to rebuild.
5. Repair the ship and improve its design.
6. Launch again.

## 2. EARS Conventions

Requirements use the Easy Approach to Requirements Syntax (EARS):

- **Ubiquitous:** The system shall `<response>`.
- **Event-driven:** When `<trigger>`, the system shall `<response>`.
- **State-driven:** While `<state>`, the system shall `<response>`.
- **Unwanted behaviour:** If `<condition>`, then the system shall `<response>`.
- **Optional feature:** Where `<feature is enabled>`, the system shall `<response>`.

Each requirement is intended to be independently testable. Terms such as accuracy, maximum count, and duration refer to configurable values in the simulation profile unless an exact value is later specified.

## 3. Scope and Interpretation

The simulation is **mesoscopic**, not molecular. A gas particle represents a finite parcel of matter with mass, composition, momentum, and thermal energy. “Accurate” means that the simulated system conserves physical quantities within declared numerical tolerances and produces plausible behaviour at the chosen scale.

The simulation covers:

- Two-dimensional position, shape, and collision geometry.
- Linear and angular motion.
- Variable mass and centre of mass.
- Local component damage and structural failure.
- Fuel, oxidiser, metal, minerals, ammunition, and reaction gases.
- Physically motivated engines, manoeuvring thrusters, cannons, explosions, and asteroid fragmentation.
- Gravity from local massive bodies and configured background bodies.

The initial specification does not require:

- Three-dimensional movement or geometry.
- Relativistic physics.
- Aerodynamics outside simulated gases.
- Individual molecule simulation.
- Real-world chemistry beyond configured reaction rules and conservation constraints.
- Multiplayer networking.

## 4. Definitions

| Term | Definition |
|---|---|
| **Body** | Any independently moving simulated object with mass, position, velocity, orientation, angular velocity, and collision geometry. |
| **Component** | A functional or structural ship body that may be connected to other components. |
| **Connector** | A massless logical or structural link between components, carrying forces, resources, control signals, or manufacturing dependencies. |
| **Bond** | A force-bearing connection between neighbouring asteroid children. |
| **Asteroid child** | A smaller physical body that forms part of an aggregate asteroid. |
| **Gas parcel** | A simulated body representing fuel gas, oxidiser gas, hot combustion gas, reaction gas, or explosion gas. |
| **Store** | A component that contains a resource and whose total mass changes with its contents. |
| **Trauma** | Accumulated damaging mechanical energy or impulse applied locally to a body, component, connector, or bond. |
| **Integrity** | Remaining ability of an item to bear load or perform its function. |
| **Control link** | A connector that maps a player or program command to a component action. |
| **Resource link** | A connector through which a component may draw or deposit a resource. |
| **Structural link** | A connector that transfers forces and torque between components. |
| **Background body** | A configured planet, moon, star, wormhole, or other source whose gravitational effect is simulated even if the source is not a locally collidable body. |
| **Simulation profile** | A named collection of numerical tolerances, time-step limits, particle limits, and fidelity settings. |
| **Functional efficiency** | A value from zero to one that scales a damaged component’s capability. |

## 5. System-Wide Physics

### 5.1 State and integration

- **PHY-001:** The simulation shall represent every dynamic body with mass, centre of mass, position, linear velocity, orientation, angular velocity, and collision geometry.
- **PHY-002:** The simulation shall derive each body's linear acceleration from the net force acting on that body.
- **PHY-003:** The simulation shall derive each body's angular acceleration from the net torque acting about that body's current centre of mass.
- **PHY-004:** The simulation shall account for rotational inertia when calculating angular acceleration.
- **PHY-005:** The simulation shall recalculate a composite object's total mass, centre of mass, and rotational inertia when its composition or stored contents change.
- **PHY-006:** When a force acts away from a body's centre of mass, the simulation shall apply both the resulting linear impulse and torque.
- **PHY-007:** The simulation shall preserve the linear and angular momentum of an isolated system within the tolerances declared by the active simulation profile.
- **PHY-008:** The simulation shall preserve simulated mass across transfers and reactions except where a configured reaction explicitly converts mass into another represented form.
- **PHY-009:** The simulation shall track kinetic, elastic, chemical, and thermal energy sufficiently to account for configured collisions, reactions, and explosions.
- **PHY-010:** The simulation shall use a time integration method that remains stable for the maximum force, speed, and time-step values declared by the active simulation profile.
- **PHY-011:** When a frame duration exceeds the permitted physics step, the simulation shall process the elapsed time using multiple bounded physics steps.
- **PHY-012:** If the simulation cannot process all required physics steps within the configured real-time budget, then the system shall apply the configured overload policy without silently skipping physical interactions.
- **PHY-013:** The simulation shall expose the active physics time scale to the presentation layer.
- **PHY-014:** While the simulation is paused, the system shall not advance physical state.

### 5.2 Material properties

- **MAT-001:** The system shall assign each physical material a density, toughness, elasticity, thermal tolerance, and damage response.
- **MAT-002:** The system shall derive an object's dry mass from its geometry and material unless the object's definition provides a validated explicit mass.
- **MAT-003:** When an object's temperature crosses a configured material threshold, the system shall apply the associated loss of integrity or change of state.
- **MAT-004:** When a container gains or loses contents, the system shall update the container's total mass by the transferred resource mass.
- **MAT-005:** The system shall prevent any store from containing more than its intact usable capacity.
- **MAT-006:** When a store is damaged, the system shall recalculate its usable capacity and containment effectiveness from its remaining integrity.

## 6. Gravity and Environmental Forces

- **GRV-001:** The simulation shall calculate gravitational force between local bodies whose mass and distance place their interaction above the configured significance threshold.
- **GRV-002:** The simulation shall apply configured gravitational fields from background planets, moons, stars, and wormholes.
- **GRV-003:** The simulation shall apply gravitational force at each affected body's centre of mass unless a configured non-uniform field requires distributed force calculation.
- **GRV-004:** When a body's mass changes, the simulation shall use the updated mass in subsequent gravitational calculations.
- **GRV-005:** When multiple gravitational sources affect a body, the simulation shall apply the vector sum of their forces.
- **GRV-006:** The system shall distinguish deliberately simplified background fields from mutually interacting local gravitational bodies in scenario data.
- **GRV-007:** Where a wormhole is present, the simulation shall apply its configured gravitational field and traversal behaviour.
- **GRV-008:** When a body crosses a traversable wormhole boundary, the simulation shall transform its position, orientation, linear momentum, and angular momentum according to the wormhole definition.
- **GRV-009:** If a body enters a region in which the gravitational model is undefined or singular, then the simulation shall apply a documented finite limiting rule.

## 7. Collision, Contact, and Damage

### 7.1 Contact physics

- **COL-001:** When two collision geometries intersect during a physics step, the simulation shall resolve contact at the detected contact location.
- **COL-002:** When resolving a collision, the simulation shall account for the bodies' relative linear velocity, angular velocity, mass, inertia, shape, material, elasticity, and friction.
- **COL-003:** When a collision produces an off-centre impulse, the simulation shall update both linear and angular momentum.
- **COL-004:** The simulation shall support simultaneous contact at multiple points on the same body.
- **COL-005:** The simulation shall prevent fast projectiles from passing through collidable objects without contact detection within the supported speed range.
- **COL-006:** When bodies remain in contact, the simulation shall prevent persistent unphysical interpenetration beyond the active profile's tolerance.
- **COL-007:** When a gas parcel contacts a solid surface, the simulation shall transfer momentum and thermal energy according to the configured gas-surface interaction model.

### 7.2 Local trauma and integrity

- **DMG-001:** When an impact affects a ship component, the simulation shall apply trauma to that component at the impact location.
- **DMG-002:** When an impact affects an asteroid child, the simulation shall apply trauma to that child and its load-bearing bonds.
- **DMG-003:** When a force travels through a structural link or bond, the simulation shall test that link or bond against its tensile, compressive, shear, and torque limits.
- **DMG-004:** When accumulated trauma exceeds an item's elastic limit, the simulation shall reduce the item's integrity.
- **DMG-005:** When a component's integrity decreases, the simulation shall derive its functional efficiency from its component-specific damage curve.
- **DMG-006:** When an item's integrity reaches zero, the simulation shall mark that item as broken.
- **DMG-007:** When a structural link or bond breaks, the simulation shall cease transferring structural force through that connection.
- **DMG-008:** When a resource link breaks, the simulation shall cease transferring resources through that connection.
- **DMG-009:** When a control link breaks, the simulation shall cease transmitting commands through that connection.
- **DMG-010:** When damage creates a breach in a store, the simulation shall release contents through the breach according to pressure, breach size, and remaining contents.
- **DMG-011:** When a broken group of connected bodies has no remaining structural path to its parent group, the simulation shall treat the group as an independent moving assembly.
- **DMG-012:** The simulation shall retain the momentum of every separated fragment.
- **DMG-013:** If damage leaves invalid or degenerate collision geometry, then the system shall replace it with a documented safe physical representation while preserving mass and momentum.

## 8. Ship Construction and Structure

### 8.1 Components and layout

- **SHP-001:** The ship designer shall allow the player to place ship components in a two-dimensional construction area.
- **SHP-002:** The ship designer shall prevent the solid geometry of two components from overlapping.
- **SHP-003:** The ship designer shall allow connectors to cross components and other connectors.
- **SHP-004:** The simulation shall assign zero mass to connectors.
- **SHP-005:** The simulation shall allow connectors to receive damage despite having zero mass.
- **SHP-006:** The system shall represent each ship as one or more connected assemblies of components.
- **SHP-007:** The system shall calculate the dry mass contribution of each component.
- **SHP-008:** The system shall display the designed ship's current total mass, centre of mass, and rotational inertia.
- **SHP-009:** When resource quantities change in a ship, the system shall update the displayed and simulated mass properties.
- **SHP-010:** The ship designer shall allow structural components to be placed to strengthen the ship.
- **SHP-011:** Structural components shall transfer forces and torque between the components to which they are structurally linked.
- **SHP-012:** The system shall not treat a collection of components as perfectly rigid unless its intact structural components and links can support the applied loads.
- **SHP-013:** When acceleration or collision loads exceed structural limits, the simulation shall permit the ship to bend, disconnect, or break apart according to the structural model.
- **SHP-014:** The ship designer shall allow armour components to surround or shield other components without overlapping their solid geometry.
- **SHP-015:** When an incoming object first contacts armour, the simulation shall resolve the contact with the armour before applying any subsequent contact to protected components.
- **SHP-016:** The system shall allow an unarmoured impact to directly damage the struck internal component.

### 8.2 Connectivity and controls

- **LNK-001:** The ship designer shall allow the player to create control, resource, manufacturing, and structural links.
- **LNK-002:** The ship designer shall display each link's type, endpoints, direction, capacity, and integrity.
- **LNK-003:** The ship designer shall allow a control input to be mapped to one or more compatible components.
- **LNK-004:** When the player activates a mapped control input, the system shall transmit the command through each intact control path to its target component.
- **LNK-005:** If a target component lacks an intact required control path, then the system shall not activate that component from the disconnected control.
- **LNK-006:** If a consuming component lacks an intact resource path to a compatible store, then the system shall not draw that resource through the broken or incompatible path.
- **LNK-007:** When multiple compatible stores can supply a request, the system shall distribute the draw according to the configured resource-routing rule.
- **LNK-008:** When a link carries more force or resource flow than its rated capacity, the simulation shall apply overload trauma to that link.

### 8.3 Design validation

- **VAL-001:** When the player requests design validation, the system shall report overlapping components, disconnected required links, unsupported components, invalid control mappings, and inaccessible stores.
- **VAL-002:** The design validator shall distinguish launch-blocking errors from survivability warnings.
- **VAL-003:** The system shall allow a physically valid but fragile or difficult-to-control ship to launch.
- **VAL-004:** If a design contains overlapping solid components, then the system shall prevent that design from launching.
- **VAL-005:** The system shall estimate available linear thrust, torque, burn duration, structural load margin, ammunition capacity, and repair capacity for a valid design.
- **VAL-006:** The system shall identify directions of motion or rotation for which the design has no effective thruster authority.
- **VAL-007:** The system shall allow the player to save, load, duplicate, and revise ship designs.
- **VAL-008:** When a component definition changes between game versions, the system shall identify affected saved designs before migration.

## 9. Propulsion and Manoeuvring Thrusters

### 9.1 Reactants and combustion

- **THR-001:** A chemical thruster shall require intact resource paths to compatible fuel and oxidiser stores before it can sustain thrust.
- **THR-002:** When a chemical thruster receives an activation command, the system shall inject compact fuel parcels and oxidiser parcels into that thruster at rates limited by the command, component condition, link capacity, and available resources.
- **THR-003:** When a thruster injects a fuel or oxidiser parcel, the system shall deduct the parcel's mass and composition from the supplying store.
- **THR-004:** When overlapping fuel and oxidiser parcels meet the configured ignition conditions, the simulation shall consume reactants according to the configured reaction ratio.
- **THR-005:** When fuel and oxidiser react, the simulation shall produce hot, dense gas parcels with conserved mass, momentum, and represented energy.
- **THR-006:** While hot gas is confined by an engine, the simulation shall allow gas pressure and collisions to transfer momentum to the engine geometry.
- **THR-007:** When reaction gas exits an engine, the simulation shall retain the gas as independently moving exhaust until it is merged, culled, collected, or leaves the simulated region under a documented rule.
- **THR-008:** The simulation shall derive spacecraft thrust from gas interactions with engine geometry rather than applying a direct force to the spacecraft.
- **THR-009:** When an engine's geometry is damaged, the simulation shall use the damaged geometry for subsequent gas collisions.
- **THR-010:** When an engine's geometry or injector is damaged, the system shall permit its thrust magnitude, direction, efficiency, leakage, and stability to change.
- **THR-011:** If either required reactant is unavailable, then the thruster shall cease generating newly reacted gas.
- **THR-012:** If fuel and oxidiser mix outside intended containment and meet ignition conditions, then the simulation shall apply the same configured chemistry and energy rules used for intentional combustion.

### 9.2 Rotation and control

- **CTL-001:** The system shall rotate ships only through simulated torque or collision impulses.
- **CTL-002:** The system shall not directly set a ship's angular velocity in response to a normal player steering command.
- **CTL-003:** When a manoeuvring thruster fires away from the current centre of mass, the simulation shall derive torque from its resulting physical forces.
- **CTL-004:** While no net torque acts on an isolated ship, the simulation shall preserve its angular momentum within the active profile's tolerance.
- **CTL-005:** When the player releases a rotation command, the system shall not automatically cancel the ship's angular velocity unless an enabled control program commands counter-thrust.
- **CTL-006:** Where flight-assistance software is installed and enabled, the system shall issue only commands available through intact control links to functioning thrusters.
- **CTL-007:** Where flight-assistance software is installed and enabled, the system shall not apply non-physical corrective forces or torque.
- **CTL-008:** When a ship's centre of mass moves because of resource use, damage, or separation, the system shall use the new centre of mass when calculating thruster torque.

## 10. Weapons, Ammunition, and Explosions

### 10.1 Cannon operation

- **WPN-001:** A cannon shall require an intact control path, an available compatible shell, and all configured propellant resources before it can fire.
- **WPN-002:** When a valid fire command reaches a ready cannon, the cannon shall load or accept one shell from its linked ammunition store.
- **WPN-003:** When a cannon fires, the system shall inject fuel and oxidiser into its firing chamber according to the cannon definition.
- **WPN-004:** When cannon propellant reacts, the simulation shall accelerate the shell through physical gas pressure and contact with the cannon and barrel geometry.
- **WPN-005:** When a shell accelerates down a barrel, the simulation shall transfer equal and opposite momentum to the cannon assembly within numerical tolerance.
- **WPN-006:** The simulation shall derive shot velocity from the reaction, barrel geometry, shell mass, leakage, and cannon condition rather than assigning a fixed launch velocity.
- **WPN-007:** When a cannon's barrel or chamber is damaged, the simulation shall use the damaged geometry and component condition for subsequent shots.
- **WPN-008:** If a damaged or obstructed cannon cannot safely contain firing pressure, then the simulation shall permit rupture, misfire, or unintended gas release according to the physical state.
- **WPN-009:** If no compatible shell is accessible through an intact link, then the cannon shall not fire.
- **WPN-010:** If required cannon propellant is unavailable, then the cannon shall not complete a normal firing cycle.
- **WPN-011:** The system shall apply cannon recoil to the ship at the cannon's structural attachment points.
- **WPN-012:** When cannon recoil exceeds local structural capacity, the simulation shall damage or detach the cannon or connected structure.

### 10.2 Shells and detonation

- **AMM-001:** The simulation shall represent each fired shell as a body with mass, geometry, position, velocity, orientation, angular velocity, integrity, and internal contents.
- **AMM-002:** The system shall allow a shell to contain separated concentrated fuel and oxidiser.
- **AMM-003:** When a shell experiences an impact, the simulation shall apply local trauma to the shell.
- **AMM-004:** When shell damage causes its fuel and oxidiser to mix under ignition conditions, the simulation shall initiate the configured explosive reaction.
- **AMM-005:** When an impact fuze remains functional and detects a qualifying impact, the system shall cause the shell's reactants to mix.
- **AMM-006:** If a shell's fuze is damaged, then the system shall derive failure to detonate, premature detonation, or normal function from the damaged fuze state.
- **AMM-007:** When a shell detonates, the simulation shall convert its configured reactants into expanding hot gas parcels.
- **AMM-008:** When explosion gas contacts nearby bodies, the simulation shall transfer pressure impulse, momentum, and thermal energy through gas-body interactions.
- **AMM-009:** The simulation shall not apply an unexplained radial damage value independently of represented fragments, gas, heat, or contact forces.
- **AMM-010:** When a shell fragments, the simulation shall preserve the mass and momentum of its represented fragments and gas within numerical tolerance.

### 10.3 Ammunition hazards

- **HAZ-001:** The simulation shall represent stored shells as damageable contents of an ammunition store.
- **HAZ-002:** When an ammunition store is struck, the system shall apply transmitted trauma to affected stored shells according to the store's protection and internal arrangement.
- **HAZ-003:** When one stored shell detonates, the simulation shall allow its gas, heat, and fragments to damage neighbouring shells, the ammunition store, and nearby components.
- **HAZ-004:** When damage causes multiple stored shells to react, the simulation shall resolve the resulting chain reaction from their physical interactions.
- **HAZ-005:** If an ammunition store ruptures without detonating all shells, then the system shall release surviving shells or their contents as physical bodies or parcels.

## 11. Asteroids

### 11.1 Aggregate construction

- **AST-001:** The system shall represent each destructible asteroid as an aggregate of asteroid children.
- **AST-002:** The system shall connect neighbouring asteroid children with damageable bonds.
- **AST-003:** The system shall assign each asteroid child physical geometry, mass, material, mineral composition, and integrity.
- **AST-004:** The simulation shall calculate an aggregate asteroid's mass, centre of mass, linear momentum, angular momentum, and rotational inertia from its children.
- **AST-005:** The simulation shall permit asteroid aggregates to translate, rotate, and collide with other bodies.
- **AST-006:** The system shall generate or load asteroid bonds such that the initial aggregate has a declared structural stability.
- **AST-007:** The system shall permit asteroid composition, porosity, bond strength, and mineral distribution to vary between asteroids.

### 11.2 Collision and fragmentation

- **AST-008:** When an asteroid child collides with another body, the simulation shall resolve the collision at that child's geometry.
- **AST-009:** When an asteroid aggregate is loaded by collision, gravity, rotation, or weapon effects, the simulation shall distribute forces through intact neighbouring bonds.
- **AST-010:** When a bond's load or accumulated trauma exceeds its limit, the simulation shall break that bond.
- **AST-011:** When broken bonds divide an asteroid into disconnected groups, the system shall treat each group as an independent aggregate.
- **AST-012:** When an asteroid fragments, the simulation shall preserve the mass, linear momentum, and angular momentum of its children within numerical tolerance.
- **AST-013:** When released asteroid children collide after fragmentation, the simulation shall continue to resolve those collisions.
- **AST-014:** While an asteroid rotates, the simulation shall apply the resulting internal loads to its bonds.
- **AST-015:** If rotational or tidal loading exceeds bond strength, then the asteroid shall be able to shed children or split without a weapon impact.
- **AST-016:** When a child is pulverised below the explicitly simulated fragment scale, the system shall convert it into conserved collectible mineral parcels or a documented aggregate representation.

## 12. Mining, Scooping, and Resources

### 12.1 Resource model

- **RES-001:** The system shall represent fuel feedstock, oxidiser feedstock, metal, other minerals, and cannon shells as distinct resource types.
- **RES-002:** The system shall assign mass to every stored resource.
- **RES-003:** The system shall not create resources during transfer, collection, repair, or manufacturing.
- **RES-004:** The system shall define explicit recipes for converting mined minerals into fuel, oxidiser, metal stock, or other usable materials.
- **RES-005:** When a recipe converts resources, the system shall account for input mass, output mass, waste products, energy, and processing time.
- **RES-006:** The system shall distinguish immediately usable resources from raw minerals requiring processing.

### 12.2 Collection

- **SCP-001:** The simulation shall represent collectible minerals and resource parcels as physical bodies or conserved parcel groups.
- **SCP-002:** When a collectible parcel enters an active scoop's capture region, the simulation shall resolve its contact or capture force rather than teleporting its momentum away.
- **SCP-003:** When a scoop successfully captures a parcel, the system shall transfer its mass and composition to a compatible store through intact resource links.
- **SCP-004:** When a ship captures a parcel, the simulation shall conserve the combined momentum of the ship and parcel within numerical tolerance.
- **SCP-005:** If no compatible store has sufficient usable capacity, then the scoop shall not transfer the excess resource into storage.
- **SCP-006:** If the required scoop-to-store resource path is broken, then the scoop shall not deposit resources into that store.
- **SCP-007:** When an incoming parcel exceeds the scoop's safe relative speed or load, the simulation shall permit the parcel to damage, rebound from, or pass the scoop according to contact physics.
- **SCP-008:** When a store accepts a captured resource, the system shall update ship mass properties during the next physics step.

## 13. Manufacturing and Repair

### 13.1 Nanofactory

- **MFG-001:** A nanofactory shall require an intact component, an installed program or recipe, accessible inputs, and sufficient operating resources before beginning a job.
- **MFG-002:** The system shall allow a nanofactory to be programmed to repair supported components.
- **MFG-003:** The system shall allow a nanofactory to be programmed to manufacture compatible cannon shells.
- **MFG-004:** When a nanofactory begins a job, the system shall reserve or consume inputs according to the job definition.
- **MFG-005:** While a nanofactory job is active, the system shall advance the job according to elapsed simulation time and the factory's functional efficiency.
- **MFG-006:** When a manufacturing job completes, the system shall place its output in an accessible compatible store or output location.
- **MFG-007:** If no valid output capacity is available, then the nanofactory shall pause completion without destroying the finished output's accounted mass.
- **MFG-008:** If the nanofactory breaks, then the system shall stop all jobs requiring that nanofactory.
- **MFG-009:** When a damaged nanofactory operates, the system shall scale its speed, efficiency, precision, and failure risk according to its damage model.
- **MFG-010:** The system shall not permit a broken nanofactory to repair itself unless the design includes another functioning repair-capable factory or a separately defined self-repair mechanism.

### 13.2 Repair

- **RPR-001:** A repair operation shall require a functioning repair-capable nanofactory and an intact manufacturing path to the repair target.
- **RPR-002:** A repair operation shall consume the metal, fuel, oxidiser, and other resources declared by the target's repair recipe.
- **RPR-003:** The repair system shall not restore more material mass than is supplied by its consumed inputs.
- **RPR-004:** While repair is active, the system shall restore target integrity over simulation time at a rate limited by factory efficiency, link capacity, target accessibility, and available resources.
- **RPR-005:** When repair restores a component's integrity, the system shall recalculate its functional efficiency and geometry as defined by the component's repair model.
- **RPR-006:** When repair restores a connector, the system shall restore its applicable force, flow, or signal capacity according to repaired integrity.
- **RPR-007:** If a repair target has been completely detached or lost, then the repair system shall require a build or replacement job rather than repairing empty space.
- **RPR-008:** If required repair resources become unavailable, then the system shall pause the repair without granting unpaid integrity.
- **RPR-009:** When a repair changes mass distribution or structural connectivity, the simulation shall recalculate the assembly's mass properties and connected groups.

## 14. Basic Ship Reference Configuration

The game shall provide at least one basic ship design demonstrating the component and link model.

- **BAS-001:** The basic ship shall include one main engine mounted at the rear.
- **BAS-002:** The basic ship shall include one fuel tank and one oxidiser tank linked to the main engine.
- **BAS-003:** The basic ship shall map the forward control to the main engine.
- **BAS-004:** The basic ship shall include one left-facing and one right-facing manoeuvring thruster mounted away from the centreline sufficiently to generate useful torque.
- **BAS-005:** The basic ship shall link both manoeuvring thrusters to fuel and oxidiser stores.
- **BAS-006:** The basic ship shall map the right-turn control to the left-facing thruster and the left-turn control to the right-facing thruster, subject to final nozzle orientation.
- **BAS-007:** The basic ship shall include a metal store.
- **BAS-008:** The basic ship shall include a nanofactory linked to the fuel tank, oxidiser tank, metal store, ammunition store, and repairable targets required by its installed programs.
- **BAS-009:** The basic ship's nanofactory shall include programs for repair and cannon-shell manufacture.
- **BAS-010:** The basic ship shall include a scoop linked to compatible tanks and stores.
- **BAS-011:** The basic ship shall include a forward cannon linked to a fire control, ammunition store, fuel tank, and oxidiser tank.
- **BAS-012:** The basic ship shall include an ammunition store linked to the nanofactory.
- **BAS-013:** The basic ship shall include sufficient structural components and links to survive its own nominal main-engine thrust and cannon recoil when undamaged.
- **BAS-014:** The basic ship shall include armour that demonstrates protection of at least one critical component.
- **BAS-015:** The basic ship shall remain vulnerable to loss of control, propulsion, ammunition, manufacturing, or structural integrity through local damage.

## 15. Player Interaction and Information

### 15.1 Flight controls

- **UIF-001:** The flight interface shall provide controls for forward thrust, left rotation thrust, right rotation thrust, cannon fire, scoop operation, repair jobs, and manufacturing jobs when the ship supports those functions.
- **UIF-002:** The flight interface shall distinguish a control command from successful component activation.
- **UIF-003:** When a commanded component fails to activate, the system shall provide a diagnosable reason including missing control, missing resource, damage, capacity, or cooldown where known to the ship.
- **UIF-004:** The system shall not reveal information that the player's ship lacks a configured means to sense unless the game mode explicitly enables omniscient information.
- **UIF-005:** The flight interface shall display linear velocity, angular velocity, orientation, and available control authority using diegetic or HUD instruments.
- **UIF-006:** The flight interface shall display current fuel, oxidiser, metal, ammunition, and storage capacity values available to the player's ship sensors.
- **UIF-007:** The flight interface shall indicate active leaks, fires, reactions, broken links, detached assemblies, and critical component failures detected by the ship.
- **UIF-008:** The system shall allow the player to inspect component integrity, efficiency, temperature, and connectivity when those values are available to the player's ship or design interface.

### 15.2 Physics legibility

- **VIS-001:** The presentation layer shall depict thruster exhaust with position and direction consistent with simulated escaping gas.
- **VIS-002:** The presentation layer shall depict explosion expansion consistently with simulated gas and fragments.
- **VIS-003:** The presentation layer shall depict asteroid and ship fragments at their simulated positions and orientations.
- **VIS-004:** When simulation entities are visually aggregated for performance, the presentation layer shall preserve their represented total mass, momentum, composition, and gameplay effect.
- **VIS-005:** The system shall provide a diagnostic visualisation mode for forces, centres of mass, thrust vectors, torque, structural loads, resource paths, and control paths.
- **VIS-006:** The ship designer shall allow the player to preview expected thrust and torque vectors for each control mapping.

## 16. Game Loop and Progression

- **GAM-001:** The system shall allow the player to transition from ship design to a flight scenario using the selected valid design.
- **GAM-002:** During flight, the system shall allow the player to obtain resources by breaking asteroids and collecting released material.
- **GAM-003:** During flight, the system shall allow the player to spend collected or stored resources on repair and ammunition manufacturing when the ship has the required equipment and connectivity.
- **GAM-004:** The system shall record resources, recoverable components, mission rewards, and costs that survive the scenario's declared return conditions.
- **GAM-005:** When the player completes a valid return or recovery, the system shall make the resulting inventory and ship condition available to the design and maintenance phase.
- **GAM-006:** If the player's ship is destroyed or stranded, then the system shall apply the scenario's declared loss, rescue, salvage, or recovery rules.
- **GAM-007:** The progression system shall allow the player to acquire improved components, materials, programs, or manufacturing recipes.
- **GAM-008:** Improved components shall remain subject to the same mass, force, connectivity, resource, damage, and conservation rules as basic components.
- **GAM-009:** The economy shall account for the acquisition cost, repair cost, ammunition cost, resource value, and recovery value involved in a sortie.
- **GAM-010:** The post-sortie interface shall report gross gains, consumed resources, damage and repair costs, losses, and net profit or loss.
- **GAM-011:** The system shall permit profitable outcomes through mining, combat, salvage, mission rewards, or a configured combination of those activities.

## 17. Saving, Replay, and Diagnostics

- **SAV-001:** The system shall save ship designs independently from active flight state.
- **SAV-002:** The system shall save each component's type, geometry, placement, condition, contents, programs, and links required to reconstruct a design.
- **SAV-003:** Where mid-flight saving is enabled, the system shall save sufficient state to resume all bodies, assemblies, gases, reactions, damage, jobs, and environmental forces without a discontinuity visible beyond numerical tolerance.
- **SAV-004:** When loading a save created by an incompatible simulation version, the system shall reject it safely or apply an explicit migration.
- **DBG-001:** The simulation shall support recording the initial state, player commands, configuration, random seed, and time-step sequence needed to reproduce a diagnostic run.
- **DBG-002:** When deterministic replay mode is enabled on the same supported platform and version, the simulation shall reproduce gameplay-significant events within declared tolerance.
- **DBG-003:** The system shall log any violation of declared conservation, stability, capacity, or geometry tolerances in diagnostic builds.
- **DBG-004:** The system shall allow a diagnostic run to report per-system computation cost and active counts for bodies, contacts, bonds, links, gas parcels, and fragments.

## 18. Performance and Quality Constraints

- **NFR-001:** The simulation profile shall declare supported maximum counts for dynamic bodies, gas parcels, contacts, bonds, components, links, and fragments.
- **NFR-002:** The simulation profile shall declare tolerances for linear momentum, angular momentum, mass, energy, penetration depth, and constraint error.
- **NFR-003:** Under the reference hardware load defined for a release, the system shall meet its target update rate for the declared reference scenario.
- **NFR-004:** When an entity count approaches a configured limit, the system shall apply only aggregation or culling rules that explicitly preserve required physical quantities and gameplay consequences.
- **NFR-005:** If a hard simulation capacity is reached, then the system shall expose the degraded condition and apply a documented deterministic policy.
- **NFR-006:** The system shall keep gameplay-critical physical outcomes independent of presentation frame rate within declared tolerance.
- **NFR-007:** The system shall validate authored component, reaction, material, recipe, and scenario data before making it available in normal play.
- **NFR-008:** If authored data violates conservation, geometry, or dependency constraints, then the validation tool shall identify the offending data and prevent its use in a release build.

## 19. Acceptance Scenarios

These scenarios exercise multiple requirements and provide early vertical-slice targets.

### AS-01 — Unassisted rotation

**Given** an intact basic ship at rest with full tanks and no external forces,  
**when** the player holds right-turn thrust and then releases it,  
**then** the left-facing manoeuvring thruster consumes fuel and oxidiser, physically generates exhaust and torque, the ship gains clockwise angular velocity, and the ship continues rotating after release.

### AS-02 — Counter-thrust

**Given** a rotating basic ship with functioning opposing manoeuvring thrusters,  
**when** the player commands the opposite turn,  
**then** the commanded thruster consumes reactants and applies opposing torque until the ship's angular momentum is reduced, cancelled, or reversed.

### AS-03 — Variable centre of mass

**Given** a ship with asymmetrically placed fuel and oxidiser tanks,  
**when** one tank loses mass through engine use or leakage,  
**then** the ship's centre of mass and rotational inertia change and later thruster firings produce correspondingly different linear acceleration and torque.

### AS-04 — Damaged engine

**Given** an engine that produces stable thrust while intact,  
**when** an impact deforms or removes part of its chamber or nozzle,  
**then** later combustion gas interacts with the damaged geometry and produces a physically derived change in thrust, direction, leakage, or stability.

### AS-05 — Cannon recoil

**Given** an intact loaded cannon mounted off the ship's centre of mass,  
**when** the cannon fires,  
**then** the shell gains forward momentum, the ship gains equal and opposite momentum within tolerance, and the off-centre recoil changes the ship's angular momentum.

### AS-06 — Magazine chain reaction

**Given** an ammunition store containing multiple live shells,  
**when** an impact damages one shell sufficiently to mix and ignite its reactants,  
**then** its detonation generates gas, heat, and fragments that can damage and detonate neighbouring shells and rupture the ship according to local physics.

### AS-07 — Asteroid fragmentation

**Given** a rotating aggregate asteroid with intact bonds,  
**when** a projectile impact overloads bonds near the contact point,  
**then** those bonds break, disconnected groups become independent aggregates, and total represented mass and momentum remain within tolerance.

### AS-08 — Mining and collection

**Given** an asteroid fragment containing usable minerals and a ship with an active scoop and available compatible storage,  
**when** the ship captures the fragment within the scoop's operating limits,  
**then** the fragment's mass and momentum transfer physically to the ship and its mineral mass appears in the linked store without duplication.

### AS-09 — Structural failure under thrust

**Given** a ship whose main engine attachment is too weak for full thrust,  
**when** the player commands full forward thrust,  
**then** engine forces load the attachment, the attachment accumulates trauma and breaks, and the detached engine continues with conserved momentum.

### AS-10 — Repair dependency failure

**Given** a damaged ship with sufficient repair resources but a broken nanofactory,  
**when** the player requests repair,  
**then** the repair does not begin and the interface identifies the unavailable nanofactory dependency.

### AS-11 — Broken resource link

**Given** a functioning thruster and non-empty tanks connected through a damaged resource link,  
**when** that link breaks and the player commands the thruster,  
**then** no reactant crosses the broken link and the thruster cannot sustain normal combustion.

### AS-12 — Profitable sortie

**Given** a valid ship design and a mining scenario,  
**when** the player launches, breaks an asteroid, gathers valuable minerals, expends fuel and ammunition, takes damage, and returns successfully,  
**then** the post-sortie report includes all gains and costs and applies the resulting net value and ship condition to the next design phase.

## 20. Open Decisions and Required Tuning

The following are intentionally not fixed by the initial concept and should be decided through prototypes:

| ID | Decision |
|---|---|
| **TBD-001** | Target platform, reference hardware, resolution, and update rate. |
| **TBD-002** | World scale, typical ship size, maximum projectile speed, and time acceleration. |
| **TBD-003** | Physics integrator, collision solver, constraint solver, and numerical tolerances. |
| **TBD-004** | Gas parcel scale, merging and splitting rules, lifetime, and off-screen handling. |
| **TBD-005** | Whether thermal radiation, conduction, melting, and phase changes are required in the first playable version. |
| **TBD-006** | The specific chemistry and recipes used to produce fuel, oxidiser, metal stock, propellant, and explosive mixtures. |
| **TBD-007** | Whether fuel and oxidiser are mined directly, refined from minerals, or both. |
| **TBD-008** | Whether ships use flexible-body deformation or connected rigid bodies with breakable constraints. |
| **TBD-009** | How structural loads propagate through components, connectors, and armour. |
| **TBD-010** | Wormhole force, traversal, time, and conservation rules. |
| **TBD-011** | Flight-assistance availability, sophistication, mass, power use, and failure modes. |
| **TBD-012** | Sensor limits and how much internal and external state the interface may reveal. |
| **TBD-013** | Scope of off-screen simulation and rules for entering or leaving the active region. |
| **TBD-014** | Mission structure, return conditions, recovery rules, economy balance, and progression pacing. |
| **TBD-015** | Whether ship design includes explicit electrical power, data buses, coolant, and crew systems. |
| **TBD-016** | Whether connectors are abstract paths or player-routed lines with localised collision and damage geometry. |
| **TBD-017** | Whether a nanofactory can replace entire missing components in flight or only repair surviving components. |
| **TBD-018** | Accessibility options for players who enjoy ship design but not demanding manual inertial control. |

## 21. Recommended First Vertical Slice

The first vertical slice should demonstrate the causal chain that defines the game:

1. Build a small ship from separate components and links.
2. Fire physical fuel and oxidiser parcels in one main engine and two manoeuvring thrusters.
3. Translate and rotate solely through gas contact, momentum, and torque.
4. Fire one physical cannon shell with recoil.
5. Damage a component and break one structural link.
6. Fragment one aggregate asteroid.
7. Scoop one released mineral type.
8. Spend that material through a nanofactory to repair damage or build one replacement shell.

Economy, procedural content, advanced chemistry, wormholes, and large gravitational environments can follow once this chain is stable, measurable, and enjoyable.
