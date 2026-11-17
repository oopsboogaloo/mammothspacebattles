# Proposal: design rules for each component type

Approved by Chloe with the decisions in §8, 16 November 2026. Being built in the order of §7.

**The aim:** a part's size and settings decide what it does, with Thrust 1 as the benchmark. At
Thrust's own sizes every rule gives back Thrust's own figures, so a regular THRUST 1 built under
these rules flies as it does today, within a few per cent.

**What changes:**

- Only the regular parts follow these rules.
- THRUST OG and its OG parts, and the games themselves (Thrust, Asteroids, Lander), are unchanged.
- Engines get a new physics option for the rockets; nothing uses it unless it declares it.

**Sources:**

- Engine physics: `docs/nozzle-design-thoughts.md`, the "simplified engine" (§5) and its order of work (§7).
- Thrust's part sizes: `scripts/asteroidShip.ts`, `scenarios/thrust-1.json`.
- Shield fuel use: `src/core/shield.ts`.
- Existing turret battery and generator: `src/core/turret.ts`, WPN-010 and WPN-013.
- Propellant energy: H₂'s declared heat, 3.4 × 10⁷ J/kg in `src/core/gas.ts`, which is 3.78 MJ per kg of the 1 : 8 mixture.

---

## 1. Rules shared by every container (tanks, magazines)

**Wall thickness t is a setting** (decided 16 November 2026, Chloe).

- It is **0.1 m by default** (Thrust's), and can be set from **0.02 m to 0.3 m**. It can be no more
  than a quarter of the container's smaller side, so there is always room inside.
- What a container holds goes with its **inner** area: the outline moved in by t on every side.
- Its dry mass goes with its **wall** area: the outer area less the inner.

**t decides three things, all in proportion to it:**

| | Rule | At Thrust's 0.1 m |
|---|---|---|
| **Weight** | dry mass = wall area × the material's density | Thrust's masses |
| **Weld strength** | each weld's limits are k × the **thinner** wall of the two parts it joins: k_T 229,500 N/m, k_C 459,000, k_S 160,500, k_M 55,200 N·m/m (the engine document's k, §5) | today's Standard welds: tension 22,950 N, compression 45,900, shear 16,050, torque 5,520 N·m |
| **Damage capacity** | the material's threshold and toughness (DMG-002) × t ÷ 0.1 m | Thrust's materials: tank 60 J and 500 J; magazine 150 J and 3,000 J |

**Thicker walls:**

- are stronger, both the welds and the container against hits;
- hold less, because there is less room inside;
- weigh more.

**Big containers are efficient** (little wall for what they hold) but are one big target with one
big explosion. Small ones are mostly wall.

**One rule for every part's welds:**

- Parts that don't have a thickness setting yet count as 0.1 m. These are the cockpit, generators,
  battery and utilities.
- So at the defaults every weld is Standard, as today.
- The weld presets (Light, Standard, Heavy) stay, as the weld's own quality: ×0.5, ×1 and ×2 on top
  of the thickness rule.
- Engines' walls follow the same rule (§5).

**Shapes:** boxes, trapezoids and triangles alike. The inner outline is the outer one offset inward
by t.

## 2. Fuel tanks

| Rule | Value | Calibrated from Thrust's tank (1.5 × 1.0 m, 2 kg dry, 4.05 kg propellant) |
|---|---|---|
| Propellant held | **3.89 kg per m² of inner area**, H₂ : O₂ 1 : 8 by mass | inner 1.3 × 0.8 = 1.04 m² → 4.05 kg |
| Dry mass | **4.35 kg per m² of wall** (tank material) | wall 0.46 m² → 2.0 kg |
| Damage | tank material, 60 J and 500 J at 0.1 m, in proportion to t | Thrust's |
| Explosion when destroyed | charge **0.0123 kg per kg of propellant it can hold** | 0.05 kg charge at 4.05 kg |
| Size limits | **0.3 m to 3.0 m** each way (bounding box); trapezoid and triangle sides at least 0.15 m | |

**Examples, 0.1 m walls unless given:**

| Tank | Holds | Dry |
|---|---|---|
| Thrust's, 1.5 × 1.0 m | 4.05 kg | 2.0 kg |
| the same with 0.05 m walls | 4.91 kg | 1.04 kg, half the weld strength, half the damage capacity |
| the same with 0.2 m walls | 2.57 kg | 3.65 kg, twice as strong |
| the Mastodon's centre tank, 1.2 × 0.65 m | 1.75 kg (2.11 kg today) | 1.43 kg |
| 3 × 1 m | 8.72 kg | 3.3 kg |
| 0.3 × 0.3 m, the smallest | 0.04 kg | 0.35 kg |

