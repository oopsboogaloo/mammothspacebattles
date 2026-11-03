// Probe paths into a world, e.g. "tick", "bodies[id=a].velocity.x", "bodies[0].mass", "events.length".

type Segment = { key: string } | { index: number } | { idEquals: string };

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\[id=([^\]]+)\]|(\.)/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m.index !== pos) break;
    pos = re.lastIndex;
    if (m[1] !== undefined) segments.push({ key: m[1] });
    else if (m[2] !== undefined) segments.push({ index: Number(m[2]) });
    else if (m[3] !== undefined) segments.push({ idEquals: m[3] });
  }
  if (pos !== path.length || segments.length === 0) throw new Error(`Invalid probe path "${path}"`);
  return segments;
}

/** Returns the value at the path, or undefined if any part is missing. */
export function resolvePath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of parsePath(path)) {
    if (cur === null || typeof cur !== "object") return undefined;
    if ("key" in seg) cur = (cur as Record<string, unknown>)[seg.key];
    else if ("index" in seg) cur = Array.isArray(cur) ? cur[seg.index] : undefined;
    else cur = Array.isArray(cur) ? cur.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === seg.idEquals) : undefined;
  }
  return cur;
}
