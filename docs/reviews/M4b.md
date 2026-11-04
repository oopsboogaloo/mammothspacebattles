# M4b review record

Milestone M4b, flight trials: ships of increasing complexity, built from the M4 parts and flown by hand. This first step is a twin-engine ship steered only by throttling one engine more than the other. There is still no attitude-control component.

## Exit criteria (§12)

| Criterion | Status | Evidence |
|---|---|---|
| RS-16 passes | ✅ | `scenarios/rs16-twin-engine.json`: both engines for 1 s, then the left only for 0.5 s, then 1 s coasting. |
| W9 E2E passes | ✅ | `e2e/propulsion.spec.ts`. From an empty world: hull, tank, wing, two engines, two feeds, a control link and key per engine (Q and E), follow, fly. 28 actions (budget 28). The ship climbs on both keys and turns right on Q alone. |

All M4b must-have requirements are traced (`pnpm req:check` with `--milestone M4b`).

## Measured (RS-16)

| Check | Result | Test |
|---|---|---|
| Both engines (0–1 s) | Climbs to 5.3 m/s; sideways drift under 10% of that; spin never above 0.05 rad/s (assertion allows 0.3) | `FLT-001` |
| Left engine only (1–1.5 s) | Spins to −1.06 rad/s (clockwise: the nose turns toward the idle right engine) | `FLT-002` |
| Coasting (1.5–2.5 s) | Ship + gas + gone angular momentum constant to 10⁻⁶; spin changes by 0.002 rad/s as gas left in the chambers sloshes | `FLT-003` |
| Weld compression | Equal throttle: left 20.8 N, right 21.0 N. Left only: 24.7 N against 5.1 N. Coasting: 0 | `FLT-004` |
| Conservation | Momentum residual 2×10⁻¹³; energy residual 3×10⁻⁵ J; no violations | scenario assertions |
| Speed | 6.9 ms per step (two engines) against 4.2 ms for real time | — |

## Design notes

- **Steering is only throttling.** Each engine's injector has its own channel (`left`/`right` in RS-16; `main`, `main-2`, … when built in the sandbox), so each can have its own key. The torque is gas on the firing engine's walls, a lever arm of 1 m from the centre of mass. Nothing turns the ship while it coasts.
- **Ports along long faces (SBX-024).** Faces now have a port at the centre and every metre out to 0.25 m from the corners: a 3 m wing has three ports underneath. When a part could join by several ports on the same face, it uses the one nearest its centre, so a wing hangs centred under a tank.
- **New engines get a free channel (SBX-025).** That's `main`, then `main-2`, and so on. A body's Links section offers its injector's channel when you add a control link.
- **Intermediate milestones.** `scripts/req-trace.ts` reads `M4b` as coming after M4 and before M5.

## Known limits

- **The jet noise from M4 is still there.** With two engines it is smaller relative to the thrust, but nothing damps it. There is no stability assist yet.
- **Keys are on/off.** There is no throttle ramp, so turning is in bursts.
- **Speed:** a second engine costs about 40% more per step (6.9 against 5.0 ms), so this runs at about 0.6× real time headless.

## Phones and tablets (SBX-047)

Building and flying now works by touch alone:
- **Below 900 px:** the world fills the top, with the parts palette as a horizontal strip and the tools as a strip beneath it. The inspector and graphs open as sheets from the bottom bar, which also has **Follow**.
- **Flight buttons:** every control channel that reaches a component gets a hold-to-fire button on the view. Each button tracks its own pointer, so two thumbs can hold two engines at once. A bound key's letter shows on its button, and keys still work.
- **Below 900 px** the inline graphs were already hidden (SBX-045), so their series chips and time-window buttons are hidden too; the Graphs sheet has all of them. **Phones (≤ 600 px)** also lose the status hint, and get a smaller hint card and gas scale, so the world keeps its room.
- **A hold ends** when its finger lifts anywhere, even off the button, and when its control link is removed. Flight-button pointers never reach the world's gestures, the buttons wrap into more columns rather than run off the view, and Fit turns Follow off.
- **Follow sticks to its body.** It keeps the body it was turned on for, so tapping empty space or another part doesn't lose the ship, and a press has to move 8 px before it counts as a pan (which stops following). A tap's wobble used to stop it.
- **Tests** (`e2e/touch.spec.ts`): W3 and W9 at 390 px and 820 px (tap to build; hold one button, or both and then release one to turn), plus the release and many-buttons cases. Playwright can't hold real multi-touch, so holds are touch-type pointer events, which is what the app reads. The SBX-045 test now checks the tools are a strip under the world.

