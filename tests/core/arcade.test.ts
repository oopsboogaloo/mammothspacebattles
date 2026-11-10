// Mammoth Asteroids' game in the world (docs/games/mammoth-asteroids.md; src/core/arcade.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARCADE_SCORES, clearestSpot, computeTotals, createWorld, getProfile, hashValue, initialWorld, parseScenario, stepInPlace, type Body, type Command, type World } from "../../src/core/index.ts";
import { disc } from "../helpers.ts";

const raw = JSON.parse(readFileSync(new URL("../../scenarios/asteroids.json", import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });

/** A game, with `edit` over the scenario. `step(s)` runs s game seconds, the commands on its first step. */
function game(edit?: (scn: typeof raw) => void): { w: World; step: (seconds: number, commands?: Command[]) => void } {
  const scn = structuredClone(raw);
  edit?.(scn);
  const w = initialWorld(parseScenario(scn));
  return {
    w,
    step: (seconds, commands = []) => {
      const n = Math.round(seconds * 240);
      for (let k = 0; k < n; k++) stepInPlace(w, k === 0 ? commands : [], sandbox);
    },
  };
}
const st = (w: World) => w.arcade!.state;
const body = (w: World, id: string) => w.bodies.find((b) => b.id === id);
const prefixed = (w: World, prefix: string) => w.bodies.filter((b) => b.id.startsWith(prefix));
/** The rocks of a level, by number. */
const rocks = (w: World, level: number) => new Set(prefixed(w, `a${level}-`).map((b) => b.id.split("-")[1]));
/** After moving things by hand: the ledger starts from the world as it now is. */
const settle = (w: World) => {
  w.ledger.totals = computeTotals(w);
};
const reach = (b: Body) => (b.shape.kind === "polygon" ? Math.max(...b.shape.vertices.map((v) => Math.hypot(v.x, v.y))) : 0);
/** The level's first gold piece, cut out of its rock and set drifting at the ship from its right. */
function looseGold(w: World): Body {
  const g = body(w, st(w).gold.left[0])!;
  w.joints = w.joints.filter((j) => j.a !== g.id && j.b !== g.id);
  delete g.compound;
  g.position = { x: 2.2 + reach(g) + 0.5, y: -1 };
  g.velocity = { x: -1, y: 0 };
  g.angularVelocity = 0;
  settle(w);
  return g;
}
/** The level's rock set still, 40 m straight above the ship. */
function rockAbove(w: World): void {
  const rock = prefixed(w, "a1-0-");
  const M = rock.reduce((m, b) => m + b.mass, 0);
  const c = { x: rock.reduce((s, b) => s + b.mass * b.position.x, 0) / M, y: rock.reduce((s, b) => s + b.mass * b.position.y, 0) / M };
  for (const b of rock) {
    b.position = { x: b.position.x - c.x, y: b.position.y - c.y + 40 };
    b.velocity = { x: 0, y: 0 };
    b.angularVelocity = 0;
  }
  settle(w);
}

describe("Mammoth Asteroids", () => {
  it("MAS-020 MAS-030 level 1 is one rock of welded pieces holding 2 or 3 gold, away from the ship, which starts at the centre with its railgun", () => {
    const { w } = game();
    const s = st(w);
    expect(s).toMatchObject({ level: 1, phase: "playing", lives: 3, n: 1, score: 0 });
    expect([...rocks(w, 1)]).toEqual(["0"]);
    const pieces = prefixed(w, "a1-0-");
    expect(pieces.length).toBeGreaterThan(15);
    expect(pieces.length).toBeLessThanOrEqual(20);
    // Drifting at 2–6 m/s, 50 m or more from the ship (the short way round).
    const M = pieces.reduce((m, b) => m + b.mass, 0);
    const v = { x: pieces.reduce((x, b) => x + b.mass * b.velocity.x, 0) / M, y: pieces.reduce((y, b) => y + b.mass * b.velocity.y, 0) / M };
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(1.9);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(6.1);
    const W = w.bounds.max.x - w.bounds.min.x;
    const H = w.bounds.max.y - w.bounds.min.y;
    for (const b of pieces) {
      const dx = b.position.x - W * Math.round(b.position.x / W);
      const dy = b.position.y - H * Math.round(b.position.y / H);
      expect(Math.hypot(dx, dy)).toBeGreaterThan(50 - 12 * 1.1);
    }
    // Its gold: 2 or 3 pieces, which nothing can damage (AST-010); every piece pulls (AST-009).
    const gold = pieces.filter((b) => b.mineral === "gold");
    expect(gold.length).toBeGreaterThanOrEqual(2);
    expect(gold.length).toBeLessThanOrEqual(3);
    expect(s.gold).toEqual({ total: gold.length, left: gold.map((b) => b.id).sort() });
    expect(gold.every((b) => b.material === undefined)).toBe(true);
    expect(pieces.every((b) => b.gravity?.feels && b.gravity.mu > 0)).toBe(true);
    // The ship: the LAND ship at the centre, at rest, with 60 slugs and a full tank.
    expect(body(w, "p1-hull")).toMatchObject({ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0 });
    expect(body(w, "p1-gun")!.magazine).toMatchObject({ count: 60, railgun: { channel: "fire", speed: 200 } });
    expect(body(w, "p1-tank")!.contents!.reduce((m, c) => m + c.mass, 0)).toBeCloseTo(8.1, 6);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-020 the same seed lays the level out the same, another seed differently, and the width of the arena is the scenario's", () => {
    expect(hashValue(game().w)).toBe(hashValue(game().w));
    const other = game((scn) => (scn.world.arcade.seed = 2)).w;
    expect(hashValue(prefixed(other, "a1-"))).not.toBe(hashValue(prefixed(game().w, "a1-")));
    // A narrower arena (an iPad's): the rocks are laid out inside it.
    const narrow = game((scn) => Object.assign(scn.world.bounds, { min: { x: -106, y: -80 }, max: { x: 106, y: 80 } })).w;
    expect(prefixed(narrow, "a1-").every((b) => Math.abs(b.position.x) < 106 + 14 && Math.abs(b.position.y) < 80 + 14)).toBe(true);
  });

  it("MAS-025 MAS-033 when the last gold is collected: the bonus, a pause, then level 2 with two rocks and a fresh ship where the old one was", () => {
    const { w, step } = game();
    // Fly for a second, with a damaged wing, some fuel burnt and some slugs fired.
    step(1, [set("left", 1), set("right", 1), set("fire", 1)]);
    step(1, [set("left", 0), set("right", 0), set("fire", 0)]);
    body(w, "p1-wing")!.integrity = 0.5;
    expect(body(w, "p1-gun")!.magazine!.count).toBeLessThan(60);
    st(w).gold.left = []; // as if the ship had collected it all
    step(1 / 240);
    // 2 game seconds are 4 of the player's: 1,000 × level 1 + 10 × (120 − 4).
    expect(st(w)).toMatchObject({ phase: "clearing", bonus: 2160, score: 2160, level: 1 });
    expect(w.events.some((e) => e.type === "arcade.clear" && e.data.level === 1 && e.data.bonus === 2160)).toBe(true);
    step(1.5 - 1 / 240);
    expect(st(w).phase).toBe("clearing");
    const old = structuredClone(body(w, "p1-hull")!);
    step(1 / 240);
    expect(st(w)).toMatchObject({ phase: "playing", level: 2, n: 2, lives: 3, lost: false });
    expect(st(w).graceUntil).toBeUndefined();
    // Everything of level 1 has gone; level 2 has two rocks.
    expect(prefixed(w, "a1-")).toHaveLength(0);
    expect(prefixed(w, "p1-")).toHaveLength(0);
    expect([...rocks(w, 2)].sort()).toEqual(["0", "1"]);
    expect(st(w).gold.total).toBe(prefixed(w, "a2-").filter((b) => b.mineral === "gold").length);
    // The fresh ship: where the old one was a step ago, moving as it was, whole, full.
    const hull = body(w, "p2-hull")!;
    expect(Math.hypot(hull.position.x - old.position.x, hull.position.y - old.position.y)).toBeLessThan(0.1);
    expect(hull.velocity.y).toBeCloseTo(old.velocity.y, 1);
    expect(hull.velocity.y).toBeGreaterThan(1); // still moving
    expect(prefixed(w, "p2-").every((b) => b.integrity === 1 && (b.material !== undefined || b.id.includes("-shell-")))).toBe(true);
    expect(body(w, "p2-gun")!.magazine!.count).toBe(60);
    expect(body(w, "p2-tank")!.contents!.reduce((m, c) => m + c.mass, 0)).toBeCloseTo(8.1, 6);
    // It flies by the same keys.
    step(0.5, [set("left", 1), set("right", 1)]);
    expect(body(w, "p2-hull")!.velocity.y).toBeGreaterThan(old.velocity.y + 1);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-020 level N has N rocks, 8 at the most", () => {
    const { w, step } = game();
    const next = (level: number) => {
      st(w).level = level - 1;
      st(w).gold.left = [];
      step(1.5 + 2 / 240);
      expect(st(w).level).toBe(level);
      return rocks(w, level).size;
    };
    expect(next(5)).toBe(5);
    expect(next(8)).toBe(8);
    expect(next(9)).toBe(8);
    expect(next(20)).toBe(8);
    // Eight rocks fit: each is clear of the others' centres.
    const centres = [...rocks(w, 20)].map((k) => {
      const ps = prefixed(w, `a20-${k}-`);
      const M = ps.reduce((m, b) => m + b.mass, 0);
      return { x: ps.reduce((s, b) => s + b.mass * b.position.x, 0) / M, y: ps.reduce((s, b) => s + b.mass * b.position.y, 0) / M };
    });
    const W = w.bounds.max.x - w.bounds.min.x;
    const H = w.bounds.max.y - w.bounds.min.y;
    for (let i = 0; i < centres.length; i++)
      for (let j = i + 1; j < centres.length; j++) {
        const dx = centres[j].x - centres[i].x;
        const dy = centres[j].y - centres[i].y;
        expect(Math.hypot(dx - W * Math.round(dx / W), dy - H * Math.round(dy / H))).toBeGreaterThan(24);
      }
    expect(w.ledger.violations).toBe(0);
  }, 120_000);

  it("MAS-024 the ship touching a gold piece collects it: it leaves the arena in a sparkle, scores 500, and the ledger records it leaving", () => {
    const { w, step } = game();
    const g = looseGold(w);
    const total = st(w).gold.total;
    let left: number | undefined;
    for (let i = 0; i < 3 * 240 && left === undefined; i++) {
      step(1 / 240);
      if (w.events.some((e) => e.type === "arcade.gold" && e.data.id === g.id)) left = w.ledger.last!.sources.boundary.mass;
    }
    expect(left).toBeCloseTo(-g.mass, 6);
    expect(body(w, g.id)).toBeUndefined();
    expect(st(w)).toMatchObject({ score: ARCADE_SCORES.gold, phase: "playing" });
    expect(st(w).gold).toMatchObject({ total });
    expect(st(w).gold.left).toHaveLength(total - 1);
    expect(st(w).stats.gold).toBe(1);
    expect((w.dust ?? []).some((d) => d.kind === "gold")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-024 gold hidden inside a larger fragment whose seams don't show is not collected, though the ship touches it", () => {
    const { w, step } = game();
    const g = looseGold(w);
    g.compound = { id: "a1-0-c9", reveal: 1 };
    let touched = false;
    for (let i = 0; i < 3 * 240; i++) {
      step(1 / 240);
      touched ||= w.contacts.some((c) => (c.a === g.id || c.b === g.id) && c.normalImpulse > 0 && (c.a.startsWith("p1-") || c.b.startsWith("p1-")));
    }
    expect(touched).toBe(true);
    expect(body(w, g.id)).toBeDefined();
    expect(st(w).score).toBe(0);
    expect(st(w).gold.left).toContain(g.id);
  });

  it("MAS-050 a rock weld that breaks just after one of the player's slugs touched that rock scores 10; one that breaks otherwise scores nothing", () => {
    const { w, step } = game();
    rockAbove(w);
    let breaks = 0;
    let seen = w.events.length;
    step(1 / 240, [set("fire", 1)]);
    for (let i = 0; i < 8 * 240 && breaks === 0; i++) {
      step(1 / 240);
      breaks += w.events.slice(seen).filter((e) => e.type === "joint.break" && /^a1-0-\d+$/.test(String(e.data.a)) && /^a1-0-\d+$/.test(String(e.data.b))).length;
      seen = w.events.length;
      if (breaks === 0) expect(st(w).score).toBe(0);
    }
    expect(breaks).toBeGreaterThan(0);
    expect(st(w).stats.welds).toBe(breaks);
    expect(st(w).score).toBe(ARCADE_SCORES.weld * breaks);
    expect(st(w).stats.shots).toBeGreaterThan(10);

    // No slugs: a piece wrecked some other way takes its welds with it, and scores nothing.
    const quiet = game();
    const piece = prefixed(quiet.w, "a1-0-").find((b) => b.mineral !== "gold" && !b.compound)!;
    piece.integrity = 0;
    quiet.step(0.1);
    expect(quiet.w.events.some((e) => e.type === "joint.break" && (e.data.a === piece.id || e.data.b === piece.id))).toBe(true);
    expect(st(quiet.w).score).toBe(0);
  }, 120_000);

  it("MAS-031 MAS-032 MAS-033 a lost ship stays as a wreck the keys no longer fly; the next comes after the wait at a clear spot, at rest, protected for a while", () => {
    const { w, step } = game();
    step(0.5, [set("left", 1), set("right", 1)]);
    body(w, "p1-hull")!.integrity = 0; // the hull destroyed
    step(2 / 240);
    expect(st(w)).toMatchObject({ phase: "waiting", lives: 2, lost: true, n: 1 });
    expect(w.events.some((e) => e.type === "arcade.lost" && e.data.lives === 2)).toBe(true);
    // The wreck: its parts are still here, and no control link reaches them.
    expect(body(w, "p1-engine-l")).toBeDefined();
    expect(w.links.some((l) => l.kind === "control" && l.to.startsWith("p1-"))).toBe(false);
    step(1.25 - 3 / 240);
    expect(st(w).phase).toBe("waiting");
    const spot = clearestSpot(w);
    step(2 / 240);
    expect(st(w)).toMatchObject({ phase: "playing", lives: 2, lost: false, n: 2 });
    const hull = body(w, "p2-hull")!;
    expect(Math.hypot(hull.position.x - spot.x, hull.position.y - spot.y)).toBeLessThan(0.5);
    expect(hull.angle).toBe(0);
    // Protected: no part has a material, so nothing damages it (DMG-002). Full tank and magazine.
    expect(prefixed(w, "p2-").every((b) => b.material === undefined)).toBe(true);
    expect(st(w).graceUntil).toBeGreaterThan(w.time);
    expect(body(w, "p2-gun")!.magazine!.count).toBe(60);
    expect(body(w, "p1-engine-l")).toBeDefined(); // the wreck stays
    step(1);
    // Protection over: the materials are back, as the template's.
    expect(st(w).graceUntil).toBeUndefined();
    const template = new Map<string, unknown>(raw.world.arcade.ship.bodies.map((b: { id: string; material: unknown }) => [b.id.replace("{n}", "2"), b.material]));
    for (const b of prefixed(w, "p2-")) if (template.has(b.id)) expect(b.material).toEqual(template.get(b.id));
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-031 a ship with no working engine welded to its hull is lost, hull and all", () => {
    const { w, step } = game();
    body(w, "p1-engine-l")!.integrity = 0;
    step(0.1);
    expect(st(w).lost).toBe(false); // one engine still flies it
    body(w, "p1-engine-r")!.integrity = 0;
    step(0.1);
    expect(st(w)).toMatchObject({ phase: "waiting", lives: 2, lost: true });
    expect(body(w, "p1-hull")).toBeDefined();
  });

  it("MAS-031 three ships a game: the third loss ends it after the wait, and nothing more happens", () => {
    const { w, step } = game();
    for (const lives of [2, 1, 0]) {
      expect(st(w).phase).toBe("playing");
      body(w, `p${st(w).n}-hull`)!.integrity = 0;
      step(2 / 240);
      expect(st(w)).toMatchObject({ phase: "waiting", lives });
      step(1.25);
    }
    expect(st(w)).toMatchObject({ phase: "over", lives: 0, n: 3 });
    expect(w.events.filter((e) => e.type === "arcade.over")).toHaveLength(1);
    expect(body(w, "p4-hull")).toBeUndefined();
    step(3);
    expect(st(w)).toMatchObject({ phase: "over", lives: 0, n: 3 });
    expect(w.events.filter((e) => e.type === "arcade.over")).toHaveLength(1);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-025 the last gold collected as the last ship is lost still clears the level, and then the game is over", () => {
    const { w, step } = game((scn) => (scn.world.arcade.lives = 1));
    body(w, "p1-hull")!.integrity = 0;
    st(w).gold.left = [];
    step(2 / 240);
    expect(st(w)).toMatchObject({ phase: "clearing", lives: 0, lost: true, score: 2200 }); // 1,000 + 10 × 120: no time has passed
    step(1.5);
    expect(st(w)).toMatchObject({ phase: "over", level: 1 });
  });

  it("MAS-030 a slug lasts 0.7 game seconds, then leaves through the boundary; fired straight up from rest it never comes round to hit its own ship", () => {
    const { w, step } = game();
    step(0.05, [set("fire", 1)]); // one shot: the next would come 0.125 s later
    step(1 / 240, [set("fire", 0)]);
    expect(st(w).stats.shots).toBe(1);
    expect(Object.keys(st(w).shells)).toEqual(["p1-gun-shell-1"]);
    const slug = body(w, "p1-gun-shell-1")!;
    expect(slug.velocity.y).toBeGreaterThan(195);
    // The kick: 0.1 kg at 200 m/s against the ship's 34 kg.
    expect(body(w, "p1-hull")!.velocity.y).toBeCloseTo(-20 / 34.2, 1);
    let left: number | undefined;
    for (let i = 0; i < 240 && left === undefined; i++) {
      step(1 / 240);
      if (!body(w, "p1-gun-shell-1")) left = w.ledger.last!.sources.boundary.mass;
    }
    expect(left).toBeCloseTo(-0.1, 9);
    expect(st(w).shells).toEqual({});
    expect(w.time).toBeLessThan(0.7 + 0.05);
    expect(w.events.some((e) => e.type === "collision" && [e.data.a, e.data.b].some((id) => String(id).includes("-shell-")))).toBe(false);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-070 the game replays exactly, and goes on identically after a save and load, with the ledger clean", () => {
    const script = (i: number): Command[] =>
      i === 0 ? [set("fire", 1), set("left", 1)] : i === 120 ? [set("right", 1)] : i === 360 ? [set("left", 0), set("fire", 0)] : i === 600 ? [set("fire", 1)] : i === 800 ? [set("right", 0), set("fire", 0)] : [];
    const run = (reloadAt?: number) => {
      let w = game((scn) => (scn.world.arcade.respawn = 0.5)).w;
      for (let i = 0; i < 1200; i++) {
        if (i === reloadAt) w = structuredClone(w); // a saved world, loaded again
        if (i === 400) w.bodies.find((b) => b.id === "p1-hull")!.integrity = 0; // a loss and a respawn on the way
        stepInPlace(w, script(i), sandbox);
      }
      return w;
    };
    const a = run();
    expect(st(a)).toMatchObject({ n: 2, lives: 2, phase: "playing" });
    expect(st(a).stats.shots).toBeGreaterThan(10);
    expect(a.ledger.violations).toBe(0);
    expect(hashValue(run())).toBe(hashValue(a));
    expect(hashValue(run(700))).toBe(hashValue(a));
  }, 120_000);

  it("MAS-032 the clearest spot is the centre when nothing is near, and moves off the path of what is coming", () => {
    const bounds = { min: { x: -100, y: -80 }, max: { x: 100, y: 80 }, wrap: true };
    expect(clearestSpot(createWorld(1, [], { x: 0, y: 0 }, { bounds }))).toEqual({ x: 0, y: 0 });
    // A rock 30 m to the left, heading for the centre at 10 m/s: it is there within the 3 s looked ahead.
    const w = createWorld(1, [disc("rock", { shape: { kind: "disc", radius: 5 }, position: { x: -30, y: 0 }, velocity: { x: 10, y: 0 } })], { x: 0, y: 0 }, { bounds });
    const spot = clearestSpot(w);
    expect(spot).not.toEqual({ x: 0, y: 0 });
    expect(Math.abs(spot.y)).toBeGreaterThan(20); // off its line
    // Across the edge counts: a rock at the far right is near the left side's points.
    const far = createWorld(1, [disc("rock", { shape: { kind: "disc", radius: 5 }, position: { x: 95, y: 0 } })], { x: 0, y: 0 }, { bounds });
    expect(clearestSpot(far)).toEqual({ x: 0, y: 0 });
  });

  it("MAS-070 the scenario's game is checked", () => {
    const bad = (edit: (scn: typeof raw) => void) => () => game(edit);
    expect(bad((s) => (s.world.arcade.hull = "hull"))).toThrow(/hull/);
    expect(bad((s) => (s.world.arcade.gun = "p{n}-nothing"))).toThrow(/gun/);
    expect(bad((s) => (s.world.arcade.rocks.gold = [3, 2]))).toThrow(/gold/);
    expect(bad((s) => (s.world.arcade.rocks.gold = [0, 2]))).toThrow(/gold/);
    expect(bad((s) => (s.world.arcade.rocks.most = 0))).toThrow(/most/);
    expect(bad((s) => delete s.world.arcade.rocks.speed)).toThrow(/speed/);
    expect(bad((s) => (s.world.bounds.wrap = false))).toThrow(/wrap/);
    expect(bad((s) => delete s.world.arcade.seed)).toThrow(/seed/);
  });
});
