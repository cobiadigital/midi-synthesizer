import { describe, expect, it } from "vitest";
import { FILTER_MODES, LadderFilter } from "../src/dsp/filter";
import { SAMPLE_RATE, estimateFrequency, magnitudeAt, peak } from "./helpers";

const MODE = Object.fromEntries(FILTER_MODES.map((label, i) => [label, i])) as Record<string, number>;

interface Settings {
  mode?: number;
  resonance?: number;
  drive?: number;
}

function build({ mode = 0, resonance = 0, drive = 0 }: Settings): LadderFilter {
  const filter = new LadderFilter(SAMPLE_RATE);
  filter.setMode(mode);
  filter.setResonance(resonance);
  filter.setDrive(drive);
  return filter;
}

/** Run a unit sine through the filter and return the settled output. */
function sweep(filter: LadderFilter, cutoff: number, freq: number, frames = 12000): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = filter.process(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE), cutoff);
  }
  // Drop the first half so the filter's transient is not in the measurement.
  return out.subarray(frames / 2);
}

/** Gain in dB at `freq` with the cutoff at `cutoff`. */
function gainDb(settings: Settings, cutoff: number, freq: number): number {
  const settled = sweep(build(settings), cutoff, freq);
  return 20 * Math.log10(Math.max(1e-9, magnitudeAt(settled, freq, SAMPLE_RATE)));
}

/** Run the filter with no input and let the resonance ring or not. */
function freeRun(resonance: number, cutoff: number, frames = SAMPLE_RATE): Float32Array {
  const filter = build({ resonance });
  const out = new Float32Array(frames);
  // A brief nudge so there is something for an unstable loop to grow from.
  for (let i = 0; i < frames; i++) out[i] = filter.process(i < 64 ? 0.01 : 0, cutoff);
  return out.subarray(frames / 2);
}

const CUTOFF = 1000;