## Landing challenge (RS-17, FLT-005…FLT-009)

`scenarios/land-twin-engine.json`, **LAND** in the picker. The twin-engine ship starts 13.7 m above the pad and 22 m short of it, drifting toward it at 1.2 m/s. Gravity is 1.6 m/s², and the ship carries 8.1 kg of propellant. To land, touch the pad slower than 1.5 m/s and come to rest within 12° of upright. Touching the terrain anywhere else, or the pad too fast, is a crash. The verdict pauses the run and says why. **Try again** reopens the scenario fresh, without replaying the last attempt's key presses.

| Check | Result | Test |
|---|---|---|
| A free fall drifts onto the slope short of the pad | Crashed: "Touched the ground off the pad, at 6.4 m/s." No ledger violations for 1.5 s after the impact | `FLT-006` |
| A free fall straight down onto the pad | Crashed: "Hit the pad at … m/s: land slower than 1.5 m/s." | `FLT-006` |
| A descent from 1.5 m, flown by a test autopilot | Landed at 0.6 m/s, 6° from upright, score 730, no violations. The autopilot holds about 0.5 m/s down with both engines, corrects tilt with one, and cuts both just above the pad | `FLT-007` |
| A tall box coming to rest on its side | Crashed: "Came to rest tilted 90°: land within 12° of upright." | `FLT-008` |
| The verdict | Part of the world state: the same run reaches it at the same step, and it stays | `FLT-005` |
| On screen | Height above pad, down and sideways speed, tilt, fuel %. Values outside the limits show in yellow with ▲. Verdict card with the reason, score and Try again. Desktop and 390 px | `e2e/landing.spec.ts` |

**Flying it.** At full throttle on both engines the ship climbs at about 2.5 m/s² against gravity, so you hover by pulsing. The jets wobble, so the ship tilts on its own: correct it with one engine (Q alone turns the nose right). While the engines fire close to the pad, their exhaust pushes back off it (ground effect). After you cut them, the exhaust spreads out of the plane within about 0.4 s, so a cushion no longer holds a landed ship up. On phones the two flight buttons sit at the bottom corners, under each thumb.

### Physics fixed on the way

