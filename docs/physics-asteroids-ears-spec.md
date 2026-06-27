# Mammoth Space Battles — EARS Requirements Specification

> A physics-first take on *Asteroids*: every object, force, and component is
> simulated. The game is about **designing** a ship, **flying** it under full
> rotational inertia, fighting other ships, mining asteroids, and turning a
> profit before going out again.

## About this document

These requirements use the **EARS** (Easy Approach to Requirements Syntax)
notation. Each requirement follows one of the standard EARS templates:

| Pattern | Template | Keyword |
|---|---|---|
| Ubiquitous | *The `<system>` shall `<response>`.* | (always active) |
| Event-driven | *When `<trigger>`, the `<system>` shall `<response>`.* | **When** |
| State-driven | *While `<state>`, the `<system>` shall `<response>`.* | **While** |
| Unwanted behaviour | *If `<condition>`, then the `<system>` shall `<response>`.* | **If / then** |
| Optional feature | *Where `<feature>`, the `<system>` shall `<response>`.* | **Where** |
| Complex | combinations of the above | — |

Each requirement has a stable identifier (e.g. `PHYS-3`) so it can be
referenced from design, tests, and traceability matrices.

### Glossary

- **Body** — any simulated object that has mass, position, velocity, an
  orientation, and angular velocity (ships, components, asteroid children,
  gas particles, projectiles, background objects).
- **Component** — a functional part of a ship (engine, tank, thruster, cannon,
  scoop, nano factory, store, etc.). Each component is itself a body.
- **Connector / Control link** — a logical link between components that carries
  control signals or resource flow. Connectors have no mass but can be damaged.
- **Structural member** — a mass-bearing rigid link added by the player to make
  a ship behave as a stiffer rigid body.
- **Bond** — a breakable constraint holding two neighbouring asteroid children
  (or two ship components) together. Bonds fail under accumulated trauma.
- **Trauma** — accumulated impulse/stress recorded on a body or bond; when it
  exceeds a threshold the bond breaks or the component degrades.
- **Reaction gas** — a transient gas body produced when fuel and oxidiser react;
  it carries momentum and transfers it on collision.
- **Stores** — the on-ship reservoirs: fuel, oxidiser, metal, and ammo.

---

## 1. Core physics simulation

**PHYS-1** — The simulation shall model every body with a position, linear
velocity, orientation, angular velocity, mass, and moment of inertia.

**PHYS-2** — The simulation shall integrate linear and angular motion of every
body each simulation step, including full rotational inertia.

**PHYS-3** — The simulation shall conserve linear and angular momentum across
collisions and reactions, except for momentum intentionally removed by modelled
damping or absorption.

**PHYS-4** — When two bodies overlap, the simulation shall resolve the collision
by applying equal and opposite impulses at the contact point, accounting for
each body's mass, velocity, orientation, and angular velocity.

**PHYS-5** — When a collision impulse is applied off a body's centre of mass,
the simulation shall apply the resulting torque so that the body's angular
velocity changes accordingly.

**PHYS-6** — The simulation shall apply no global linear or angular damping to
ships, so that an unbalanced thrust or impact leaves the ship translating or
spinning until counteracted. *(Space is frictionless; control is the player's
problem.)*

**PHYS-7** — While the simulation is running, the simulation shall advance on a
fixed timestep so that physics results are deterministic for a given input
sequence.

**PHYS-8** — If a body's velocity in one step would be large enough to pass
fully through another body (tunnelling), then the simulation shall use
continuous/swept collision detection to detect and resolve the contact.

**PHYS-9** — The simulation shall represent reaction gas, explosion gas, and
mineral debris as discrete particle bodies that participate in collision and
momentum transfer.

**PHYS-10** — Where the particle count would exceed the configured simulation
budget, the simulation shall merge, expire, or coarsen particles while
preserving aggregate momentum and energy within a configured tolerance.

---

## 2. Gravity and background objects

**GRAV-1** — The simulation shall model background objects — moons, planets,
stars, and wormholes — that exert gravitational force on all bodies.

**GRAV-2** — The simulation shall compute the gravitational force on each body
as the sum of contributions from all significant gravitating sources.

**GRAV-3** — The simulation shall treat any sufficiently massive object,
including large asteroids, as a gravitational source affecting nearby bodies.

**GRAV-4** — When a body is within a wormhole's region of influence, the
simulation shall apply the wormhole's modelled effect on the body's trajectory.

