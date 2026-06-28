# Mammoth Space Battles — EARS Requirements Specification

> A 2D, physics-first take on *Asteroids*: every object, force, and component is
> simulated. The game is about **designing** a ship, **flying** it under full
> rotational inertia, fighting, mining, and turning a profit before going out
> again. Mastery of inertia *is* the game.

## Design Pillars

1. **2D, pilot-skill-first.** The hand on the stick is the main character.
   Mastery of momentum and rotational inertia *is* the game.
2. **Asteroids alone must be fun.** If flying out, mining, and getting home in
   one piece isn't satisfying with *zero* enemies, we've already failed.
   Everything else builds on that foundation.
3. **Hard is fine.** Returning intact is an achievement. We design for
   hard-but-*fair*, never hard-but-random.
4. **Retro neon vector aesthetic.** Glowing line-art silhouettes, vector motion
   trails, dark space — the *Asteroids* / Vectrex / *Thrust* look, modernised
   with bloom.

### Lineage

- **Primary inspirations:** *Asteroids*, *Lunar Lander*, *Thrust*, *XPilot* —
  firmly 2D, vector-styled, skill-driven flight.
- **Secondary / where we diverge:** the modular-ship and damage-propagation
  ideas echo *Cosmoteer*; the rotational inertia and flight assist echo *Kerbal
  Space Program* and *Children of a Dead Earth*; modular construction-as-gameplay
  echoes *Reassembly*. We borrow ideas from these but are **not** a hard-sim or a
  base-builder — we are a fast, vector-styled, skill-first 2D game.

---

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

Each requirement has a stable identifier (e.g. `PHYS-3`) so it can be referenced
from design, tests, and traceability matrices. Items marked **(Phase 2)** are
agreed in principle but scheduled after the core game. Deferred and undecided
items live in the appendices.

### Glossary

- **Body** — any simulated object with mass, position, velocity, orientation,
  and angular velocity (ships, components, asteroid children, particles,
  projectiles, background objects).
- **Component** — a functional part of a ship (engine, tank, thruster, cannon,
  scoop, nano factory, store, cargo hold, flight computer, etc.). Each is a body.
- **Connector / Control link** — a logical link carrying control signals or
  resource flow. Connectors have no mass but can be damaged.
- **Structural member** — a mass-bearing rigid link added by the player to make a
  ship behave as a stiffer rigid body.
- **Bond** — a breakable constraint holding two neighbouring asteroid children
  (or two ship components) together. Bonds fail under accumulated trauma.
- **Trauma** — accumulated impulse/stress on a body or bond; exceeding a
  threshold breaks the bond or degrades the component.
- **Thrust transfer function** — a component's model that converts consumed
  propellant into a thrust force and direction (and recoil). A black box now;
  see Appendix A.
- **Stores** — consumable reservoirs: fuel, oxidiser, metal, and ammo.
- **Cargo** — non-consumable valuables (gems) carried for profit in the cargo
  hold.

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

**PHYS-5** — When a collision impulse is applied off a body's centre of mass, the
simulation shall apply the resulting torque so that the body's angular velocity
changes accordingly.

**PHYS-6** — The simulation shall apply no global linear or angular damping to
ships, so that an unbalanced thrust or impact leaves the ship translating or
spinning until counteracted. *(Space is frictionless; control is the player's
problem.)*

**PHYS-7** — While the simulation is running, the simulation shall advance on a
fixed timestep so that physics results are deterministic for a given input
sequence.

**PHYS-8** — If a body's velocity in one step would be large enough to pass fully
through another body (tunnelling), then the simulation shall use
continuous/swept collision detection to detect and resolve the contact.

**PHYS-9** — The simulation shall represent explosion gas and mineral debris as
discrete particle bodies that participate in collision and momentum transfer.

**PHYS-10** — Where the particle count would exceed the configured simulation
budget, the simulation shall merge, expire, or coarsen particles while preserving
aggregate momentum within a configured tolerance.

---

## 2. Gravity and background objects

**GRAV-1** — The simulation shall model background objects — moons, planets,
stars, and wormholes — that exert gravitational force on all bodies.

**GRAV-2** — The simulation shall compute the gravitational force on each body as
the sum of contributions from all significant gravitating sources.

**GRAV-3** — The simulation shall treat any sufficiently massive object, including
large asteroids, as a gravitational source affecting nearby bodies.

**GRAV-4** — When a body is within a wormhole's region of influence, the
simulation shall apply the wormhole's modelled effect on the body's trajectory.

