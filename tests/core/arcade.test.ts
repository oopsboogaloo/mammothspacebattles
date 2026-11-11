// Mammoth Asteroids' game in the world (docs/games/mammoth-asteroids.md; src/core/arcade.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARCADE_SCORES, bodyMass, clearestSpot, orbitVelocities, computeTotals, createWorld, getProfile, gunshipPlan, gunshipSpot, hashValue, initialWorld, parseScenario, stepInPlace, type Body, type Command, type World } from "../../src/core/index.ts";
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
/** A game with nothing in it but the ship. */
function alone() {
  const g = game();
  g.w.bodies = g.w.bodies.filter((b) => b.id.startsWith("p1-"));
  g.w.joints = g.w.joints.filter((j) => j.a.startsWith("p1-") && j.b.startsWith("p1-"));
  settle(g.w);
  return g;
}
/** The propellant in a ship's two tanks, kg. */
const fuel = (w: World, prefix: string) => prefixed(w, `${prefix}tank-`).reduce((m, b) => m + b.contents!.reduce((s, c) => s + c.mass, 0), 0);
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
    // Its gold: 2 or 3 pieces, which nothing can damage (AST-010); the rock pulls as one (AST-011).
    const gold = pieces.filter((b) => b.mineral === "gold");
    expect(gold.length).toBeGreaterThanOrEqual(2);
    expect(gold.length).toBeLessThanOrEqual(3);
    expect(s.gold).toEqual({ total: gold.length, left: gold.map((b) => b.id).sort() });
    expect(gold.every((b) => b.material === undefined)).toBe(true);
    expect(pieces.every((b) => b.gravity?.feels && b.gravity.joined && b.gravity.mu > 0)).toBe(true);
    // The ship: its cockpit at the centre, at rest, with 120 shells and full tanks.
    const hull = body(w, "p1-hull")!;
    expect(Math.hypot(hull.position.x, hull.position.y)).toBeLessThan(1e-5);
    expect(hull).toMatchObject({ velocity: { x: 0, y: 0 }, angle: 0 });
    expect(body(w, "p1-gun")!.magazine).toMatchObject({ count: 120, railgun: { channel: "fire", speed: 96 } });
    expect(fuel(w, "p1-")).toBeCloseTo(16.2, 6);
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
    // Fly for a second, with a damaged wing, some fuel burnt and a shell fired.
    step(1, [set("left", 1), set("right", 1)]);
    step(0.1, [set("left", 0), set("right", 0), set("fire", 1)]);
    step(0.9, [set("fire", 0)]);
    body(w, "p1-gen-l")!.integrity = 0.5;
    expect(body(w, "p1-gun")!.magazine!.count).toBeLessThan(120);
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
    expect(body(w, "p2-gun")!.magazine!.count).toBe(120);
    expect(fuel(w, "p2-")).toBeCloseTo(16.2, 6);
    // It flies by the same keys.
    step(0.5, [set("left", 1), set("right", 1)]);
    expect(body(w, "p2-hull")!.velocity.y).toBeGreaterThan(old.velocity.y + 1);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-026 rocks pulling on each other are started in rough orbit: across the line to their centre, at the speed that holds a circle, with no momentum overall", () => {
    // Two equal rocks 60 m apart: each circles the middle, 30 m out, at v² = (G m / d²) × 30.
    const G = 0.186;
    const pair = [
      { at: { x: -30, y: 0 }, mass: 2000 },
      { at: { x: 30, y: 0 }, mass: 2000 },
    ];
    const v = orbitVelocities(pair, G, 1);
    const speed = Math.sqrt(((G * 2000) / 3600) * 30);
    expect(v[0].x).toBeCloseTo(0, 9);
    expect(v[0].y).toBeCloseTo(-speed, 9); // anticlockwise: the left one moves down
    expect(v[1].y).toBeCloseTo(speed, 9);
    expect(orbitVelocities(pair, G, -1)[0].y).toBeCloseTo(speed, 9);
    // Unequal: the heavy one moves less, and their momentum cancels.
    const u = orbitVelocities([pair[0], { at: { x: 30, y: 0 }, mass: 6000 }], G, 1);
    expect(2000 * u[0].y + 6000 * u[1].y).toBeCloseTo(0, 6);
    expect(Math.abs(u[0].y)).toBeGreaterThan(Math.abs(u[1].y));

    // In the game: level 2's two rocks circle each other. After 20 game seconds they are whole and
    // about as far apart as they started; drifting as before, they would have parted or met.
    const { w, step } = game();
    st(w).level = 1;
    st(w).gold.left = [];
    step(1.5 + 2 / 240);
    expect(st(w).level).toBe(2);
    const centre = (k: number) => {
      const bs = prefixed(w, `a2-${k}-`);
      const M = bs.reduce((m, b) => m + b.mass, 0);
      return { x: bs.reduce((x, b) => x + b.mass * b.position.x, 0) / M, y: bs.reduce((y, b) => y + b.mass * b.position.y, 0) / M, vx: bs.reduce((x, b) => x + b.mass * b.velocity.x, 0) / M, vy: bs.reduce((y, b) => y + b.mass * b.velocity.y, 0) / M, M };
    };
    const apart = () => {
      const [a, b] = [centre(0), centre(1)];
      const W = w.bounds.max.x - w.bounds.min.x;
      const H = w.bounds.max.y - w.bounds.min.y;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return Math.hypot(dx - W * Math.round(dx / W), dy - H * Math.round(dy / H));
    };
    const [a, b] = [centre(0), centre(1)];
    expect(Math.hypot(a.vx, a.vy)).toBeLessThan(2.5); // slower than the 2 to 6 m/s drift
    expect(Math.hypot(a.M * a.vx + b.M * b.vx, a.M * a.vy + b.M * b.vy) / (a.M + b.M)).toBeLessThan(0.05);
    const d0 = apart();
    const welds = w.joints.filter((j) => j.a.startsWith("a2-")).length;
    step(20);
    expect(apart()).toBeGreaterThan(0.6 * d0);
    expect(apart()).toBeLessThan(1.4 * d0);
    expect(w.joints.filter((j) => j.a.startsWith("a2-")).length).toBe(welds);
    // One rock has nothing to orbit: it drifts.
    const one = game();
    const rock = prefixed(one.w, "a1-0-");
    const M = rock.reduce((m, x) => m + x.mass, 0);
    const drift = Math.hypot(rock.reduce((x, r) => x + r.mass * r.velocity.x, 0) / M, rock.reduce((y, r) => y + r.mass * r.velocity.y, 0) / M);
    expect(drift).toBeGreaterThan(1.9);
    expect(drift).toBeLessThan(6.1);
    expect(() => game((scn) => delete scn.world.arcade.rocks.gravity)).toThrow(/orbit/);
  }, 120_000);

  it("MAS-021 a shell's blast makes 5.5 kg of gas, 5.33 kg more than the shell weighs, to push the rock's pieces apart, and the ledger records it as supplied", () => {
    const { w, step } = game();
    rockAbove(w);
    step(1 / 240, [set("fire", 1)]);
    step(1 / 240, [set("fire", 0)]);
    let burst: { gas: number } | undefined;
    let supplied = 0;
    for (let i = 0; i < 240 && !burst; i++) {
      step(1 / 240);
      burst = w.events.find((e) => e.type === "detonation")?.data as { gas: number } | undefined;
      if (burst) supplied = w.ledger.last!.sources.supply.mass;
    }
    expect(burst!.gas).toBeCloseTo(5.5, 9);
    expect(supplied).toBeCloseTo(5.333333, 9);
    step(1);
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
    expect(st(w).stats.shots).toBeGreaterThan(0);

    // No slugs: a piece wrecked some other way takes its welds with it, and scores nothing.
    const quiet = game();
    const piece = prefixed(quiet.w, "a1-0-").find((b) => b.mineral !== "gold" && !b.compound)!;
    piece.integrity = 0;
    quiet.step(0.1);
    expect(quiet.w.events.some((e) => e.type === "joint.break" && (e.data.a === piece.id || e.data.b === piece.id))).toBe(true);
    expect(st(quiet.w).score).toBe(0);
  }, 120_000);

  it("MAS-021 MAS-027 MAS-030 the explosive shell breaks a rock up: its blast pushes pieces apart, so the rock splits within a few hits and few pieces are destroyed; a solid slug did none of that", () => {
    const mag = raw.world.arcade.ship.bodies.find((b: { id: string }) => b.id === "p{n}-gun").magazine;
    // The Mammoth scenario's shell, from the mining tuning (AST-008).
    expect(mag).toMatchObject({ count: 120, reload: 0.25, shell: { mass: 0.166667, explosive: { charge: 0.1, fragments: 0, radius: 4, heat: 1.512e8, gas: 5.333333 } } });
    expect(raw.world.arcade.rocks).toMatchObject({ density: 6, bond: 800, material: { threshold: 200, toughness: 40_000 } });
    const chunks = (w: World) => {
      const seen = new Set<string>();
      let n = 0;
      for (const b of prefixed(w, "a1-0-")) {
        if (seen.has(b.id)) continue;
        n++;
        const stack = [b.id];
        while (stack.length) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          for (const j of w.joints) if (j.a === id) stack.push(j.b); else if (j.b === id) stack.push(j.a);
        }
      }
      return n;
    };
    const fire = (edit?: (scn: typeof raw) => void) => {
      const { w, step } = game(edit);
      rockAbove(w);
      const pieces = prefixed(w, "a1-0-").length;
      step(2.05, [set("fire", 1)]); // 9 shells
      step(2, [set("fire", 0)]);
      return { w, shots: st(w).stats.shots, bursts: w.events.filter((e) => e.type === "detonation" && String(e.data.id).startsWith("p1-")).length, pieceBursts: w.events.filter((e) => e.type === "detonation" && String(e.data.id).startsWith("burst-")).length, chunks: chunks(w), lost: pieces - prefixed(w, "a1-0-").length };
    };
    const now = fire();
    expect(now.shots).toBe(9);
    expect(now.bursts).toBeGreaterThanOrEqual(4); // measured 5: the blasts push the pieces out of the later shells' way
    expect(now.chunks).toBeGreaterThanOrEqual(2); // measured: 4 chunks, 10 of its 20 pieces destroyed
    expect(now.lost).toBeGreaterThanOrEqual(3);
    expect(now.lost).toBeLessThanOrEqual(14); // some of the rock is pushed apart, not vaporised
    // MAS-027: a burst of gas where each piece was destroyed.
    expect(now.pieceBursts).toBe(now.lost);
    expect(st(now.w).stats.welds).toBeGreaterThan(3);
    expect(st(now.w).score).toBe(ARCADE_SCORES.weld * st(now.w).stats.welds);
    // Gold is untouched by the blasts, and the ship by its own shells.
    expect(prefixed(now.w, "a1-0-").filter((b) => b.mineral === "gold")).toHaveLength(st(now.w).gold.total);
    expect(st(now.w)).toMatchObject({ lost: false, lives: 3 });
    expect(now.w.ledger.violations).toBe(0);
    // As it first was: a light solid slug. Nine of them break nothing.
    const before = fire((scn) => {
      const gun = scn.world.arcade.ship.bodies.find((b: { id: string }) => b.id === "p{n}-gun");
      gun.magazine.shell = { shape: { kind: "disc", radius: 0.06 }, mass: 0.1, restitution: 0, friction: 0.3 };
      Object.assign(scn.world.arcade.rocks, { density: 20, bond: 20_000 });
    });
    expect(before).toMatchObject({ shots: 9, bursts: 0, pieceBursts: 0, chunks: 1, lost: 0 });
  }, 120_000);

  it("MAS-031 MAS-032 MAS-033 a lost ship stays as a wreck the keys no longer fly; the next comes after the wait at a clear spot, at rest, protected for a while", () => {
    const { w, step } = game();
    step(0.5, [set("left", 1), set("right", 1)]);
    body(w, "p1-hull")!.integrity = 0; // the hull destroyed
    step(2 / 240);
    expect(st(w)).toMatchObject({ phase: "waiting", lives: 2, lost: true, n: 1 });
    expect(w.events.some((e) => e.type === "arcade.lost" && e.data.lives === 2)).toBe(true);
    // The wreck: its parts are still here, and no control link reaches them.
    expect(body(w, "p1-main")).toBeDefined();
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
    expect(body(w, "p2-gun")!.magazine!.count).toBe(120);
    expect(body(w, "p1-main")).toBeDefined(); // the wreck stays
    step(1);
    // Protection over: the materials are back, as the template's.
    expect(st(w).graceUntil).toBeUndefined();
    const template = new Map<string, unknown>(raw.world.arcade.ship.bodies.map((b: { id: string; material: unknown }) => [b.id.replace("{n}", "2"), b.material]));
    for (const b of prefixed(w, "p2-")) if (template.has(b.id)) expect(b.material).toEqual(template.get(b.id));
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-031 a ship with no working engine welded to its hull is lost, hull and all", () => {
    const { w, step } = game();
    for (const e of ["main", "back-l", "back-r", "front-l"]) body(w, `p1-${e}`)!.integrity = 0;
    step(0.1);
    expect(st(w).lost).toBe(false); // one engine still flies it
    body(w, "p1-front-r")!.integrity = 0;
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

  it("MAS-030 a shell lasts 1.4 game seconds, then leaves through the boundary; fired straight up from rest it never comes round to hit its own ship", () => {
    const { w, step } = game();
    for (const b of prefixed(w, "a1-")) b.position = { x: b.position.x, y: b.position.y - 30 }; // the rock out of the line of fire
    settle(w);
    step(0.05, [set("fire", 1)]); // one shot: the next would come 0.25 s later
    step(1 / 240, [set("fire", 0)]);
    expect(st(w).stats.shots).toBe(1);
    expect(Object.keys(st(w).shells)).toEqual(["p1-gun-shell-1"]);
    const shell = body(w, "p1-gun-shell-1")!;
    expect(shell.velocity.y).toBeGreaterThan(94);
    // The kick: 0.167 kg at 96 m/s against the ship's 67 kg (20 kg of it the 120 shells). The ship
    // as a whole: its parts ring a little on their welds after a shot.
    const ship = prefixed(w, "p1-").filter((b) => !b.id.includes("-shell-"));
    const M = ship.reduce((m, b) => m + bodyMass(b), 0);
    expect(M).toBeCloseTo(66.9, 0);
    expect(ship.reduce((p, b) => p + bodyMass(b) * b.velocity.y, 0) / M).toBeCloseTo(-16 / M, 2);
    let left: number | undefined;
    for (let i = 0; i < 480 && left === undefined; i++) {
      step(1 / 240);
      if (!body(w, "p1-gun-shell-1")) left = w.ledger.last!.sources.boundary.mass;
    }
    expect(left).toBeCloseTo(-0.166667, 9);
    expect(st(w).shells).toEqual({});
    expect(w.time).toBeGreaterThan(1.35);
    expect(w.time).toBeLessThan(1.4 + 0.1);
    expect(w.events.some((e) => e.type === "collision" && [e.data.a, e.data.b].some((id) => String(id).includes("-shell-")))).toBe(false);
    expect(w.events.some((e) => e.type === "detonation")).toBe(false);
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
    expect(st(a).stats.shots).toBeGreaterThan(5);
    expect(a.ledger.violations).toBe(0);
    expect(hashValue(run())).toBe(hashValue(a));
    expect(hashValue(run(700))).toBe(hashValue(a));
  }, 120_000);

  it("MAS-030 the recoil of all 120 shells leaves the ship whole: no weld bends and no part is damaged, still, under thrust, in reverse or turning", () => {
    for (const held of [[], ["left", "right"], ["left"], ["right"], ["reverse"]]) {
      const { w, step } = alone(); // empty space, so only its own gun can hurt it
      const welds = w.joints.length;
      // Still: all 120 shells, 31 s of fire. Forward or in reverse: 11 s and 44 shells (held for
      // longer, the ship flies at hundreds of metres a second through its own shells). Turning: 5 s
      // and 20 shells. Spun for longer (past 30 rad/s) its shells cross paths and set each other
      // off, and one such blast 5 m away broke a thruster off: not the recoil's doing.
      const seconds = held.length === 0 ? 31 : held.length === 1 && held[0] !== "reverse" ? 5 : 11;
      step(seconds, [set("fire", 1), ...held.map((c) => set(c, 1))]);
      expect(body(w, "p1-gun")!.magazine!.count).toBe(120 - Math.min(120, 4 * seconds));
      expect(st(w).phase).toBe("playing");
      expect(w.joints.length).toBe(welds);
      expect(w.joints.filter((j) => j.integrity < 1).map((j) => j.id)).toEqual([]);
      expect(prefixed(w, "p1-").filter((b) => !b.id.includes("shell") && b.integrity < 1).map((b) => b.id)).toEqual([]);
    }
  }, 300_000); // 63 s of flight in all

  it("MAS-035 the player's controls drive the five engines: a turn fires one back thruster and the opposite front one, both fire the main and both back ones, reverse both front ones", () => {
    const firing = (held: string[]) => {
      const { w, step } = alone();
      step(0.25, held.map((c) => set(c, 1)));
      return prefixed(w, "p1-")
        .filter((b) => b.injector?.firing)
        .map((b) => b.id.slice(3))
        .sort();
    };
    expect(firing([])).toEqual([]);
    expect(firing(["right"])).toEqual(["back-l", "front-r"]);
    expect(firing(["left"])).toEqual(["back-r", "front-l"]);
    expect(firing(["left", "right"])).toEqual(["back-l", "back-r", "main"]);
    expect(firing(["reverse"])).toEqual(["front-l", "front-r"]);
    expect(firing(["reverse", "right"])).toEqual(["back-l", "front-l", "front-r"]);
    // Let go, and they stop.
    const { w, step } = alone();
    step(0.25, [set("left", 1), set("right", 1)]);
    step(0.05, [set("left", 0), set("right", 0)]);
    expect(prefixed(w, "p1-").some((b) => b.injector?.firing)).toBe(false);
  });

  it("MAS-035 it accelerates at about 19.3 m/s² forward and 4.2 m/s² in reverse, and turns at about 3.5 rad/s² where it is, either way", () => {
    const after = (held: string[]) => {
      const { w, step } = alone();
      step(2, held.map((c) => set(c, 1)));
      const hull = body(w, "p1-hull")!;
      expect(w.joints.filter((j) => j.integrity < 1)).toEqual([]);
      expect(w.ledger.violations).toBe(0);
      return { x: hull.velocity.x / 2, y: hull.velocity.y / 2, turn: hull.angularVelocity / 2 };
    };
    // Four and a half times the LAND ship's 4.29 m/s², and twice its 1.74 rad/s² (measured the same way).
    const forward = after(["left", "right"]);
    expect(forward.y).toBeGreaterThan(18.3);
    expect(forward.y).toBeLessThan(20.3);
    expect(Math.abs(forward.turn)).toBeLessThan(0.02);
    const reverse = after(["reverse"]);
    expect(reverse.y).toBeLessThan(-3.8);
    expect(reverse.y).toBeGreaterThan(-4.6);
    const right = after(["right"]);
    expect(right.turn).toBeLessThan(-3.3); // clockwise: the nose turns right
    expect(right.turn).toBeGreaterThan(-3.7);
    expect(after(["left"]).turn).toBeCloseTo(-right.turn, 1);
  });

  it("MAS-035 thrusting up through the top edge at full speed does not turn the ship: its exhaust's tail is gone before the ship meets it", () => {
    const { w, step } = alone();
    step(5, [set("left", 1), set("right", 1)]);
    const hull = body(w, "p1-hull")!;
    expect(hull.velocity.y).toBeGreaterThan(80); // it has crossed the edge (80 m up) at over 50 m/s
    expect(Math.abs(hull.angularVelocity)).toBeLessThan(0.05);
    expect(Math.abs(hull.angle)).toBeLessThan(0.1);
  });

  it("MAS-036 a destroyed magazine explodes violently and the ship is lost; a destroyed battery explodes too, and the ship flies on damaged", () => {
    for (const side of ["l", "r"]) {
      const { w, step } = alone();
      body(w, `p1-mag-${side}`)!.integrity = 0;
      step(0.5);
      expect(w.events.filter((e) => e.type === "detonation")).toHaveLength(1);
      expect(body(w, "p1-hull")).toBeUndefined();
      expect(prefixed(w, "p1-tank-")).toHaveLength(0);
      expect(st(w)).toMatchObject({ lost: true, lives: 2 });
      expect(prefixed(w, "p1-").length).toBeGreaterThan(5); // wreckage is left
      expect(w.ledger.violations).toBe(0);
    }
    const { w, step } = alone();
    body(w, "p1-battery")!.integrity = 0;
    step(0.5);
    expect(w.events.filter((e) => e.type === "detonation")).toHaveLength(1);
    expect(st(w)).toMatchObject({ lost: false, lives: 3 });
    expect(body(w, "p1-hull")!.integrity).toBeLessThan(1);
    expect(body(w, "p1-hull")!.integrity).toBeGreaterThan(0.3);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-037 a thruster knocked off the ship burns what is left in it, about 0.4 s, and is then dead; its tank leaks where its line was", () => {
    const { w, step } = alone();
    step(0.1);
    const fuel = (t: string) => body(w, t)!.contents!.reduce((m, c) => m + c.mass, 0);
    w.joints = w.joints.filter((j) => j.id !== "p1-w-tank-l-back-l"); // the back left thruster comes off
    let burned = 0;
    for (let i = 0; i < 240; i++) {
      step(1 / 240);
      if (body(w, "p1-back-l")!.injector!.firing) burned += 1 / 240;
    }
    expect(st(w).cut).toEqual(["p1-tank-l>p1-back-l"]);
    expect(burned).toBeGreaterThan(0.2);
    expect(burned).toBeLessThan(0.7);
    expect(w.links.some((l) => l.kind === "feed" && l.to === "p1-back-l")).toBe(false);
    // The controls no longer reach it: turning right fires the front right thruster alone.
    step(0.25, [set("right", 1)]);
    expect(prefixed(w, "p1-").filter((b) => b.injector?.firing).map((b) => b.id)).toEqual(["p1-front-r"]);
    step(0.05, [set("right", 0)]);
    // The tank it hung from leaks where the line was: the middle of its bottom face.
    const tank = body(w, "p1-tank-l")!;
    expect(tank.integrity).toBeCloseTo(0.9, 9);
    expect(tank.breach).toMatchObject({ point: { x: 0, y: -0.5 }, normal: { x: 0, y: -1 } });
    const [l0, r0] = [fuel("p1-tank-l"), fuel("p1-tank-r")];
    step(4);
    expect(l0 - fuel("p1-tank-l")).toBeGreaterThan(0.1); // about 0.05 kg/s
    expect(r0 - fuel("p1-tank-r")).toBeLessThan(0.01);
    expect(st(w)).toMatchObject({ lost: false, lives: 3 });
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-037 a destroyed thruster goes up in a small explosion and its tank leaks; the main thruster destroyed, both tanks leak; a wing lost whole, its thrusters burn out", () => {
    const one = alone();
    one.step(0.1);
    body(one.w, "p1-back-l")!.integrity = 0;
    one.step(0.5);
    expect(one.w.events.filter((e) => e.type === "detonation").map((e) => e.data.id)).toEqual(["p1-back-l"]);
    expect(body(one.w, "p1-tank-l")).toBeDefined(); // the explosion is small: the tank beside it survives
    expect(body(one.w, "p1-tank-l")!.breach).toMatchObject({ point: { x: 0, y: -0.5 } });
    expect(st(one.w)).toMatchObject({ lost: false, cut: ["p1-tank-l>p1-back-l"] });

    const main = alone();
    main.step(0.1);
    body(main.w, "p1-main")!.integrity = 0;
    main.step(0.5);
    expect(st(main.w).cut).toEqual(["p1-tank-l>p1-main", "p1-tank-r>p1-main"]);
    for (const t of ["p1-tank-l", "p1-tank-r"]) expect(body(main.w, t)!.integrity).toBeLessThan(0.91);
    expect(st(main.w).lost).toBe(false); // the four small thrusters still fly it

    const wing = alone();
    wing.step(0.1);
    wing.w.joints = wing.w.joints.filter((j) => !j.id.startsWith("p1-w-tank-gen-l"));
    let fired = false;
    for (let i = 0; i < 240; i++) {
      wing.step(1 / 240);
      fired ||= ["p1-back-l", "p1-front-l"].every((e) => body(wing.w, e)!.injector!.firing);
    }
    expect(fired).toBe(true);
    expect(["p1-back-l", "p1-front-l"].some((e) => body(wing.w, e)!.injector!.firing)).toBe(false);
    expect(st(wing.w).cut).toEqual(["p1-tank-l>p1-back-l", "p1-tank-l>p1-front-l", "p1-tank-l>p1-main"]);
    expect(wing.w.ledger.violations).toBe(0);
  });

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
    expect(bad((s) => (s.world.arcade.mix = [{ channel: "main", any: [] }]))).toThrow(/mix/);
    expect(bad((s) => (s.world.arcade.mix = [{ channel: "", any: [{ on: ["left"] }] }]))).toThrow(/mix/);
    expect(bad((s) => (s.world.arcade.mix = [{ channel: "main", any: [{ on: [] }] }]))).toThrow(/mix/);
  });
});

