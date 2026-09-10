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
 *  - saw: a second saw subtracted at a phase offset, which notches the
 *    harmonics that fit the gap and thins the tone toward a nasal, hollow
 *    sound
 *  - triangle: wave folding, which reflects the peaks back down and grows
 *    harmonics a triangle does not otherwise have
 *
 * At shape 0 every wave is exactly what it was before there was a shape
 * control: the saw's second copy is at zero offset and cancels to nothing
 * extra, and the folder passes its input straight through.
 */
/** How far past full scale a fully folded triangle is driven before reflection. */
const FOLD_GAIN = 3;

/**
 * Reflect a signal back into -1..1 rather than clipping at it: past the top it
 * turns around and heads down again, which is what a wave folder does and
 * where its harmonics come from. Continuous, bounded, and periodic in 4, so
 * any input folds however far it overshoots.
 */
export function fold(x: number): number {
  const q = (x + 1) / 4;
  return 1 - 4 * Math.abs(q - Math.floor(q) - 0.5);
}

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
        out = this.saw(t, dt, shape);
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
        out = shape > 0 ? fold(this.triState * (1 + shape * FOLD_GAIN)) : this.triState;
        break;
      }
    }

    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return out;
  }

  /**
   * Saw, optionally minus a copy of itself a fraction of a cycle later. The
   * difference of two saws is silent at the harmonics whose wavelength divides
   * the offset evenly, so sweeping shape sweeps a comb through the spectrum.
   * Each copy carries its own PolyBLEP: there are two discontinuities per
   * cycle now, and an uncorrected one would alias.
   */
  private saw(t: number, dt: number, shape: number): number {
    const first = 2 * t - 1 - polyBlep(t, dt);
    if (shape <= 0) return first;
    let offsetPhase = t + clamp(shape, 0, 1) * 0.5;
    if (offsetPhase >= 1) offsetPhase -= 1;
    const second = 2 * offsetPhase - 1 - polyBlep(offsetPhase, dt);
    // Halved, so a fully thinned saw is not twice the level of a plain one.
    return (first - second * shape) / (1 + shape * 0.5);
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
