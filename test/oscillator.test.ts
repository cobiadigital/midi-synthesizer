import { describe, expect, it } from "vitest";
import { fold, Oscillator, polyBlep } from "../src/dsp/oscillator";
import { SAMPLE_RATE, estimateFrequency, magnitudeAt, peak } from "./helpers";

function render(osc: Oscillator, hz: number, wave: "saw" | "square" | "triangle", n: number, shape = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = osc.process(hz, wave, shape);
  return out;
}

describe("polyBlep", () => {
  it("is zero away from the discontinuity", () => {
    expect(polyBlep(0.5, 0.01)).toBe(0);
  });

  it("is continuous across the wrap point", () => {
    const dt = 0.01;
    const before = polyBlep(1 - 1e-9, dt);
    const after = polyBlep(0, dt);
    // Just before the wrap the residual is +1; just after it is -1. Added to a
    // saw that jumps from +1 to -1 this smooths the step by two samples.
    expect(before).toBeCloseTo(1, 5);
    expect(after).toBeCloseTo(-1, 5);
  });
});

describe("Oscillator", () => {
  it.each(["saw", "square", "triangle"] as const)("%s plays at the requested pitch", (wave) => {
    const osc = new Oscillator(SAMPLE_RATE);
    const buf = render(osc, 220, wave, SAMPLE_RATE);
    // Skip the first period so the triangle integrator has settled.
    const f = estimateFrequency(buf.subarray(1000), SAMPLE_RATE);
    expect(f).toBeCloseTo(220, 0);
  });

  it.each(["saw", "square", "triangle"] as const)("%s stays within nominal bounds", (wave) => {
    const osc = new Oscillator(SAMPLE_RATE);
    const buf = render(osc, 440, wave, SAMPLE_RATE / 4);
    expect(peak(buf)).toBeLessThan(1.35);
  });

  it("saw has the expected harmonic rolloff (1/n)", () => {
    const osc = new Oscillator(SAMPLE_RATE);
    const hz = 375; // 48000 / 128, so harmonics sit on DFT bins for a 128-sample window multiple
    const buf = render(osc, hz, "saw", SAMPLE_RATE);
    const h1 = magnitudeAt(buf, hz, SAMPLE_RATE);
    const h2 = magnitudeAt(buf, hz * 2, SAMPLE_RATE);
    const h3 = magnitudeAt(buf, hz * 3, SAMPLE_RATE);
    expect(h1 / h2).toBeCloseTo(2, 0);
    expect(h1 / h3).toBeCloseTo(3, 0);
  });

  it("50% square has no even harmonics", () => {
    const osc = new Oscillator(SAMPLE_RATE);
    const hz = 375;
    const buf = render(osc, hz, "square", SAMPLE_RATE);
    const h1 = magnitudeAt(buf, hz, SAMPLE_RATE);
    const h2 = magnitudeAt(buf, hz * 2, SAMPLE_RATE);
    expect(h2 / h1).toBeLessThan(0.02);
  });

  it("shape widens the pulse and introduces even harmonics", () => {
    const osc = new Oscillator(SAMPLE_RATE);
    const hz = 375;
    const buf = render(osc, hz, "square", SAMPLE_RATE, 0.6);
    const h1 = magnitudeAt(buf, hz, SAMPLE_RATE);
    const h2 = magnitudeAt(buf, hz * 2, SAMPLE_RATE);
    expect(h2 / h1).toBeGreaterThan(0.3);
  });

  it("suppresses aliasing at high pitch compared to a naive saw", () => {
    const hz = 5000;
    const osc = new Oscillator(SAMPLE_RATE);
    const blep = render(osc, hz, "saw", SAMPLE_RATE);
    const naive = new Float32Array(SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < naive.length; i++) {
      naive[i] = 2 * phase - 1;
      phase = (phase + hz / SAMPLE_RATE) % 1;
    }
    // The 10th harmonic (50 kHz) folds back to 48000 - 50000 = -2000 -> 2000 Hz.
    // Anti-aliasing should reduce the energy at that aliased frequency.
    const aliasHz = 2000;
    expect(magnitudeAt(blep, aliasHz, SAMPLE_RATE)).toBeLessThan(magnitudeAt(naive, aliasHz, SAMPLE_RATE) * 0.5);
  });
});

