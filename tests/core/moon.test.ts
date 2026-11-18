// Moon Mammoth's game in the world (docs/games/moon-mammoth.md; src/core/moon.ts) on the test moon
// (scripts/moon.ts): 40 m in radius, smooth, with a ledge at 20 m clockwise from the top, a girder
// at 45 m, a crater with spikes at 80 m, a falling rock at 100 m, and flags at 0, 60 and 120 m.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeTotals, getProfile, hashValue, initialWorld, parseScenario, ScenarioError, stepInPlace, type Command, type World } from "../../src/core/index.ts";
import { inCoreUnits } from "../helpers.ts";

const raw = (name = "moon-test") => inCoreUnits(JSON.parse(readFileSync(new URL(`../../scenarios/${name}.json`, import.meta.url), "utf8")));
const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const R = 40;

function game(edit?: (scn: ReturnType<typeof raw>) => void) {
  const scn = raw();
  edit?.(scn);
  const w = initialWorld(parseScenario(scn));
  const step = (seconds: number, commands: Command[] = []) => {
    const k = Math.round(seconds * 240);
    for (let i = 0; i < k; i++) stepInPlace(w, i === 0 ? commands : [], sandbox);
  };
  return { w, step };
}
const mam = (w: World) => w.bodies.find((b) => b.id === "mammoth")!;
const st = (w: World) => w.moon!.state;
const spec = (w: World) => w.moon!.spec;
/** How far round the moon it is, m clockwise from the top; its height over the smooth surface; and its speed round and up. */
const along = (w: World) => R * Math.atan2(mam(w).position.x, mam(w).position.y);
const alt = (w: World) => Math.hypot(mam(w).position.x, mam(w).position.y) - R;
const upOf = (w: World) => {
  const p = mam(w).position;
  const n = Math.hypot(p.x, p.y);
  return { x: p.x / n, y: p.y / n };
};
const vRound = (w: World) => mam(w).velocity.x * upOf(w).y - mam(w).velocity.y * upOf(w).x;
const vUp = (w: World) => mam(w).velocity.x * upOf(w).x + mam(w).velocity.y * upOf(w).y;
/** Puts the mammoth standing at s m round, at rest. */
function place(w: World, s: number, above = 1.02): void {
  const m = mam(w);
  m.position = { x: (R + above) * Math.sin(s / R), y: (R + above) * Math.cos(s / R) };
  m.velocity = { x: 0, y: 0 };
  w.contacts = w.contacts.filter((c) => c.a !== m.id && c.b !== m.id);
  w.ledger.totals = computeTotals(w);
}

describe("Moon Mammoth: the mammoth and the moon", () => {
  it("MMN-002 the mammoth is one free disc, and rests on the rock without bouncing or sinking", () => {
    const { w, step } = game();
    expect(mam(w).shape).toEqual({ kind: "disc", radius: 1 });
    step(1);
    expect(alt(w)).toBeGreaterThan(0.98);
    expect(alt(w)).toBeLessThan(1.02);
    expect(Math.hypot(mam(w).velocity.x, mam(w).velocity.y)).toBeLessThan(0.01);
    expect(st(w).grounded).toBe(true);
  });

  it("MMN-002 TER-009 a long fall ends on the ground, with no bounce", () => {
    const { w, step } = game();
    place(w, -30, 16);
    step(0.8);
    expect(alt(w)).toBeGreaterThan(0.95);
    expect(alt(w)).toBeLessThan(1.05);
    expect(Math.abs(vUp(w))).toBeLessThan(0.5);
  });

  it("MMN-003 gravity is toward the centre everywhere: it runs the whole way round, either way", () => {
    for (const way of ["left", "right"]) {
      const { w, step } = game((scn) => {
        // A bare moon: nothing in the way.
        scn.world.bodies = scn.world.bodies.filter((b: { id: string }) => b.id === "mammoth" || b.id === "moon-core");
        scn.world.terrain.islands = [Array.from({ length: 160 }, (_, k) => ({ x: R * Math.cos((2 * Math.PI * k) / 160), y: R * Math.sin((2 * Math.PI * k) / 160) }))];
        scn.world.moon.flags = [scn.world.moon.flags[0], { at: { x: 0, y: -500 }, time: 1000 }];
        delete scn.world.moon.rocks;
      });
      place(w, 30 * (way === "left" ? 1 : -1));
      step(0.2);
      let turned = 0;
      let last = along(w);
      step(0.01, [set(way, 1)]);
      for (let i = 0; i < 70; i++) {
        step(0.2);
        let d = along(w) - last;
        if (d > Math.PI * R) d -= 2 * Math.PI * R;
        if (d < -Math.PI * R) d += 2 * Math.PI * R;
        turned += d;
        last = along(w);
        expect(alt(w)).toBeLessThan(4.5);
      }
      // 14 s at 18 m/s: one lap (251 m).
      expect(Math.abs(turned)).toBeGreaterThan(240);
      expect(Math.sign(turned)).toBe(way === "right" ? 1 : -1);
    }
  });
});

