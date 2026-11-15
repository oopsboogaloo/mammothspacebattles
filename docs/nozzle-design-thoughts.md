# Nozzle design: thoughts and conclusions so far

Where we are on engine nozzles, written 15 November 2026 while the engine-validation sweep runs.
The aim is to let players design ships, nozzle size and shape included, so the game needs a model
of what a nozzle does that is cheap to run, behaves like a real one, and can be shown while
designing. Nothing here is built yet: this is the thinking to build from.

## 1. What the game does today

Measured on Mammoth Thrust's ship (`docs/ship-designs.md`, "Nozzle walls" and "Nozzle shape";
`scripts/nozzle-walls.ts`, `scripts/nozzle-shape.ts`):

- **The walls switch models.** While an engine's own walls enclose its chamber, the chamber is held
  as one volume (PRP-011, `src/core/vessel.ts`). Gas leaves through the throat as a jet at
  c\*·(1 + 1/γ), a formula: the choked throat's jet momentum plus its pressure. Without walls the
  injector spills loose parcels at 10 m/s, and the parcels pushing on the head as they burn make
  most of the thrust.
- **The walls are worth 2.7 times the thrust.** Without them every engine gives about 37% of its
  thrust (forward 2,204 N against 810 N; exhaust about 206 m/s against 76).
- **Their shape hardly matters.** Converging, straight or flaring, 0.15 m or 2.2 m long, every
  sealed nozzle gives 1,603–1,619 N, within 1%.
  - About 93% is the jet's recoil from the formula, about 7% the gas's push in the step it leaves.
  - Exhaust after that adds nothing: at about 190 m/s it is out of a 1.1 m nozzle in one or two
    steps, too soon to push on the walls.
  - The shape only moves the throat. Flaring walls are narrowest at the head, so the chamber is a
    thin slab there. Straight or converging walls are narrowest at the exit, so the whole tube is
    chamber. That changes the chamber pressure, and so the weld loads, up to 12 times, but not the
    thrust.
- **Why it was built so:** performance. Simulating the gas inside chambers and nozzles was more than
  half an engine scene's parcels, and the densest (spec §10.1; Gunship 2 went from 47 to 8 ms a
  step). At game resolution the parcels also under-resolved the nozzle badly
  (`docs/perf/gpu-gas-phase0.md` §15), so the throat term was moved into the formula.

**So, in the game, the effect of the walls is mostly built into the model, not something that
emerges from the gas.** Sealing a chamber switches on the formula; a nozzle's flare or length
doesn't behave as a real nozzle would.

## 2. What a real nozzle does: textbook theory