**GRAV-5** — Where two-body gravitational accuracy is insufficient for
performance, the simulation shall approximate distant sources (e.g. via a spatial
hierarchy) while keeping the dominant local sources exact.

**GRAV-6** — The simulation shall apply gravitational acceleration independent of
a body's mass, so that all bodies in the same field accelerate identically.

---

## 3. Asteroids

**AST-1** — The simulation shall model each large asteroid as an aggregation of
smaller asteroid children.

**AST-2** — The simulation shall hold neighbouring asteroid children together with
bonds, so that an intact asteroid moves and rotates as one body.

**AST-3** — While an asteroid's bonds are intact, the simulation shall move and
rotate the aggregate asteroid as a single rigid body with accurate rotation.

**AST-4** — When a collision or weapon impact imparts an impulse to an asteroid,
the simulation shall add trauma to the bonds local to the impact point.

**AST-5** — If the trauma on a bond exceeds its breaking threshold, then the
simulation shall break that bond.

**AST-6** — When enough bonds break to separate a group of children from the
aggregate, the simulation shall spawn the separated group as an independent body
with the velocity and angular velocity inherited from its parent at the point of
separation.

**AST-7** — The simulation shall give each asteroid child a mineral composition
(fuel, oxidiser, metal, and gem yields) that determines what is released when it
is broken up.

**AST-8** — When an asteroid child is destroyed or detached, the simulation shall
release scoopable mineral and gem debris corresponding to its composition.

**AST-9** — The simulation shall simulate asteroid rotation and asteroid-to-
asteroid collisions accurately, including the resulting changes in spin.

**AST-10** — When two asteroids collide, the simulation shall apply collision
trauma to the bonds of both, so that large impacts can fragment them.

---

## 4. Ships and components

**SHIP-1** — The simulation shall represent a ship as a set of components laid out
in 2D without overlapping footprints, joined by connectors and structural
members.

**SHIP-2** — The simulation shall assign each component a mass; for a container
component the mass shall include the current mass of its contents.

**SHIP-3** — The simulation shall compute a ship's total mass, centre of mass, and
moment of inertia from its current components and their contents.

**SHIP-4** — When the contents of a container component change (fuel burned, ammo
built, minerals scooped, cargo loaded), the simulation shall update the ship's
mass, centre of mass, and moment of inertia accordingly.

**SHIP-5** — The simulation shall allow connectors to overlap other connectors,
and shall assign connectors zero mass.

**SHIP-6** — A connector shall be damageable even though it has no mass.

**SHIP-7** — The simulation shall carry control signals and resource flow only
along intact connectors between components.

**SHIP-8** — Where structural members are added between components, the simulation
shall stiffen the ship so that it resists deforming or breaking apart under
acceleration.

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

**DMG-6** — While an engine or thruster is damaged, the simulation shall degrade
and/or skew its thrust transfer function (reduced magnitude, offset direction),
so that a damaged nozzle thrusts weaker and asymmetrically.

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

> The live game models thrust through a component-level **thrust transfer
> function** (a black box). Deriving that function from a first-principles
> fuel/oxidiser gas simulation is deferred — see **Appendix A.1**. The engine and
> cannon expose a stable interface so the gas sim can be swapped in later without
> changing the rest of the simulation.

**PROP-1** — The simulation shall power engines and thrusters by consuming fuel
and oxidiser from the connected stores.

**PROP-2** — When an engine or thruster fires, the component shall convert the
consumed fuel and oxidiser into a thrust force and direction via its thrust
transfer function, and the simulation shall apply equal-and-opposite recoil to
the ship.

**PROP-3** — When an engine fires off the ship's centre of mass, the simulation
shall apply the resulting torque, so that thrust can rotate as well as translate
the ship.

**PROP-4** — The simulation shall determine a device's thrust magnitude and
efficiency from its component rating, so that higher-spec engines produce more
thrust per unit of propellant.

**PROP-5** — The engine and cannon components shall expose a stable propulsion
interface, so that the internal thrust/acceleration model can be replaced (black-
box transfer function now; first-principles gas simulation later) without
affecting the rest of the simulation.

**PROP-6** — If a store lacks the fuel or oxidiser required to fire a device, then
the simulation shall not produce thrust from that device.

---

## 7. Rotation and control

**ROT-1** — The simulation shall generate ship rotation from thrusters that fire
off the centre of mass, not from a direct "turn" command.

**ROT-2** — When the player commands left rotation, the simulation shall fire the
right-pointing thruster (per the control-link mapping) to produce the
corresponding torque.

