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
  ["rs02-off-centre-impact", "RS-02"],
  ["rs03-bullet-thin-wall", "RS-03"],
  ["rs04-box-stack", "RS-04"],
  ["rs00-workload", "RS-00"],
];

export const BUILT_INS: BuiltIn[] = ORDER.flatMap(([name, id]) => {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`));
  if (!entry) return [];
  const raw = entry[1];
  const description = String(raw.description ?? "");
  const blurb = description.replace(/^(Starter SC-\d+|RS-\d+)\.\s*/, "");
  return [{ file: name, id, title: String(raw.title ?? name), blurb, raw }];
});
