import { describe, expect, it } from "vitest";
import { paramDef } from "../src/dsp/params";
import { Synth } from "../src/dsp/synth";
import { MonoVoice } from "../src/dsp/voice";
import { SAMPLE_RATE, magnitudeAt, rms } from "./helpers";

/** Note 45 is A2 at 110 Hz, low enough to leave room for harmonics and a sub. */
const A2 = 45;
const A2_HZ = 110;

function voice(patch: Partial<Record<string, number>> = {}): MonoVoice {
  const v = new MonoVoice(SAMPLE_RATE);
  v.setParam("ampAttack", 0.001);
  v.setParam("ampSustain", 1);
  v.setParam("ampDecay", 0.001);
  for (const [id, value] of Object.entries(patch)) v.setParam(id as never, value as number);
  return v;
}

function play(v: MonoVoice, note = A2, frames = SAMPLE_RATE / 2): Float32Array {
  v.noteOn(note, 100);
  const out = new Float32Array(frames);
  v.render(out);
  // Past the attack, where the tone has settled.
  return out.subarray(frames >> 1);
}

const level = (buffer: Float32Array, hz: number) => magnitudeAt(buffer, hz, SAMPLE_RATE);

describe("Mixer", () => {
  it("is VCO 1 alone by default", () => {
    for (const id of ["mixOsc2", "mixSub", "mixNoise"] as const) expect(paramDef(id).default).toBe(0);
    expect(paramDef("mixOsc1").default).toBe(1);
  });

  it("silences a source at zero and scales it in between", () => {
    const full = play(voice({ mixOsc1: 1 }));
    const half = play(voice({ mixOsc1: 0.5 }));
    const off = play(voice({ mixOsc1: 0 }));
    expect(level(half, A2_HZ)).toBeCloseTo(level(full, A2_HZ) / 2, 2);
    expect(rms(off)).toBe(0);
  });

  it("adds the sub an octave below VCO 1, following its octave switch", () => {
    const without = play(voice());
    const with_ = play(voice({ mixSub: 1 }));
    expect(level(without, A2_HZ / 2)).toBeLessThan(0.01);
    expect(level(with_, A2_HZ / 2)).toBeGreaterThan(0.3);

    // VCO 1 up an octave takes the sub with it: the sub lands where VCO 1 was.
    const shifted = play(voice({ mixSub: 1, mixOsc1: 0, osc1Octave: 1 }));
    expect(level(shifted, A2_HZ)).toBeGreaterThan(0.3);
  });

  it("adds broadband noise that is not a pitch", () => {
    const noisy = play(voice({ mixOsc1: 0, mixNoise: 1 }));
    expect(rms(noisy)).toBeGreaterThan(0.1);
    // Energy everywhere rather than at harmonics of anything.
    for (const hz of [137, 461, 1723, 5011]) expect(level(noisy, hz)).toBeGreaterThan(0);
    const tonal = play(voice());
    expect(level(noisy, A2_HZ)).toBeLessThan(level(tonal, A2_HZ) * 0.1);
  });

  it("gives each poly voice its own noise, rather than one noise eight times", () => {
    const chord = new Synth(SAMPLE_RATE);
    const single = new Synth(SAMPLE_RATE);
    for (const s of [chord, single]) {
      s.setParam("ampAttack", 0.001);
      s.setParam("mixOsc1", 0);
      s.setParam("mixNoise", 1);
    }
    for (const note of [60, 64, 67, 71]) chord.noteOn(note, 100);
    single.noteOn(60, 100);

    const render = (s: Synth) => {
      const out = new Float32Array(SAMPLE_RATE / 4);
      s.render(out);
      return rms(out.subarray(out.length >> 1));
    };
    // Four correlated copies would sum to four times one; four independent
    // ones sum to about twice, the square root of four.
    const ratio = render(chord) / render(single);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.6);
  });
});