**Fuel efficiency (`economy`, 66 on every Thrust engine)** is a flight-test cheat: it makes 65 parts
in 66 of the exhaust from nothing. I propose making it a fixed game constant (66) for regular engines,
not a design setting, so the tank rules above stay honest.

## 3. Magazines

| Rule | Value | Calibrated from THRUST 1's magazine (0.7 × 0.45 m, 3 kg dry, 60 shells) |
|---|---|---|
| Shells held | **480 per m² of inner area** (60 ÷ 0.125), rounded down after a 10⁻⁶ tolerance | inner 0.5 × 0.25 = 0.125 m² → 60 |
| Dry mass | **15.8 kg per m² of wall** (hull material, armoured) | wall 0.19 m² → 3.0 kg |
| Damage | hull material, 150 J and 3,000 J at 0.1 m, in proportion to t | Thrust's |
| Explosion when destroyed | charge **1/60 kg per shell it can hold** (none once empty, as now) | 1 kg at 60 shells |
| Size limits | **0.3 m to 2.0 m** each way | |

**Examples, 0.1 m walls unless given:**

| Magazine | Shells | Dry |
|---|---|---|
| THRUST 1's, 0.7 × 0.45 m | 60 | 3.0 kg |
| the same with 0.05 m walls | 100 | 1.66 kg, but half as strong |
| the Mastodon's, 0.4 × 1.4 m | 115 (100 today) | 5.05 kg |
| 2 × 2 m | 1,555 | 12 kg |
| 0.3 × 0.3 m, the smallest | 4 | 1.26 kg |

**The shell itself** stays the railgun's: 0.167 kg. Its mass belongs to the magazine, as now.

**Bullet magazines and guns** (Chloe, 16 November 2026: added for ships without power):

- A bullet magazine holds 240 bullets per m², half a magazine's: a chemically propelled cartridge
  takes twice the room.
- The gun needs no power. Its muzzle speed is 100 m/s at a 0.7 m barrel, going as the square root
  of the length. See `spec.md` §22.

## 4. Power: batteries, generators, and what uses power

### 4.1 Units and the exchange rate

- **Energy is in kJ; power in kW.**
- **A generator turns propellant into stored energy at 1,000 kJ per kg** of tank propellant, about 26%
  of the game's chemical energy. That is a plausible efficiency for a turbine or fuel cell.
- So **every kJ spent costs 1 g of propellant**, through the generators. This is the single exchange
  rate that ties power to fuel, the main effect you predicted.

### 4.2 Battery

| Rule | Value | Calibrated from Thrust's battery (1.2 × 0.5 m, 2 kg) |
|---|---|---|
| Capacity | **2,700 kJ per m²** of outline | 0.6 m² → 1,620 kJ, about 4 s of shield |
| Mass | **3.3 kg per m²** | 2 kg |
| Explosion when destroyed | charge ∝ energy stored, **0.05 kg when full** | as now |
| Size limits | **0.2 m to 2.0 m** each way | |

- Batteries on one ship share their energy.
- Only batteries welded to the cockpit count; one knocked off is lost with its charge.
- The ship starts with full batteries.

### 4.3 Generators

| Rule | Value | Calibrated from Thrust's generators (0.7 × 0.8 m, 2 kg each) |
|---|---|---|
| Output | **400 kW per m²** of outline, at most | 0.56 m² → 224 kW each, 448 kW for the pair |
| Fuel burned | **output ÷ 1,000 kJ/kg**: up to 0.224 kg/s each | |
| When they run | only while the batteries aren't full, and only as hard as needed to fill them | a full battery burns no fuel |
| Fed | from the tanks, through feed links like engines' (added automatically) | |
| Mass | **3.6 kg per m²** | 2 kg |
| Size limits | **0.3 m to 2.0 m** each way | |

- A generator works only while welded to the cockpit and fed.
- Destroyed, cut off, or with the tanks dry, it stops.

### 4.4 What uses power

| Device | Draw | Basis | On Thrust 1 |
|---|---|---|---|
| **Shield**, while up | **400 kW** | today's 0.4 kg/s of fuel × 1,000 kJ/kg | full battery: 4 s alone; with both generators: indefinitely, at 0.4 kg/s of fuel as today |
| **Shield hit** | **1.25 kJ per N·s** of the hit's impulse, at least 25 kJ | today's 0.00125 kg/N·s and 0.025 kg | a 400 N·s rock hit costs 500 kJ, a third of the battery |
| **Railgun shot** | kinetic energy ÷ 0.5 efficiency: **3.5 kJ** a shot | ½ × 0.167 kg × 144² m²/s² = 1.73 kJ | 8 a second is 28 kW; all 120 shells cost 0.42 kg of fuel |
| **Tractor beam**, while on | **10 kW** | its 1,200 N force at about 3 m/s, with losses | |
| **Tether**, while reeling in | **5 kW** | | |

**With no energy left:**