**GRAV-5** — Where two-body gravitational accuracy is insufficient for
performance, the simulation shall approximate distant sources (e.g. via a
spatial hierarchy) while keeping the dominant local sources exact.

**GRAV-6** — The simulation shall apply gravitational acceleration independent of
a body's mass, so that all bodies in the same field accelerate identically.

---

## 3. Asteroids

**AST-1** — The simulation shall model each large asteroid as an aggregation of
smaller asteroid children.

**AST-2** — The simulation shall hold neighbouring asteroid children together
with bonds, so that an intact asteroid moves and rotates as one body.

**AST-3** — While an asteroid's bonds are intact, the simulation shall move and
rotate the aggregate asteroid as a single rigid body with accurate rotation.

**AST-4** — When a collision or weapon impact imparts an impulse to an asteroid,
the simulation shall add trauma to the bonds local to the impact point.

**AST-5** — If the trauma on a bond exceeds its breaking threshold, then the
simulation shall break that bond.

**AST-6** — When enough bonds break to separate a group of children from the
aggregate, the simulation shall spawn the separated group as an independent
body with the velocity and angular velocity inherited from its parent at the
point of separation.

**AST-7** — The simulation shall give each asteroid child a mineral composition
(including fuel, oxidiser, and metal yields) that determines what is released
when it is broken up.

**AST-8** — When an asteroid child is destroyed or detached, the simulation
shall release scoopable mineral debris corresponding to its composition.

**AST-9** — The simulation shall simulate asteroid rotation and asteroid-to-
asteroid collisions accurately, including the resulting changes in spin.

**AST-10** — When two asteroids collide, the simulation shall apply collision
trauma to the bonds of both, so that large impacts can fragment them.

---

## 4. Ships and components

**SHIP-1** — The simulation shall represent a ship as a set of components laid
out in 2D without overlapping footprints, joined by connectors and structural
members.

**SHIP-2** — The simulation shall assign each component a mass; for a container
component the mass shall include the current mass of its contents.

**SHIP-3** — The simulation shall compute a ship's total mass, centre of mass,
and moment of inertia from its current components and their contents.

**SHIP-4** — When the contents of a container component change (fuel burned,
ammo built, minerals scooped), the simulation shall update the ship's mass,
centre of mass, and moment of inertia accordingly.

**SHIP-5** — The simulation shall allow connectors to overlap other connectors,
and shall assign connectors zero mass.

**SHIP-6** — A connector shall be damageable even though it has no mass.

**SHIP-7** — The simulation shall carry control signals and resource flow only
along intact connectors between components.

**SHIP-8** — Where structural members are added between components, the
simulation shall stiffen the ship so that it resists deforming or breaking apart
under acceleration.

**SHIP-9** — If a ship without sufficient structural members undergoes high
acceleration, then the simulation shall allow the inter-component bonds to take
trauma and the ship to break apart.

**SHIP-10** — Where armour components surround the ship, the simulation shall let
them absorb impact energy before underlying components are damaged.

**SHIP-11** — If an unarmoured component is struck by a significant impact, then
the simulation shall be permitted to render that component, and potentially the
ship, inoperable from a single hit.

**SHIP-12** — The simulation shall route control inputs through the control link
topology: forward maps to the engine via the control component, left maps to the
right-pointing thruster, right maps to the left-pointing thruster, and fire maps
to the cannon.

---

## 5. Component damage, function degradation, and repair

**DMG-1** — When a component experiences an impact, the simulation shall compute
collision damage for that specific component from the impulse it received.

**DMG-2** — The simulation shall connect ship components to one another with
forces/bonds that are tested by impacts, in the same manner as asteroid bonds.

**DMG-3** — If the trauma on an inter-component bond exceeds its threshold, then
the simulation shall break that bond and allow the affected components to
separate from the ship.

**DMG-4** — While a component is damaged, the simulation shall reduce that
component's function in proportion to its damage. *(A damaged engine produces
less or asymmetric thrust; a damaged scoop gathers less, etc.)*

**DMG-5** — If a component's damage reaches its failure threshold, then the
simulation shall mark the component as broken and stop it functioning.

**DMG-6** — Where an engine or thruster shape is damaged, the simulation shall
change how reaction gas reflects off it, so that thrust magnitude and direction
differ from the undamaged case.