describe("Moon Mammoth: run and turn", () => {
  it("MMN-010 held right, it reaches the run speed and no more; let go, it stops", () => {
    const { w, step } = game();
    step(0.2);
    step(0.05, [set("right", 1)]);
    expect(vRound(w)).toBeGreaterThan(5);
    step(0.3);
    expect(vRound(w)).toBeGreaterThan(17.5);
    expect(vRound(w)).toBeLessThan(18.5);
    expect(st(w).action).toBe("walk");
    step(0.3, [set("right", 0)]);
    expect(Math.abs(vRound(w))).toBeLessThan(0.1);
    expect(st(w).action).toBe("idle");
  });

  it("MMN-011 it doesn't climb an upright face: the ledge stops it until it jumps", () => {
    const { w, step } = game();
    step(0.1);
    step(2, [set("right", 1)]);
    expect(along(w)).toBeLessThan(19.2);
    expect(alt(w)).toBeLessThan(1.1);
    step(0.4, [set("jump", 1)]);
    step(0.25);
    // On the ledge, 2.5 m up.
    expect(along(w)).toBeGreaterThan(21);
    expect(alt(w)).toBeGreaterThan(3.4);
    expect(st(w).grounded).toBe(true);
  });

  it("MMN-012 reversing on the ground changes the way it faces and shows the turn", () => {
    const { w, step } = game();
    step(0.1);
    step(0.3, [set("right", 1)]);
    expect(st(w).facing).toBe(1);
    step(0.02, [set("right", 0), set("left", 1)]);
    expect(st(w).facing).toBe(-1);
    expect(st(w).action).toBe("turn");
    step(0.5);
    expect(vRound(w)).toBeLessThan(-17.5);
    expect(st(w).action).toBe("walk");
  });
});

