# Rescaling the game's units: lengths ×4, masses ×1024

Chloe, 18 November 2026. The ships came out metres across and kilograms in weight: a 1.2 m cockpit
of 6 kg, a 60 kg THRUST 1, a 1 kg gun. They should fit a mammoth. The decision:

- **Lengths ×4.** The cockpit becomes 4.8 m across, big enough for a woolly mammoth (2.7–3.4 m at
  the shoulder, 2.8–3.8 m long; [Wikipedia](https://en.wikipedia.org/wiki/Woolly_mammoth)).
- **Masses ×1024.** At the same 2D densities a part ×4 across would weigh ×16; ×1024 is that times
  64, the factor that took the cockpit from 6 kg to a spacecraft cabin's mass (a Mercury capsule's
  structure was 340 kg, 1.89 m across). THRUST 1 becomes about 62 t full.
- **Time unchanged.** So the game plays exactly as now: every speed and acceleration ×4 (THRUST's
  gravity 4 → 16 m/s²), so that on screen nothing moves differently.

The relative weights of the parts are to be rebalanced afterwards, once the scale is settled: this
change alone must not change how anything flies, THRUST OG and the games' own ships included.

## Why 4 and 1024

Both are powers of two. Multiplying a floating-point number by 2ⁿ changes only its exponent, so if
every quantity is scaled consistently, every result of the physics is too, exactly: a scaled world
runs bit for bit as the old one, divided by its factors. That turns "basically the same" into a
test that either passes exactly or names the first step and quantity that differ.

How each kind of quantity scales (L ×4, M ×1024, T ×1):

| Quantity | Units | Factor |
|---|---|---|
| Length, position | L | 4 |
| Area (2D) | L² | 16 |
| Mass | M | 1024 |
| 2D density | M/L² | 64 |
| Speed | L/T | 4 |
| Acceleration, gravity | L/T² | 4 |
| Mass flow | M/T | 1024 |
| Force, impulse per second | ML/T² | 4,096 |
| Momentum | ML/T | 4,096 |
| Energy, torque | ML²/T² | 16,384 |
| Moment of inertia, angular momentum | ML² (/T) | 16,384 |
| 2D pressure (force per length) | M/T² | 1024 |
| Stiffness (force per length) | M/T² | 1024 |
| Specific energy (J/kg) | L²/T² | 16 |
| Gravitational parameter μ | L³/T² | 64 |
| Angles, ratios, counts, times, steps, seeds | — | 1 |

Every factor is an even power of two, so square roots of scaled quantities stay exact too.

## Stage 1: the engine indifferent to units (no behaviour change)

1. **A units table** for every number a scenario can hold (about 290 kinds of field across the 61
   scenarios), by where it sits: `position.x` is a length, `limits.torque` an energy,
   `material.threshold` an energy, `gravity.mu` L³/T², and so on.
2. **`scaleScenario(raw, {length, mass})`**, which converts a scenario by that table.
3. **The proof test**: every scenario, and the designer's presets in their games, run at the old
   units and converted, side by side in the same build, with scripted input; every body's position,
   velocity, angle, spin, mass and integrity, every gas parcel and every event, compared exactly
   after dividing by its factor.
4. **Fix what it catches**: each failure is a constant written in old units (a default, a
   tolerance, a grid cell, a cut-off). Each becomes a quantity the world carries in its units, so
   it scales with the scenario. Repeat until every scenario passes.

Nothing anyone can see changes in stage 1.

**Stage 1 done (18 November 2026).** UNITS-001 and UNITS-002 (`tests/core/units.test.ts`): all 61
scenarios and the six presets run bit for bit the same at lengths ×4 and masses ×1024, over 5 s of
scripted input on every control (`node scripts/units-report.ts`). What it took, each found by the
proof: the contact solver's restitution cut-off and largest correction (Rust); the profile's
tolerances and limits; the gas's dynamic scale (÷16 for lengths ×4: it already divides every molar
mass, so temperatures stay); the world's default bounds; injector, tractor, collector, turret and
weld defaults; the terrain's crust, rims and micrometre rounding; the AI pilots' distances and
speeds; leaks, blasts, shields, power, the engines' body grid, the wisps' grid; and the games'
rules (landing, Thrust, the arcade, Moon Mammoth, ropes, the plant, dust). Explosive heats are taken
before the gas scale, so they are not converted.

## Stage 2: change the units

5. Record a baseline of every scenario with the build before the change.
6. Convert the scenario files, the presets, the parts and the designer's rules, and the core's
   defaults, to the new units.
7. Prove it across builds: the new build's runs, divided by the factors, equal the baseline
   exactly.
8. Update the tests' literal figures by their factors.
9. Display and input, which the proof does not cover: camera zoom, the designer's grid and snap,
   read-outs, effects sized in metres, drag thresholds; checked with the browser tests.
10. Saved designs in the browser (localStorage) get a version stamp and are converted on load.
11. Docs: a dated note where figures are historical; current figures updated.

**Stage 2 as built (18 November 2026).**

- **Scenario files are schema 2**, in the game's units; a schema 1 file is migrated on load, exactly
  (`migrateUnits.ts`: parameters by their units, formulas and assertions rewritten so they give and
  check the same, the camera's zoom ÷4). The 61 files were converted by `scripts/convert-units.ts`,
  each checked bit for bit against its original over 5 s of scripted input before it was replaced;
  UNITS-003 keeps the migration checked. The level scripts build in the core's units and write in the
  game's.
- **The core's constants keep their figures**, scaling with a world's units (stage 1); profiles are
  scaled wherever they are passed (`stepInPlace`, `createWorld`).
- **The designer keeps the core's units inside**, so its rules, presets and saved designs are as they
  were; it shows and takes the game's (`src/app/blueprint/shown.ts`), and a ship goes into a game in
  the game's units (`withBlueprint`). Saved designs need no migration.
- **The sandbox and the games run in the game's units**: their parts, palette, gas tool, ports,
  cameras, views and HUDs, and the renderers' sizes in metres, written as the old figure times its
  factor (`src/app/units.ts`). Prefabs saved before are scaled up on load.
- **Tests:** the core's and the designer's read levels converted back to the core's units
  (`tests/helpers.ts` `inCoreUnits`), checking what they always did; the games' pages are tested in
  the game's units.