- **The ledger with gravity on.** Feed links move propellant from the tank down to the engines. That changes potential energy (the pump's work), but it wasn't recorded, so every step with gravity showed an energy residual of about 14 mJ. It is now recorded as a transfer, as is the outlet height for injectors.
- **A ground and the gas.** Each step, the gas put every body into every grid cell under its bounding circle. An 80 m ground filled about 145,000 cells, so a step took about 1 s; it now takes about 15–19 ms with the engines firing near the ground. Only cells near gas are filled now, and a body that would still fill very many is tested against every parcel. Before, a body bigger than the cap was left out entirely, so gas passed through it. The far field now ignores fixed bodies, so exhaust that spreads along the ground away from the ship leaves.
- **Welds no longer warm start.** Reapplying last step's weld impulses after the load had changed made the velocity solve create energy. After a landing it pushed the ship back up off the pad, and a 6 m/s crash gained up to 19 J in a step, all reported by the ledger. Weld loads come from each step's own impulse, so every joint-break test passes unchanged. Contacts still warm start, which stacks need (RS-04).

### The exhaust cushion (GAS-009, FLT-007)

You noticed that after landing, the ship floated on its own exhaust and the landing never finished. The cause was the 2D world, not cold gas: the gas trapped under the ship was about 2,800 K. A 2D world is a slab that never thins, so exhaust caught in a pocket under the wing, between the legs and the pad, stayed there. In 3D the pocket is open at the front and back. Measured 0.35–0.75 s after a cutoff 0.6 m above the pad, the gas still pushed with 3.4 N, 8% of the ship's weight. It bobbed for well over a second and kept resetting the rest timer.

- **Gas out of the plane:** LAND's world has a depth of 2 m. Exhaust older than 0.1 s, outside the engines' interiors, leaves the plane at its own sound speed over that depth, as a cloud in vacuum would, whole parcel by whole parcel. The ledger records what leaves at the boundary. Over the same window, the push is now under 3% of the weight (`GAS-009` tests). The chamber and nozzle are declared closed (`injector.chamber`). Thrust in open space is about 3% lower (the mean of four slightly offset 0.5 s climbs; a single run varies by 1–2%), because exhaust just past the nozzle exit thins.
- **First version, thinning parcels, replaced:** parcels lost mass gradually instead. Light parcels next to full ones were flung fast and ran out of thermal energy, forcing up to 20 halvings of a substep. That made firing near the ground slower than with no depth at all, and in one run about 390,000 clamps in a single step created 3 mJ that the ledger reported. Whole-parcel removal fixes both: no parcel is ever lighter than its neighbours.
- **Settling:** "Landed" now needs under 0.3 m/s and 0.3 rad/s for 0.5 s, and a bounce off the pad shorter than 0.1 s doesn't restart the count. A 3 m autopilot descent is now called about 0.9 s sooner. It touches down faster than before (1.1 m/s, score 483) because nothing cushions the last drop.

### Known limits

- **Slow motion while firing:** real time needs about 4.2 ms a step. Measured headless on the current container, engines on full:
  - 20 m above the pad: 14 ms a step.
  - 2 m above: 22 ms, with about 140 parcels. Without the out-of-plane gas this was 46 ms and about 400 parcels.
  - The sandbox shows the achieved speed.
- **Keys are still on/off**, so hovering takes pulsing.
- **One pad, one terrain.** No level choice or score table yet.

## Flight test among asteroids (RS-18, FLT-010…FLT-013)

`scenarios/ft-asteroids.json`, **FT** in the picker. It flies the LAND ship, with the same parts, weight, legs and 8.1 kg tank, in a 240 × 160 m arena that wraps round, among eight irregular asteroids. The rocks are 2.3–8.6 t, convex with 8–11 corners, drift at 0.1–0.3 m/s and spin at 0.02–0.08 rad/s. Each pulls with its own gravity, 0.5–1.2 m/s² at its surface, and they bounce you (restitution 0.4). Nothing ends the run. The camera follows the ship, and the view draws the arena's neighbouring copies, so crossing an edge shows no seam except a faint dashed line.

| Check | Result | Test |
|---|---|---|
| Fuel economy 20 | A 1 s full burn makes about 1 kg of exhaust from about 50 g of propellant. The ledger's `supply` source records the other 95% and finds no violations | `FLT-010 FLT-013` |
| Thrust | Unchanged: the ship climbs at about 4 m/s² in open space, so the tank lasts about 160 s of full thrust on both engines, against 8 s | `FLT-010` |
| Gravity | Matches mu·r/(r² + core²)^1.5; the source doesn't move; recorded as a field | `FLT-011` |
| Wrap | A welded pair crossing an edge at 20 m/s comes back at the other side with its weld intact. The angular momentum the move changes (D × P) is recorded at the boundary. No violations | `FLT-012` |
| Gravity across the seam | Pulls from the source's nearest copy | `FLT-012` |
| Firing while crossing | Exhaust within 10 m crosses with the ship; sideways drift over a 2 s burn matches a burn away from the edge | headless trial |

Known limits:
- Nothing collides across the seam (see the spec's model notes).
- Asteroids don't pull each other.
- The economy makes mass from nothing, declared in the ledger, never hidden.

## Next flight trials (to agree)

Increasingly complex ships, flown by hand with what exists. For example: a ship with a payload pod; a four-engine cross for turning both ways; flying a course of fixed markers; and, with gravity on, hovering and landing on a fixed pad.

## UXV-003 (owner review)

1. Open RS-16 and watch the turn, with Joint load on.
2. Build W9's twin-engine ship from an empty world and fly it: Q and E together to climb, one of them to turn.
3. Open LAND and land on the pad, on a keyboard and on a phone or tablet. Then crash on purpose and use Try again.