**DMG-7** — The simulation shall require metal, fuel, and oxidiser to repair a
component.

**DMG-8** — The nano factory shall perform repairs and builds; the simulation
shall draw the required metal, fuel, and oxidiser from the connected stores when
it does so.

**DMG-9** — If the nano factory is broken, then the simulation shall make repairs
and builds impossible for the remainder of that sortie.

**DMG-10** — When a repair completes on a component, the simulation shall restore
that component's function in proportion to the repair performed.

---

## 6. Propulsion — engine and thrusters

**PROP-1** — The simulation shall power thrusters and engines by consuming fuel
and oxidiser from the connected stores.

**PROP-2** — When a thruster fires, the simulation shall deduct fuel and oxidiser
from the stores and emit small, compact fuel and oxidiser gas bodies.

**PROP-3** — When emitted fuel gas and oxidiser gas overlap, the simulation shall
react their overlapping region and produce a hot, dense gas body.

**PROP-4** — The simulation shall expand the hot dense gas body over time and let
it collide with the engine/thruster shape.

**PROP-5** — When hot gas collides with the engine/thruster shape, the simulation
shall transfer momentum to the ship and reflect the gas off the shape as
reaction gas. *(Thrust is an emergent result of modelled gas reflection, not a
fixed force vector.)*

**PROP-6** — The simulation shall produce thrust whose magnitude and direction
emerge from the modelled reaction and reflection, so that a malformed or damaged
nozzle yields different thrust.

**PROP-7** — When the engine fires off the ship's centre of mass, the simulation
shall apply the resulting torque, so that thrust can rotate as well as translate
the ship.

**PROP-8** — If a store lacks the fuel or oxidiser required to fire a thruster or
engine, then the simulation shall not produce thrust from that device.

---

## 7. Rotation and control

**ROT-1** — The simulation shall generate ship rotation from thrusters that fire
off the centre of mass, not from a direct "turn" command.

**ROT-2** — When the player commands left rotation, the simulation shall fire the
right-pointing thruster (per the control-link mapping) to produce the
corresponding torque.

**ROT-3** — When the player commands right rotation, the simulation shall fire
the left-pointing thruster (per the control-link mapping) to produce the
corresponding torque.

**ROT-4** — The simulation shall accumulate angular velocity from thruster
torques and shall not arrest a ship's spin automatically, so that the player
must counter-thrust to stop rotating.

**ROT-5** — If the side thrusters are unbalanced (one damaged, broken, or out of
propellant), then the simulation shall produce an asymmetric, harder-to-control
rotational response.

---

## 8. Weapons — cannon and projectiles

**WPN-1** — The simulation shall fire cannon shells by the same gas-reaction
mechanism used for propulsion, accelerating the shell down the barrel.

**WPN-2** — When the cannon fires, the simulation shall consume fuel and oxidiser
to accelerate the shell, and shall apply recoil momentum to the ship.

**WPN-3** — When the cannon fires off the ship's centre of mass, the simulation
shall apply the recoil torque as well as the recoil force.

**WPN-4** — The simulation shall give each fired projectile its own momentum, so
that it travels ballistically and is affected by gravity and collisions.

**WPN-5** — The simulation shall give each cannon shell a payload of highly
concentrated fuel and oxidiser kept separate until detonation.

**WPN-6** — When a cannon shell impacts a target, the simulation shall mix the
shell's fuel and oxidiser and detonate it.

**WPN-7** — If damage causes a shell's fuel and oxidiser to mix prematurely, then
the simulation shall detonate that shell where it is.

**WPN-8** — If a shell detonates inside or adjacent to the ammo store, then the
simulation shall chain-detonate the stored shells, causing catastrophic damage
to the ship.

**WPN-9** — The simulation shall draw the cannon's propellant and the shells'
payload from the fuel and oxidiser stores at build/fire time.

---

## 9. Explosions

**EXP-1** — When an explosive detonates, the simulation shall generate expanding
gas particles radiating from the detonation point.

**EXP-2** — When explosion gas particles collide with a body, the simulation
shall transfer momentum to that body.

**EXP-3** — When an explosion's impulse reaches a component or asteroid bond, the
simulation shall apply trauma to that component/bond, potentially breaking it.

**EXP-4** — The simulation shall attenuate an explosion's effect with distance as
the gas particles spread and lose density. *(No fixed blast radius; the gas does
the work.)*

---

