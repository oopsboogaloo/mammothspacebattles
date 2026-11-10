// Asteroids, first look (AST-001…AST-003): the seeded generator, and fracture by the weld rules.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyOf, computeTotals, createWorld, generateAsteroid, getProfile, initialWorld, parseScenario, polygonArea, revealCompounds, stepInPlace, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const spec = { id: "a", seed: 7, pieces: 20, radius: 6, density: 300, bond: 300_000, position: { x: 0, y: 0 } };
const parts = (w: World, prefix: string) => new Set(w.bodies.filter((b) => b.id.startsWith(prefix)).map((b) => assemblyOf(w, b.id).sort()[0])).size;

describe("asteroid generator", () => {
  it("AST-002 the same seed gives the same asteroid; another seed, another", () => {
    expect(generateAsteroid(spec)).toEqual(generateAsteroid(spec));
    expect(generateAsteroid({ ...spec, seed: 8 })).not.toEqual(generateAsteroid(spec));
  });

  it("AST-001 AST-002 an asteroid is the requested number of convex pieces, tiling it, welded into one rock", () => {
    const a = generateAsteroid(spec);
    expect(a.bodies).toHaveLength(20);
    const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints }); // throws on any invalid polygon
    expect(parts(w, "a-")).toBe(1);
    // Pieces meet edge to edge: their areas add up to the mass the density says.
    const area = a.bodies.reduce((s, b) => s + (b.shape.kind === "polygon" ? polygonArea(b.shape.vertices) : 0), 0);
    expect(a.bodies.reduce((s, b) => s + b.mass, 0)).toBeCloseTo(300 * area, 6);
    // A bond's limits scale with its shared edge: tension = bond × length, torque = bond × length² / 4.
    for (const j of a.joints) {
      const len = j.limits!.tension! / 300_000;
      expect(j.limits!.torque).toBeCloseTo((300_000 * len * len) / 4, 6);
      expect(len).toBeGreaterThan(0);
    }
  });

  it("AST-001 an asteroid left alone, or spinning slowly, stays whole", () => {
    for (const w0 of [0, 0.5]) {
      const a = generateAsteroid({ ...spec, angularVelocity: w0 });
      const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints }, sandbox);
      for (let i = 0; i < 480; i++) stepInPlace(w, [], sandbox);
      expect(w.events.some((e) => e.type === "joint.break")).toBe(false);
      expect(w.ledger.violations).toBe(0);
    }
  }, 300_000);

  it("AST-003 two asteroids colliding fast shatter into parts, with mass and momentum conserved", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "asteroid-collision.json")), { speed: 12 });
    const w = initialWorld(scn);
    const t0 = computeTotals(w);
    for (let i = 0; i < 960; i++) stepInPlace(w, [], sandbox);
    const t1 = computeTotals(w);
    // Pieces destroyed in the crash leave in dust (DMG-007); the rest break into parts.
    const gone = (prefix: string) => w.events.filter((e) => e.type === "destroyed.removed" && String(e.data.id).startsWith(prefix)).length;
    expect(parts(w, "big-") + gone("big-")).toBeGreaterThan(3);
    expect(parts(w, "small-") + gone("small-")).toBeGreaterThan(3);
    // What stays plus what left through the boundary is what there was.
    const left = w.events.filter((e) => e.type === "destroyed.removed").reduce((m, e) => m + Number(e.data.mass), 0);
    expect(t1.mass + left).toBeCloseTo(t0.mass, 6);
    if (!left) {
      expect(t1.momentum.x).toBeCloseTo(t0.momentum.x, 3);
      expect(t1.momentum.y).toBeCloseTo(t0.momentum.y, 3);
    }
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AST-002 a scenario's asteroids are validated", () => {
    const raw = readJson(join(ROOT, "scenarios", "asteroid-collision.json")) as { world: { asteroids: Record<string, unknown>[] } };
    raw.world.asteroids[0].pieces = 0;
    raw.world.asteroids[1].radius = -1;
    let paths: string[] = [];
    try {
      parseScenario(raw);
    } catch (e) {
      paths = (e as { errors: { path: string }[] }).errors.map((x) => x.path);
    }
    expect(paths.sort()).toEqual(["$.world.asteroids[0].pieces", "$.world.asteroids[1].radius"]);
  });

  it("AST-003 DMG-002 an asteroid's pieces carry its material, which is validated", () => {
    const made = generateAsteroid({ ...spec, material: { name: "rock", threshold: 10, toughness: 200 } });
    expect(made.bodies.every((b) => b.material?.toughness === 200)).toBe(true);
    expect(generateAsteroid(spec).bodies.every((b) => b.material === undefined)).toBe(true);
    const raw = readJson(join(ROOT, "scenarios", "asteroid-collision.json")) as { world: { asteroids: Record<string, unknown>[] } };
    raw.world.asteroids[0].material = { threshold: 10, toughness: 0 };
    expect(() => parseScenario(raw)).toThrow(/asteroids\[0\]\.material\.toughness/);
  });
});

