import { describe, expect, it } from "vitest";
import { DIVISION_LABELS } from "../src/dsp/clock";
import { LFO_WAVES } from "../src/dsp/lfo";
import { LFO_TARGETS } from "../src/dsp/params";
import { MonoVoice } from "../src/dsp/voice";
import { SAMPLE_RATE, estimateFrequency, magnitudeAt, rms } from "./helpers";

const A3 = 57;
const A3_HZ = 220;

function voice(patch: Record<string, number> = {}): MonoVoice {
  const v = new MonoVoice(SAMPLE_RATE);
  v.setParam("ampAttack", 0.001);
  v.setParam("ampDecay", 0.001);
  v.setParam("ampSustain", 1);
  for (const [id, value] of Object.entries(patch)) v.setParam(id as never, value);
  return v;
}

const wave = (name: string) => LFO_WAVES.indexOf(name as never);
const target = (name: string) => LFO_TARGETS.indexOf(name as never);

function play(v: MonoVoice, seconds = 1.2, note = A3): Float32Array {
  v.noteOn(note, 100);
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  v.render(out);
  return out;
}

/** A window of 80 ms starting at `seconds`. */
function at(buffer: Float32Array, seconds: number): Float32Array {
  const start = Math.round(seconds * SAMPLE_RATE);
  return buffer.subarray(start, start + Math.round(0.08 * SAMPLE_RATE));
}

/** Energy above the fundamental relative to it: how bright the tone is. */
function brightness(window: Float32Array): number {
  let high = 0;
  for (let h = 4; h <= 10; h++) high += magnitudeAt(window, A3_HZ * h, SAMPLE_RATE);
  return high / Math.max(1e-9, magnitudeAt(window, A3_HZ, SAMPLE_RATE));
}

describe("LFO routing", () => {
  it("sweeps the cutoff, so the tone opens and closes on the beat of the LFO", () => {
    // A square LFO at 1 Hz holds the cutoff up for half a second, then down.
    const buffer = play(voice({
      filterCutoff: 500, lfoWave: wave("square"), lfoRate: 1,
      lfoTarget: target("cutoff"), lfoDepth: 0.5,
    }));
    expect(brightness(at(buffer, 0.1))).toBeGreaterThan(brightness(at(buffer, 0.6)) * 5);
  });

  it("bends pitch, which is what vibrato is", () => {
    const buffer = play(voice({
      lfoWave: wave("square"), lfoRate: 1, lfoTarget: target("pitch"), lfoDepth: 0.5,
    }));
    // Half depth of an octave either way: up a tritone, then down one.
    const up = estimateFrequency(at(buffer, 0.2), SAMPLE_RATE);
    const down = estimateFrequency(at(buffer, 0.7), SAMPLE_RATE);
    expect(up / down).toBeCloseTo(2, 0);
    expect(up).toBeGreaterThan(A3_HZ);
    expect(down).toBeLessThan(A3_HZ);
  });

  it("moves the pulse width, which a square hears as its even harmonics coming and going", () => {
    const buffer = play(voice({
      osc1Wave: 1, filterCutoff: 18000,
      lfoWave: wave("square"), lfoRate: 1, lfoTarget: target("shape"), lfoDepth: 0.6,
    }));
    const even = (w: Float32Array) => magnitudeAt(w, A3_HZ * 2, SAMPLE_RATE);
    // Wide pulse first, back to a symmetrical square after the LFO flips.
    expect(even(at(buffer, 0.2))).toBeGreaterThan(even(at(buffer, 0.7)) * 10);
  });

  it("does nothing at all when depth is down", () => {
    const still = play(voice({ filterCutoff: 500, lfoWave: wave("square"), lfoRate: 1, lfoDepth: 0 }));
    expect(brightness(at(still, 0.1))).toBeCloseTo(brightness(at(still, 0.6)), 5);
  });

  it("locks to the tempo when synced", () => {
    // A quarter note at 120 bpm is half a second, so the square LFO flips
    // every quarter second rather than every half.
    const buffer = play(voice({
      filterCutoff: 500, lfoWave: wave("square"), lfoTarget: target("cutoff"), lfoDepth: 0.5,
      lfoSync: 1, lfoDivision: DIVISION_LABELS.indexOf("1/4"), tempo: 120,
    }));
    expect(brightness(at(buffer, 0.05))).toBeGreaterThan(brightness(at(buffer, 0.3)) * 5);
    expect(brightness(at(buffer, 0.55))).toBeGreaterThan(brightness(at(buffer, 0.3)) * 5);
  });

  it("starts its cycle again on every note, so a chord shimmers instead of pulsing together", () => {
    const v = voice({
      filterCutoff: 500, lfoWave: wave("square"), lfoRate: 1,
      lfoTarget: target("cutoff"), lfoDepth: 0.5,
    });
    const first = play(v, 0.6);
    // Half a second in, the square has flipped and the tone has closed.
    expect(brightness(at(first, 0.52))).toBeLessThan(brightness(at(first, 0.1)));
    // A fresh note restarts the cycle: bright again straight away.
    const second = play(v, 0.3);
    expect(brightness(at(second, 0.02))).toBeGreaterThan(brightness(at(first, 0.52)) * 5);
  });
});

describe("Mod wheel and velocity", () => {
  it("the wheel adds depth on top of the knob", () => {
    const patch = { filterCutoff: 500, lfoWave: wave("square"), lfoRate: 1, lfoTarget: target("cutoff") };
    const parked = play(voice({ ...patch, lfoDepth: 0 }));
    expect(brightness(at(parked, 0.1))).toBeCloseTo(brightness(at(parked, 0.6)), 5);

    const wheeled = play(voice({ ...patch, lfoDepth: 0, modWheel: 0.5 }));
    expect(brightness(at(wheeled, 0.1))).toBeGreaterThan(brightness(at(wheeled, 0.6)) * 5);
  });

  it("velocity opens the filter when it is routed there", () => {
    const hard = voice({ filterCutoff: 400, velToCutoff: 0.5 });
    const soft = voice({ filterCutoff: 400, velToCutoff: 0.5 });
    hard.noteOn(A3, 127);
    soft.noteOn(A3, 20);
    const render = (v: MonoVoice) => {
      const out = new Float32Array(SAMPLE_RATE / 4);
      v.render(out);
      return out.subarray(out.length >> 1);
    };
    expect(brightness(render(hard))).toBeGreaterThan(brightness(render(soft)) * 3);
  });

  it("velocity to amplitude defaults to the curve it had before the knob existed", () => {
    const level = (velocity: number, amount?: number): number => {
      const v = voice(amount === undefined ? {} : { velToAmp: amount });
      v.noteOn(A3, velocity);
      const out = new Float32Array(SAMPLE_RATE / 4);
      v.render(out);
      return rms(out.subarray(out.length >> 1));
    };
    // The old fixed curve was 0.3 + 0.7 * velocity, which is exactly what a
    // Vel Amp of 0.7 gives: a note at zero velocity keeps 30% of its level.
    expect(level(0) / level(127)).toBeCloseTo(0.3, 1);
    // Turned off, velocity stops changing the level at all.
    expect(level(20, 0) / level(127, 0)).toBeCloseTo(1, 2);
    // Turned up, a soft note all but disappears.
    expect(level(20, 1) / level(127, 1)).toBeLessThan(0.2);
  });
});
