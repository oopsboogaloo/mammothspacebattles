// Frame pacing for a game on a slow device (Chloe, 14 November 2026: "does letting frame rate drop to
// 30fps help?"). The page has two costs a frame: taking in the worker's world and drawing it. When the
// frames run long the page draws every other one, 30 fps, which halves both, and draws lighter; the
// simulation is untouched (it runs in the worker at its own rate) and the skipped frame's time is
// carried into the next, so everything moves as fast as before, only drawn half as often. It goes
// back to full rate once the drawing has room to spare.

/** Below this, frames per second, for a second: drop to half rate. */
const SLOW_FPS = 40;
/** At half rate: drawn this fast, and each frame's work this short, ms, for this long, s: back to full. */
const KEEP_FPS = 28;
const SPARE_MS = 8;
const RECOVER_S = 3;
const ENTER_S = 1;

export interface Pace {
  /** Skip this frame (half rate). */
  skip: boolean;
  /** Draw lighter (half rate). */
  lite: boolean;
}

export class FramePacer {
  half = false;
  private last = -1;
  private interval = 1000 / 60;
  private work = 0;
  private slowFor = 0;
  private fineFor = 0;
  private parity = false;

  /** At the start of a frame, `now` ms: whether to skip it, and how to draw. */
  frame(now: number): Pace {
    // At half rate every other frame is skipped, and isn't measured: the next drawn one is.
    if (this.half) {
      this.parity = !this.parity;
      if (this.parity) return { skip: true, lite: true };
    }
    if (this.last >= 0) {
      const dt = Math.min(250, now - this.last);
      const s = dt / 1000;
      this.interval = this.interval * 0.9 + dt * 0.1;
      if (!this.half) {
        this.slowFor = this.interval > 1000 / SLOW_FPS ? this.slowFor + s : 0;
        if (this.slowFor >= ENTER_S) {
          this.half = true;
          this.fineFor = 0;
          this.parity = false;
        }
      } else {
        this.fineFor = this.interval < 1000 / KEEP_FPS && this.work < SPARE_MS ? this.fineFor + s : 0;
        if (this.fineFor >= RECOVER_S) {
          this.half = false;
          this.slowFor = 0;
          this.interval = 1000 / 60;
        }
      }
    }
    this.last = now;
    return { skip: false, lite: this.half };
  }

  /** At the end of a frame drawn: how long its work took, ms. */
  done(workMs: number): void {
    this.work = this.work * 0.8 + workMs * 0.2;
  }
}
