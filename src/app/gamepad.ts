// A game controller in the games (Lander, Mammoth Asteroids, Mammoth Thrust).
//
// The browser gives a controller's state only when asked, so each frame the pads are read and
// compared with the frame before. In flight, what is held goes to the game as named controls, each
// pressed and let go once. Out of flight (a title, a menu, paused, game over) the pad moves around
// the buttons on screen: the D-pad or stick steps from one to the next, A presses the one chosen.
// Start pauses and resumes.
import { useEffect } from "preact/hooks";

/** What a pad is doing, as the standard layout names it (the browser's "standard" mapping). */
export interface PadState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  lb: boolean;
  rb: boolean;
  lt: boolean;
  rt: boolean;
  start: boolean;
}
export const PAD_KEYS = ["left", "right", "up", "down", "a", "b", "x", "y", "lb", "rb", "lt", "rt", "start"] as const;
export const NO_PAD: PadState = { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false, lb: false, rb: false, lt: false, rt: false, start: false };

/** How far the stick must be pushed to count, of its full travel. */
export const STICK = 0.5;
/** How far a trigger must be pulled to count. */
export const TRIGGER = 0.3;

interface RawPad {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

/** How far the stick is pushed each way, and how far each trigger is pulled, 0 to 1 (past a small dead zone), every pad together. */
export interface PadAnalog {
  left: number;
  right: number;
  up: number;
  down: number;
  lt: number;
  rt: number;
}
/** Stick travel ignored at its centre, of the whole: a stick at rest is rarely exactly still. */
export const DEAD = 0.15;
const past = (x: number) => (x > DEAD ? Math.min(1, (x - DEAD) / (1 - DEAD)) : 0);

/** The pads' analog inputs: the left stick's four directions and the triggers, the strongest of every pad. */
export function readAnalog(pads: readonly (RawPad | null)[]): PadAnalog {
  const out: PadAnalog = { left: 0, right: 0, up: 0, down: 0, lt: 0, rt: 0 };
  for (const pad of pads) {
    if (!pad) continue;
    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    out.left = Math.max(out.left, past(-x));
    out.right = Math.max(out.right, past(x));
    out.up = Math.max(out.up, past(-y));
    out.down = Math.max(out.down, past(y));
    out.lt = Math.max(out.lt, pad.buttons[6]?.value ?? 0);
    out.rt = Math.max(out.rt, pad.buttons[7]?.value ?? 0);
  }
  return out;
}

/** One pad's state: the D-pad and the left stick are the same four directions. */
export function readPad(pad: RawPad): PadState {
  const on = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > TRIGGER);
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  return {
    left: on(14) || x < -STICK,
    right: on(15) || x > STICK,
    up: on(12) || y < -STICK,
    down: on(13) || y > STICK,
    a: on(0),
    b: on(1),
    x: on(2),
    y: on(3),
    lb: on(4),
    rb: on(5),
    lt: on(6),
    rt: on(7),
    start: on(9),
  };
}

/** Every connected pad together: any of them may hold a button. */
export function readPads(pads: readonly (RawPad | null)[]): PadState {
  const out = { ...NO_PAD };
  for (const pad of pads) {
    if (!pad) continue;
    const s = readPad(pad);
    for (const k of PAD_KEYS) out[k] = out[k] || s[k];
  }
  return out;
}

export interface PadGame {
  /** The ship is being flown: the game's play screen, running. */
  flying: () => boolean;
  /** The controls this pad state holds, by the game's own names. */
  controls: (p: PadState) => string[];
  /** A control is pressed, or let go. */
  set: (control: string, on: boolean) => void;
  /** Start: pause or resume, if the game can be. Returns false if there is nothing to pause. */
  pause: () => boolean;
  /**
   * A game whose controls take values between 0 and 1 (Mammoth Asteroids' and Thrust's ships): the
   * value each of its channels should have, from the pad's buttons and its stick and triggers; and
   * how to set one. These channels are then left out of `controls`.
   */
  analog?: { values: (p: PadState, a: PadAnalog) => Record<string, number>; set: (channel: string, value: number) => void };
}