describe("Moon Mammoth: jump", () => {
  /** The highest it gets in a jump with the button held for `hold` s. */
  const peak = (hold: number) => {
    const { w, step } = game();
    place(w, -30);
    step(0.2);
    let top = 0;
    step(1 / 240, [set("jump", 1)]);
    for (let i = 1; i < 240; i++) {
      step(1 / 240, i === Math.round(hold * 240) ? [set("jump", 0)] : []);
      top = Math.max(top, alt(w) - 1);
    }
    return { top, w };
  };

  it("MMN-020 from the ground it leaves at the jump speed, straight up; not from the air", () => {
    const { w, step } = game();
    place(w, -30);
    step(0.2);
    step(2 / 240, [set("jump", 1)]);
    expect(vUp(w)).toBeGreaterThan(25);
    expect(Math.abs(vRound(w))).toBeLessThan(0.1);
    step(0.1, [set("jump", 0)]);
    const before = vUp(w);
    step(2 / 240, [set("jump", 1)]);
    expect(vUp(w)).toBeLessThan(before);
    expect(st(w).action).toBe("jump");
  });

  it("MMN-020 held, the jump is about 3.5 m high", () => {
    const { top, w } = peak(1);
    // 3.5 m under the surface's gravity; a little more, as the pull falls off with height.
    expect(top).toBeGreaterThan(3.4);
    expect(top).toBeLessThan(4.1);
    expect(st(w).grounded).toBe(true);
  });

  it("MMN-021 let go while rising, the jump is cut short", () => {
    const { top } = peak(0.03);
    expect(top).toBeGreaterThan(1);
    expect(top).toBeLessThan(2.2);
  });

  it("MMN-022 a jump pressed just before landing is made on landing", () => {
    const { w, step } = game();
    place(w, -30, 1.6);
    // It lands after about 0.11 s: pressed at 0.08 s, still in the air.
    step(0.08);
    expect(st(w).grounded).toBe(false);
    step(0.1, [set("jump", 1)]);
    expect(vUp(w)).toBeGreaterThan(10);
  });

  it("MMN-022 a jump pressed just after running off an edge is made", () => {
    const { w, step } = game();
    // On the ledge (20 to 28 m), running right, off its end.
    place(w, 24, 3.52);
    step(0.1);
    step(0.01, [set("right", 1)]);
    while (along(w) < 28.2) step(1 / 240);
    step(0.02);
    expect(alt(w)).toBeLessThan(3.5);
    step(2 / 240, [set("jump", 1)]);
    expect(vUp(w)).toBeGreaterThan(25);
  });

  it("MMN-023 in the air it steers, more slowly than on the ground", () => {
    const { w, step } = game();
    place(w, -30);
    step(0.2);
    step(2 / 240, [set("jump", 1)]);
    step(0.1, [set("right", 1)]);
    expect(vRound(w)).toBeGreaterThan(5);
    expect(vRound(w)).toBeLessThan(9);
  });
});

describe("Moon Mammoth: roll", () => {
  it("MMN-030 on the ground, a burst at the roll speed the way it faces, for the roll's time, unsteered", () => {
    const { w, step } = game();
    place(w, -60);
    step(0.2);
    step(0.1, [set("roll", 1)]);
    expect(st(w).action).toBe("roll");
    expect(vRound(w)).toBeGreaterThan(31);
    // Steering against it does nothing while it lasts.
    step(0.1, [set("left", 1)]);
    expect(vRound(w)).toBeGreaterThan(31);
    expect(st(w).facing).toBe(1);
    step(0.4);
    expect(st(w).action).not.toBe("roll");
    expect(vRound(w)).toBeLessThan(0);
  });

  it("MMN-030 not from the air", () => {
    const { w, step } = game();
    place(w, -60, 6);
    step(0.05, [set("roll", 1)]);
    expect(st(w).action).not.toBe("roll");
  });

  it("MMN-031 it can't roll again until the wait has passed", () => {
    const { w, step } = game();
    place(w, -60);
    step(0.2);
    step(0.31, [set("roll", 1)]);
    step(0.01, [set("roll", 0)]);
    step(0.1, [set("roll", 1)]);
    expect(st(w).action).not.toBe("roll");
    step(0.5, [set("roll", 0)]);
    step(0.05, [set("roll", 1)]);
    expect(st(w).action).toBe("roll");
  });

  it("MMN-032 a jump during a roll keeps the roll's speed", () => {
    const { w, step } = game();
    place(w, -60);
    step(0.2);
    step(0.05, [set("roll", 1)]);
    step(0.3, [set("jump", 1)]);
    expect(st(w).grounded).toBe(false);
    // More than a run's 18 m/s; less than the roll's 32 only by the moon's curve under its flight.
    expect(vRound(w)).toBeGreaterThan(27);
  });
});