describe("LadderFilter", () => {
  it("passes the band below the cutoff and stops the band above it", () => {
    expect(gainDb({}, CUTOFF, 50)).toBeGreaterThan(-1);
    expect(gainDb({}, CUTOFF, 8000)).toBeLessThan(-40);
  });

  it("puts each pole exactly on its own corner at the set cutoff", () => {
    // The taps differ by whole poles, so the gap between the 12 and 6 dB modes
    // is one pole's response. At the cutoff that has to be -3.01 dB, which is
    // the tuning of the whole filter in a single number.
    const onePole = gainDb({ mode: MODE["LP 12"] ?? 0 }, CUTOFF, CUTOFF) - gainDb({ mode: MODE["LP 6"] ?? 0 }, CUTOFF, CUTOFF);
    expect(onePole).toBeCloseTo(-3.01, 1);
  });

  it("stacks the lowpass orders exactly two poles apart", () => {
    for (const freq of [500, 1000, 2000, 4000]) {
      const lp6 = gainDb({ mode: MODE["LP 6"] ?? 0 }, CUTOFF, freq);
      const lp12 = gainDb({ mode: MODE["LP 12"] ?? 0 }, CUTOFF, freq);
      const lp24 = gainDb({ mode: MODE["LP 24"] ?? 0 }, CUTOFF, freq);
      expect((lp24 - lp12) / (lp12 - lp6), `${freq} Hz`).toBeCloseTo(2, 2);
    }
  });

  it("approaches six decibels an octave per pole", () => {
    const mode = MODE["LP 6"] ?? 0;
    const perOctave = gainDb({ mode }, CUTOFF, 4000) - gainDb({ mode }, CUTOFF, 8000);
    // A shade over six: the bilinear frequency warping steepens the response
    // as it nears Nyquist, which is the price of an exactly tuned corner.
    expect(perOctave).toBeGreaterThan(6);
    expect(perOctave).toBeLessThan(7);
  });

  it("highpass modes mirror the lowpass ones", () => {
    expect(gainDb({ mode: MODE["HP 24"] ?? 0 }, CUTOFF, 8000)).toBeGreaterThan(-1);
    expect(gainDb({ mode: MODE["HP 24"] ?? 0 }, CUTOFF, 50)).toBeLessThan(-80);
    expect(gainDb({ mode: MODE["HP 12"] ?? 0 }, CUTOFF, 8000)).toBeGreaterThan(-1);
    // Half the order, so roughly half the attenuation in dB two octaves down.
    const hp24 = gainDb({ mode: MODE["HP 24"] ?? 0 }, CUTOFF, 250);
    const hp12 = gainDb({ mode: MODE["HP 12"] ?? 0 }, CUTOFF, 250);
    expect(hp24 / hp12).toBeGreaterThan(1.8);
    expect(hp24 / hp12).toBeLessThan(2.2);
  });

  it("bandpass modes peak at the cutoff and fall away either side", () => {
    for (const label of ["BP 12", "BP 24"] as const) {
      const mode = MODE[label] ?? 0;
      expect(gainDb({ mode }, CUTOFF, CUTOFF), label).toBeGreaterThan(-1);
      expect(gainDb({ mode }, CUTOFF, 50), label).toBeLessThan(-15);
      expect(gainDb({ mode }, CUTOFF, 16000), label).toBeLessThan(-15);
    }
    // The 24 dB version is two poles either side, so its skirts are steeper.
    expect(gainDb({ mode: MODE["BP 24"] ?? 0 }, CUTOFF, 200)).toBeLessThan(
      gainDb({ mode: MODE["BP 12"] ?? 0 }, CUTOFF, 200) - 5,
    );
  });

  it("notch rejects the cutoff and passes both sides", () => {
    const mode = MODE["Notch"] ?? 0;
    expect(gainDb({ mode }, CUTOFF, CUTOFF)).toBeLessThan(-30);
    expect(gainDb({ mode }, CUTOFF, 50)).toBeGreaterThan(-1);
    expect(gainDb({ mode }, CUTOFF, 16000)).toBeGreaterThan(-1);
  });

  it("resonance lifts the cutoff region step by step", () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map((resonance) => gainDb({ resonance }, CUTOFF, CUTOFF));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i], `resonance step ${i}`).toBeGreaterThan((levels[i - 1] ?? 0) + 1);
    }
    // A useful span between flat and screaming.
    expect((levels[4] ?? 0) - (levels[0] ?? 0)).toBeGreaterThan(15);
  });

  it("resonance does not run away with the passband", () => {
    for (const resonance of [0, 0.5, 1]) {
      expect(gainDb({ resonance }, CUTOFF, 50), `resonance ${resonance}`).toBeGreaterThan(-6);
    }
  });

  it("self-oscillates at the top of the resonance knob and not below it", () => {
    expect(peak(freeRun(0.8, CUTOFF))).toBeLessThan(1e-6);
    expect(peak(freeRun(1, CUTOFF))).toBeGreaterThan(0.2);
  });

  it("self-oscillates in tune with the cutoff", () => {
    for (const cutoff of [110, 440, 2000, 6000]) {
      const tone = freeRun(1, cutoff);
      expect(estimateFrequency(tone, SAMPLE_RATE) / cutoff, `${cutoff} Hz`).toBeCloseTo(1, 1);
    }
  });

  it("keeps self-oscillation at a usable level rather than a runaway one", () => {
    for (const cutoff of [110, 1000, 6000]) {
      const level = peak(freeRun(1, cutoff));
      expect(level, `${cutoff} Hz`).toBeGreaterThan(0.2);
      expect(level, `${cutoff} Hz`).toBeLessThan(1);
    }
  });

  it("is clean at the bottom of the drive knob and dirty at the top", () => {
    const harmonics = [0, 0.5, 1].map((drive) => {
      const settled = sweep(build({ drive }), 12000, 220);
      const fundamental = magnitudeAt(settled, 220, SAMPLE_RATE);
      return magnitudeAt(settled, 660, SAMPLE_RATE) / fundamental;
    });
    expect(harmonics[0]).toBeLessThan(0.01);
    expect(harmonics[1]).toBeGreaterThan(0.03);
    expect(harmonics[2]).toBeGreaterThan(0.15);
  });

  it("stays within a sample's headroom however hard it is driven", () => {
    for (const drive of [0, 0.25, 0.5, 0.75, 1]) {
      const settled = sweep(build({ drive }), 12000, 220);
      expect(peak(settled), `drive ${drive}`).toBeLessThan(1.1);
    }
  });

  it("stays finite at every extreme", () => {
    const filter = build({ resonance: 1, drive: 1, mode: MODE["HP 24"] ?? 0 });
    let worst = 0;
    for (let i = 0; i < SAMPLE_RATE; i++) {
      // Sweep the cutoff across the whole range while hammering the input.
      const cutoff = 20 + 17980 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / SAMPLE_RATE));
      const out = filter.process(i % 2 === 0 ? 1 : -1, cutoff);
      expect(Number.isFinite(out)).toBe(true);
      worst = Math.max(worst, Math.abs(out));
    }
    expect(worst).toBeLessThan(4);
  });
});