**ROT-3** — When the player commands right rotation, the simulation shall fire the
left-pointing thruster (per the control-link mapping) to produce the
corresponding torque.

**ROT-4** — The simulation shall accumulate angular velocity from thruster torques
and shall not arrest a ship's spin automatically, so that the player must
counter-thrust (or use flight assist) to stop rotating.

**ROT-5** — If the side thrusters are unbalanced (one damaged, broken, or out of
propellant), then the simulation shall produce an asymmetric, harder-to-control
rotational response.

---

## 8. Flight computer and assist

**ASSIST-1** — The ship shall support a **flight computer** component that fires
the ship's *real* thrusters to aid control — for example nulling rotation or
holding heading — so the physics stays honest and the computer simply pilots
well.

**ASSIST-2** — While the flight computer is damaged or destroyed, the simulation
shall weaken or fail its assistance accordingly.

**ASSIST-3 (Phase 2)** — The flight computer is the first instance of a broader
**programmable computer/electronics** capability; for now its assist logic is a
black box, and is expected to become player-programmable later (see Appendix
A.2).

---

## 9. Weapons — cannon and projectiles

**WPN-1** — The cannon shall accelerate a shell down its barrel by consuming fuel
and oxidiser via its barrel acceleration model (black box now; first-principles
gas simulation deferred — Appendix A.1).

**WPN-2** — When the cannon fires, the simulation shall apply recoil momentum to
the ship.

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
simulation shall chain-detonate the stored shells, causing catastrophic damage to
the ship.

**WPN-9** — The simulation shall draw the cannon's propellant and the shells'
payload from the fuel and oxidiser stores at build/fire time.

---

## 10. Explosions

**EXP-1** — When an explosive detonates, the simulation shall generate expanding
gas particles radiating from the detonation point.

**EXP-2** — When explosion gas particles collide with a body, the simulation shall
transfer momentum to that body.

**EXP-3** — When an explosion's impulse reaches a component or asteroid bond, the
simulation shall apply trauma to that component/bond, potentially breaking it.

**EXP-4** — The simulation shall attenuate an explosion's effect with distance as
the gas particles spread and lose density. *(No fixed blast radius; the gas does
the work.)*

---

## 11. Mining, minerals, and scooping

**MINE-1** — The simulation shall release minerals — fuel, oxidiser, and metal
(consumables) — when asteroid children are broken up.

**MINE-2** — When the scoop overlaps released minerals, the simulation shall
gather them and add them to the connected stores.

**MINE-3** — When scooped minerals are added, the simulation shall route fuel to
the fuel tank, oxidiser to the oxidiser tank, and metal to the metal store, up to
each store's capacity.

**MINE-4** — If a store is at capacity, then the simulation shall not add further
material of that type to it. *(Excess remains in the world or is lost.)*

**MINE-5** — The simulation shall make metal a mineral obtained from asteroids,
used for repairs and for building.

**MINE-6** — When the scoop is broken, the simulation shall not gather minerals.

**GEM-1** — Asteroids shall contain **gems** — a high-value mineral gathered for
profit, not consumed by ship systems.

---

## 12. Cargo and tractor beam

**CARGO-1** — The ship shall support a **cargo hold** component with finite
capacity; its mass shall include its current contents, so a full hold visibly
worsens handling.

**CARGO-2** — When the scoop gathers gems, the simulation shall deposit them into
the cargo hold (gems → hold, distinct from fuel/oxidiser/metal → stores).

**CARGO-3** — If the cargo hold is full, then the scoop shall not gather further
gems.

**TRACTOR-1** — The ship shall support a **rear-mounted tractor beam** component
that applies a pulling force to a targeted large object, allowing it to be
**towed** (*Thrust*-style).

**TRACTOR-2** — While towing, the simulation shall couple the towed object's mass
and motion to the ship through the beam, so the combined centre of mass and
inertia change and piloting becomes markedly harder. *(Signature skill mechanic:
hauling a massive rock fights your thrusters and threatens to swing you into
other rocks.)*

---

## 13. The basic ship (reference design)

> The following define the *most basic operable ship* — a worked example and the
> minimal launchable configuration. Richer, role-specific designs are covered by
> the starter templates (Section 14).

**BASE-1** — The reference ship shall have one large engine at the rear, connected
to the fuel tank and the oxidiser tank, with its control link wired to forward on
the control component.

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

## 14. Starter templates

**TMPL-1** — The game shall ship a set of **starter ship templates**, each a
complete, launch-ready design.

