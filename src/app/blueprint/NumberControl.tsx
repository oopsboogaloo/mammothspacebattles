// A number as the designer edits it (docs/blueprint/spec.md §4): a box to type in, a slider, and
// ◀ ▶ steppers that repeat while held; on a mouse, the label scrubs. One undo step per gesture.
import { useEffect, useRef, useState } from "preact/hooks";

export interface NumberControlProps {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  readonly?: boolean;
  note?: string;
  /** Differs from where it started: shows ● and ↺. */
  changed?: boolean;
  onReset?: () => void;
  /** Each value while a gesture goes on. */
  onLive: (v: number) => void;
  /** The gesture is over (or a typed value is committed). */
  onEnd: () => void;
  testid?: string;
}

const fmt = (v: number, d: number) => {
  const s = v.toFixed(d);
  return d === 0 ? Number(s).toLocaleString("en-GB").replace(/,/g, " ") : s;
};

/** A typed value: a number, a sum of them (1.2*2, 3/4 + 0.1), or with cm or mm for metres. */
export function parseTyped(text: string, unit: string): number | null {
  let t = text.trim().replace(/,/g, "").replace(/\s+/g, "");
  let scale = 1;
  if (unit === "m") {
    const u = /(cm|mm|m)$/.exec(t)?.[1];
    if (u) {
      scale = u === "cm" ? 0.01 : u === "mm" ? 0.001 : 1;
      t = t.slice(0, -u.length);
    }
  } else if (unit && t.endsWith(unit)) t = t.slice(0, -unit.length);
  if (!/^[-+*/().\d]+$/.test(t)) return null;
  // A tiny recursive-descent reader for + − × ÷ and brackets (no eval).
  let i = 0;
  const peek = () => t[i];
  const num = (): number => {
    if (peek() === "(") {
      i++;
      const v = sum();
      if (peek() !== ")") throw new Error();
      i++;
      return v;
    }
    if (peek() === "-") return i++, -num();
    if (peek() === "+") return i++, num();
    const m = /^\d*\.?\d+(e[-+]?\d+)?|^\d+\./i.exec(t.slice(i));
    if (!m) throw new Error();
    i += m[0].length;
    return Number(m[0]);
  };
  const prod = (): number => {
    let v = num();
    while (peek() === "*" || peek() === "/") v = t[i++] === "*" ? v * num() : v / num();
    return v;
  };
  const sum = (): number => {
    let v = prod();
    while (peek() === "+" || peek() === "-") v = t[i++] === "+" ? v + prod() : v - prod();
    return v;
  };
  try {
    const v = sum();
    if (i !== t.length || !Number.isFinite(v)) return null;
    return v * scale;
  } catch {
    return null;
  }
}

