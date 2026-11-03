// Numeric field with units, typing and drag-to-scrub, and inline validation (INS-002, INS-004).
import { useEffect, useRef, useState } from "preact/hooks";
import { plain } from "./format.ts";

export interface NumberFieldProps {
  id: string;
  label: string;
  value: number | "mixed";
  unit?: string;
  step?: number;
  decimals?: number;
  /** Returns an error message, or null if the value is acceptable. */
  validate?: (v: number) => string | null;
  onCommit: (v: number) => void;
  title?: string;
}

export function NumberField({ id, label, value, unit, step = 0.1, decimals = 3, validate, onCommit, title }: NumberFieldProps) {
  const shown = value === "mixed" ? "" : plain(value, decimals);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  const scrub = useRef<{ x: number; start: number; moved: boolean; value: number } | null>(null);

  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);

  const commit = (raw: string) => {
    editing.current = false;
    const trimmed = raw.trim();
    if (trimmed === "" && value === "mixed") return;
    const v = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(v)) {
      setError("Enter a number");
      setText(shown);
      return;
    }
    const problem = validate?.(v) ?? null;
    if (problem) {
      setError(problem);
      setText(shown); // keep the previous value
      return;
    }
    setError(null);
    if (value === "mixed" || v !== value) onCommit(v);
  };

  const onLabelDown = (e: PointerEvent) => {
    if (value === "mixed") return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, start: value, moved: false, value };
  };
  const onLabelMove = (e: PointerEvent) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 2 && !s.moved) return;
    s.moved = true;
    s.value = s.start + Math.round(dx / 4) * step * (e.shiftKey ? 10 : 1);
    setText(plain(s.value, decimals));
  };
  const onLabelUp = () => {
    const s = scrub.current;
    scrub.current = null;
    // Use the ref, not `text`: the re-render with the new text may not have happened yet.
    if (s?.moved) commit(plain(s.value, decimals));
  };

  return (
    <div class={`field ${value === "mixed" ? "mixed" : ""}`}>
      <label for={id} title={title ?? "Drag left or right to change (Shift for ×10)"} onPointerDown={onLabelDown} onPointerMove={onLabelMove} onPointerUp={onLabelUp}>
        {label}
      </label>
      <div class="input">
        <input
          id={id}
          data-testid={`field-${id}`}
          inputMode="decimal"
          value={text}
          placeholder={value === "mixed" ? "mixed" : undefined}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => (editing.current = true)}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setText(shown);
              setError(null);
              editing.current = false;
              (e.currentTarget as HTMLInputElement).blur();
            }
            e.stopPropagation();
          }}
        />
        {unit && <span class="unit">{unit}</span>}
      </div>
      {error && (
        <div class="error" id={`${id}-error`} role="alert" data-testid={`error-${id}`}>
          {error}
        </div>
      )}
    </div>
  );
}
