# Engine validation: the chamber model against the gas (15 November 2026)

Does the chamber model (PRP-011, `src/core/vessel.ts`) give the thrust the gas simulation would, for
engines of other sizes and shapes? And does the gas, finely resolved, follow textbook nozzle theory?
The background and what follows for ship design are in `docs/nozzle-design-thoughts.md`.

## Setup

`scripts/engine-validation.ts`; the results are in `engine-validation.json` beside this file.

- **The engines:** RS-08's (`scenarios/rs08-chemical-rocket.json`): a head with an injector, a
  chamber 0.8 m wide and 0.6 m long, a throat 0.3 m wide, 0.5 kg/s. Reshaped (no nozzle, a straight
  extension, area ratios 2 to 5, half-angles 10° to 61°) and scaled ×2 and ×4, the flow in
  proportion to the throat so the chamber pressure is the same. Each is welded to a 100 kg base, alone
  in empty space, no gravity, the sandbox profile.
- **Each engine is run three ways:**
  - **Model:** its interior declared, so the chamber is held as one volume and lets its gas out as
    a jet at c\*·(1 + 1/γ).
  - **Gas:** no interior declared, so the chamber, throat and nozzle are all parcels, at 500 to
    8,000 parcels a second (the sandbox lets a chamber engine release 1,000).
  - **Ideal:** one-dimensional nozzle flow into vacuum (planar: areas are widths) from the chamber's
    own state, taken from the model's jet (193 m/s, γ 1.33), with and without the loss to a
    spreading jet (sin α ÷ α on the jet's momentum).
- **Thrust** is the mean mass × acceleration from 0.75 to 1.5 s. **Where the gas is heading** is
  extrapolated from the three finest rates (Richardson): F∞ = F₃ + (F₃ − F₂) ÷ (2^p − 1).
- To rerun: `seq 0 9 | xargs -P 4 -I{} sh -c 'node scripts/engine-validation.ts --engine {} > /tmp/eng-{}.json'`,
  then `node scripts/engine-validation.ts --merge /tmp/eng-*.json`. About an hour on four cores.

**Not run:** the ×0.5 engine (`--engine 7`). Its 0.15 m throat packs the parcels so densely that it
hadn't finished after two hours. **Not converged:** the ×4 engine, still rising fast at 8,000
parcels a second.

## Results

Thrust, N (gas ÷ model in brackets):

| Engine | Area ratio | Half-angle | Ideal, throat | Ideal, nozzle (with divergence loss) | Model | Gas 500/s | Gas 1,000/s | Gas 2,000/s | Gas 4,000/s | Gas 8,000/s |
|---|---|---|---|---|---|---|---|---|---|---|
| Throat only | 1.0 | 0° | 97 | 97 (97) | 104 | 54 (0.52) | 71 (0.68) | 80 (0.77) | 92 (0.88) | 92 (0.88) |
| Straight, 0.6 m | 1.0 | 0° | 96 | 96 (96) | 103 | 56 (0.54) | 72 (0.70) | 88 (0.86) | 99 (0.96) | 102 (0.99) |
| Ratio 2, 0.6 m | 2.0 | 14° | 97 | 112 (111) | 112 | 56 (0.50) | 74 (0.66) | 91 (0.81) | 101 (0.90) | 105 (0.94) |
| Ratio 2.8, 0.6 m (RS-08) | 2.8 | 24° | 97 | 117 (114) | 107 | 57 (0.54) | 73 (0.68) | 87 (0.81) | 102 (0.96) | 108 (1.00) |
| Ratio 2.8, 0.15 m (wide) | 2.8 | 61° | 97 | 117 (98) | 104 | 54 (0.52) | 71 (0.68) | 83 (0.80) | 94 (0.90) | 94 (0.90) |
| Ratio 2.8, 1.5 m (long) | 2.8 | 10° | 96 | 117 (116) | 115 | 59 (0.51) | 73 (0.63) | 91 (0.79) | 103 (0.90) | 109 (0.95) |
| Ratio 5, 1.2 m | 5.0 | 27° | 97 | 123 (119) | 108 | 56 (0.51) | 72 (0.66) | 89 (0.83) | 101 (0.93) | 108 (1.00) |
| RS-08 × 2 | 2.8 | 24° | 193 | 233 (227) | 208 | 58 (0.28) | 88 (0.42) | 133 (0.64) | 178 (0.85) | 203 (0.98) |
| RS-08 × 4 | 2.8 | 24° | 386 | 466 (454) | 416 | 102 (0.24) | 120 (0.29) | 165 (0.40) | 255 (0.61) | 350 (0.84) |

Where the gas is heading, against the model and the ideal nozzle:

| Engine | Gas, extrapolated (order) | Model ÷ gas | Gas ÷ ideal (with loss) |
|---|---|---|---|
| Throat only | 92 (6.0) | 1.14 | 0.95 |
| Straight, 0.6 m | 103 (1.8) | 1.00 | 1.08 |
| Ratio 2, 0.6 m | 108 (1.3) | 1.04 | 0.98 |
| Ratio 2.8, 0.6 m (RS-08) | 110 (1.6) | 0.97 | 0.97 |
| Ratio 2.8, 0.15 m (wide) | 94 (4.6) | 1.11 | 0.96 |
| Ratio 2.8, 1.5 m (long) | 115 (1.0) | 1.00 | 0.99 |
| Ratio 5, 1.2 m | 121 (0.7) | 0.90 | 1.01 |
| RS-08 × 2 | 238 (0.8) | 0.88 | 1.05 |
| RS-08 × 4 | – (not converging yet) | – | – |

Chamber pressure, N/m, at 8,000 parcels a second against the model's: 410–785 against 214 at size
×1; 303 against 229 at ×2; 274 against 237 at ×4. Every run was steady to a few per cent between
0.5–1.0 s and 1.0–1.5 s, and the ledger recorded no violations.

Cost, ms a step on this machine: the model 1–2 ms; the gas 2–9 ms at 500–1,000 parcels a second,
25–40 ms at 2,000, 100–180 ms at 4,000, 170–710 ms at 8,000 (the bigger engines less: 45–54 ms at
8,000).

## Findings

1. **Finely resolved, the gas follows textbook nozzle theory, within about ±5%.** Across area ratios
   1 to 5, half-angles 10° to 61° and sizes ×1 and ×2, the extrapolated gas thrust is 0.95–1.05 of
   ideal 1D flow with the divergence loss. The one outlier is the straight extension (1.08). One-dimensional
   theory is a sound model for the game's nozzles.
2. **The divergence loss sin α ÷ α holds.** The wide nozzle (61° a side) gives 94 N, against 98 N
   ideal with the loss and 117 N without it.
3. **The chamber model is off by up to about 15%, depending on the nozzle.** It reads high for
   poor nozzles (throat only +14%, the wide one +11%) and low for good ones (ratio 5 −10%, RS-08
   ×2 −12%), because it gives every nozzle about the same thrust: 103–115 N. Adding the nozzle
   term from theory would put it within the gas's ±5%.
4. **At the game's resolution the gas is far off,** 30–70% of its converged thrust at 500–1,000
   parcels a second, worse the bigger the engine. Converging it costs 50 to 300 times the model's
   step. So the chamber model was the right choice, and the nozzle should come from theory, not
   from parcels.
5. **The gas's chamber pressure hasn't converged for the smaller engines** (2–3 times the model's
   at size ×1, against 1.2–1.3 at ×2 and ×4): a throat a few parcels wide holds the gas back. The
   thrust converges regardless; read the pressures as indicative only.

## Caveats

- The ideal comes from the model's own jet, so it starts from the same gas as the model; it checks
  the nozzle, not the chamber.
- The extrapolation orders vary (0.7–6), so take the extrapolated values as ±5%.
- One run each, at one chamber pressure; ×0.5 not run, ×4 not converged.
