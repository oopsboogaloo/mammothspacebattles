// A tiny, safe expression language for scenario assertions (SCN-003).
// Supports numbers, + - * / ^, parentheses, unary minus, functions
// ln, sqrt, abs, min, max, and probe references: `v` (value at the assertion's
// step), `v@0` (at tick 0) and `v@end` (at the final tick).

export type ProbeLookup = (id: string, at: number | "here" | "end") => number;

const FUNCS: Record<string, { arity: number; fn: (...a: number[]) => number }> = {
  ln: { arity: 1, fn: Math.log },
  sqrt: { arity: 1, fn: Math.sqrt },
  abs: { arity: 1, fn: Math.abs },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
};

type Tok = { t: "num"; v: number } | { t: "id"; v: string; at: number | "here" | "end" } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)(?:@(\d+|end))?|([-+*/^(),]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected character at ${pos} in "${src}"`);
    pos = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: "id", v: m[2], at: m[3] === undefined ? "here" : m[3] === "end" ? "end" : Number(m[3]) });
    else toks.push({ t: "op", v: m[4] });
  }
  return toks;
}

export function evaluateFormula(src: string, lookup: ProbeLookup): number {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}" in "${src}"`);
    i++;
  };

  function expr(): number {
    let v = term();
    while (isOp("+") || isOp("-")) v = toks[i++].v === "+" ? v + term() : v - term();
    return v;
  }
  function term(): number {
    let v = unary();
    while (isOp("*") || isOp("/")) v = toks[i++].v === "*" ? v * unary() : v / unary();
    return v;
  }
  // Unary minus binds looser than ^, so -2^2 = -4 as in standard notation.
  function unary(): number {
    if (isOp("-")) {
      i++;
      return -unary();
    }
    return power();
  }
  function power(): number {
    const base = atom();
    if (isOp("^")) {
      i++;
      return base ** unary(); // right-associative; allows 2^-1
    }
    return base;
  }
  function atom(): number {
    const tok = toks[i++];
    if (!tok) throw new Error(`Unexpected end of "${src}"`);
    if (tok.t === "num") return tok.v;
    if (tok.t === "op" && tok.v === "(") {
      const v = expr();
      expect(")");
      return v;
    }
    if (tok.t === "id") {
      const f = FUNCS[tok.v];
      if (f && isOp("(")) {
        i++;
        const args = [expr()];
        while (isOp(",")) {
          i++;
          args.push(expr());
        }
        expect(")");
        if (args.length !== f.arity) throw new Error(`${tok.v}() takes ${f.arity} argument(s)`);
        return f.fn(...args);
      }
      return lookup(tok.v, tok.at);
    }
    throw new Error(`Unexpected "${tok.v}" in "${src}"`);
  }

  const v = expr();
  if (i !== toks.length) throw new Error(`Unexpected "${toks[i].v}" in "${src}"`);
  return v;
}