describe("asteroid minerals and larger fragments", () => {
  const rock = { name: "rock", threshold: 10, toughness: 200 };
  const rich = { ...spec, pieces: 12, material: rock, gold: 1, compounds: 2 };

  it("AST-006 an asteroid holds one gold piece at random: denser, much tougher, the same for the same seed", () => {
    const a = generateAsteroid(rich);
    const gold = a.bodies.filter((b) => b.mineral === "gold");
    expect(gold).toHaveLength(1);
    const g = gold[0];
    const area = polygonArea((g.shape as { vertices: { x: number; y: number }[] }).vertices);
    expect(g.mass).toBeCloseTo(2 * spec.density * area, 6);
    expect(g.material!.toughness).toBe(2000);
    expect(generateAsteroid(rich).bodies.find((b) => b.mineral === "gold")!.id).toBe(g.id);
    // Minerals and larger fragments leave the shape alone.
    expect(a.bodies.map((b) => b.shape)).toEqual(generateAsteroid({ ...spec, pieces: 12 }).bodies.map((b) => b.shape));
    const ids = new Set([0, 1, 2, 3, 4, 5].map((seed) => generateAsteroid({ ...rich, seed }).bodies.find((b) => b.mineral === "gold")!.id));
    expect(ids.size).toBeGreaterThan(2); // it moves about from rock to rock
  });

  it("AST-007 a larger fragment is neighbouring pieces with hidden seams, twenty times as strong as a bond", () => {
    const a = generateAsteroid(rich);
    const groups = new Map<string, string[]>();
    for (const b of a.bodies) if (b.compound) groups.set(b.compound.id, [...(groups.get(b.compound.id) ?? []), b.id]);
    expect(groups.size).toBe(2);
    for (const members of groups.values()) {
      expect(members).toHaveLength(3);
      const seams = a.joints.filter((j) => members.includes(j.a) && members.includes(j.b));
      expect(seams.length).toBeGreaterThanOrEqual(2); // connected
      for (const j of seams) {
        expect(j.hidden).toBeDefined();
        expect(j.limits!.tension).toBeCloseTo(20 * j.hidden!.tension, 6);
      }
    }
    expect(a.joints.filter((j) => j.hidden).every((j) => [...groups.values()].some((m) => m.includes(j.a) && m.includes(j.b)))).toBe(true);
  });

  it("AST-007 once a larger fragment has lost a quarter of its integrity its seams show and take ordinary limits", () => {
    const a = generateAsteroid(rich);
    const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints });
    const cid = w.bodies.find((b) => b.compound)!.compound!.id;
    const members = w.bodies.filter((b) => b.compound?.id === cid);
    const mass = members.reduce((s, b) => s + b.mass, 0);
    // A scratch, a tenth of its integrity by mass: not enough.
    members[0].integrity = 1 - (0.1 * mass) / members[0].mass;
    expect(members[0].integrity).toBeGreaterThan(0);
    stepInPlace(w, [], sandbox);
    expect(members.every((b) => b.compound)).toBe(true);
    expect(w.events.some((e) => e.type === "compound.reveal")).toBe(false);
    // Enough damage: revealed.
    members[1].integrity = 0.05;
    members[2].integrity = 0.05;
    stepInPlace(w, [], sandbox);
    expect(members.some((b) => b.compound)).toBe(false);
    const e = w.events.find((x) => x.type === "compound.reveal")!;
    expect(e.data.id).toBe(cid);
    const ids = new Set(members.map((b) => b.id));
    for (const j of w.joints) if (ids.has(j.a) && ids.has(j.b)) expect(j.hidden).toBeUndefined();
    expect(w.ledger.violations).toBe(0);
    expect(revealCompounds(w)).toEqual([]); // nothing left to show
  });

  it("AST-007 a larger fragment whose hidden seam breaks shows its seams, with no damage to its pieces", () => {
    // No material: damage can never reveal it, so a broken seam must.
    const a = generateAsteroid({ ...rich, material: undefined });
    const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints });
    const seam = w.joints.find((j) => j.hidden)!;
    const cid = w.bodies.find((b) => b.id === seam.a)!.compound!.id;
    w.joints = w.joints.filter((j) => j !== seam); // as if it broke under load
    stepInPlace(w, [], sandbox);
    expect(w.bodies.some((b) => b.compound?.id === cid)).toBe(false);
    expect(w.events.some((e) => e.type === "compound.reveal" && e.data.id === cid)).toBe(true);
  });

  it("AST-006 AST-007 the asteroid scenarios carry gold and larger fragments", () => {
    for (const file of ["gunship-rubble", "gunship-blast", "tractor"]) {
      const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", `${file}.json`))));
      const rocks = new Set(w.bodies.filter((b) => b.mineral === "gold").map((b) => b.id.split("-")[0]));
      expect(rocks.size).toBe(4);
      expect(new Set(w.bodies.filter((b) => b.compound).map((b) => b.compound!.id)).size).toBe(6);
    }
  });
});