describe("Moon Mammoth: duck and slide", () => {
  it("MMN-040 ducked, the disc is its ducked size and stays on the ground; still, it sits", () => {
    const { w, step } = game();
    step(0.2);
    step(0.3, [set("duck", 1)]);
    expect(mam(w).shape).toEqual({ kind: "disc", radius: 0.6 });
    expect(alt(w)).toBeGreaterThan(0.58);
    expect(alt(w)).toBeLessThan(0.62);
    expect(st(w).action).toBe("sit");
    step(0.3, [set("duck", 0)]);
    expect(mam(w).shape).toEqual({ kind: "disc", radius: 1 });
    expect(alt(w)).toBeGreaterThan(0.98);
  });

  it("MMN-041 ducked while running, it slides on and slows at the slide's rate", () => {
    const { w, step } = game();
    place(w, -60);
    step(0.1);
    step(0.4, [set("right", 1)]);
    const from = along(w);
    step(0.25, [set("right", 0), set("duck", 1)]);
    expect(st(w).action).toBe("slide");
    // 16 m/s² for 0.25 s off 18 m/s is 14 m/s; the joins in the rock take a little more.
    expect(vRound(w)).toBeGreaterThan(12.5);
    expect(vRound(w)).toBeLessThan(14.5);
    step(1.2);
    expect(Math.abs(vRound(w))).toBeLessThan(0.1);
    expect(along(w) - from).toBeGreaterThan(9);
    expect(st(w).action).toBe("sit");
  });

  it("MMN-042 it passes under the girder only ducked", () => {
    const standing = game();
    standing.step(0.1);
    place(standing.w, 34);
    standing.step(2, [set("right", 1)]);
    expect(along(standing.w)).toBeLessThan(42.5);

    const sliding = game();
    place(sliding.w, 34);
    sliding.step(0.1);
    sliding.step(0.3, [set("right", 1)]);
    sliding.step(1.5, [set("duck", 1)]);
    expect(along(sliding.w)).toBeGreaterThan(48.5);
  });

  it("MMN-043 it doesn't stand up under the girder, whatever the button", () => {
    const { w, step } = game();
    place(w, 34);
    step(0.1);
    step(0.3, [set("right", 1)]);
    step(0.01, [set("duck", 1)]);
    while (along(w) < 44.5) step(1 / 240);
    step(0.3, [set("duck", 0), set("right", 0)]);
    expect(st(w).ducked).toBe(true);
    expect(mam(w).shape).toEqual({ kind: "disc", radius: 0.6 });
    // Held right, it creeps out and then stands.
    step(1.5, [set("right", 1)]);
    expect(along(w)).toBeGreaterThan(49);
    expect(st(w).ducked).toBe(false);
  });
});

