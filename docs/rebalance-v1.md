# Rebalance v1 (agreed; built 18 November 2026)

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

## As built (18 November 2026)

In the designer's rules (`src/app/blueprint/rules.ts`: `SHELL`, `POWER`, `PILOT`, the magazine's
256), the shield's new hit cost in the core (PWR-004 `hitEfficiency`), and docs/blueprint/spec.md
§32. Where the figures above were rounded:

- The battery is 2.048 t in the game (2 kg in the designer's units), so at 450 Wh/kg it stores
  3.32 GJ, not 3.24: about 46 shots. The shield's draw is set so it still drains it in 20 s
  (166 MW, not 162).
- The generators are 2.048 t too: 25.6 MW each, 51.2 MW the pair.
- A hit's energy is taken against the whole ship (the reduced mass): a 40 kg shell on THRUST 1
  costs just under 115.2 MJ.
- The battery's and magazines' blasts are as before.
- Every regular cockpit has the pilot, so the Mastodon, Stegodon, Phiomia and Loxodon are each 4 t
  heavier (the Phiomia and Loxodon accelerate about a quarter less). THRUST OG has none.

## After the first play (Chloe, 18 November 2026)

Flown through to level 6: "clearly not shit". The railgun makes the game much easier, which is
fine (the game is hard). Changes:

- **Shells: 100, not 512.** A railgun's demands are on the ship's power, and the gun is heavy; its
  ammunition should be small and light. THRUST 1's magazines hold 50 each and shrink to fit: 1.25 m
  square, as small as holds them. Their walls are as thick as a part that small may have (a quarter
  of its side, 0.31 m against the standard 0.4 m), so their armour, and the welds on them, are 78%
  of before. THRUST 1: 47.96 t full, 43.96 t without the pilot; 184 m/s² forward, 11.6 rad/s².
- **The shield in a crash.** One crash into a wall emptied the battery. That was a bug, not the
  figure: the elastic field bounces against the wall many times as it settles, and each touch was
  charged as a new hit (a 20 m/s crash: about 30 hits, some 35 times the energy it brought). Now
  one encounter is one hit: a body touching the field again within 0.5 s of last touching it costs
  nothing more. A 20 m/s crash costs 54 MJ (1.6% of the battery), 40 m/s 220 MJ (7%). Asked for:
  hits a quarter to a fifth as dear; the fix alone makes a crash about 35 times cheaper, so the
  25% efficiency is kept (a shell still costs 115 MJ).
- **Generators ×4: 50 kW/kg**, 102 MW each, 205 MW the pair ("they're half the ship"). They hold
  the shield (166 MW) up for as long as there is propellant, burning about 24 kg/s for it (THRUST
  1's 6.2 t: about 4 minutes), and refill a shot (72 MJ) in 0.35 s.
- **Fast shells are drawn as streaks.** THRUST 1's railgun shells (1,200 m/s) went too far
  between frames to be seen, showing as spaced-out dots. A shell that moves more than 6 pixels a
  frame is now drawn with a streak behind it as long as it goes in 2.5 frames (so longer than its
  jump from one frame to the next), fading toward the tail; it is still one particle in the
  physics. Slower shells (the turrets' bolts) stay dots (`src/app/render.ts`).