The standard one-dimensional, isentropic model (steady, no friction or heat loss, an ideal gas of
constant γ, uniform across each cross-section). References: [NASA Glenn, rocket thrust
summary](https://www.grc.nasa.gov/www/K-12/airplane/rktthsum.html), [NASA Glenn, nozzle
design](https://www.grc.nasa.gov/www/BGH/nozzled.html); Sutton & Biblarz, *Rocket Propulsion
Elements*, is the standard textbook.

1. **The chamber** is the stagnation state: gas at rest at T₀, p₀. In the game's terms, specific
   internal energy u₀, and a² = γ(γ − 1)·u.
2. **The throat chokes:** the flow reaches Mach 1 there, which fixes the mass flow from the throat's
   area and the chamber's state. T\* = 2T₀/(γ + 1); the sound speed there is c\*.
3. **The area ratio sets the exit Mach number:** for ε = Aₑ/A\*,
   ε = (1/M)·[(2/(γ + 1))·(1 + (γ − 1)/2·M²)]^((γ + 1)/(2(γ − 1))), solved numerically for the
   supersonic M.
4. **The exit state:** Tₑ = T₀/(1 + (γ − 1)/2·Mₑ²), vₑ = Mₑ·aₑ.
5. **Thrust:** F = ṁ·vₑ + (pₑ − p_ambient)·Aₑ.

With the throat alone (ε = 1), F = ṁ·c\*·(1 + 1/γ): exactly the game's chamber formula. **The game's
model is the textbook answer for an engine with no nozzle.**

### How much a nozzle is worth

The throat fixes the mass flow, so extra thrust is extra efficiency (specific impulse) too.
Thrust ÷ throat-only, ideal, in vacuum:

| Area ratio | Typical combustion gas (γ 1.2) | The game's exhaust (γ 1.33) |
|---|---|---|
| 2 | 1.18 | 1.16 |
| 2.8 (RS-08's) | 1.24 | 1.21 |
| 5 | 1.32 | 1.27 |
| 10 | 1.40 | 1.33 |
| 40 | 1.52 | 1.40 |
| 280 (upper-stage size) | 1.62 | 1.46 |

- **It matches real engines.** A NASA test measured vacuum thrust coefficients of 1.70, 1.82 and
  1.96 at area ratios 8, 25 and 200, close to frozen-flow theory; the formula gives 1.74 at 10,
  1.88 at 40 and 2.01 at 280 (γ 1.2), against 1.24 for a throat alone. The F-1 is 1.59 at sea level
  and 1.82 in vacuum, the RS-25 1.53 and 1.91; engines range from about 1.3 to 2.
  ([Thrust coefficient](https://cavac.at/cavacopedia/Thrust%20Coefficient),
  [NTRS 19980223581](https://ntrs.nasa.gov/citations/19980223581),
  [Rocket engine nozzle](https://en.wikipedia.org/wiki/Rocket_engine_nozzle).)
- **Real engines use area ratios of 15–80 at sea level and up to several hundred in vacuum.**

### Contour, divergence and ambient pressure

- **The exact contour is worth only 1–2%.** Exhaust leaving at an angle carries momentum sideways.
  For a cone the momentum term is multiplied by (1 + cos α)/2, 0.983 at 15°; the pressure term is
  not ([Niemeyer, nozzle design](https://kyleniemeyer.github.io/rocket-propulsion/fundamentals/nozzle-design);
  [NTRS 19910019867](https://ntrs.nasa.gov/api/citations/19910019867/downloads/19910019867.pdf)).
  Bell nozzles exist mainly to cut that loss and save length and mass.
- **For the game's planar nozzles the factor is sin α ÷ α.** This is derived, not looked up: the
  mean of cos θ over a flat fan of half-angle α. No published source was found for the planar
  case; check it against a textbook before relying on it. 0.97 at 15°, 0.83 at 60°.
- **Ambient pressure changes what is best.** At sea level (chamber 70 bar, γ 1.2) thrust peaks
  near ratio 10 (+30%), and a vacuum nozzle of ratio 80 calculates to −35%. In reality the flow
  separates from the wall instead, so the loss is smaller, but it is rough on the engine. This is
  why first stages and upper stages have different nozzles. **The game has no ambient air**
  (nothing in `src/core` models it), so the p_ambient term is zero today.
- **What 1D theory leaves out:** friction, heat loss, boundary layers, shocks and separation, very
  short or abrupt nozzles, and γ changing as the gas cools. Real nozzles reach about 95–99% of the
  ideal.
- **2D against 3D.** The area-ratio relation holds in the game's plane with widths for areas. In 3D
  the area grows with the radius squared, so a modest bell reaches a large ratio; in 2D ratio 10
  needs an exit ten times the throat's width. Big gains need visibly wide nozzles.

## 3. The engine-validation experiment

`scripts/engine-validation.ts` and the sandbox's ENG-V (`scenarios/eng-validation.json`):

- Engines with a chamber, a throat and a nozzle (RS-08's, reshaped and scaled ×0.5 to ×4), each
  welded to a 100 kg base in empty space, run two ways:
  - **model:** the interior declared, the chamber held as one volume;
  - **gas:** no interior declared, so the chamber, throat and nozzle are all parcels, at 500 to
    8,000 parcels a second.
- Both are compared with the theory above, taking u₀ and γ from the model's own jet, so theory and
  model start from the same gas.
- ENG-V shows three of the engines in the sandbox, each as the model and as gas side by side.

**First results** (the quick trial: three engines, two parcel rates, not converged):

| Engine | Ideal, nozzle (with divergence loss) | Model | Gas, 500/s | Gas, 1,000/s |
|---|---|---|---|---|
| Throat only | 97 N | 104 N | 54 N | 71 N |
| RS-08's nozzle (ratio 2.8) | 114 N | 107 N | 57 N | 73 N |
| Long nozzle (ratio 5) | 119 N | 108 N | 56 N | 72 N |

- **The model hardly responds to the nozzle** (104 → 108 N), where theory says a good one adds about
  20%.
- **The gas at game resolution gives about two thirds of the model's thrust** and doesn't respond to
  the nozzle either. It rose from 54 to 71 N on doubling the parcels, so it hasn't settled.
- **The gas's chamber runs at 3–4 times the model's pressure** (about 600–900 N/m against 214) for
  less thrust: the gas struggles through a throat only a few parcels wide.

**The full sweep** (ten engines, up to 8,000 parcels a second) is to show where the gas settles:
near the model, near the theory, or elsewhere. Its results go in `docs/perf/engine-validation.json`
and `docs/perf/engine-validation.md` when it finishes.

**A caveat:** at game resolution the gas is too coarse to be the truth. Real-world measurements
anchor the theory; the gas checks the game's own behaviour (2D, heavy gas) and the edge cases
theory handles worst.

## 4. The proposed model

A theory-based nozzle model with a few measured corrections, not a fitted table: it extrapolates to
designs nobody has tested, needs no tables, and behaves as an engineer would expect.

**Inputs, from the ship's own geometry** (the chamber scan in `vessel.ts` already finds the chamber
and throat; it would carry on to where the walls end):

- the throat's width A\* and the exit's Aₑ;
- each wall's angle at the exit (α left and right) and the nozzle's length;
- from the chamber model: ṁ, u₀ and γ.

**The calculation, in vacuum:**

1. ε = Aₑ/A\*, the exit Mach number Mₑ, then Tₑ, vₑ and pₑ (§2).
2. F = λ·ṁ·vₑ + pₑ·Aₑ, with λ = sin α ÷ α.
3. For asymmetric or damaged nozzles, the 1D pressure along each wall separately. Their sum gives
   the thrust's direction, so a bent or broken wall makes a side force by itself (PRP-008).

**How it would drive the simulation** (the extension `docs/perf/gpu-gas-phase0.md` §15 floated):

- Release the exhaust at the nozzle's exit at vₑ with the exit's temperature, not at the throat.
  Momentum and energy stay exact, as the ledger requires. The plume gets faster and cooler as the
  nozzle grows, which shows in play.
- Push the pressure along each wall onto that wall, so nozzle welds carry real loads and can fail.
- A check: in quasi-1D flow the walls' push equals ṁ·(vₑ − c\*) + pₑ·Aₑ − p\*·A\*.
- Cost stays as today: no parcels inside the nozzle.

## 5. What it would mean for designing ships

All of this can be worked out while designing, before flying:

| Choice | What it buys | What it costs |
|---|---|---|
| Throat width | Sets the chamber pressure: a small throat at a given flow means high pressure. | High pressure needs stronger chamber walls and welds. |
| Area ratio | More thrust per kg of propellant, with diminishing returns: +21% at 2.8, +27% at 5, +33% at 10 (the game's exhaust). | A wider exit: in 2D, ratio 10 is an exit ten times the throat's width. |
| Wall angle | A long, gentle nozzle loses little to divergence. | Length and mass. A short, wide one saves both but loses thrust (λ 0.97 at 15°, 0.83 at 60°). |
| Symmetry and damage | — | An asymmetric nozzle pushes sideways; losing a wall costs thrust and makes the ship veer. |

A designer readout could show thrust, exhaust speed (Isp), exit Mach number, chamber pressure and
wall loads.

## 6. Where measurement comes in

1. **Validation:** whether the gas follows the theory's trend across sizes and shapes (the sweep).
2. **Calibration of the edge cases** where 1D theory is weakest: very short or abrupt nozzles,
   straight extensions, asymmetric or damaged walls. ENG-V-style scenarios can measure correction
   factors for these.
3. **Real-world anchors:** published thrust coefficients (§2) set the targets.

## 7. Suggested order of work, when we come to it

1. A pure `nozzleFlow(geometry, chamber)` function in `src/core`, tested against textbook values.
   It is also all a ship designer needs.
2. Extend the chamber model to release exhaust at the nozzle's exit and load the walls, checked
   with ENG-V and the sweep.
3. Rebalance: every engine with a flared nozzle gets stronger (about +20% for RS-08-like
   nozzles). Lander, the gunships and Thrust's ship would need retuning, or their nozzles
   reshaping.
4. Later: the designer readout.

## 8. Open questions

- Should nozzles bend or deform under load, so a damaged nozzle changes shape rather than only
  losing a wall?
- Is the rebalance in step 3 acceptable, or should existing ships keep their handling by reshaping
  their nozzles?
- Should the game ever have ambient air (planets with atmospheres)? Then sea-level against vacuum
  nozzles becomes a real design choice, and over-expansion and separation need modelling.
- Is sin α ÷ α right for planar nozzles? To check against a textbook.