describe("Moon Mammoth: flags, the timer and the hazards", () => {
  it("MMN-056 the clocks start at the first move", () => {
    const { w, step } = game();
    step(1);
    expect(st(w).phase).toBe("waiting");
    expect(st(w).elapsed).toBe(0);
    expect(st(w).left).toBe(8);
    step(0.5, [set("left", 1)]);
    expect(st(w).phase).toBe("running");
    expect(st(w).left).toBeCloseTo(7.5, 1);
    expect(st(w).elapsed).toBeCloseTo(0.5, 1);
  });

  it("MMN-050 reaching the next flag sets the timer to the next leg's time; a later flag first doesn't count", () => {
    const { w, step } = game((scn) => (scn.world.moon.flags[2].time = 5));
    place(w, 120);
    step(0.3, [set("right", 1)]);
    expect(st(w).flag).toBe(0);
    place(w, 58);
    step(0.3);
    expect(st(w).flag).toBe(1);
    expect(st(w).left).toBeGreaterThan(4.7);
    expect(st(w).left).toBeLessThanOrEqual(5);
    expect(w.events.some((e) => e.type === "moon.flag")).toBe(true);
  });

  it("MMN-051 out of time, it is back at the last flag reached, at rest, with the leg's full time", () => {
    const { w, step } = game((scn) => (scn.world.moon.flags[1].time = 1));
    step(0.1);
    step(0.9, [set("left", 1)]);
    expect(along(w)).toBeLessThan(-10);
    step(0.2);
    expect(st(w).tries).toBe(1);
    expect(st(w).back?.why).toBe("time");
    expect(st(w).left).toBeGreaterThan(0.85);
    expect(Math.abs(along(w))).toBeLessThan(3);
    step(0.5, [set("left", 0)]);
    expect(st(w).phase).toBe("running");
  });

  it("MMN-052 touching the spikes sends it back to the last flag", () => {
    const { w, step } = game();
    place(w, 58);
    step(0.3, [set("right", 1)]);
    expect(st(w).flag).toBe(1);
    step(2);
    expect(st(w).tries).toBeGreaterThanOrEqual(1);
    expect(st(w).back?.why).toBe("spikes");
    expect(st(w).flag).toBe(1);
    expect(w.ledger.violations).toBe(0);
  });

  it("MMN-052 a running jump from the crater's slope clears the spikes", () => {
    const { w, step } = game();
    place(w, 58);
    step(0.1);
    step(0.01, [set("right", 1)]);
    // From the crater's rim (it is 73 to 87 m; the spikes 78 to 82 m).
    while (along(w) < 72.5) step(1 / 240);
    step(0.3, [set("jump", 1)]);
    step(1);
    expect(st(w).tries).toBe(0);
    expect(along(w)).toBeGreaterThan(90);
  });

  it("MMN-053 MMN-054 a rock falls when the mammoth comes near, sends it back if it lands on it, and is put back", () => {
    const { w, step } = game();
    const rock = () => w.bodies.find((b) => b.id.startsWith("fall-"))!;
    const home = { ...rock().position };
    expect(rock().fixed).toBe(true);
    // Under where it will land, standing still.
    place(w, 100);
    step(0.02, [set("jump", 1)]);
    expect(rock().fixed).toBe(false);
    step(1, [set("jump", 0)]);
    expect(st(w).back?.why).toBe("rock");
    expect(st(w).tries).toBe(1);
    expect(rock().fixed).toBe(true);
    expect(rock().position).toEqual(home);
    expect(w.ledger.violations).toBe(0);
  });

  it("MMN-053 a roll gets out from under it; at rest the rock is only in the way", () => {
    const { w, step } = game();
    const rock = () => w.bodies.find((b) => b.id.startsWith("fall-"))!;
    place(w, 84);
    step(0.1);
    step(0.01, [set("right", 1)]);
    while (rock().fixed) step(1 / 240);
    step(0.7, [set("roll", 1)]);
    expect(st(w).tries).toBe(0);
    expect(along(w)).toBeGreaterThan(102);
    // The rock has landed behind it. Walking back into it does no harm.
    step(1, [set("right", 0), set("roll", 0)]);
    step(1.5, [set("left", 1)]);
    expect(st(w).tries).toBe(0);
    expect(along(w)).toBeGreaterThan(100);
  });

  it("MMN-053 at a run, with no roll, the rock lands on it", () => {
    const { w, step } = game();
    place(w, 84);
    step(0.1);
    step(1.2, [set("right", 1)]);
    expect(st(w).back?.why).toBe("rock");
  });

  it("MMN-055 the last flag ends the run", () => {
    const { w, step } = game();
    place(w, 58);
    step(0.2, [set("right", 1)]);
    place(w, 118);
    step(0.2);
    expect(st(w).phase).toBe("won");
    expect(w.events.some((e) => e.type === "moon.won")).toBe(true);
    const t = st(w).elapsed;
    // The clocks stop, and so does the mammoth, whatever is held.
    step(0.5);
    expect(st(w).elapsed).toBe(t);
    expect(Math.abs(vRound(w))).toBeLessThan(0.1);
  });
});

