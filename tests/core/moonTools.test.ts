// Moon Mammoth's rifle and grappling hook (docs/games/moon-mammoth.md §11; src/core/moon.ts,
// rope.ts) on the second test moon (scripts/moon.ts): 40 m in radius, smooth, with a block under a
// roof at 20 m clockwise from the top, a pit 14 m wide at 60 m with a beam 8 m over it, and a cliff
// 7 m high from 100 m with a beam over its edge.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeTotals, getProfile, hashValue, initialWorld, moonAim, moonRope, parseScenario, ropeLength, ScenarioError, stepInPlace, type Command, type World } from "../../src/core/index.ts";

const raw = (name = "moon-test-2") => JSON.parse(readFileSync(new URL(`../../scenarios/${name}.json`, import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const R = 40;

function game(name = "moon-test-2") {
  const w = initialWorld(parseScenario(raw(name)));
  const step = (seconds: number, commands: Command[] = []) => {
    const k = Math.round(seconds * 240);
    for (let i = 0; i < k; i++) stepInPlace(w, i === 0 ? commands : [], sandbox);
  };
  return { w, step };
}
const mam = (w: World) => w.bodies.find((b) => b.id === "mammoth")!;
const st = (w: World) => w.moon!.state;
const along = (w: World) => R * Math.atan2(mam(w).position.x, mam(w).position.y);
const alt = (w: World) => Math.hypot(mam(w).position.x, mam(w).position.y) - R;
const frame = (w: World) => {
  const p = mam(w).position;
  const n = Math.hypot(p.x, p.y);
  const up = { x: p.x / n, y: p.y / n };
  return { up, right: { x: up.y, y: -up.x } };
};
const shots = (w: World) => w.bodies.filter((b) => b.id.startsWith("shot-"));
const block = (w: World) => w.bodies.find((b) => b.id.startsWith("block-"));
function place(w: World, s: number, above = 1.02): void {
  const m = mam(w);
  m.position = { x: (R + above) * Math.sin(s / R), y: (R + above) * Math.cos(s / R) };
  m.velocity = { x: 0, y: 0 };
  w.contacts = w.contacts.filter((c) => c.a !== m.id && c.b !== m.id);
  w.ledger.totals = computeTotals(w);
}
/** The aim, in the mammoth's own frame, from it to a body. */
function aimAt(w: World, id: string): number {
  const b = w.bodies.find((x) => x.id === id)!;
  const f = frame(w);
  const d = { x: b.position.x - mam(w).position.x, y: b.position.y - mam(w).position.y };
  return Math.atan2(d.x * f.up.x + d.y * f.up.y, d.x * f.right.x + d.y * f.right.y) + 0.02;
}
const PIT_BEAM = "girder-2";
const CLIFF_BEAM = "girder-4";

describe("Moon Mammoth: aiming", () => {
  it("MMN-100 before the player aims, the tools point a little above the way the mammoth faces", () => {
    const { w, step } = game();
    step(0.1);
    const f = frame(w);
    let a = moonAim(w)!;
    expect(a.angle).toBeCloseTo(0.6, 6);
    expect(a.dir.x * f.right.x + a.dir.y * f.right.y).toBeCloseTo(Math.cos(0.6), 6);
    step(0.1, [set("left", 1)]);
    a = moonAim(w)!;
    expect(a.angle).toBeCloseTo(Math.PI - 0.6, 6);
  });

  it("MMN-100 the aim the player sets is kept, in the mammoth's own frame, whichever way it then faces", () => {
    const { w, step } = game();
    step(0.1, [set("aim", 2)]);
    expect(moonAim(w)!.angle).toBe(2);
    step(0.2, [set("left", 1)]);
    expect(moonAim(w)!.angle).toBe(2);
    const f = frame(w);
    const a = moonAim(w)!;
    expect(a.dir.x * f.up.x + a.dir.y * f.up.y).toBeCloseTo(Math.sin(2), 6);
    expect(a.dir.x * f.right.x + a.dir.y * f.right.y).toBeCloseTo(Math.cos(2), 6);
  });

  it("MMN-101 level 1 has no tools: fire and hook do nothing", () => {
    const { w, step } = game("moon-test");
    step(0.5, [set("fire", 1), set("hook", 1), set("aim", 1)]);
    expect(moonAim(w)).toBeNull();
    expect(shots(w)).toEqual([]);
    expect(w.ropes ?? []).toEqual([]);
  });
});

describe("Moon Mammoth: the rifle", () => {
  it("MMN-110 a shot is a body that leaves along the aim at the rifle's speed; the mammoth recoils with its momentum", () => {
    const { w, step } = game();
    place(w, -30, 12);
    step(0.02, [set("aim", 0)]);
    const before = { ...mam(w).velocity };
    const f = frame(w);
    step(1 / 240, [set("fire", 1)]);
    expect(shots(w).length).toBe(1);
    const s = shots(w)[0];
    expect(s.mass).toBe(1);
    const rel = { x: s.velocity.x - before.x, y: s.velocity.y - before.y };
    expect(rel.x * f.right.x + rel.y * f.right.y).toBeGreaterThan(399);
    // 1 kg at 400 m/s off a 100 kg mammoth: 4 m/s the other way.
    const dv = { x: mam(w).velocity.x - before.x, y: mam(w).velocity.y - before.y };
    expect(dv.x * f.right.x + dv.y * f.right.y).toBeCloseTo(-4, 1);
    expect(w.ledger.violations).toBe(0);
  });

  it("MMN-110 held, it fires again every eighth of a second (a quarter as the player sees it)", () => {
    const { w, step } = game();
    step(0.02, [set("aim", 1.2)]);
    step(0.5, [set("fire", 1)]);
    expect(st(w).shots).toBe(4);
    step(0.5, [set("fire", 0)]);
    expect(st(w).shots).toBe(4);
  });

  it("MMN-111 a shot falls under the moon's gravity, and is gone after its time", () => {
    const { w, step } = game();
    place(w, -30);
    step(0.3);
    step(0.02, [set("aim", 1.2)]);
    step(1 / 240, [set("fire", 1)]);
    step(1 / 240, [set("fire", 0)]);
    const s = () => shots(w)[0];
    // Going up, it slows: the moon's pull is on it like anything else.
    const speed = () => Math.hypot(s().velocity.x, s().velocity.y);
    const from = speed();
    step(0.05);
    expect(speed()).toBeLessThan(from - 1.5);
    expect(speed()).toBeGreaterThan(from - 6);
    step(1);
    expect(shots(w)).toEqual([]);
  });

  it("MMN-112 a shot never strikes the mammoth that fired it, whichever way it is going", () => {
    const { w, step } = game();
    place(w, -30);
    step(0.2);
    // Running right, firing right: it runs into where its shots start.
    step(0.01, [set("aim", 0), set("right", 1)]);
    step(0.6, [set("fire", 1)]);
    expect(w.events.some((e) => e.type === "collision" && [e.data.a, e.data.b].includes("mammoth") && [String(e.data.a), String(e.data.b)].some((id) => id.startsWith("shot-")))).toBe(false);
  });

  it("MMN-113 three shots break the block, by the engine's damage rule, and the way is open", () => {
    const { w, step } = game();
    place(w, 14);
    step(0.3);
    step(0.02, [set("aim", 0.1)]);
    step(0.2, [set("fire", 1)]);
    expect(block(w)!.integrity).toBeLessThan(1);
    expect(block(w)!.integrity).toBeGreaterThan(0);
    step(0.4);
    expect(block(w)).toBeUndefined();
    const hits = w.events.filter((e) => e.type === "damage" && String(e.data.id).startsWith("block-"));
    expect(hits.length).toBe(3);
    // Each hit delivered more than the block's 30 kJ threshold: about half of the shot's 80 kJ.
    for (const h of hits) expect(h.data.energy as number).toBeGreaterThan(30000);
    step(1, [set("fire", 0), set("right", 1)]);
    expect(along(w)).toBeGreaterThan(24);
    expect(w.ledger.violations).toBe(0);
  });

  it("MMN-114 the mammoth running or rolling into the block neither breaks it nor moves it", () => {
    const { w, step } = game();
    const home = { ...block(w)!.position };
    step(0.1);
    step(1.5, [set("right", 1)]);
    step(0.5, [set("roll", 1)]);
    step(0.5, [set("roll", 0)]);
    step(0.5, [set("roll", 1)]);
    expect(block(w)!.integrity).toBe(1);
    // It gives a hand's width to each roll's first blow (3,200 N·s into 4 t), and stands.
    expect(Math.hypot(block(w)!.position.x - home.x, block(w)!.position.y - home.y)).toBeLessThan(0.4);
    expect(along(w)).toBeLessThan(18.5);
  });
});

describe("Moon Mammoth: the hook", () => {
  /** At the pit's near side, the rope on the beam over it. */
  const hooked = () => {
    const g = game();
    place(g.w, 51.5);
    g.step(0.3);
    g.step(0.02, [set("aim", aimAt(g.w, PIT_BEAM))]);
    g.step(0.2, [set("hook", 1)]);
    g.step(0.02, [set("hook", 0)]);
    return g;
  };

  it("MMN-120 the hook is cast along the aim and catches what it hits: a girder, or the rock", () => {
    const { w } = hooked();
    const r = moonRope(w)!;
    expect(r.mode).toBe("held");
    expect(r.anchor!.body).toBe(PIT_BEAM);
    expect(ropeLength(r)).toBeGreaterThan(10);
    expect(ropeLength(r)).toBeLessThan(12.5);

    const g = game();
    place(g.w, -30);
    g.step(0.3);
    // Down and ahead: into the ground.
    g.step(0.02, [set("aim", -0.5)]);
    g.step(0.2, [set("hook", 1)]);
    expect(moonRope(g.w)!.mode).toBe("held");
    expect(moonRope(g.w)!.anchor!.body.startsWith("rock-")).toBe(true);
  });

  it("MMN-121 cast at nothing within its reach, it comes back", () => {
    const { w, step } = game();
    place(w, -30);
    step(0.3);
    step(0.02, [set("aim", 1.5)]);
    step(0.15, [set("hook", 1)]);
    expect(moonRope(w)!.mode).toBe("back");
    step(0.3);
    expect(moonRope(w)).toBeUndefined();
  });

  it("MMN-122 MMN-124 running off the pit's edge on the rope it swings; let go on the way up, it flies to the far side", () => {
    const { w, step } = hooked();
    step(0.55, [set("right", 1), set("up", 1)]);
    // Out over the pit (53 to 67 m), below its edges at the bottom of the swing, and held.
    expect(along(w)).toBeGreaterThan(60);
    expect(moonRope(w)!.mode).toBe("held");
    step(0.05, [set("jump", 1), set("up", 0)]);
    expect(moonRope(w)?.mode ?? "back").toBe("back");
    step(1.2, [set("jump", 0)]);
    expect(along(w)).toBeGreaterThan(70);
    expect(st(w).tries).toBe(0);
    expect(st(w).grounded).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("MMN-122 without the rope the pit can't be crossed: a running jump lands on its spikes", () => {
    const { w, step } = game();
    place(w, 46);
    step(0.1);
    step(0.01, [set("right", 1)]);
    while (along(w) < 52.3) step(1 / 240);
    step(1.5, [set("jump", 1)]);
    expect(st(w).tries).toBe(1);
    expect(st(w).back?.why).toBe("spikes");
  });

  it("MMN-123 up reels the rope in and down pays it out: reeled up to the beam over the cliff and let go, the mammoth is on the cliff's top", () => {
    const { w, step } = game();
    place(w, 96.5);
    step(0.3);
    step(0.02, [set("aim", aimAt(w, CLIFF_BEAM))]);
    step(0.2, [set("hook", 1)]);
    step(0.02, [set("hook", 0)]);
    const from = ropeLength(moonRope(w)!);
    step(0.5, [set("up", 1)]);
    // 8 m/s for half a second.
    expect(from - ropeLength(moonRope(w)!)).toBeCloseTo(4, 0);
    expect(alt(w)).toBeGreaterThan(3);
    step(0.25, [set("up", 0), set("duck", 1)]);
    expect(from - ropeLength(moonRope(w)!)).toBeCloseTo(2, 0);
    // Hanging in the air, down pays out: it is not a duck.
    expect(st(w).ducked).toBe(false);
    step(1.3, [set("duck", 0), set("up", 1)]);
    step(0.6, [set("up", 0), set("right", 1)]);
    step(0.05, [set("jump", 1)]);
    step(1.2, [set("jump", 0)]);
    // The cliff's top is 7 m up: standing on it.
    expect(alt(w)).toBeGreaterThan(7.9);
    expect(alt(w)).toBeLessThan(8.1);
    expect(along(w)).toBeGreaterThan(101);
    expect(st(w).grounded).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("MMN-124 the hook's button again lets the rope go, and it comes back", () => {
    const { w, step } = hooked();
    step(0.02, [set("hook", 1)]);
    expect(moonRope(w)!.mode).toBe("back");
    step(0.3, [set("hook", 0)]);
    expect(moonRope(w)).toBeUndefined();
    // And it can be cast again.
    step(0.2, [set("hook", 1)]);
    expect(moonRope(w)!.mode).toBe("held");
  });

  it("MMN-125 sent back to a flag, the mammoth's rope and its shots in flight go with it", () => {
    const { w, step } = hooked();
    // Hanging on the rope and firing upward when the leg's time runs out.
    st(w).left = 0.3;
    step(0.02, [set("aim", 1.3)]);
    step(0.25, [set("fire", 1)]);
    expect(moonRope(w)!.mode).toBe("held");
    expect(shots(w).length).toBeGreaterThan(0);
    step(0.02 + 1 / 240, [set("fire", 0)]);
    step(1 / 240);
    expect(st(w).tries).toBe(1);
    expect(st(w).back?.why).toBe("time");
    expect(moonRope(w)).toBeUndefined();
    expect(shots(w)).toEqual([]);
    expect(st(w).flying).toEqual([]);
  });
});

describe("Moon Mammoth: the tools and the engine's rules", () => {
  const play = (w: World, step: (s: number, c?: Command[]) => void) => {
    place(w, 51.5);
    step(0.3);
    step(0.02, [set("aim", aimAt(w, PIT_BEAM))]);
    step(0.2, [set("hook", 1), set("fire", 1)]);
    step(0.6, [set("hook", 0), set("right", 1), set("up", 1)]);
    step(0.5, [set("jump", 1), set("fire", 0)]);
    return hashValue(w);
  };

  it("MMN-080 a run with the rifle and the hook and its replay agree exactly", () => {
    const a = game();
    const b = game();
    expect(play(a.w, a.step)).toBe(play(b.w, b.step));
  });

  it("MMN-081 the rifle and the hook break none of the conservation checks", () => {
    const { w, step } = game();
    play(w, step);
    expect(w.ledger.violations).toBe(0);
  });

  it("level 2 is a world: gates, pits under beams, cliffs, and the tools; level 1 is as it was, with none", () => {
    const w = initialWorld(parseScenario(raw("moon-2")));
    expect(w.moon!.spec.tools).toBeDefined();
    expect(w.bodies.filter((b) => b.id.startsWith("block-")).length).toBe(4);
    expect(w.bodies.filter((b) => b.id.startsWith("block-")).every((b) => !b.fixed && b.material)).toBe(true);
    expect(w.moon!.spec.flags.length).toBe(8);
    expect(initialWorld(parseScenario(raw("moon-1"))).moon!.spec.tools).toBeUndefined();
  });

  it("the blocks of level 2 stand where they are put (the ground under each is level): after two seconds none has moved or been hurt", () => {
    const w = initialWorld(parseScenario(raw("moon-2")));
    const home = new Map(w.bodies.filter((b) => b.id.startsWith("block-")).map((b) => [b.id, { ...b.position }]));
    for (let i = 0; i < 480; i++) stepInPlace(w, [], sandbox);
    for (const [id, p] of home) {
      const b = w.bodies.find((x) => x.id === id)!;
      expect(Math.hypot(b.position.x - p.x, b.position.y - p.y)).toBeLessThan(0.15);
      expect(b.integrity).toBe(1);
    }
    expect(w.ledger.violations).toBe(0);
  });

  it("level 2 can be run: a simple player shoots each gate, swings each pit from its beam and climbs each cliff on the rope, inside every leg's time", () => {
    const w = initialWorld(parseScenario(raw("moon-2")));
    const C = 2 * Math.PI * 80;
    const pos = () => {
      const a = 80 * Math.atan2(mam(w).position.x, mam(w).position.y);
      return a < -1 ? a + C : a;
    };
    const held: Record<string, number> = {};
    let queue: Command[] = [];
    const hold = (ch: string, v: number) => {
      if ((held[ch] ?? 0) !== v) queue.push(set(ch, (held[ch] = v)));
    };
    const tick = () => {
      stepInPlace(w, queue, sandbox);
      queue = [];
    };
    const until = (f: () => boolean, most = 240 * 8) => {
      for (let n = 0; !f() && n < most && st(w).phase !== "won"; n++) tick();
    };
    const rise = () => (mam(w).velocity.x * mam(w).position.x + mam(w).velocity.y * mam(w).position.y) / Math.hypot(mam(w).position.x, mam(w).position.y);
    const stopAt = (to: number) => {
      hold("right", 1);
      until(() => pos() >= to);
      hold("right", 0);
      until(() => Math.hypot(mam(w).velocity.x, mam(w).velocity.y) < 0.3);
    };
    const hookOn = (beam: string) => {
      hold("aim", aimAt(w, beam));
      tick();
      hold("hook", 1);
      until(() => moonRope(w)?.mode === "held", 120);
      hold("hook", 0);
      expect(moonRope(w)?.anchor?.body).toBe(beam);
    };
    type Ev = { kind: "gate"; at: number; block: string } | { kind: "pit"; at: number; width: number; beam: string } | { kind: "cliff"; at: number; beam: string };
    const course: Ev[] = [
      { kind: "gate", at: 30, block: "block-0" },
      { kind: "pit", at: 85, width: 14, beam: "girder-2" },
      { kind: "cliff", at: 140, beam: "girder-4" },
      { kind: "gate", at: 205, block: "block-5" },
      { kind: "pit", at: 255, width: 18, beam: "girder-7" },
      { kind: "cliff", at: 310, beam: "girder-9" },
      { kind: "gate", at: 328, block: "block-10" },
      { kind: "pit", at: 378, width: 14, beam: "girder-12" },
      { kind: "gate", at: 408, block: "block-13" },
    ];
    for (const e of course) {
      if (e.kind === "gate") {
        // Stop short, aim at the block, and fire until it is gone.
        stopAt(e.at - 9);
        hold("aim", aimAt(w, e.block) - 0.02);
        tick();
        hold("fire", 1);
        until(() => !w.bodies.some((b) => b.id === e.block));
        hold("fire", 0);
      } else if (e.kind === "pit") {
        // Hook the beam from the edge, run off reeling in, and let go on the way up past the middle.
        stopAt(e.at - e.width / 2 - 1.5);
        hookOn(e.beam);
        hold("right", 1);
        hold("up", 1);
        until(() => pos() > e.at + 1.5 && rise() > 5, 480);
        hold("up", 0);
        hold("jump", 1);
        tick();
        tick();
        hold("jump", 0);
        until(() => st(w).grounded && pos() > e.at + e.width / 2, 480);
      } else {
        // Hook the beam from the cliff's foot, reel all the way up, lean over the top and let go.
        stopAt(e.at - 3.5);
        hookOn(e.beam);
        hold("up", 1);
        until(() => !moonRope(w) || ropeLength(moonRope(w)!) <= 1.8, 720);
        hold("up", 0);
        hold("right", 1);
        for (let i = 0; i < 120; i++) tick();
        hold("jump", 1);
        tick();
        tick();
        hold("jump", 0);
        until(() => st(w).grounded, 480);
      }
      expect(st(w).tries).toBe(0);
    }
    hold("right", 1);
    until(() => st(w).phase === "won", 240 * 20);
    expect(st(w).phase).toBe("won");
    expect(st(w).tries).toBe(0);
    // About a minute as the player sees it.
    expect(st(w).elapsed).toBeLessThan(35);
    expect(w.ledger.violations).toBe(0);
  });

  it("the scenario is checked: the tools need a rifle and a hook", () => {
    const bad = raw();
    delete bad.world.moon.tools.hook;
    expect(() => parseScenario(bad)).toThrow(ScenarioError);
  });
});