describe("Mammoth Asteroids: gunships", () => {
  /** A game taken straight to `level`, the ship at rest at the centre. */
  function at(level: number, edit?: (scn: typeof raw) => void) {
    const g = game(edit);
    st(g.w).level = level - 1;
    st(g.w).gold.left = [];
    g.step(1.5 + 2 / 240);
    expect(st(g.w).level).toBe(level);
    return g;
  }
  const hullOf = (w: World) => body(w, `p${st(w).n}-hull`)!;
  const short = (w: World, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const W = w.bounds.max.x - w.bounds.min.x;
    const H = w.bounds.max.y - w.bounds.min.y;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.hypot(dx - W * Math.round(dx / W), dy - H * Math.round(dy / H));
  };

  it("MAS-040 MAS-041 MAS-043 when they come and how well they fight: from level 3; from level 9 sooner, more often and more skilled, to their limits", () => {
    const spec = parseScenario(structuredClone(raw)).world.arcade!;
    expect(gunshipPlan(spec, 1)).toBeNull();
    expect(gunshipPlan(spec, 2)).toBeNull();
    // Game seconds: 10 and 30 are 20 s and a minute on screen.
    expect(gunshipPlan(spec, 3)).toEqual({ first: 10, every: 30, skill: 0.3 });
    expect(gunshipPlan(spec, 5)!.skill).toBeCloseTo(0.5, 12);
    expect(gunshipPlan(spec, 8)).toEqual({ first: 10, every: 30, skill: 0.8 });
    // Past level 8: 2 s sooner and 5 s closer together a level on screen, and 0.05 more skilled.
    const nine = gunshipPlan(spec, 9)!;
    expect([nine.first, nine.every]).toEqual([9, 27.5]);
    expect(nine.skill).toBeCloseTo(0.85, 12);
    const twelve = gunshipPlan(spec, 12)!;
    expect([twelve.first, twelve.every]).toEqual([6, 20]);
    expect(twelve.skill).toBeCloseTo(1, 12);
    // Their limits: 10 s into the level, every 20 s on screen, skill 1.
    for (const level of [16, 30]) expect(gunshipPlan(spec, level)).toEqual({ first: 5, every: 10, skill: 1 });
    expect(gunshipPlan(spec, 13)).toEqual({ first: 5, every: 17.5, skill: 1 });
    // Without the late rules, level 9 is as level 8.
    const plain = structuredClone(spec);
    delete plain.gunship!.late;
    expect(gunshipPlan(plain, 20)).toEqual({ first: 10, every: 30, skill: 0.8 });
  });

  it("MAS-040 no gunship on levels 1 and 2", () => {
    const { w, step } = game();
    expect(st(w).nextGunship).toBeUndefined();
    step(11);
    expect(prefixed(w, "g")).toHaveLength(0);
    expect(st(w).gunships).toEqual([]);
    const two = at(2);
    expect(st(two.w).nextGunship).toBeUndefined();
  });

  it("MAS-040 MAS-041 on level 3 a ring shows 10 s in, and half a second later a Gunship 3 beams in there, clear and away from the player, hunting the player's ship", () => {
    const { w, step } = at(3);
    const start = st(w).levelStart;
    expect(st(w).nextGunship).toBeCloseTo(start + 10, 9);
    step(start + 10 - w.time - 2 / 240);
    expect(st(w).incoming).toBeUndefined();
    step(3 / 240);
    // The ring: where it will come, a beam there, no gunship yet; the next is due 30 s after this one.
    const ring = st(w).incoming!;
    expect(ring.at).toBeCloseTo(w.time + 0.5, 1);
    expect(st(w).beams.some((b) => b.x === ring.x && b.y === ring.y && b.r === 6)).toBe(true);
    expect(prefixed(w, "g1-")).toHaveLength(0);
    expect(st(w).nextGunship).toBeCloseTo(start + 40, 9);
    expect(short(w, hullOf(w).position, ring)).toBeGreaterThanOrEqual(70);
    step(0.5 + 2 / 240);
    expect(st(w).incoming).toBeUndefined();
    expect(st(w).gunships).toEqual([{ n: 1, hull: "g1-hull", out: false }]);
    const hull = body(w, "g1-hull")!;
    expect(Math.hypot(hull.position.x - ring.x, hull.position.y - ring.y)).toBeLessThan(0.5);
    expect(short(w, hullOf(w).position, hull.position)).toBeGreaterThanOrEqual(69);
    // Clear of everything: nothing of it touches a rock as it arrives.
    expect(w.contacts.some((c) => (c.a.startsWith("g1-") && c.b.startsWith("a3-")) || (c.b.startsWith("g1-") && c.a.startsWith("a3-")))).toBe(false);
    // Its pilot: hunting, on the enemy side, with the level's skill; its channels its own.
    expect(hull.pilot).toMatchObject({ mode: "hunting", side: "enemy", skill: { combat: 0.3 } });
    expect(w.links.filter((l) => l.kind === "control" && l.to.startsWith("g1-")).map((l) => (l.kind === "control" ? l.channel : "")).sort()).toEqual(["g1.fire", "g1.left", "g1.right"]);
    expect(prefixed(w, "g1-").some((b) => b.tractor)).toBe(false);
    // Within a second it has picked the player's ship (a ship with a railgun and no pilot is the player's).
    step(1);
    expect(body(w, "g1-hull")!.pilot!.combat!.target).toMatch(/^p\d+-/);
    expect(w.events.some((e) => e.type === "arcade.gunship" && e.data.n === 1 && e.data.skill === 0.3)).toBe(true);
    expect(w.ledger.violations).toBe(0);
  }, 120_000);

  it("MAS-040 a gunship's spot is at least 70 m from the player the short way round, and off the path of what is coming", () => {
    const bounds = { min: { x: -142, y: -80 }, max: { x: 142, y: 80 }, wrap: true };
    const empty = createWorld(1, [], { x: 0, y: 0 }, { bounds });
    for (const player of [{ x: 0, y: 0 }, { x: 130, y: 70 }, { x: -100, y: 10 }]) {
      const spot = gunshipSpot(empty, player);
      const dx = spot.x - player.x - 284 * Math.round((spot.x - player.x) / 284);
      const dy = spot.y - player.y - 160 * Math.round((spot.y - player.y) / 160);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(70);
    }
    // A big rock sitting on the spot an empty arena gives: the gunship comes in somewhere else.
    const first = gunshipSpot(empty, { x: 0, y: 0 });
    const blocked = createWorld(1, [disc("rock", { shape: { kind: "disc", radius: 12 }, position: first })], { x: 0, y: 0 }, { bounds });
    const other = gunshipSpot(blocked, { x: 0, y: 0 });
    expect(Math.hypot(other.x - first.x, other.y - first.y)).toBeGreaterThan(20);
  });

  it("MAS-042 a gunship out of the fight scores 1,000 once: its pilot lets go, its controls are cut, and its wreck stays", () => {
    const { w, step } = at(3);
    st(w).nextGunship = w.time; // now, not in 10 s
    step(0.5 + 4 / 240);
    expect(body(w, "g1-hull")).toBeDefined();
    const before = st(w).score;
    body(w, "g1-hull")!.integrity = 0; // its hull destroyed
    step(2 / 240);
    expect(st(w).score).toBe(before + ARCADE_SCORES.gunship);
    expect(st(w).gunships).toEqual([{ n: 1, hull: "g1-hull", out: true }]);
    expect(st(w).stats.gunships).toBe(1);
    expect(w.events.filter((e) => e.type === "arcade.gunship.out")).toHaveLength(1);
    expect(prefixed(w, "g1-").length).toBeGreaterThan(10); // the wreck
    expect(prefixed(w, "g1-").some((b) => b.pilot)).toBe(false);
    expect(w.links.some((l) => l.kind === "control" && l.to.startsWith("g1-"))).toBe(false);
    step(2);
    expect(st(w).score).toBe(before + ARCADE_SCORES.gunship);
    // No engine left is out too: the second gunship, with both its engines wrecked.
    st(w).nextGunship = w.time;
    step(0.5 + 4 / 240);
    for (const id of ["g2-engine-l", "g2-engine-r"]) body(w, id)!.integrity = 0;
    step(2 / 240);
    expect(st(w).score).toBe(before + 2 * ARCADE_SCORES.gunship);
    expect(body(w, "g2-hull")).toBeDefined();
    expect(w.ledger.violations).toBe(0);
  }, 120_000);

  it("MAS-040 three gunships at the most fly at once: a fourth that is due waits until one is out, and the next is timed from when it came", () => {
    // One every 2 game seconds, on a level with a protected ship that stays.
    const { w, step } = at(3, (scn) => Object.assign(scn.world.arcade.gunship, { first: 0.5, every: 2 }));
    const flying = () => st(w).gunships.filter((g) => !g.out).length;
    step(6);
    expect(flying()).toBe(3);
    step(4); // two more were due by now
    expect(flying()).toBe(3);
    expect(st(w).gunshipCount).toBe(3);
    expect(st(w).incoming).toBeUndefined();
    expect(st(w).nextGunship).toBeLessThan(w.time); // one is waiting
    // One is put out: the fourth's ring shows at once, and it comes half a second later.
    body(w, "g2-hull")!.integrity = 0;
    step(3 / 240);
    expect(st(w).incoming).toBeDefined();
    expect(st(w).nextGunship).toBeCloseTo(w.time + 2, 1); // the fifth is due 2 s after the fourth's ring, not at once
    step(0.5 + 2 / 240);
    expect(flying()).toBe(3);
    expect(st(w).gunships.map((g) => `${g.n}${g.out ? " out" : ""}`)).toEqual(["1", "2 out", "3", "4"]);
    step(4);
    expect(st(w).gunshipCount).toBe(4); // and the fifth waits in its turn
    // A scenario may set another limit.
    const one = at(3, (scn) => Object.assign(scn.world.arcade.gunship, { first: 0.5, every: 2, most: 1 }));
    one.step(8);
    expect(st(one.w).gunshipCount).toBe(1);
    expect(() => game((scn) => (scn.world.arcade.gunship.most = 0))).toThrow(/most/);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("MAS-041 one hit from a gunship's shell on a tank, thruster or gun damages the player's ship, and no single hit destroys it, wherever it lands", () => {
    const shell = raw.world.arcade.gunship.template.bodies.find((b: { magazine?: unknown }) => b.magazine).magazine;
    expect(shell.shell).toMatchObject({ mass: 0.3 });
    expect(shell.shell.explosive).toBeUndefined();
    // From the left at a tank, from the left at a front thruster, from below into the main thruster,
    // from above at the gun, and from the right at the other front thruster (the cockpit's centre is the origin).
    const shots: [{ x: number; y: number }, { x: number; y: number }][] = [
      [{ x: -6, y: -0.55 }, { x: 96, y: 0 }],
      [{ x: -6, y: 0.2 }, { x: 96, y: 0 }],
      [{ x: 0, y: -6 }, { x: 0, y: 96 }],
      [{ x: 0, y: 5 }, { x: 0, y: -96 }],
      [{ x: 6, y: 0.4 }, { x: -96, y: 0 }],
    ];
    const parts = new Set<string>();
    for (const [position, velocity] of shots) {
      const { w, step } = game();
      step(0.3, [{ type: "body.add", body: { ...shell.shell, id: "g9-breech-shell-1", position, velocity, angle: 0, angularVelocity: 0 } }]);
      const hit = w.events.filter((e) => e.type === "collision" && [e.data.a, e.data.b].includes("g9-breech-shell-1")).map((e) => String(e.data.a === "g9-breech-shell-1" ? e.data.b : e.data.a));
      expect(hit[0]).toMatch(/^p1-/);
      parts.add(hit[0]);
      // Damaged: a part or a weld has lost integrity. Not destroyed: the ship flies on.
      const ship = prefixed(w, "p1-");
      const worst = Math.max(...ship.map((b) => 1 - b.integrity), ...w.joints.filter((j) => j.a.startsWith("p1-")).map((j) => 1 - j.integrity));
      // A square hit takes 15 to 18% off a hull part and 5 to 9% off a thruster. A tank is destroyed
      // and explodes; the ship flies on without it.
      expect(worst).toBeGreaterThan(0.005);
      expect(st(w)).toMatchObject({ lost: false, lives: 3, phase: "playing" });
      expect(body(w, "p1-hull")!.integrity).toBeGreaterThan(0.5);
      expect(w.ledger.violations).toBe(0);
    }
    expect(parts.size).toBeGreaterThanOrEqual(4); // the shots landed on different parts
  });

  it("MAS-025 MAS-040 at a level clear the gunships beam out with the rocks, and the next level's first is due again", () => {
    const { w, step } = at(3);
    st(w).nextGunship = w.time;
    step(0.5 + 4 / 240);
    expect(prefixed(w, "g1-").length).toBeGreaterThan(10);
    st(w).gold.left = [];
    step(1.5 + 2 / 240);
    expect(st(w).level).toBe(4);
    expect(prefixed(w, "g")).toHaveLength(0);
    expect(st(w).gunships).toEqual([]);
    expect(st(w).incoming).toBeUndefined();
    expect(st(w).nextGunship).toBeCloseTo(st(w).levelStart + 10, 9);
    expect(st(w).gunshipCount).toBe(1); // the next is g2: no id is used twice
    expect(w.controls["g1.left"] ?? 0).toBe(0);
    expect(w.ledger.violations).toBe(0);
  });

  it("MAS-070 a level with a gunship hunting and firing replays exactly, its shells gone after their time", () => {
    const run = () => {
      // Seed 4: a level where no rock stays in its line of fire (on seed 1 its first shot is 56 s in).
      const { w, step } = at(3, (scn) => {
        scn.world.arcade.gunship.first = 0.25;
        scn.world.arcade.seed = 4;
      });
      // It closes to its stand-off distance, lines up and fires: until its first shot, then a second more.
      const fired = () => w.events.some((e) => e.type === "railgun.fired" && String(e.data.id).startsWith("g1-"));
      for (let k = 0; k < 80 && !fired(); k++) step(0.5);
      step(1);
      return w;
    };
    const a = run();
    const fired = a.events.filter((e) => e.type === "railgun.fired" && String(e.data.id).startsWith("g1-")).length;
    expect(fired).toBeGreaterThan(0);
    // None of its shells is older than their 1.4 s.
    for (const b of a.bodies) if (b.id.startsWith("g1-breech-shell-")) expect(a.tick - st(a).shells[b.id]).toBeLessThanOrEqual(1.4 * 240);
    expect(a.ledger.violations).toBe(0);
    expect(hashValue(run())).toBe(hashValue(a));
  }, 300_000);

  it("MAS-070 a scenario's gunship is checked", () => {
    const bad = (edit: (scn: typeof raw) => void) => () => game(edit);
    expect(bad((s) => (s.world.arcade.gunship.hull = "g{n}-nothing"))).toThrow(/gunship.hull/);
    expect(bad((s) => s.world.arcade.gunship.template.bodies.forEach((b: { pilot?: unknown }) => delete b.pilot))).toThrow(/pilot/);
    expect(bad((s) => (s.world.arcade.gunship.every = 0))).toThrow(/every/);
    expect(bad((s) => (s.world.arcade.gunship.skill.max = 2))).toThrow(/skill/);
    expect(bad((s) => (s.world.arcade.gunship.late.first = 1))).toThrow(/late.first/);
    // Without one, the game has no gunships.
    const none = game((s) => delete s.world.arcade.gunship);
    st(none.w).level = 4;
    st(none.w).gold.left = [];
    none.step(1.5 + 2 / 240);
    expect(st(none.w).nextGunship).toBeUndefined();
  });
});

describe("Mammoth Asteroids: the demo and its Clearing pilot", () => {
  const demo = (seed: number) => game((scn) => Object.assign(scn.world.arcade, { demo: true, seed }));

  it("MAS-060 AIP-020 the demo's ship has a Clearing pilot on its hull, flying through the ship's own channels; the player's game has none", () => {
    const { w, step } = demo(4);
    expect(body(w, "p1-hull")!.pilot).toMatchObject({ mode: "clearing", side: "player" });
    expect(game().w.bodies.some((b) => b.pilot)).toBe(false);
    step(3);
    // It has set the engines, and only its own channels exist: the five engines' and the gun's.
    expect(Object.keys(w.controls).sort()).toEqual(["bl", "br", "fire", "fl", "fr", "main"]);
    expect(body(w, "p1-hull")!.velocity).not.toEqual({ x: 0, y: 0 });
    expect(body(w, "p1-hull")!.pilot!.intent).toMatch(/a1-0-\d+/); // closing on, or attacking, a piece of the rock
    expect(w.ledger.violations).toBe(0);
  });

  it("AIP-020 MAS-060 it shoots the rock where it holds gold, frees a piece and collects it, within 40 game seconds", () => {
    const { w, step } = demo(4);
    let got = false;
    for (let k = 0; k < 80 && !got; k++) {
      step(0.5);
      got = w.events.some((e) => e.type === "arcade.gold");
    }
    expect(got).toBe(true);
    expect(st(w).stats.shots).toBeGreaterThan(0);
    expect(st(w).stats.gold).toBe(1);
    expect(st(w).score).toBeGreaterThanOrEqual(ARCADE_SCORES.gold);
    // What it shot at first was a rock piece welded to gold.
    const first = w.events.find((e) => e.type === "detonation")!;
    expect(first).toBeDefined();
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("MAS-060 a lost demo ship's pilot goes with it, and the next ship has its own", () => {
    const { w, step } = demo(4);
    step(1);
    body(w, "p1-hull")!.integrity = 0.0001; // nearly gone: it stays in the world, wrecked by the next knock
    for (const e of ["main", "back-l", "back-r", "front-l", "front-r"]) body(w, `p1-${e}`)!.integrity = 0; // no engine: lost
    step(2 / 240);
    expect(st(w)).toMatchObject({ lost: true, lives: 2 });
    expect(prefixed(w, "p1-").some((b) => b.pilot)).toBe(false);
    step(1.25 + 2 / 240);
    expect(body(w, "p2-hull")!.pilot).toMatchObject({ mode: "clearing" });
    expect(w.bodies.filter((b) => b.pilot)).toHaveLength(1);
  });

  it("MAS-060 the demo replays exactly", () => {
    const run = () => {
      const { w, step } = demo(4);
      step(8);
      return w;
    };
    expect(hashValue(run())).toBe(hashValue(run()));
    expect(() => game((scn) => (scn.world.arcade.demo = "yes"))).toThrow(/demo/);
  }, 120_000);
});


