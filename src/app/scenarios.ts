// Built-in scenarios shown in the picker (UX-001): starters first, then references.
const files = import.meta.glob("../../scenarios/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;

export interface BuiltIn {
  file: string;
  id: string;
  title: string;
  blurb: string;
  raw: Record<string, unknown>;
}

/** Display order and short ids. Test-only scenarios (empty, m0-commands) are not listed. */
const ORDER: [string, string][] = [
  ["sc01-elastic-collision", "SC-01"],
  ["sc02-gas-in-a-box", "SC-02"],
  ["sc03-simplest-rocket", "SC-03"],
  ["fly-twin-engine", "FLY"],
  ["land-twin-engine", "LAND"],
  ["ft-asteroids", "FT"],
  ["ft-breakable", "FT-B"],
  ["cannon-test", "GUN"],
  ["cannon-explosive", "GUN-X"],
  ["gunship", "GS"],
  ["gunship-2", "GS2"],
  ["gunship-rubble", "GS-R"],
  ["gunship-blast", "GS-X"],
  ["tractor", "TRC"],
  ["base", "BASE"],
  ["ai-flight", "AI-1"],
  ["asteroid-collision", "AST-C"],
  ["rs02-off-centre-impact", "RS-02"],
  ["rs03-bullet-thin-wall", "RS-03"],
  ["rs04-box-stack", "RS-04"],
  ["rs05-weak-joint", "RS-05"],
  ["rs05b-spinning-assembly", "RS-05b"],
  ["rs07-gas-burst", "RS-07"],
  ["rs08-chemical-rocket", "RS-08"],
  ["rs09-off-axis-thruster", "RS-09"],
  ["rs10-weak-engine-mount", "RS-10"],
  ["rs11-armour-ram", "RS-11"],
  ["rs16-twin-engine", "RS-16"],
  ["rs00-workload", "RS-00"],
];

export const BUILT_INS: BuiltIn[] = ORDER.flatMap(([name, id]) => {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`));
  if (!entry) return [];
  const raw = entry[1];
  const description = String(raw.description ?? "");
  const blurb = description.replace(/^(Starter SC-\d+|RS-\d+b?)\.\s*/, "");
  return [{ file: name, id, title: String(raw.title ?? name), blurb, raw }];
});