**TMPL-2** — Each starter template shall be **validated to fly**: it can
translate, rotate, and arrest its own spin under flight assist without tearing
itself apart.

**TMPL-3** — The starter set shall cover **varied roles** so designs feel distinct
— for example a nimble *Prospector* (scoop-heavy, light), a sturdy *Hauler*
(large stores and cargo hold, slow), and an agile *Skirmisher* (cannon and
armour).

---

## 15. Ship design / editor

**DES-1** — The game shall provide a ship designer in which the player places
components in 2D.

**DES-2** — If the player places a component so that its footprint overlaps
another component's footprint, then the designer shall reject or prevent the
placement.

**DES-3** — The designer shall allow connectors and control links to overlap other
connectors.

**DES-4** — The designer shall let the player wire control links between the
control component and other components (e.g. forward→engine, left→right thruster,
fire→cannon).

**DES-5** — The designer shall let the player add structural members to stiffen
the ship and armour to protect it.

**DES-6** — The designer shall let the player program the nano factory (e.g.
repair, build cannon shells).

**DES-7 (Phase 2)** — The designer shall report the design's derived properties —
total mass, centre of mass, and how thrust lines relate to the centre of mass —
so the player can anticipate handling.

**DES-8 (Phase 2)** — Where a design has unconnected or mis-wired essential
components, the designer shall warn the player before launch.

---

## 16. Game loop, economy, and stakes

**LOOP-1** — The game shall follow the loop: design a ship, fly a sortie, return,
improve components, and go out again.

**LOOP-2** — When the player launches a sortie, the game shall instantiate the
designed ship with its current stores and components into the simulated world.

**LOOP-3** — During a sortie, the game shall let the player mine asteroids, fight
other ships, gather minerals to replenish fuel/oxidiser/metal, and gather gems
for profit.

**LOOP-4** — The game shall let the player make a profit from a sortie by
returning with more value (chiefly gems) than was expended.

**LOOP-5** — When a sortie ends, the game shall let the player repair and improve
components before the next sortie.

**TENET-1** — An asteroids-only session, with no enemies, shall be a complete and
enjoyable game in itself. *(Design Pillar 2, made testable.)*

**COMBAT-AI-1** — The game shall provide **AI-controlled rival ships** as the
initial opponents.

**COMBAT-1** — The game shall support ship-to-ship combat in which all weapon
effects, recoil, damage, and debris are simulated by the same physics as the rest
of the world.

**ECON-1** — The player shall spend profit on **improved components** (e.g.
higher-spec engines and cannons) and on **blueprints**.

**ECON-2** — A **blueprint** shall unlock a component or recipe that the nano
factory can then build/install.

**STAKE-1** — The core tension shall be **survival and return**: dwindling fuel,
aggressive threats, and the risk of a crippling hit shall make simply getting out
and back a meaningful achievement.

### Loss and insurance

> *Elite Dangerous*-style rebuy: a lost ship stings but is rarely game-ending,
> and the player can never be permanently stranded.

**LOSS-1** — When a player's ship is destroyed or lost, the game shall offer a
**rebuy** that restores the ship to its launch specification (hull and fitted
components) for **10% of the ship's launch value**, with insurance covering the
remaining 90%.

**LOSS-2** — The game shall define **launch value** as the value of the ship's
hull and fitted components at the moment it launched, excluding cargo.

**LOSS-3** — When a ship is lost, the game shall forfeit the cargo (gems) it was
carrying. *(The carried profit is what's at risk — the heart of the
survival-and-return tension.)*

**LOSS-4** — When the player accepts a rebuy, the game shall deduct the 10% rebuy
cost from the player's funds.

**LOSS-5** — If the player cannot afford the rebuy cost, then the game shall allow
the player to sell assets (components, blueprints, holdings) to raise the funds.

**LOSS-6** — If the player's net worth is below a configured threshold, then the
game shall provide a **free minimum-spec ship**, so a player can never be
permanently stranded without a ship.

---

## 17. Game world and viewport

> The sector is a closed, wrap-around arena larger than the screen. You cannot
> fly out of it — the only way in or out is the hyperspace point.

### World

**WORLD-1** — The game world (a **sector**) shall be larger than the player's
screen.

**WORLD-2** — The world shall **wrap around** on both axes (toroidal topology): a
body leaving one edge shall re-enter at the opposite edge with continuous
position and velocity, so it is not possible to leave the sector by flying away.

**WORLD-3** — The simulation shall compute physics interactions across the wrap
boundary — collisions, gravity, beams, and projectiles — using the **nearest
toroidal image** of each body, so behaviour is seamless across the seam.