export function NumberControl(p: NumberControlProps) {
  const [text, setText] = useState(fmt(p.value, p.decimals));
  const [problem, setProblem] = useState<string | null>(null);
  const typing = useRef(false);
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; value: number } | null>(null);
  const valueRef = useRef(p.value);
  valueRef.current = p.value;

  useEffect(() => {
    if (!typing.current) setText(fmt(p.value, p.decimals));
  }, [p.value, p.decimals]);

  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, v));
  const snap = (v: number) => Number(clamp(v).toFixed(Math.max(p.decimals, 3)));

  const commitText = () => {
    typing.current = false;
    const v = parseTyped(text, p.unit);
    if (v === null) {
      setProblem("Type a number, like 1.2 or 120 cm");
      setText(fmt(p.value, p.decimals));
      return;
    }
    const c = clamp(v);
    setProblem(c !== v ? `Kept between ${fmt(p.min, p.decimals)} and ${fmt(p.max, p.decimals)} ${p.unit}` : null);
    p.onLive(snap(c));
    p.onEnd();
    setText(fmt(c, p.decimals));
  };

  // A stepper: one step now, then repeating while held (faster after a while). Shift: ×10.
  const startStep = (dir: number, big: boolean) => {
    const step = p.step * (big ? 10 : 1) * dir;
    let v = valueRef.current;
    const go = (delay: number) => {
      v = snap(v + step);
      p.onLive(v);
      hold.current = { value: v, timer: setTimeout(() => go(Math.max(40, delay * 0.8)), delay) };
    };
    go(400);
  };
  const stopStep = () => {
    if (!hold.current) return;
    clearTimeout(hold.current.timer);
    hold.current = null;
    p.onEnd();
  };
  useEffect(() => () => hold.current?.timer && clearTimeout(hold.current.timer), []);

  // Scrubbing the label (mouse only): 1 px is one step / 4.
  const scrub = useRef<{ x: number; start: number } | null>(null);
  const onLabelDown = (e: PointerEvent) => {
    if (p.readonly || e.pointerType !== "mouse") return;
    scrub.current = { x: e.clientX, start: valueRef.current };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onLabelMove = (e: PointerEvent) => {
    if (!scrub.current) return;
    const dx = e.clientX - scrub.current.x;
    p.onLive(snap(scrub.current.start + (dx * p.step * (e.shiftKey ? 2.5 : 0.25))));
  };
  const onLabelUp = () => {
    if (!scrub.current) return;
    scrub.current = null;
    p.onEnd();
  };

  const pos = ((clamp(p.value) - p.min) / (p.max - p.min || 1)) * 100;
  return (
    <div class={`field${p.readonly ? " ro" : ""}${p.changed ? " changed" : ""}`} data-testid={p.testid}>
      <div class="fl">
        <label title={p.readonly ? "" : "Drag the name left or right to change it"} onPointerDown={onLabelDown} onPointerMove={onLabelMove} onPointerUp={onLabelUp}>
          {p.label}
        </label>
        {p.changed && p.onReset && (
          <button class="reset" title="Back to how it was" onClick={p.onReset} aria-label={`Reset ${p.label}`}>
            ↺
          </button>
        )}
        <div class="val">
          {p.readonly ? (
            <span class="num">{fmt(p.value, p.decimals)}</span>
          ) : (
            <input
              class="num"
              inputMode="decimal"
              aria-label={p.label}
              value={text}
              onFocus={(e) => {
                typing.current = true;
                (e.currentTarget as HTMLInputElement).select();
              }}
              onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                else if (e.key === "Escape") {
                  typing.current = false;
                  setText(fmt(p.value, p.decimals));
                  setProblem(null);
                  (e.currentTarget as HTMLInputElement).blur();
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const v = snap(p.value + (e.key === "ArrowUp" ? 1 : -1) * p.step * (e.shiftKey ? 10 : 1));
                  p.onLive(v);
                  p.onEnd();
                  setText(fmt(v, p.decimals));
                }
              }}
            />
          )}
          <span class="unit">{p.unit}</span>
        </div>
      </div>
      {!p.readonly && (
        <div class="sl">
          <button class="step" aria-label={`Less ${p.label}`} title="Less (hold to repeat; Shift ×10)" onPointerDown={(e) => startStep(-1, e.shiftKey)} onPointerUp={stopStep} onPointerLeave={stopStep} onPointerCancel={stopStep}>
            ◀
          </button>
          <div class="track">
            <div class="fill" style={{ width: `${pos}%` }} />
            <div class="knob" style={{ left: `${pos}%` }} />
            <input
              type="range"
              aria-label={`${p.label} slider`}
              min={p.min}
              max={p.max}
              step={p.step / 10}
              value={p.value}
              onInput={(e) => p.onLive(snap(Number((e.currentTarget as HTMLInputElement).value)))}
              onChange={() => p.onEnd()}
            />
          </div>
          <button class="step" aria-label={`More ${p.label}`} title="More (hold to repeat; Shift ×10)" onPointerDown={(e) => startStep(1, e.shiftKey)} onPointerUp={stopStep} onPointerLeave={stopStep} onPointerCancel={stopStep}>
            ▶
          </button>
        </div>
      )}
      {(problem || p.note) && <div class={`note${problem ? " bad" : ""}`}>{problem ?? p.note}</div>}
    </div>
  );
}