- the shield drops;
- the railgun doesn't fire;
- the beam and tether let go.

Each comes back as soon as there is enough energy for its next step, or for its next shot.

**What it will mean in play:**

- As you suspected, Thrust's generators (448 kW) outpace everything but the shield (400 kW). The
  battery refills in about 4 s, and the real cost is fuel.
- Holding the shield up burns fuel as fast as today. A run of hits drains the battery faster than
  the generators refill it, and the shield drops.
- One generator lost (224 kW) can't hold the shield up: it lasts about 9 s from a full battery
  instead of indefinitely.

## 5. Rockets

The "simplified engine" of `docs/nozzle-design-thoughts.md` §5, implemented as that document's
order of work (§7) proposes, opt-in so nothing else changes.

### 5.1 What the designer sets

| Setting | Limits |
|---|---|
| Burn rate ṁ (the feed sets it) | 0.1 to 20 kg/s |
| Chamber width W_c and chamber length L_c | W_c from the throat to 4 m; L_c from 0.05 to 2 m |
| Throat width W_t | 0.1 m to W_c |
| Nozzle length L_n and wall half-angle α | L_n 0 to 3 m; α 0 to 45° |
| Wall thickness t (one for the whole engine) | 0.02 to 0.3 m |

The exit width follows: W_e = W_t + 2 L_n tan α.

### 5.2 What follows (in order of cause)

1. **Chamber pressure** p_c = ṁ · c\* ÷ W_t (N per m of depth). The game's chamber model already
   settles there.
