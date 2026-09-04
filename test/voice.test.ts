import { describe, expect, it } from "vitest";
import { MonoVoice } from "../src/dsp/voice";
import { SAMPLE_RATE, estimateFrequency, rms } from "./helpers";

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