**WORLD-4** — The sector shall contain an **indestructible hyperspace point** used
to enter and leave the sector.

**WORLD-5** — The hyperspace point shall not take damage and shall not be
destroyed by collisions or weapons.

**WORLD-6** — When the player launches a sortie, the game shall bring the ship
into the sector at the hyperspace point.

**WORLD-7** — When the player's ship uses the hyperspace point, the game shall let
the player leave the sector (ending the sortie / transiting to another sector or
to base).

### Viewport

**VIEW-1** — The game shall present a **scrolling viewport** that follows the
player's ship, showing a portion of the larger world.

**VIEW-2** — While the ship moves through the world, the viewport shall scroll to
keep the ship in view.

**VIEW-3** — The viewport shall render the wrap-around **seamlessly**, so objects
near the opposite edge appear correctly when in view across the boundary, with no
visible hard edge.

**VIEW-4** — The viewport shall be a **per-player camera**, so split-screen can
give each player an independent view (ties to Appendix A.3).

**VIEW-5 (Phase 2)** — Where situational awareness is needed off-screen, the game
shall indicate significant off-screen objects (e.g. threats, the hyperspace
point) at the screen edge.

---

## 18. Presentation and aesthetic

**ART-1** — The game shall render in a **retro neon vector style**: glowing
line-art silhouettes, vector motion trails, and a dark backdrop.

**ART-2** — The game shall present and simulate firmly in **2D**.

---

## 19. Non-functional / cross-cutting

**NFR-1** — The simulation shall be deterministic for a given seed and input
sequence, so that runs are reproducible for testing and replay. *(Note: this
becomes critical if multiplayer is pursued — see Appendix A.3.)*

**NFR-2** — The simulation shall maintain interactive frame rates under its
configured particle and body budgets.

**NFR-3** — Where the active body or particle count threatens the performance
budget, the simulation shall degrade gracefully (particle coarsening, level of
detail) rather than stall.

**NFR-4** — The simulation shall apply one consistent physics model to ships,
asteroids, projectiles, gases, and background objects, so that no object class is
a special case. *(Everything is simulated.)*

---

## Appendix A — Deferred & Experimental

> Agreed ambitions that are intentionally **not for now**. Each is designed to
> slot in behind an existing interface so the core game does not have to be
> rebuilt to adopt it.

**A.1 — Gas-particle combustion (engine & cannon), experimental.** An engine or
cannon *may later* derive its thrust/acceleration transfer function from a
first-principles simulation: emit compact fuel + oxidiser gas, react overlapping
regions into hot dense gas, expand it, collide it with (and reflect it off) the
nozzle/barrel to transfer momentum, and eject the remainder as reaction gas. A
damaged nozzle would then change thrust emergently. This is deferred for
performance, determinism, and controllability reasons; the engine/cannon
interface (PROP-5) is built so it can be swapped in behind the black box. *Open
question: ensure reflected reaction gas actually escapes the ship carrying
momentum away, and that combustion energy comes from modelled chemical potential
energy.*

**A.2 — Programmable electronics.** The flight computer (Section 8) is the first
black-box instance of a future capability in which the player can **program**
ship logic (assist behaviours, weapon control, automation). Needs design.

**A.3 — Multiplayer.** A desired future pillar in two forms: **local
split-screen** (multiple players on one device) and **networked** play.
**Single-player must work well first** — multiplayer follows once the core game
is good.

Sequencing and rationale:

- **Split-screen is the cheaper, earlier step.** It runs one shared
  deterministic simulation on one machine, so it sidesteps netcode, rollback,
  and clock-sync entirely. It is the natural first multiplayer milestone and it
  de-risks the networked version by forcing the engine to handle multiple
  players cleanly.
- **Networked play** is the harder step and interacts directly with the
  determinism requirement (NFR-1) and a future netcode/rollback model.
- **Build single-player multiplayer-ready, cheaply.** Even with one player,
  route input through a **per-player input source** and render through a
  **per-player camera/viewport** abstraction. This small discipline now avoids a
  large refactor when split-screen arrives, without doing any multiplayer work
  yet.

---

## Appendix B — Decisions & Open Questions

**Q1 — Loss model. RESOLVED.** *Elite Dangerous*-style rebuy: on loss, insurance
covers 90% of the ship's launch value and the player pays a 10% rebuy; carried
cargo is forfeit; a free minimum-spec ship is provided below a net-worth
threshold. See **LOSS-1…6** (Section 16). Not permadeath; ships are recoverable.

*(No open questions outstanding.)*
