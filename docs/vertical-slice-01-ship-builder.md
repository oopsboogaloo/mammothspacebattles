# Vertical Slice Task 1 — Small Ship Builder

**Status:** Proposed implementation slice  
**Related requirements:** SHP-001 through SHP-016, LNK-001 through LNK-008, VAL-001 through VAL-007, BAS-001 through BAS-015  
**Parent slice:** Recommended First Vertical Slice item 1, "Build a small ship from separate components and links."

## 1. Goal

Deliver a minimal ship-construction loop that lets a player assemble, validate, save, and load one small two-dimensional ship made from separate components and typed links. This slice establishes the data model used by later propulsion, weapon, damage, mining, and repair slices.

The result does not need to fly yet. It must produce a valid ship definition that later simulation slices can consume without changing the authored design format.

## 2. Player-Facing Scope

The player shall be able to:

1. Open a ship designer workspace.
2. Place components on a two-dimensional grid or continuous construction plane.
3. Rotate and move placed components.
4. Create typed links between compatible component endpoints.
5. See basic mass-property estimates for the current design.
6. Run design validation.
7. Save and reload the design.
8. Load a provided basic ship reference design.

## 3. Minimum Component Set

The first task should include only the components required to express the basic ship reference configuration and to support later vertical-slice work:

| Component | Required properties | Initial behaviour |
|---|---|---|
| Command module | Dry mass, collision shape, control-source endpoints | Provides control link origins. |
| Main engine | Dry mass, collision shape, fuel and oxidiser inputs, control input, structural mounts | Accepts links but does not need to produce thrust in this task. |
| Manoeuvring thruster | Dry mass, collision shape, fuel and oxidiser inputs, control input, structural mounts, nozzle direction | Accepts links but does not need to produce thrust in this task. |
| Fuel tank | Dry mass, usable capacity, initial fill, resource output endpoint | Contributes stored fuel mass to design estimates. |
| Oxidiser tank | Dry mass, usable capacity, initial fill, resource output endpoint | Contributes stored oxidiser mass to design estimates. |
| Metal store | Dry mass, usable capacity, initial fill, resource output/input endpoint | Contributes stored metal mass to design estimates. |
| Ammunition store | Dry mass, shell capacity, initial shell count, resource output/input endpoint | Contributes shell mass to design estimates. |
| Cannon | Dry mass, collision shape, ammunition input, fuel input, oxidiser input, fire-control input, structural mounts | Accepts links but does not need to fire in this task. |
| Scoop | Dry mass, collision shape, resource output endpoint, control input, structural mounts | Accepts links but does not need to collect parcels in this task. |
| Nanofactory | Dry mass, input/output endpoints, manufacturing link endpoints, installed program list | Accepts repair and manufacturing paths but does not need to run jobs in this task. |
| Armour plate | Dry mass, collision shape, material, structural mounts | May be placed as protection without overlapping solid geometry. |
| Structural beam | Dry mass, collision shape, structural endpoints | Creates or reinforces load paths between nearby components. |

## 4. Link Types

The designer shall support these typed links from the start:

- **Control links** from command sources to controllable components.
- **Resource links** from stores to consuming components or from producers to stores.
- **Manufacturing links** between the nanofactory, stores, and repairable targets.
- **Structural links** between components that can transfer force in later physics slices.

Each link record shall store a stable identifier, type, source endpoint, target endpoint, directionality, nominal capacity, and current integrity. Links may be rendered as lines even if their eventual simulation representation changes.

## 5. Design Data Contract

A saved ship design shall contain:

- A schema version.
- A design identifier and display name.
- A list of component instances with stable identifiers, component definition keys, position, rotation, condition, stored contents, installed programs, and any component-specific configuration.
- A list of link instances with stable identifiers, link type, endpoints, direction, capacity, and condition.
- Optional designer metadata such as camera position, notes, and tags.

Component instance identifiers must remain stable across save and load so later diagnostics, damage reports, and migrations can refer to the same authored parts.

## 6. Validation Rules

The first validator shall report launch-blocking errors for:

1. Overlapping solid component geometry.
2. Links whose source or target component does not exist.
3. Links connected to endpoints that do not exist on the referenced component definition.
4. Resource links connecting incompatible resource types.
5. Control links connecting incompatible controls.
6. Required basic ship functions that are absent from the reference design.

The validator shall report survivability warnings for:

1. Components with no structural path to the command module.
2. Engines, thrusters, cannons, or scoops with missing resource paths.
3. Controllable components with missing control paths.
4. The absence of armour around any critical component.
5. Designs with no effective source of forward thrust, turning authority, ammunition, repair resources, or mineral storage.

## 7. Basic Ship Reference Design

The repository shall include one data-authored basic ship that exercises every required component and link type. The design should include:

- A command module near the centre of the ship.
- One rear main engine with fuel, oxidiser, control, and structural links.
- Two manoeuvring thrusters offset from the centreline with opposite turning controls.
- Fuel, oxidiser, metal, and ammunition stores.
- One forward cannon connected to fire control, ammunition, fuel, and oxidiser.
- One scoop connected to compatible storage.
- One nanofactory connected to stores and at least one repairable target.
- Structural beams and structural links joining the ship into one primary assembly.
- Armour protecting at least one critical component while leaving other critical functions locally vulnerable.

## 8. Acceptance Criteria

This task is complete when:

1. A user can construct a small ship from the minimum component set.
2. The designer prevents or reports overlapping solid components.
3. The user can create all four required link types.
4. The designer displays total mass and an estimated centre of mass using dry mass plus stored resource mass.
5. The validator separates launch-blocking errors from survivability warnings.
6. A valid basic ship reference design is present in repository data.
7. Saving and loading preserves component identifiers, link identifiers, placement, contents, and installed programs.
8. The saved design format is documented well enough for the next vertical-slice task to consume.

## 9. Out of Scope

This task intentionally excludes:

- Actual thrust generation.
- Gas parcel simulation.
- Cannon firing.
- Collision response in flight.
- Local damage propagation.
- Asteroid fragmentation.
- Scoop capture physics.
- Nanofactory job execution.
- Economy and progression.

These behaviours belong to later vertical-slice tasks after the construction data model is stable.
