// A game controller's state from the browser's pads (src/app/gamepad.ts).
import { describe, expect, it } from "vitest";
import { NO_PAD, readPad, readPads } from "../../src/app/gamepad.ts";

const pad = (down: number[] = [], axes = [0, 0, 0, 0], values: Record<number, number> = {}) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0) })),
  axes,
});

describe("game controller", () => {
  it("PAD-001 the standard layout's buttons are read by name, and nothing held is nothing", () => {
    expect(readPad(pad())).toEqual(NO_PAD);
    expect(readPad(pad([0, 2, 5, 9]))).toEqual({ ...NO_PAD, a: true, x: true, rb: true, start: true });
    expect(readPad(pad([1, 3, 4]))).toEqual({ ...NO_PAD, b: true, y: true, lb: true });
    expect(readPad(pad([12, 13, 14, 15]))).toEqual({ ...NO_PAD, up: true, down: true, left: true, right: true });
  });

  it("PAD-001 the left stick is the D-pad past half its travel, and a trigger counts past 0.3", () => {
    expect(readPad(pad([], [-0.4, 0.4]))).toEqual(NO_PAD);
    expect(readPad(pad([], [-0.6, 0]))).toEqual({ ...NO_PAD, left: true });
    expect(readPad(pad([], [0.6, -0.6]))).toEqual({ ...NO_PAD, right: true, up: true });
    expect(readPad(pad([], [0, 0.9]))).toEqual({ ...NO_PAD, down: true });
    expect(readPad(pad([], [0, 0], { 7: 0.2 }))).toEqual(NO_PAD);
    expect(readPad(pad([], [0, 0], { 6: 0.5, 7: 0.31 }))).toEqual({ ...NO_PAD, lt: true, rt: true });
  });

  it("PAD-001 every connected pad counts, and an empty slot or a pad with few buttons is no trouble", () => {
    expect(readPads([null, pad([0]), null, pad([], [0.8, 0])])).toEqual({ ...NO_PAD, a: true, right: true });
    expect(readPads([])).toEqual(NO_PAD);
    expect(readPad({ buttons: [{ pressed: true, value: 1 }], axes: [] })).toEqual({ ...NO_PAD, a: true });
  });
});
