import { describe, expect, it } from "vitest";
import { MonoVoice } from "../src/dsp/voice";
import { SAMPLE_RATE, estimateFrequency, magnitudeAt, rms } from "./helpers";

/** How much of a note's fifth harmonic survives, relative to its fundamental. */
function brightness(buffer: Float32Array, fundamental: number): number {
  const low = magnitudeAt(buffer, fundamental, SAMPLE_RATE);
  return magnitudeAt(buffer, fundamental * 5, SAMPLE_RATE) / Math.max(1e-9, low);
}

function render(voice: MonoVoice, n: number): Float32Array {
  const out = new Float32Array(n);
  voice.render(out);
  return out;
}

describe("MonoVoice", () => {
  it("is silent until a note is played", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    expect(rms(render(voice, 4800))).toBe(0);
  });

  it("plays middle C at 261.63 Hz", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("ampAttack", 0.001);
    voice.noteOn(60, 100);
    const buf = render(voice, SAMPLE_RATE);
    expect(estimateFrequency(buf.subarray(4800), SAMPLE_RATE)).toBeCloseTo(261.63, 0);
  });

  it("octave switch transposes by 12 semitones", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("ampAttack", 0.001);
    voice.setParam("osc1Octave", 1);
    voice.noteOn(60, 100);
    const buf = render(voice, SAMPLE_RATE);
    expect(estimateFrequency(buf.subarray(4800), SAMPLE_RATE)).toBeCloseTo(523.25, 0);
  });

  it("returns to the held note on release (last-note priority with legato)", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("ampAttack", 0.001);
    voice.noteOn(60, 100);
    render(voice, 4800);
    voice.noteOn(67, 100);
    render(voice, 4800);
    voice.noteOff(67);
    const buf = render(voice, SAMPLE_RATE);
    expect(estimateFrequency(buf.subarray(4800), SAMPLE_RATE)).toBeCloseTo(261.63, 0);
    expect(voice.isActive()).toBe(true);
  });

  it("goes silent after the last key is released", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("ampRelease", 0.02);
    voice.noteOn(60, 100);
    render(voice, 4800);
    voice.noteOff(60);
    render(voice, SAMPLE_RATE / 2);
    expect(voice.isActive()).toBe(false);
    expect(rms(render(voice, 4800))).toBe(0);
  });

  it("glide slides pitch between notes instead of jumping", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("ampAttack", 0.001);
    voice.setParam("glide", 1.0);
    voice.noteOn(48, 100);
    render(voice, 4800);
    voice.noteOn(72, 100);
    // Shortly after the new note, pitch should be well below the target.
    const early = render(voice, 4800);
    const f = estimateFrequency(early, SAMPLE_RATE);
    expect(f).toBeGreaterThan(130);
    expect(f).toBeLessThan(500);
  });

  it("velocity scales loudness", () => {
    const quiet = new MonoVoice(SAMPLE_RATE);
    const loud = new MonoVoice(SAMPLE_RATE);
    for (const v of [quiet, loud]) v.setParam("ampAttack", 0.001);
    quiet.noteOn(60, 20);
    loud.noteOn(60, 127);
    render(quiet, 4800);
    render(loud, 4800);
    expect(rms(render(loud, 4800))).toBeGreaterThan(rms(render(quiet, 4800)) * 1.5);
  });

  it("the cutoff takes the top off the tone", () => {
    const open = new MonoVoice(SAMPLE_RATE);
    const closed = new MonoVoice(SAMPLE_RATE);
    for (const v of [open, closed]) {
      v.setParam("ampAttack", 0.001);
      v.setParam("ampSustain", 1);
    }
    open.setParam("cutoff", 18000);
    closed.setParam("cutoff", 400);
    open.noteOn(60, 100);
    closed.noteOn(60, 100);
    render(open, 4800);
    render(closed, 4800);
    expect(brightness(render(closed, 16384), 261.63)).toBeLessThan(
      brightness(render(open, 16384), 261.63) * 0.2,
    );
  });

  it("the filter envelope sweeps the cutoff and closes again", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("ampAttack", 0.001);
    voice.setParam("ampSustain", 1);
    voice.setParam("cutoff", 300);
    voice.setParam("filterEgAmount", 5);
    voice.setParam("filtAttack", 0.001);
    voice.setParam("filtDecay", 0.4);
    voice.setParam("filtSustain", 0);
    voice.noteOn(60, 100);
    const early = render(voice, 8192);
    render(voice, SAMPLE_RATE);
    const late = render(voice, 8192);
    expect(brightness(early, 261.63)).toBeGreaterThan(brightness(late, 261.63) * 5);
  });

  it("a negative envelope amount closes the filter instead of opening it", () => {
    const up = new MonoVoice(SAMPLE_RATE);
    const down = new MonoVoice(SAMPLE_RATE);
    for (const v of [up, down]) {
      v.setParam("ampAttack", 0.001);
      v.setParam("ampSustain", 1);
      v.setParam("cutoff", 1500);
      v.setParam("filtAttack", 0.001);
      v.setParam("filtSustain", 1);
    }
    up.setParam("filterEgAmount", 2);
    down.setParam("filterEgAmount", -2);
    up.noteOn(60, 100);
    down.noteOn(60, 100);
    render(up, 4800);
    render(down, 4800);
    expect(brightness(render(up, 16384), 261.63)).toBeGreaterThan(
      brightness(render(down, 16384), 261.63) * 4,
    );
  });

  it("key tracking opens the filter as you play up the keyboard", () => {
    const tracked = new MonoVoice(SAMPLE_RATE);
    const fixed = new MonoVoice(SAMPLE_RATE);
    for (const v of [tracked, fixed]) {
      v.setParam("ampAttack", 0.001);
      v.setParam("ampSustain", 1);
      v.setParam("cutoff", 500);
    }
    tracked.setParam("keyTrack", 1);
    // Two octaves up, so full tracking should quadruple the cutoff with it.
    tracked.noteOn(84, 100);
    fixed.noteOn(84, 100);
    render(tracked, 4800);
    render(fixed, 4800);
    expect(rms(render(tracked, 16384))).toBeGreaterThan(rms(render(fixed, 16384)) * 4);
  });

  it("velocity opens the filter when it is routed there", () => {
    const soft = new MonoVoice(SAMPLE_RATE);
    const hard = new MonoVoice(SAMPLE_RATE);
    for (const v of [soft, hard]) {
      v.setParam("ampAttack", 0.001);
      v.setParam("ampSustain", 1);
      v.setParam("cutoff", 400);
      v.setParam("filterVelocity", 1);
    }
    soft.noteOn(60, 10);
    hard.noteOn(60, 127);
    render(soft, 4800);
    render(hard, 4800);
    // Compared as a harmonic ratio, so the velocity gain curve cannot account
    // for the difference on its own.
    expect(brightness(render(hard, 16384), 261.63)).toBeGreaterThan(
      brightness(render(soft, 16384), 261.63) * 5,
    );
  });

  it("never exceeds unity at max volume", () => {
    const voice = new MonoVoice(SAMPLE_RATE);
    voice.setParam("masterVolume", 1);
    voice.setParam("osc1Wave", 1);
    voice.noteOn(36, 127);
    const buf = render(voice, SAMPLE_RATE);
    let peak = 0;
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(1.0);
  });
});
