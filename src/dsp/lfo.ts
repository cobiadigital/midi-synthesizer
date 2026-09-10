import { DIVISIONS } from "./clock";
import { clamp, makeRandom } from "./math";

export const LFO_WAVES = ["triangle", "saw", "square", "random"] as const;
export type LfoWave = (typeof LFO_WAVES)[number];

/**
 * Low frequency oscillator: a modulation source, not something you hear.
 *
 * Nothing here is band-limited, and it does not need to be. A PolyBLEP square
 * exists to keep a 2 kHz edge from folding back into the audible range; a
 * 5 Hz square's edges land where nothing is listening, and the corners are
 * the point of the shape.
 *
 * `random` is sample and hold: one new value per cycle, held flat until the
 * next. The generator is seeded per instance so a pool of voices does not
 * step through the same sequence together.
 */
export class Lfo {
  private phase = 0;
  private increment = 0;
  private wave: LfoWave = "triangle";
  private held = 0;
  private readonly random: () => number;

  constructor(
    private readonly sampleRate: number,
    seed = 1,
  ) {
    this.random = makeRandom(0x1f123bb5 + seed * 0x9e3779b1);
    this.held = this.random() * 2 - 1;
    this.setRate(5);
  }

  setWave(index: number): void {
    this.wave = LFO_WAVES[clamp(Math.round(index), 0, LFO_WAVES.length - 1)] ?? "triangle";
  }

  setRate(hz: number): void {
    this.increment = clamp(hz, 0.01, 100) / this.sampleRate;
  }

  /** Rate from tempo and a step division, the same arithmetic the step clock uses. */
  setSynced(bpm: number, division: number): void {
    const index = clamp(Math.round(division), 0, DIVISIONS.length - 1);
    const beats = DIVISIONS[index]?.beats ?? 1;
    this.setRate(bpm / 60 / beats);
  }

  /**
   * Start the cycle again. Called on note-on so each voice's wobble begins
   * with its note: a chord shimmers rather than pulsing in lockstep.
   */
  retrigger(): void {
    this.phase = 0;
    if (this.wave === "random") this.held = this.random() * 2 - 1;
  }

  /** One sample, in -1..1. */
  process(): number {
    this.phase += this.increment;
    if (this.phase >= 1) {
      this.phase -= 1;
      // A new value per cycle, so the hold length follows the rate knob.
      if (this.wave === "random") this.held = this.random() * 2 - 1;
    }

    switch (this.wave) {
      case "triangle": {
        // Zero at the start of the cycle and rising, so a retriggered note
        // bends up from where it was rather than jumping to an extreme.
        const t = this.phase;
        return t < 0.25 ? t * 4 : t < 0.75 ? 2 - t * 4 : t * 4 - 4;
      }
      case "saw":
        // A ramp, so it does start at an extreme: that is what a ramp is.
        return this.phase * 2 - 1;
      case "square":
        return this.phase < 0.5 ? 1 : -1;
      case "random":
        return this.held;
    }
  }
}