describe("VCO 2", () => {
  it("sounds at VCO 1's pitch when it is not offset", () => {
    const both = play(voice({ mixOsc1: 0, mixOsc2: 1 }));
    expect(level(both, A2_HZ)).toBeGreaterThan(0.3);
  });

  it("coarse pitch sets an interval against VCO 1", () => {
    // Seven semitones up is a fifth: 110 Hz against 164.81 Hz.
    const fifth = play(voice({ mixOsc2: 1, osc2Pitch: 7 }));
    expect(level(fifth, A2_HZ)).toBeGreaterThan(0.3);
    expect(level(fifth, 164.81)).toBeGreaterThan(0.3);
  });

  it("the octave switch and coarse pitch stack", () => {
    const up = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Octave: 1, osc2Pitch: 7 }));
    // An octave and a fifth above 110 Hz is 329.63 Hz.
    expect(level(up, 329.63)).toBeGreaterThan(0.3);
  });

  it("fine detune shifts it by cents", () => {
    // Two seconds, so the analysis window resolves partials three Hz apart:
    // at a quarter second the bins are four Hz wide and the two smear into one.
    const detuned = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Detune: 50 }), A2, SAMPLE_RATE * 2);
    // Fifty cents above 110 Hz is 113.23 Hz, and nothing is left at 110.
    expect(level(detuned, 113.23)).toBeGreaterThan(0.3);
    expect(level(detuned, A2_HZ)).toBeLessThan(level(detuned, 113.23) * 0.2);
  });

  it("detuning against VCO 1 beats at the difference between them", () => {
    // Level in short windows across a second, which is where beating shows.
    const envelope = (detune: number): number[] => {
      const buffer = play(voice({ mixOsc1: 1, mixOsc2: 1, osc2Detune: detune }), A2, SAMPLE_RATE * 2);
      const step = Math.round(SAMPLE_RATE * 0.04);
      const levels: number[] = [];
      for (let i = 0; i + step <= buffer.length; i += step) levels.push(rms(buffer.subarray(i, i + step)));
      return levels;
    };
    const swing = (levels: number[]) => Math.max(...levels) / Math.max(1e-9, Math.min(...levels));
    /** How many times the level crosses its own average: two per beat cycle. */
    const crossings = (levels: number[]): number => {
      const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
      let count = 0;
      for (let i = 1; i < levels.length; i++) {
        if (((levels[i - 1] ?? 0) - mean) * ((levels[i] ?? 0) - mean) < 0) count++;
      }
      return count;
    };

    const beating = envelope(50);
    // Fifty cents apart at 110 Hz is a beat every 310 ms, so a second of audio
    // swings through it about three times: six crossings of the average.
    expect(crossings(beating)).toBeGreaterThanOrEqual(4);
    expect(crossings(beating)).toBeLessThanOrEqual(9);
    // The dip is real but partial. Two saws never null the way two sines
    // would: every harmonic beats at its own multiple of the difference, so
    // they are never all opposed at once.
    expect(swing(beating)).toBeGreaterThan(1.5);
    // In tune, the pair is steady.
    expect(swing(envelope(0))).toBeLessThan(1.2);
  });

  it("tracks the keyboard and holds the interval at any note", () => {
    const low = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Pitch: 7 }), 45);
    const high = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Pitch: 7 }), 69);
    expect(level(low, 164.81)).toBeGreaterThan(0.3);
    // A4 is 440, so the fifth above is 659.26 Hz.
    expect(level(high, 659.26)).toBeGreaterThan(0.3);
  });

  it("has its own waveform and shape", () => {
    // A square at 50% has no even harmonics; a saw has them all.
    const square = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Wave: 1 }));
    const saw = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Wave: 0 }));
    expect(level(square, A2_HZ * 2)).toBeLessThan(level(saw, A2_HZ * 2) * 0.1);
    // Widening the pulse brings the even harmonics back.
    const pulse = play(voice({ mixOsc1: 0, mixOsc2: 1, osc2Wave: 1, osc2Shape: 0.5 }));
    expect(level(pulse, A2_HZ * 2)).toBeGreaterThan(level(square, A2_HZ * 2) * 5);
  });
});