## 10. Mining, minerals, and scooping

**MINE-1** — The simulation shall release minerals — including fuel, oxidiser, and
metal — when asteroid children are broken up.

**MINE-2** — When the scoop overlaps released minerals, the simulation shall
gather them and add them to the connected stores.

**MINE-3** — When scooped minerals are added, the simulation shall route fuel to
the fuel tank, oxidiser to the oxidiser tank, and metal to the metal store, up
to each store's capacity.

**MINE-4** — If a store is at capacity, then the simulation shall not add further
material of that type to it. *(Excess remains in the world or is lost.)*

**MINE-5** — The simulation shall make metal a mineral obtained from asteroids,
used for repairs and for building.

**MINE-6** — When the scoop is broken, the simulation shall not gather minerals.

---

## 11. The basic ship (reference design)

> The following define the *most basic operable ship*. They serve as a worked
> example and as the default/starter configuration.

**BASE-1** — The reference ship shall have one large engine at the rear,
connected to the fuel tank and the oxidiser tank, with its control link wired to
forward on the control component.

**BASE-2** — The reference ship shall have a fuel tank, an oxidiser tank, and a
metal store.

**BASE-3** — The reference ship shall have a nano factory connected to the
oxidiser tank, fuel tank, and metal store, programmed to repair and to build
cannon shells.

**BASE-4** — The reference ship shall have smaller side thrusters pointing left
and right, connected to the oxidiser and fuel tanks, to generate rotational
inertia; the left thruster's control link shall map to right on control and the
right thruster's to left on control.

**BASE-5** — The reference ship shall have a scoop connected to the tanks and the
metal store, so that scooped minerals add to the stores.

**BASE-6** — The reference ship shall have a front-mounted cannon connected to an
ammo store, the fuel tank, and the oxidiser tank, with its control link wired so
that fire control fires the cannon.

**BASE-7** — The reference ship shall have an ammo store connected to the nano
factory, which is programmed to build cannon shells into it.

**BASE-8** — The reference ship shall have a control component that distributes
forward, left, right, and fire inputs to the connected components.

---

## 12. Ship design / editor

**DES-1** — The game shall provide a ship designer in which the player places
components in 2D.

**DES-2** — If the player places a component so that its footprint overlaps
another component's footprint, then the designer shall reject or prevent the
placement.

**DES-3** — The designer shall allow connectors and control links to overlap
other connectors.

**DES-4** — The designer shall let the player wire control links between the
control component and other components (e.g. forward→engine, left→right thruster,
fire→cannon).

**DES-5** — The designer shall let the player add structural members to stiffen
the ship and armour to protect it.

**DES-6** — The designer shall let the player program the nano factory (e.g.
repair, build cannon shells).

**DES-7** — The designer shall report the design's derived properties — total
mass, centre of mass, and how thrust lines relate to the centre of mass — so the
player can anticipate handling.

**DES-8** — Where a design has unconnected or mis-wired essential components, the
designer shall warn the player before launch.

---

## 13. Game loop and economy

**LOOP-1** — The game shall follow the loop: design a ship, fly a sortie, return,
improve components, and go out again.

**LOOP-2** — When the player launches a sortie, the game shall instantiate the
designed ship with its current stores and components into the simulated world.

**LOOP-3** — During a sortie, the game shall let the player mine asteroids, fight
other ships, and gather minerals to replenish fuel, oxidiser, and metal.

**LOOP-4** — The game shall let the player make a profit from a sortie by
gathering more value than was expended. *(Profit is the player's goal each run.)*

**LOOP-5** — When a sortie ends, the game shall let the player improve and repair
components before the next sortie.

**LOOP-6** — The game shall support ship-to-ship combat in which all weapon
effects, recoil, damage, and debris are simulated by the same physics as the
rest of the world.

---

## 14. Non-functional / cross-cutting

**NFR-1** — The simulation shall be deterministic for a given seed and input
sequence, so that runs are reproducible for testing and replay.

**NFR-2** — The simulation shall maintain interactive frame rates under its
configured particle and body budgets.

**NFR-3** — Where the active body or particle count threatens the performance
budget, the simulation shall degrade gracefully (particle coarsening, level of
detail) rather than stall.

**NFR-4** — The simulation shall apply one consistent physics model to ships,
asteroids, projectiles, gases, and background objects, so that no object class
is a special case. *(Everything is simulated.)*
