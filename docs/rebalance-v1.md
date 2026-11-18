# Rebalance v1 (agreed, not built yet)

Chloe, 18 November 2026. To land after the units rescale (docs/units-rescale-plan.md) merges, as its
own PR. Figures are in the game's units (lengths ×4, masses ×1024 against before).

## The pilot

- A woolly mammoth cow, **4 t** (adult females up to about 4 t, bulls about 6 t; herds were most
  likely led by an experienced cow, inferred from fossil sex ratios and modern elephants:
  [Wikipedia](https://en.wikipedia.org/wiki/Woolly_mammoth),
  [Live Science](https://www.livescience.com/60845-male-mammoths-died-alone.html)).
- She sits in the cockpit (4.8 m across). Ship masses are to be shown with and without her: the
  next part of the game has landing and disembarking.

## The railgun

- Shell **40 kg at 1,200 m/s** (28.8 MJ, today's energy; was 171 kg at 576 m/s). Recoil per shot
  about half of today's.
- A shot's draw on the battery: about 72 MJ (some 40% efficient: the shell's 28.8 MJ).
- Magazines: Chloe had no preference. Suggested: the same mass of shells per magazine, 256 of
  40 kg (512 on THRUST 1).

## Power: real-world figures

Start grounded (Chloe): today's real figures first; being sci-fi, they may be raised from there.

| Part | Today (sci-fi) | v1 (real-world) | Source |
|---|---|---|---|
| Battery | 3,600 Wh/kg (THRUST 1's: 7.4 MWh in 2 t) | **450 Wh/kg** (0.9 MWh, 3.3 GJ) | best commercial lithium cell: [Amprius](https://www.unmannedsystemstechnology.com/2025/05/amprius-unveils-high-performance-lithium-ion-battery-for-demanding-aviation-applications/) |
| Generator | 1,800 kW/kg (3.7 GW each) | **12.5 kW/kg** (25 MW each): 2.5 × a fuel cell's ~5 kW/kg (Chloe: "here we have massive generators") | Toyota Mirai fuel cell stack, 128 kW in 24 kg: [JSME](https://jsme.or.jp/english/about/awards/2021-2/award2021-nt2) |
| Electricity per kg of propellant | 16 MJ/kg | **~7 MJ/kg** | estimate: H₂ + O₂ (1 : 8) ~13 MJ/kg, about half turned into electricity |

On those, THRUST 1's railgun has about 45 shots in a full battery (about 49 in one burst, the
generators adding as it fires), and its two generators (50 MW) make one shot about every 1.4 s
(42 a minute). At full output they burn about 7 kg/s of propellant: THRUST 1's 6.2 t lasts about
15 minutes of it.

## The shield (Chloe, 18 November 2026)

- **Each hit** costs the energy it brings, relative to the ship (½ m v², the shell's mass and its
  speed relative to the field), at **25% efficiency**: 4 × that energy from the battery. The new
  40 kg shell at 1,200 m/s: 28.8 MJ, so 115 MJ a hit. Physics: stopping a hit means soaking up its
  energy; the cost is in braking it actively, and a perfectly springy field would cost nothing.
  Today's rule (5 kJ per N·s of impulse, at least 410 MJ) charges by momentum instead.
- **Running it** drains THRUST 1's battery in **20 s**: 3.24 GJ ÷ 20 s = **162 MW** (a fixed draw,
  set by THRUST 1's battery). Its generators (50 MW) can't keep it up: the shield is a short,
  deliberate measure. From full, with no hits, about 29 s with the generators running (20 s on the
  battery alone); each hit takes about 1 s off that.

## The tractor beam and tether (Chloe, 18 November 2026)

- **Beam: 60 MW.** The generators (50 MW) almost carry it: it runs the battery down by 10 MW, about
  5½ minutes from full (54 s on the battery alone).
- **Tether: 20 MW.** The generators carry it, with 30 MW to spare for the battery.
- **Both: 80 MW**: about 1¾ minutes from a full battery.

## Power budget, THRUST 1 (battery 3.24 GJ, generators 50 MW)

| Using | Draw | Full battery lasts |
|---|---|---|
| Tether | 20 MW | for ever (generators carry it) |
| Beam | 60 MW | ~5½ min |
| Beam + tether | 80 MW | ~1¾ min |
| Shield (no hits) | 162 MW | ~29 s |
| Railgun, flat out (8 shots/s) | ~576 MW | ~49 shots, ~6 s |

## Context: THRUST 1 today (game's units)

Full 61.7 t (dry 35.0 t; propellant 6.2 t; shells 20.5 t); with the pilot 65.7 t. Cockpit 6.1 t,
magazines 3.1 t dry each, tanks 1.9 t dry each, main engine 3.1 t, light thrusters 1.2 t each,
generators and battery 2 t each, railgun, tractor and winch 1 t each, shield emitter 0.3 t, welds
1.5 t. Ammunition is a third of the ship and propellant a tenth.