describe("asteroids whose every piece pulls, and gold that can't be destroyed (Mammoth Asteroids)", () => {
  const test = getProfile("test");
  const G = 0.02;
  const pulling = { ...spec, density: 20, bond: 20_000, gold: 2, gravity: { G } };

  it("AST-009 every piece pulls by its mass (gold by its own), softened by its size, and feels other rocks", () => {
    const a = generateAsteroid(pulling);
    for (const b of a.bodies) {
      const reach = Math.max(...(b.shape as { vertices: { x: number; y: number }[] }).vertices.map((v) => Math.hypot(v.x, v.y)));
      expect(b.gravity).toMatchObject({ mu: G * b.mass, feels: true });
      expect(b.gravity!.core).toBeCloseTo(reach, 12);
    }
    const plain = generateAsteroid({ ...pulling, gold: 0 });
    const gold = a.bodies.filter((b) => b.mineral === "gold");
    expect(gold).toHaveLength(2);
    for (const g of gold) expect(g.gravity!.mu).toBeCloseTo(2 * plain.bodies.find((b) => b.id === g.id)!.gravity!.mu, 12);
    expect(generateAsteroid({ ...pulling, gravity: { G, core: 3 } }).bodies.every((b) => b.gravity!.core === 3)).toBe(true);
    expect(generateAsteroid(spec).bodies.every((b) => b.gravity === undefined)).toBe(true);
  });

  it("AST-009 a rock's pieces don't pull each other: alone it stays exactly at rest, whole; a probe falls toward it at about G·M/r²", () => {
    const a = generateAsteroid(pulling);
    const M = a.bodies.reduce((m, b) => m + b.mass, 0);
    const alone = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints }, test);
    for (let i = 0; i < 240; i++) stepInPlace(alone, [], test);
    expect(alone.bodies.every((b) => b.velocity.x === 0 && b.velocity.y === 0 && b.angularVelocity === 0)).toBe(true);
    expect(parts(alone, "a-")).toBe(1);
    const probe = { id: "probe", shape: { kind: "disc" as const, radius: 0.2 }, mass: 1, position: { x: 40, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 };
    const w = createWorld(1, [...a.bodies, probe], { x: 0, y: 0 }, { joints: a.joints }, test);
    const comX = a.bodies.reduce((x, b) => x + b.mass * b.position.x, 0) / M;
    stepInPlace(w, [], test);
    const p = w.bodies.find((b) => b.id === "probe")!;
    const r = 40 - comX;
    expect(-p.velocity.x / test.timestep).toBeGreaterThan(0.95 * ((G * M) / (r * r)));
    expect(-p.velocity.x / test.timestep).toBeLessThan(1.05 * ((G * M) / (r * r)));
    expect(w.ledger.violations).toBe(0);
  });

  it("AST-009 a piece broken off is pulled back by the rest of its rock, and the rock toward it", () => {
    const a = generateAsteroid(pulling);
    // The piece furthest out, cut loose and set 2 m further out, at rest.
    const far = a.bodies.reduce((m, b) => (Math.hypot(b.position.x, b.position.y) > Math.hypot(m.position.x, m.position.y) ? b : m));
    const out = Math.hypot(far.position.x, far.position.y);
    const dir = { x: far.position.x / out, y: far.position.y / out };
    far.position = { x: far.position.x + 2 * dir.x, y: far.position.y + 2 * dir.y };
    const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints.filter((j) => j.a !== far.id && j.b !== far.id) }, test);
    for (let i = 0; i < 240; i++) stepInPlace(w, [], test);
    const piece = w.bodies.find((b) => b.id === far.id)!;
    const rest = w.bodies.filter((b) => b.id !== far.id);
    expect(piece.velocity.x * dir.x + piece.velocity.y * dir.y).toBeLessThan(-0.01); // falling back
    const restP = rest.reduce((s, b) => s + b.mass * (b.velocity.x * dir.x + b.velocity.y * dir.y), 0);
    expect(restP).toBeGreaterThan(0); // and the rock comes to meet it
    expect(w.ledger.violations).toBe(0);
  });

  it("AST-010 indestructible gold has no material: a blast that wrecks the rock leaves the gold whole, and loose", () => {
    const weak = { name: "rock", threshold: 10, toughness: 100 };
    const rock = generateAsteroid({ ...spec, radius: 3, pieces: 12, material: weak, gold: 2, goldIndestructible: true });
    const gold = rock.bodies.filter((b) => b.mineral === "gold").map((b) => b.id);
    expect(gold).toHaveLength(2);
    for (const b of rock.bodies) expect(b.material === undefined).toBe(gold.includes(b.id));
    // Destructible gold keeps its tougher material, as before.
    expect(generateAsteroid({ ...spec, material: weak, gold: 1 }).bodies.find((b) => b.mineral === "gold")!.material!.name).toBe("gold");
    const charge = { id: "charge", shape: { kind: "disc" as const, radius: 0.1 }, mass: 1, position: { x: 5, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, explosive: { charge: 0.5, fragments: 0, radius: 12, armed: true, trigger: true } };
    const w = createWorld(1, [...rock.bodies, charge], { x: 0, y: 0 }, { joints: rock.joints });
    for (let i = 0; i < 30; i++) stepInPlace(w, [], sandbox);
    expect(w.events.some((e) => e.type === "detonation")).toBe(true);
    const left = w.bodies.filter((b) => b.id.startsWith("a-"));
    expect(left.filter((b) => b.mineral === "gold").map((b) => b.id).sort()).toEqual([...gold].sort());
    for (const b of left.filter((x) => x.mineral === "gold")) expect(b.integrity).toBe(1);
    expect(left.filter((b) => b.mineral !== "gold").length).toBeLessThan(rock.bodies.length - 2); // rock was wrecked and removed
    // The gold's welds went with the rock round it.
    expect(w.joints.filter((j) => gold.includes(j.a) || gold.includes(j.b)).length).toBeLessThan(rock.joints.filter((j) => gold.includes(j.a) || gold.includes(j.b)).length);
  });

  it("AST-009 AST-010 a scenario's asteroid may ask for both, and they are validated", () => {
    const raw = readJson(join(ROOT, "scenarios", "asteroid-collision.json")) as { world: { asteroids: Record<string, unknown>[] } };
    Object.assign(raw.world.asteroids[0], { gravity: { G: 0.02 }, goldIndestructible: true });
    const w = initialWorld(parseScenario(raw));
    expect(w.bodies.filter((b) => b.gravity?.feels).length).toBeGreaterThan(0);
    for (const bad of [{ gravity: { G: 0 } }, { gravity: { G: 1, core: -1 } }, { gravity: 3 }, { goldIndestructible: "yes" }]) {
      const r = readJson(join(ROOT, "scenarios", "asteroid-collision.json")) as { world: { asteroids: Record<string, unknown>[] } };
      Object.assign(r.world.asteroids[0], bad);
      expect(() => parseScenario(r)).toThrow();
    }
  });
});