describe("fold", () => {
  it("passes its input through untouched inside the range", () => {
    for (const x of [-1, -0.5, 0, 0.25, 1]) expect(fold(x)).toBeCloseTo(x, 6);
  });

  it("reflects rather than clipping, and stays in range however hard it is driven", () => {
    // Just past the top it turns around: 1.5 comes back as 0.5.
    expect(fold(1.5)).toBeCloseTo(0.5, 6);
    expect(fold(2)).toBeCloseTo(0, 6);
    expect(fold(3)).toBeCloseTo(-1, 6);
    expect(fold(-1.5)).toBeCloseTo(-0.5, 6);
    for (let x = -20; x <= 20; x += 0.013) {
      expect(fold(x)).toBeGreaterThanOrEqual(-1.0000001);
      expect(fold(x)).toBeLessThanOrEqual(1.0000001);
    }
  });

  it("is continuous, so folding cannot click", () => {
    let worst = 0;
    let previous = fold(-8);
    for (let x = -8; x <= 8; x += 0.001) {
      const value = fold(x);
      worst = Math.max(worst, Math.abs(value - previous));
      previous = value;
    }
    expect(worst).toBeLessThan(0.01);
  });
});

describe("Shape", () => {
  /** Harmonic amplitudes 1..n of one waveform at `shape`. */
  function harmonics(waveform: "saw" | "triangle", shape: number, count = 12): number[] {
    const osc = new Oscillator(SAMPLE_RATE);
    const hz = 220;
    const buffer = new Float32Array(SAMPLE_RATE / 2);
    for (let i = 0; i < buffer.length; i++) buffer[i] = osc.process(hz, waveform, shape);
    const settled = buffer.subarray(buffer.length >> 1);
    return Array.from({ length: count }, (_, i) => magnitudeAt(settled, hz * (i + 1), SAMPLE_RATE));
  }

  it("leaves both waves exactly as they were at zero", () => {
    for (const waveform of ["saw", "triangle"] as const) {
      const plain = new Oscillator(SAMPLE_RATE);
      const shaped = new Oscillator(SAMPLE_RATE);
      for (let i = 0; i < 4800; i++) {
        expect(shaped.process(220, waveform, 0)).toBe(plain.process(220, waveform));
      }
    }
  });

  it("saw shape notches the harmonics that fit the offset", () => {
    const plain = harmonics("saw", 0);
    const thinned = harmonics("saw", 1);
    // A half-cycle offset cancels every even harmonic and leaves the odd ones,
    // which is what turns a saw nasal and hollow.
    expect(thinned[1] ?? 1).toBeLessThan((plain[1] ?? 1) * 0.1);
    expect(thinned[3] ?? 1).toBeLessThan((plain[3] ?? 1) * 0.1);
    expect(thinned[2] ?? 0).toBeGreaterThan((plain[2] ?? 1) * 0.5);
  });

  it("folding grows harmonics a triangle does not have", () => {
    const plain = harmonics("triangle", 0);
    const folded = harmonics("triangle", 1);
    const energy = (h: number[]) => h.slice(2).reduce((a, b) => a + b, 0);
    expect(energy(folded)).toBeGreaterThan(energy(plain) * 3);
  });

  it("keeps a folded triangle inside unity", () => {
    const osc = new Oscillator(SAMPLE_RATE);
    let worst = 0;
    for (let i = 0; i < SAMPLE_RATE; i++) worst = Math.max(worst, Math.abs(osc.process(110, "triangle", 1)));
    expect(worst).toBeLessThanOrEqual(1);
  });
});
