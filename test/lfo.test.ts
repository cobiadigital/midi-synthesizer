import { describe, expect, it } from "vitest";
import { DIVISION_LABELS } from "../src/dsp/clock";
import { Lfo, LFO_WAVES } from "../src/dsp/lfo";
import { SAMPLE_RATE } from "./helpers";

function run(lfo: Lfo, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = lfo.process();
  return out;
}

function lfoAt(wave: string, hz: number): Lfo {
  const lfo = new Lfo(SAMPLE_RATE);
  lfo.setWave(LFO_WAVES.indexOf(wave as never));
  lfo.setRate(hz);
  lfo.retrigger();
  return lfo;
}

/** Cycles per second, counted from upward crossings of zero. */
function rateOf(buffer: Float32Array): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < buffer.length; i++) {
    if ((buffer[i - 1] ?? 0) < 0 && (buffer[i] ?? 0) >= 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  }
  return crossings < 2 ? 0 : ((crossings - 1) * SAMPLE_RATE) / (last - first);
}

describe("Lfo", () => {
  it("stays inside its range whatever the wave", () => {
    for (const wave of LFO_WAVES) {
      const out = run(lfoAt(wave, 7), 1);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("runs at the rate it is given", () => {
    for (const hz of [1, 5, 20]) {
      expect(rateOf(run(lfoAt("triangle", hz), 4))).toBeCloseTo(hz, 1);
    }
  });

  it("starts a triangle at zero and rises, so a note bends up from where it was", () => {
    const lfo = lfoAt("triangle", 1);
    const out = run(lfo, 1);
    expect(out[0] ?? 1).toBeCloseTo(0, 2);
    expect(out[Math.round(SAMPLE_RATE * 0.25)] ?? 0).toBeCloseTo(1, 2);
    expect(out[Math.round(SAMPLE_RATE * 0.5)] ?? 1).toBeCloseTo(0, 2);
    expect(out[Math.round(SAMPLE_RATE * 0.75)] ?? 0).toBeCloseTo(-1, 2);
  });

  it("squares off cleanly and ramps linearly", () => {
    const square = run(lfoAt("square", 2), 1);
    for (const v of square) expect(Math.abs(v)).toBeCloseTo(1, 6);

    const saw = run(lfoAt("saw", 1), 1);
    expect(saw[0] ?? 0).toBeCloseTo(-1, 2);
    expect(saw[Math.round(SAMPLE_RATE * 0.5)] ?? 0).toBeCloseTo(0, 2);
  });

  it("holds a random value for a whole cycle rather than hissing", () => {
    const out = run(lfoAt("random", 4), 1);
    const steps = new Set<number>();
    let changes = 0;
    for (let i = 1; i < out.length; i++) {
      steps.add(out[i] ?? 0);
      if (out[i] !== out[i - 1]) changes++;
    }
    // Four cycles in a second means about four values, each held flat.
    expect(changes).toBeLessThanOrEqual(5);
    expect(steps.size).toBeLessThanOrEqual(6);
    expect(steps.size).toBeGreaterThan(1);
  });

  it("retrigger restarts the cycle", () => {
    const lfo = lfoAt("triangle", 1);
    run(lfo, 0.3);
    lfo.retrigger();
    expect(lfo.process()).toBeCloseTo(0, 2);
  });

  it("syncs to the tempo and division", () => {
    const lfo = new Lfo(SAMPLE_RATE);
    lfo.setWave(LFO_WAVES.indexOf("triangle"));
    // A quarter note at 120 bpm is half a second, so two cycles a second.
    lfo.setSynced(120, DIVISION_LABELS.indexOf("1/4"));
    expect(rateOf(run(lfo, 4))).toBeCloseTo(2, 1);
    // An eighth is twice as fast.
    lfo.setSynced(120, DIVISION_LABELS.indexOf("1/8"));
    expect(rateOf(run(lfo, 4))).toBeCloseTo(4, 1);
  });

  it("gives each instance its own sample-and-hold sequence", () => {
    // Only the random wave consults the generator, so the comparison has to
    // be made there: every other wave is identical whatever the seed.
    const held = (seed: number): number[] => {
      const lfo = new Lfo(SAMPLE_RATE, seed);
      lfo.setWave(LFO_WAVES.indexOf("random"));
      lfo.setRate(20);
      lfo.retrigger();
      return [...new Set(run(lfo, 0.5))];
    };
    expect(held(1)).not.toEqual(held(2));
    // Same seed, same sequence: the pool stays reproducible in tests.
    expect(held(1)).toEqual(held(1));
  });
});