describe("Moon Mammoth: the engine's rules", () => {
  const play = (w: World, step: (s: number, c?: Command[]) => void) => {
    step(0.1);
    step(0.9, [set("right", 1)]);
    step(0.5, [set("jump", 1)]);
    step(0.5, [set("jump", 0), set("roll", 1)]);
    step(0.6, [set("roll", 0), set("duck", 1)]);
    step(1, [set("duck", 0)]);
    step(1, [set("right", 0), set("left", 1)]);
    return hashValue(w);
  };

  it("MMN-080 a run and its replay from the same inputs agree exactly", () => {
    const a = game();
    const b = game();
    expect(play(a.w, a.step)).toBe(play(b.w, b.step));
  });

  it("MMN-081 its moves break none of the conservation checks: what its legs add is recorded as power", () => {
    const { w, step } = game();
    play(w, step);
    expect(w.ledger.violations).toBe(0);
    expect(w.events.filter((e) => e.type === "violation")).toEqual([]);
    step(0.1, [set("left", 0), set("right", 1)]);
    expect(Math.abs(w.ledger.last!.sources.power.energy)).toBeGreaterThan(0);
  });

  it("level 1 is a world, with a flag for every leg and rock that doesn't bounce", () => {
    const w = initialWorld(parseScenario(raw("moon-1")));
    expect(spec(w).flags.length).toBe(7);
    expect(w.bodies.filter((b) => b.id.startsWith("rock-")).every((b) => b.restitution === 0)).toBe(true);
    expect(w.bodies.some((b) => b.id.startsWith("spike-"))).toBe(true);
    expect(w.bodies.some((b) => b.id.startsWith("girder-"))).toBe(true);
    expect(spec(w).rocks?.length).toBe(3);
  });

  it("level 1 can be run: a simple player (jump at a crater's rim or when stopped, duck at a girder, roll when a rock falls) finishes the lap inside every leg's time", () => {
    const w = initialWorld(parseScenario(raw("moon-1")));
    const C = 2 * Math.PI * 80;
    const sOf = (q: { x: number; y: number }) => {
      const a = 80 * Math.atan2(q.x, q.y);
      return a < -1 ? a + C : a;
    };
    const girders = w.bodies.filter((b) => b.id.startsWith("girder-")).map((b) => sOf(b.position));
    // Each crater's spikes, by the crater: where they start and how wide they are.
    const rows = new Map<string, number[]>();
    for (const b of w.bodies.filter((x) => x.id.startsWith("spike-"))) rows.set(b.id.split("-")[1], [...(rows.get(b.id.split("-")[1]) ?? []), sOf(b.position)]);
    const rims = [...rows.values()].map((v) => Math.min(...v) - (5.5 - (Math.max(...v) - Math.min(...v)) / 2));
    const held: Record<string, number> = {};
    let slow = 0;
    let jumpUntil = -100;
    for (let i = 0; i < 240 * 60 && st(w).phase !== "won"; i++) {
      const s = sOf(mam(w).position);
      const out: Command[] = [];
      const hold = (ch: string, on: boolean) => {
        if ((held[ch] ?? 0) !== Number(on)) out.push(set(ch, (held[ch] = Number(on))));
      };
      const duck = girders.some((g) => s > g - 5.5 && s < g + 3.6);
      slow = st(w).grounded && !duck && Math.hypot(mam(w).velocity.x, mam(w).velocity.y) < 6 ? slow + 1 : 0;
      if (st(w).grounded && !duck && i > jumpUntil + 10 && (slow > 6 || rims.some((r) => s > r - 1.2 && s < r + 0.3))) jumpUntil = i + 70;
      hold("right", true);
      hold("duck", duck);
      hold("roll", !duck && w.bodies.some((b) => b.id.startsWith("fall-") && !b.fixed && Math.hypot(b.velocity.x, b.velocity.y) > 1.5));
      hold("jump", i <= jumpUntil);
      stepInPlace(w, out, sandbox);
    }
    expect(st(w).phase).toBe("won");
    expect(st(w).tries).toBe(0);
    // About a minute as the player sees it.
    expect(st(w).elapsed).toBeLessThan(35);
    expect(w.ledger.violations).toBe(0);
  });

  it("the scenario is checked: the mammoth must be a free disc, with at least two flags", () => {
    const bad = raw();
    bad.world.moon.mammoth = "moon-core";
    bad.world.moon.flags = [bad.world.moon.flags[0]];
    expect(() => parseScenario(bad)).toThrow(ScenarioError);
  });
});