2. **Thrust** F = η · ṁ · c\* · C_F.
   - C_F is the 1D isentropic thrust coefficient for the area ratio ε = W_e ÷ W_t, its momentum
     term times λ = sin α ÷ α (§2 of the document).
   - Throat alone, C_F = 1 + 1/γ, which is today's formula.
   - At ε 1.45 (Thrust's) C_F is about 10% more; at ε 2.8, 21%; at ε 5, 27%.
3. **Burning completely (the L\* rule)** η = 1 while L\* = W_c · L_c ÷ W_t is at least L\*₀, and falls
   as √(L\* ÷ L\*₀) below it, to no less than 0.7.
   - L\*₀ is calibrated so THRUST 1's new main engine sits just at the knee.
   - This stops chambers shrinking to nothing (the document's open point).
4. **The walls hold the pressure or they don't:**
   - Each weld's limits are **k · t**: k_T 229,500 N/m, k_C 459,000, k_S 160,500, k_M 55,200 N·m/m.
     Thrust's 0.1 m walls give exactly today's Standard welds.
   - A wall's mass is **6.8 kg per m² of wall** (Thrust's nozzle walls: 0.75 kg for 1.1 × 0.1 m).
   - The physics already pushes the chamber's pressure onto the walls, so an over-pressured engine
     bursts in flight.
   - The designer shows each wall's margin: k_T · t ÷ (p_c · L ÷ 2), and bending.
5. **Throttle response** follows from the chamber's size by itself (the chamber model). Nothing to add.

**In the physics (opt-in):**

- The exhaust leaves at the nozzle's exit at v_e, not at the throat.
- The pressure along each wall pushes on that wall, so a bent or broken nozzle pushes sideways.
- Momentum and energy stay exact (the ledger).
- An injector declares `nozzle: true` to get this. Without it, everything is as today.

### 5.3 THRUST 1's new rockets (the benchmark)

The five engines are replaced by rockets built to these rules, at the same places and with the same
wiring:

| | Today (main / each small) | Target |
|---|---|---|
| Thrust | 1,603 N / 299 N | the same, ±3% |
| Burn rate | 7.78 / 1.45 kg/s | about 9% less for the same thrust (the nozzle's gain, which is fuel saved) |
| Mass | 3.0 / 1.2 kg | within ±10% |
| Ship: forward, reverse, turn | 36.1 m/s², 9.8 m/s², 9.9 rad/s² | within ±5% (Measure) |
| Full-burn time | 50 s | about 55 s (the fuel saved) |

The new geometry gets:

- a real throat, narrower than the chamber, with chamber walls;
- the same 0.1 m walls, so the same welds;
- the same exit widths.

So the ship looks much as it does, and its damage model is kept.

**Pressure-fed tanks** (decided: engines are pressure-fed; this comes with the rockets):

- A tank holds pressure p while its walls (§1) are at least p · L ÷ (2 k_T) thick, L being its longest
  side.
- An engine can't run its chamber above what the weakest tank feeding it holds. Its burn rate is
  capped at ṁ_max = 2 k_T · t · W_t ÷ (L · c\*).
- The designer shows each tank's margin, and the cap where it bites.
- So high pressure costs tank mass and capacity: thicker walls weigh more and leave less room
  inside.
- THRUST 1's engines run at about 200 N/m, far below what its 0.1 m tanks hold, so the cap doesn't
  touch it.

## 6. In the designer

- **Properties:**
  - each part shows what its rules give: propellant held and dry mass; shells held; kJ stored;
    kW made and kg/s burned at full;
  - for rockets: pressure, thrust, Isp, L\*, and each wall's margin.
- **Size limits:** typed values, sliders and drag handles stop at the limits.
- **Performance gains a power line:** battery kJ, generators kW, shield time on the battery alone,
  and whether the generators can hold the shield up.
- **Try it:** a battery gauge and a fuel gauge.

## 7. Order of work

1. **Containers** *(built, `docs/blueprint/spec.md` §19)***:** the tank and magazine rules, wall thickness (weight, welds, damage) and the size
   limits; THRUST 1 and the Mastodon rebuilt from them. Measured against today.
2. **Power** *(built, `docs/blueprint/spec.md` §20)***:**
   - in the physics: battery, generators, and draws for the shield, railgun, beam and tether;
   - in the designer: the rules, readouts and Try it gauges;
   - shield fuel use measured against today's.
3. **Rockets** *(the chambered geometry built, `spec.md` §23; the nozzle physics, §27; the L\* rule, the pressure ceilings and their readouts, §28)***:**
   - in the physics: `nozzleFlow` (pure, tested against textbook values), then opt-in exhaust at the
     exit and wall loads;
   - then the rocket part, THRUST 1's new engines, and L\*₀ calibrated;
   - the benchmark table above measured, and the Mastodon re-measured.
4. Later: separate H₂/O₂ tanks; pumped engines drawing power.

Each step ships as its own PR with its measured figures against THRUST 1 today.

## 8. Decisions (16 November 2026, Chloe)

1. **Container walls are a setting** (0.02–0.3 m, 0.1 m default), driving weight, weld strength and
   damage capacity (§1).
2. **The power figures as proposed, to try and tune:**
   - 1,000 kJ per kg of fuel;
   - the battery about 4 s of shield;
   - the generators 112% of the shield.
3. **The railgun starts cheap** (3.5 kJ a shot), so the ship plays like Thrust's. Chloe will raise
   it so that firing and shielding become real decisions; the cost is one number to change.
4. **Fuel efficiency is fixed at 66 for regular engines**, not a player setting. Chloe may tune it.
   Later engines may be more or less efficient, made from rarer or commoner materials.
5. **Engines are pressure-fed:** no ship has to carry a power source (the Mastodon carries none).

### Rockets (17 November 2026, Chloe)

6. **Working nozzles, on the new engines only.** The OG engines, the double engine and every game's
   ships keep the throat's jet; the presets keep their new, honest figures (no rebalance).
7. **The L\* rule, choice B:** L\*₀ = 0.30 m, THRUST 1's main engine. Below it a chamber burns
   √(L\* ÷ L\*₀) of its propellant's energy, never under 70%: "smaller, lighter thrusters should have
   some disadvantage, or why would you not make all the thrusters tiny?" THRUST 1's light
   thrusters' chambers grow from 0.10 to 0.19 m (L\* 0.304) to keep their thrust.
8. **Pressure ceilings:** a wall t thick spanning L holds 2·k_P·t ÷ L, **k_P = 25,700 N/m** (THRUST
   1's main engine runs at half what its tanks can feed). A pressure-fed engine's chamber runs at
   most its weakest feeding tank's hold ÷ **1.5** ("let's see what 1.5 does"), and at most what its
   own walls hold. Its most flow is ceiling × throat ÷ c\*, so its most thrust grows with its
   throat. **The designer stops you at the ceiling**; an edit that lowers it brings the flow down.
   The tank pressure rule of §5 (2·k_T) is replaced by this.
9. **Welds weigh something** (17 November 2026): a weld point is a fillet bead of the walls' own
   material, 6.8 kg/m² × (quality × t)² ÷ 2: Standard 0.034 kg at 0.1 m walls, Light a quarter,
   Heavy four times, for half or twice the strength. Only welds between parts weigh; welds on OG
   parts are free. The Phiomia and the Stegodon use Light welds.
   - So a tank must hold the pressure of the chambers it feeds.
   - That rule comes in with the rockets (step 3), as the tank-wall check in §5.3.
   - The order of work's step 4 keeps only separate H₂/O₂ tanks and pumped engines.

**Notes from review:**

- **Shell counts round down with a small tolerance:** floor(inner area × 60 ÷ 0.125 + 10⁻⁶).
  Otherwise floating point gives Thrust's magazine 59, not 60. A test checks it gives exactly 60.
- **A tank's or magazine's explosion is set by what it can hold** (its capacity), not by what it
  holds at the moment.
  - Making the charge change during play would change the ledger's chemical energy with no
    source to record it.
  - A magazine with no shells left still doesn't go off, as now.
