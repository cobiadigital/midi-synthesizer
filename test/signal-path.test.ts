import { describe, expect, it } from "vitest";
import { DIVISION_LABELS } from "../src/dsp/clock";
import { Synth } from "../src/dsp/synth";
import { SAMPLE_RATE, magnitudeAt, rms } from "./helpers";

function synth(patch: Partial<Record<string, number>> = {}): Synth {
  const s = new Synth(SAMPLE_RATE);
  s.setParam("ampAttack", 0.001);
  s.setParam("ampDecay", 0.001);
  s.setParam("ampSustain", 1);
  s.setParam("ampRelease", 0.01);
  for (const [id, value] of Object.entries(patch)) s.setParam(id as never, value as number);
  return s;
}

function renderStereo(s: Synth, frames: number, blockSize = 128) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += blockSize) {
    const end = Math.min(frames, offset + blockSize);
    s.render(left.subarray(offset, end), right.subarray(offset, end));
  }
  return { left, right };
}

/** Hold a note for `noteSeconds`, then let whatever it left behind run on. */
function playNote(s: Synth, note: number, noteSeconds: number, totalSeconds: number) {
  const frames = Math.round(totalSeconds * SAMPLE_RATE);
  const noteFrames = Math.round(noteSeconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  s.noteOn(note, 100);
  for (let offset = 0; offset < frames; offset += 128) {
    if (offset >= noteFrames && offset - 128 < noteFrames) s.noteOff(note);
    const end = Math.min(frames, offset + 128);
    s.render(left.subarray(offset, end), right.subarray(offset, end));
  }
  return { left, right };
}

function window(buffer: Float32Array, fromSeconds: number, lengthSeconds = 0.05): Float32Array {
  const start = Math.round(fromSeconds * SAMPLE_RATE);
  return buffer.subarray(start, start + Math.round(lengthSeconds * SAMPLE_RATE));
}

/** Energy at a high harmonic relative to the fundamental: a brightness measure. */
function brightness(buffer: Float32Array, fundamental: number, harmonic: number): number {
  return magnitudeAt(buffer, fundamental * harmonic, SAMPLE_RATE) / magnitudeAt(buffer, fundamental, SAMPLE_RATE);
}

describe("Signal path", () => {
  it("is a bit-exact bypass with everything at its default", () => {
    const s = synth();
    s.noteOn(60, 100);
    const { left, right } = renderStereo(s, SAMPLE_RATE / 2);
    expect(rms(left)).toBeGreaterThan(0.05);
    for (let i = 0; i < left.length; i++) expect(right[i]).toBe(left[i]);
  });

  it("cutoff takes the harmonics off a saw", () => {
    const open = synth({ filterCutoff: 18000 });
    const closed = synth({ filterCutoff: 300 });
    for (const s of [open, closed]) s.noteOn(45, 100);
    const a = renderStereo(open, SAMPLE_RATE / 2).left;
    const b = renderStereo(closed, SAMPLE_RATE / 2).left;
    // 110 Hz fundamental, its ninth harmonic near 1 kHz.
    expect(brightness(b.subarray(4800), 110, 9)).toBeLessThan(brightness(a.subarray(4800), 110, 9) * 0.1);
  });

  it("the filter envelope sweeps the cutoff and then lets it fall", () => {
    const s = synth({ filterCutoff: 200, filterEnvAmount: 1, filterAttack: 0.001, filterDecay: 0.4, filterSustain: 0 });
    s.noteOn(45, 100);
    const { left } = renderStereo(s, SAMPLE_RATE);
    const early = brightness(window(left, 0.02), 110, 9);
    const late = brightness(window(left, 0.8), 110, 9);
    expect(early).toBeGreaterThan(late * 5);
  });

  it("key tracking keeps a high note as bright as a low one", () => {
    const tone = (note: number, keyTrack: number): number => {
      const s = synth({ filterCutoff: 400, filterKeyTrack: keyTrack });
      s.noteOn(note, 100);
      const { left } = renderStereo(s, SAMPLE_RATE / 2);
      return brightness(left.subarray(4800), 440 * Math.pow(2, (note - 69) / 12), 5);
    };
    // Two octaves up, the fifth harmonic is four times further past a fixed
    // cutoff and all but gone; with the filter following the keyboard it
    // survives about as well as it does down low.
    const fixed = tone(48, 0) / tone(72, 0);
    const tracked = tone(48, 1) / tone(72, 1);
    expect(fixed).toBeGreaterThan(10);
    expect(tracked).toBeLessThan(3);
  });

  it("the master high-pass thins the bottom out", () => {
    const flat = synth();
    const thin = synth({ hpfCutoff: 1200 });
    for (const s of [flat, thin]) s.noteOn(36, 100);
    const a = renderStereo(flat, SAMPLE_RATE / 2).left.subarray(4800);
    const b = renderStereo(thin, SAMPLE_RATE / 2).left.subarray(4800);
    const fundamental = 440 * Math.pow(2, (36 - 69) / 12);
    expect(magnitudeAt(b, fundamental, SAMPLE_RATE)).toBeLessThan(magnitudeAt(a, fundamental, SAMPLE_RATE) * 0.1);
  });

  it("the delay repeats a note on the far channel after it has stopped", () => {
    const s = synth({ delayMix: 1, delayTime: 0.3, delayFeedback: 0.4 });
    const { left, right } = playNote(s, 60, 0.05, 1);
    // The note itself is long gone by the time the first repeat lands, and it
    // lands on the left only.
    expect(rms(window(left, 0.2))).toBe(0);
    expect(rms(window(left, 0.31))).toBeGreaterThan(0.01);
    expect(rms(window(right, 0.31))).toBe(0);
    // The second repeat crosses over.
    expect(rms(window(right, 0.61))).toBeGreaterThan(0.001);
  });

  it("a synced delay lands on the division rather than the time knob", () => {
    const s = synth({
      delayMix: 1,
      delayTime: 0.05,
      delaySync: 1,
      delayDivision: DIVISION_LABELS.indexOf("1/8"),
      tempo: 120,
      delayFeedback: 0,
    });
    const { left } = playNote(s, 60, 0.05, 1);
    // An eighth at 120 bpm is 250 ms, not the 50 ms the knob is set to.
    expect(rms(window(left, 0.1))).toBe(0);
    expect(rms(window(left, 0.26))).toBeGreaterThan(0.01);
  });

  it("the reverb keeps sounding after the voice has stopped, in stereo", () => {
    const s = synth({ reverbMix: 1, reverbSize: 0.8 });
    const { left, right } = playNote(s, 60, 0.05, 1);
    const tailL = window(left, 0.5, 0.2);
    const tailR = window(right, 0.5, 0.2);
    expect(rms(tailL)).toBeGreaterThan(0.001);
    // The two sides carry different tails, which is what makes it a room.
    let difference = 0;
    for (let i = 0; i < tailL.length; i++) difference += ((tailL[i] ?? 0) - (tailR[i] ?? 0)) ** 2;
    expect(Math.sqrt(difference / tailL.length)).toBeGreaterThan(rms(tailL) * 0.2);
  });

  it("effects output does not depend on the render block size", () => {
    const patch = { delayMix: 0.5, delayTime: 0.12, delayFeedback: 0.6, reverbMix: 0.4, hpfCutoff: 200 };
    const whole = synth(patch);
    const blocks = synth(patch);
    for (const s of [whole, blocks]) s.noteOn(60, 100);
    const a = renderStereo(whole, 24000, 24000);
    const b = renderStereo(blocks, 24000, 128);
    let worst = 0;
    for (let i = 0; i < 24000; i++) {
      worst = Math.max(worst, Math.abs((a.left[i] ?? 0) - (b.left[i] ?? 0)), Math.abs((a.right[i] ?? 0) - (b.right[i] ?? 0)));
    }
    expect(worst).toBe(0);
  });
});