/** A value is sent again only when it has changed by this much (or gone to 0 or 1). */
const STEP = 0.03;

/** A menu over the game: while one is up, the pad works its buttons only. */
const MODAL = ".mas-modal, .lander-modal";

/** The buttons the pad can step through: those on screen, in the menu if one is up; never the hold buttons. */
function choices(): HTMLButtonElement[] {
  const root: ParentNode = document.querySelector(MODAL) ?? document;
  return [...root.querySelectorAll<HTMLButtonElement>("button:not([disabled]):not([data-hold])")].filter((b) => b.getClientRects().length > 0);
}

/** Moves the choice on by `by` buttons (from none: the first, or the last going back). */
function step(by: number): void {
  const all = choices();
  if (!all.length) return;
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  const to = at < 0 ? (by > 0 ? 0 : all.length - 1) : (at + by + all.length) % all.length;
  all[to].focus();
}

/** Presses the chosen button; with none chosen, the first. */
function press(): void {
  const all = choices();
  const at = all.indexOf(document.activeElement as HTMLButtonElement);
  (all[at] ?? all[0])?.click();
}

/** Reads the pads each frame for a game (see the top of this file). */
export function usePad(game: PadGame): void {
  useEffect(() => {
    let raf = 0;
    let before = { ...NO_PAD };
    const held = new Set<string>();
    // The analog channels' values as last sent.
    const sent = new Map<string, number>();
    const zeroAnalog = () => {
      for (const [c, v] of sent) if (v !== 0) game.analog!.set(c, 0);
      sent.clear();
    };
    // Buttons that were down when flight began (A on Play, say) do nothing until let go.
    const stale = new Set<keyof PadState>();
    let wasFlying = false;
    const letGo = () => {
      for (const c of held) game.set(c, false);
      held.clear();
      if (game.analog) zeroAnalog();
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      const now = readPads(pads);
      const hit = (k: keyof PadState) => now[k] && !before[k];
      const used = PAD_KEYS.some((k) => now[k]);
      // Shows which button is chosen once a pad is in use (styles.css).
      if (used) document.documentElement.classList.add("pad");
      const flying = game.flying() && !document.querySelector(MODAL);
      for (const k of [...stale]) if (!now[k]) stale.delete(k);
      if (flying && !wasFlying) for (const k of PAD_KEYS) if (now[k]) stale.add(k);
      wasFlying = flying;
      if (flying) {
        const live = { ...now };
        for (const k of stale) live[k] = false;
        const want = new Set(game.controls(live));
        for (const c of [...held]) {
          if (want.has(c)) continue;
          held.delete(c);
          game.set(c, false);
        }
        for (const c of want) {
          if (held.has(c)) continue;
          held.add(c);
          game.set(c, true);
        }
        if (game.analog) {
          // A button or stick held since before flight began counts for nothing until let go, here too.
          const a = readAnalog(pads);
          for (const k of ["left", "right", "up", "down", "lt", "rt"] as const) if (stale.has(k)) a[k] = 0;
          const values = game.analog.values(live, a);
          for (const [c, raw] of Object.entries(values)) {
            const v = Math.max(0, Math.min(1, raw));
            const was = sent.get(c) ?? 0;
            if (v === was || (Math.abs(v - was) < STEP && v !== 0 && v !== 1)) continue;
            sent.set(c, v);
            game.analog.set(c, v);
          }
        }
        if (hit("start") && !stale.has("start")) {
          letGo();
          game.pause();
        }
      } else {
        letGo();
        if (hit("up") || hit("left")) step(-1);
        if (hit("down") || hit("right")) step(1);
        if (hit("a")) press();
        // Start resumes a paused game; anywhere else it is A.
        if (hit("start") && !game.pause()) press();
      }
      before = now;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      letGo();
    };
  }, []);
}
