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

## Next flight trials (to agree)

Increasingly complex ships, flown by hand with what exists. For example: a ship with a payload pod; a four-engine cross for turning both ways; flying a course of fixed markers; and, with gravity on, hovering and landing on a fixed pad.

## UXV-003 (owner review)

1. Open RS-16 and watch the turn, with Joint load on.
2. Build W9's twin-engine ship from an empty world and fly it: Q and E together to climb, one of them to turn.
