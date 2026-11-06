# Ship design log

What each player ship is and how it handles, measured, so a design can be found again or
compared. The first four share one layout: a hull and tank between two engines (chamber, throat and
nozzle walls), under a wing, on two legs. Measured November 2026 (sandbox profile, gas scale 100).

## How the numbers were measured

In empty space with no gravity, everything but the ship removed:

- **Thrust and exhaust speed:** both engines at full throttle; acceleration of the whole ship
  between 0.5 s and 1.5 s (so the chambers are up), thrust per engine = mass × acceleration ÷ 2;
  exhaust speed = the median speed, relative to the ship, of gas 2–4 m behind it.
- **Turn:** the left engine alone at full throttle for 0.5 s from rest; the spin it reaches.
- **Mass:** the whole ship, propellant and shells included.

## The ships

| | Lander (LAND) | Gunship (GS) | Gunship 2 (GS2) | Gunship 3 (GS3) | Mammoth (MAM) |
|---|---|---|---|---|---|
| Scenario | `land-twin-engine` | `gunship` | `gunship-2` | `gunship-3`; also base, tractor, AI-1/2/3 | `mammoth` |
| **Mass**, fuelled | 25.8 kg | 108.2 kg | 78.2 kg | 90.8 kg | 279 kg |
| **Thrust per engine** | 81 N | 285 N | 283 N | 580 N | about 445 N (four engines) |
| **Acceleration**, both engines | 6.3 m/s² | 5.3 m/s² | 7.2 m/s² | 12.8 m/s² | 6.4 m/s² (all four) |
| **Turn**, one engine for 0.5 s | 1.30 rad/s | 1.32 rad/s | 2.59 rad/s | 4.67 rad/s | 0.60 rad/s (one side: two engines) |
| Engines from the middle | 1.0 m | 1.0 m | 1.45 m | 1.45 m | 7.0 m front, 5.5 m rear |
| Wing span | 3.0 m | 3.0 m | 3.9 m | 3.9 m | none; outriggers about 15 m across |
| Gas flow per engine | 0.5 kg/s | 1.5 kg/s | 1.5 kg/s | 6 kg/s | 2.75 kg/s |
| Exhaust parcel | 1 g | 1 g | 1 g | 4 g | 12 g (fewer parcels: faster to simulate) |
| Mixture, H₂ : O₂ by mass | 1 : 8 | 1 : 8 | 1 : 8 | 1 : 47 (lean) | 1 : 8 |
| Exhaust speed | 172 m/s | 181 m/s | 197 m/s | 99 m/s | 160 m/s |
| Exhaust temperature | about 1,600 K (glows) | about 1,600 K | about 1,600 K | about 580 K (grey, below the 800 K glow) | about 1,600 K |
| Propellant | 8.1 kg | 8.1 kg | 8.1 kg | 8.1 kg | 27 kg in two tanks |
| Fuel economy (FLT-010 cheat) | 1× | 20× | 20× | 80× | 20× |
| Full-thrust burn time | about 8 s | about 54 s | about 54 s | about 54 s | about 49 s |
| Welds (tension / torque) | 10⁶ N / 10⁶ N·m: unbreakable | 5,000 N / 2,000 N·m | 5,000 N / 2,000 N·m | 10,000 N / 4,000 N·m | 40,000 N / 16,000–48,000 N·m |
| Parts can be damaged | no | yes (hull, tank materials) | yes | yes | yes |
| Gun | none | gas cannon, 2 kg shells, 0.1 kg charge, about 44 m/s, 30 shells, 1 s reload | gas cannon, as GS, 15 shells | railgun, 1 kg explosive shells at 96 m/s, 40 shells, 0.25 s reload | railgun, 0.5 kg explosive shells at 96 m/s, 40 shells, 0.25 s reload |
| Tractor and tether | no | no | no (yes in TRC) | yes: 30° beam, 50 m, 400 N; 15 m tether between centres of mass | yes: separate projector and tether generator; 25 m tether, 1,600 N beam |

Gravity where each flies: LAND 1.6 m/s²; the home base about 1.9 m/s² at its surface; none in
open space. Under its own gravity the lander's thrust is about 3.9 times its weight; Gunship 3's
about 6.7 times at the base.

## Handling notes

- **The lander handles best** (owner's view, November 2026). It accelerates moderately and turns
  gently: one engine gives 1.3 rad/s after half a second.
- **The original Gunship turns just like the lander** (1.32 rad/s): the same 1 m engine spacing,
  and its extra mass and inertia balance its stronger engines. It accelerates more slowly (5.3 m/s²).
- **Gunship 2 moved the engines out to 1.45 m and lost 30 kg:** it turns twice as fast as the
  lander (2.6 rad/s). It was found hard to fly.
- **Gunship 3 doubled the thrust** (four times the mass flow at half the exhaust speed) on Gunship
  2's layout: it turns 3.6 times as fast as the lander and accelerates twice as hard. Still hard to
  fly; kept as is for now.

- **The Mammoth is four times as long** as the lander, with four lander-type engines two a side.
  It pushes like the lander, but turns about half as fast: a ship twice the size, at the same
  acceleration, turns about half as fast unless its engines move further out. Start turns early.
  It flies on with one engine out, or one each side, at half thrust.

## Ideas kept for later

- **A gunship with the lander's handling:** keep Gunship 3's gun, tractor and armour, but
  - cut each engine's flow so it accelerates at about 6.3 m/s² (about 290 N an engine, as Gunship 2);
  - move the engines back in to 1 m from the middle, so one engine turns it at about 1.3 rad/s.
  - Optionally the lander's mixture too, for its faster, lighter, glowing exhaust (that undoes
    Gunship 3's heavier, slower exhaust).
- **Mammoth turning:** to match the lander's 1.3 rad/s it would need its engines about 10 m out,
  or small steering thrusters (or a reaction wheel) run from the battery.
- **The gas cannon** (Gunship and Gunship 2) is kept for when the physics cannon comes back. On
  Gunship 3 it froze the step when fired while thrusting (the shell slid back onto the breech and
  crushed its propellant); the railgun replaced it (spec WPN-008).
