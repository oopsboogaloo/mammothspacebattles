# Proposal: design rules for each component type

Draft for Chloe's approval, 16 November 2026. Nothing here is built yet.

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

**Wall thickness t.**

- Walls are 0.05 m all round, the same for every container for now.
- What a container holds goes with its **inner** area: the outline moved in by t on every side.
- Its dry mass goes with its **wall** area: the outer area less the inner.

**Why this matters:**

- Small containers are mostly wall, so they are heavy for what they hold.
- Big ones are efficient, but they are one big target with one big explosion.
- That is the trade real tanks make.

**Shapes:** the same rule works for boxes, trapezoids and triangles. The inner outline is the outer
one offset inward, so no new code is needed per shape.

## 2. Fuel tanks

| Rule | Value | Calibrated from Thrust's tank (1.5 × 1.0 m, 2 kg dry, 4.05 kg propellant) |
|---|---|---|
| Propellant held | **3.21 kg per m² of inner area**, H₂ : O₂ 1 : 8 by mass | inner 1.4 × 0.9 = 1.26 m² → 4.05 kg |
| Dry mass | **8.3 kg per m² of wall** | wall 0.24 m² → 2.0 kg |
| Explosion when destroyed | charge **0.0123 kg per kg of propellant** held at the time | 0.05 kg charge at 4.05 kg |
| Size limits | **0.3 m to 3.0 m** each way (bounding box); trapezoid and triangle sides at least 0.15 m | below 0.3 m the inner space is under a quarter of the outline |

**Examples:**

- The Mastodon's centre tank (1.2 × 0.65 m) would hold 1.94 kg; it is 2.11 kg today, scaled by outline.
- A 3 × 1 m tank holds 8.4 kg for 3.3 kg dry.
- A 0.3 × 0.3 m tank holds 0.13 kg for 0.42 kg dry.

**Fuel efficiency (`economy`, 66 on every Thrust engine)** is a flight-test cheat: it makes 65 parts
in 66 of the exhaust from nothing. I propose making it a fixed game constant (66) for regular engines,
not a design setting, so the tank rules above stay honest.

## 3. Magazines

| Rule | Value | Calibrated from THRUST 1's magazine (0.7 × 0.45 m, 3 kg dry, 60 shells) |
|---|---|---|
| Shells held | **285 per m² of inner area**, rounded down | inner 0.6 × 0.35 = 0.21 m² → 60 |
| Dry mass | **28.6 kg per m² of wall** (armoured: 3.4 times a tank's) | wall 0.105 m² → 3.0 kg |
| Explosion when destroyed | charge **1/60 kg per shell** held (none when empty, as now) | 1 kg at 60 shells |
| Size limits | **0.3 m to 2.0 m** each way | 0.3 × 0.3 m holds 11 shells |

**Examples:**

- The Mastodon's magazine (0.4 × 1.4 m) would hold 111 shells; it holds 100 today.
- A 2 × 2 m magazine holds 1,031 shells, 172 kg of them.

**The shell itself** stays the railgun's: 0.167 kg. Its mass belongs to the magazine, as now.

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

**Pressure-fed tanks** (decided in the document; I suggest **later**, as its own step):

- Tank walls thicken with the highest chamber pressure they feed: t ≥ p_max · L ÷ (2 k_T).
- So high pressure costs tank mass and capacity.
- It ties §2 to §5. It isn't needed for THRUST 1 to fly as today.

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

1. **Containers:** the tank and magazine rules and the size limits; THRUST 1 and the Mastodon
   rebuilt from them. Measured against today.
2. **Power:**
   - in the physics: battery, generators, and draws for the shield, railgun, beam and tether;
   - in the designer: the rules, readouts and Try it gauges;
   - shield fuel use measured against today's.
3. **Rockets:**
   - in the physics: `nozzleFlow` (pure, tested against textbook values), then opt-in exhaust at the
     exit and wall loads;
   - then the rocket part, THRUST 1's new engines, and L\*₀ calibrated;
   - the benchmark table above measured, and the Mastodon re-measured.
4. Later: pressure-fed tanks, separate H₂/O₂ tanks, pumped engines drawing power.

Each step ships as its own PR with its measured figures against THRUST 1 today.

## 8. For you to decide

1. **Container walls fixed at 0.05 m** for now, or a setting from the start?
2. **The power exchange rate and sizes:**
   - 1,000 kJ per kg of fuel;
   - battery about 4 s of shield;
   - generators 112% of the shield.

   Or would you rather the battery mattered more (say 10 s of shield) or the generators were barely
   enough?
3. **The railgun is cheap in power** (3.5 kJ a shot, physically). Keep it so, or make it a real drain
   (say 30 kJ a shot, 240 kW sustained, so firing and shielding compete)?
4. **Fuel efficiency (economy)** fixed at 66 for regular engines, not a player setting?
5. **Pressure-fed tanks later** (step 4), not now?
