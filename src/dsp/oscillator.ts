import { clamp } from "./math";

export type Waveform = "saw" | "square" | "triangle";

/**
 * PolyBLEP (polynomial band-limited step) correction.
 * `t` is the phase in [0, 1), `dt` is the phase increment per sample.
 * Returns a residual to add near each discontinuity so the waveform's
 * sharp edges are smoothed over two samples, suppressing aliasing.
 */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * A single anti-aliased oscillator producing saw, square, or triangle.
 *
 * `shape` (0..1) is the Minilogue-style "shape" control. Its meaning depends
 * on the waveform:
 *  - square: pulse width, from 50% (0) to 95% (1)
 *  - saw: ignored for now (reserved for a phase-offset double saw)
 *  - triangle: ignored for now (reserved for wave folding)
 */
export class Oscillator {
  /** Phase in [0, 1). Public so tests and sync can inspect or reset it. */
  phase = 0;
  /** Triangle integrator state. Starts at -1 so the wave swings -1..+1 with no DC offset. */
  private triState = -1;

  constructor(private readonly sampleRate: number) {}

  reset(): void {
    this.phase = 0;
    this.triState = -1;
  }

  /** Render one sample at `frequency` Hz. */
  process(frequency: number, waveform: Waveform, shape = 0): number {
    const dt = clamp(frequency / this.sampleRate, 0, 0.5);
    const t = this.phase;
    let out: number;

    switch (waveform) {
      case "saw": {
        out = 2 * t - 1 - polyBlep(t, dt);
        break;
      }
      case "square": {
        out = this.square(t, dt, shape);
        break;
      }
      case "triangle": {
        // Triangle = leaky integral of a 50% square. A gentle leak keeps DC
        // from accumulating when frequency changes mid-note.
        const sq = this.square(t, dt, 0);
        this.triState = this.triState * (1 - dt * 0.05) + 4 * dt * sq;
        out = this.triState;
        break;
      }
    }

    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return out;
  }

  private square(t: number, dt: number, shape: number): number {
    const pulseWidth = 0.5 + clamp(shape, 0, 1) * 0.45;
    let out = t < pulseWidth ? 1 : -1;
    out += polyBlep(t, dt);
    let fallingEdge = t - pulseWidth;
    if (fallingEdge < 0) fallingEdge += 1;
    out -= polyBlep(fallingEdge, dt);
    return out;
  }
}
