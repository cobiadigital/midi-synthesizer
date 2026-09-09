import { describe, expect, it } from "vitest";
import { Highpass, LadderFilter } from "../src/dsp/filter";
import { SAMPLE_RATE, magnitudeAt, peak } from "./helpers";

/** Run a sine through a filter and return its gain at that frequency, past the settling time. */
function gainAt(filter: { process(x: number): number }, hz: number, amplitude = 0.05): number {
  const n = SAMPLE_RATE / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = filter.process(amplitude * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
  }
  return magnitudeAt(out.subarray(n >> 1), hz, SAMPLE_RATE) / amplitude;
}

function ladder(cutoff: number, resonance = 0, drive = 1): LadderFilter {
  const filter = new LadderFilter(SAMPLE_RATE);
  filter.setCutoff(cutoff);
  filter.setResonance(resonance);
  filter.setDrive(drive);
  return filter;
}

const db = (gain: number) => 20 * Math.log10(gain);

describe("LadderFilter", () => {
  it("passes the band below cutoff at close to unity", () => {
    expect(db(gainAt(ladder(2000), 300))).toBeGreaterThan(-1.5);
  });

  it("rolls off at 24 dB per octave", () => {
    // Measured an octave apart, well into the stopband where the slope has
    // settled. Four poles is 24 dB; the oversampled feedback loop costs a
    // little of it near the top.
    const octave = db(gainAt(ladder(1000), 4000)) - db(gainAt(ladder(1000), 8000));
    expect(octave).toBeGreaterThan(20);
    expect(octave).toBeLessThan(28);
  });

  it("resonance peaks at the marked cutoff, not beside it", () => {
    const flat = db(gainAt(ladder(1000), 1000));
    const resonant = db(gainAt(ladder(1000, 0.9), 1000));
    expect(resonant - flat).toBeGreaterThan(15);
    // The peak is a peak: its neighbours an octave either side are well below.
    expect(db(gainAt(ladder(1000, 0.9), 500))).toBeLessThan(resonant - 15);
    expect(db(gainAt(ladder(1000, 0.9), 2000))).toBeLessThan(resonant - 15);
  });

  it("self-oscillates at the top of the resonance knob and nowhere below it", () => {
    const ring = (resonance: number): number => {
      const filter = ladder(1000, resonance);
      filter.process(1);
      const out = new Float32Array(SAMPLE_RATE);
      for (let i = 0; i < out.length; i++) out[i] = filter.process(0);
      return peak(out.subarray(out.length - 4800));
    };
    expect(ring(0.5)).toBeLessThan(1e-6);
    expect(ring(1)).toBeGreaterThan(0.05);
  });

  it("stays bounded with resonance and drive at maximum", () => {
    const filter = ladder(1000, 1, 8);
    let worst = 0;
    for (let i = 0; i < SAMPLE_RATE; i++) {
      const out = filter.process(Math.sin((2 * Math.PI * 100 * i) / SAMPLE_RATE));
      worst = Math.max(worst, Math.abs(out));
    }
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst).toBeLessThan(2);
  });

  it("drive grows harmonics that are not there when clean", () => {
    const third = (drive: number): number => {
      const filter = ladder(2000, 0, drive);
      const n = SAMPLE_RATE / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = filter.process(0.8 * Math.sin((2 * Math.PI * 300 * i) / SAMPLE_RATE));
      return magnitudeAt(out.subarray(n >> 1), 900, SAMPLE_RATE);
    };
    expect(db(third(8)) - db(third(1))).toBeGreaterThan(20);
  });

  it("reset clears the poles so no note inherits the last one", () => {
    const filter = ladder(1000, 0.9);
    for (let i = 0; i < 1000; i++) filter.process(1);
    filter.reset();
    for (let i = 0; i < 100; i++) expect(filter.process(0)).toBe(0);
  });
});

describe("Highpass", () => {
  function highpass(cutoff: number): Highpass {
    const filter = new Highpass(SAMPLE_RATE);
    filter.setCutoff(cutoff);
    return filter;
  }

  it("blocks DC", () => {
    const filter = highpass(100);
    let last = 0;
    for (let i = 0; i < SAMPLE_RATE; i++) last = filter.process(1);
    expect(Math.abs(last)).toBeLessThan(1e-3);
  });

  it("passes the band above cutoff at close to unity", () => {
    expect(db(gainAt(highpass(500), 4000))).toBeGreaterThan(-1.5);
  });

  it("rolls off at 12 dB per octave below cutoff", () => {
    const octave = db(gainAt(highpass(500), 250)) - db(gainAt(highpass(500), 125));
    expect(octave).toBeGreaterThan(9);
    expect(octave).toBeLessThan(13);
  });
});
