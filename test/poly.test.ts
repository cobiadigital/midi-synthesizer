import { describe, expect, it } from "vitest";
import { ParamStore } from "../src/dsp/params";
import { MAX_VOICES, PolyVoices } from "../src/dsp/poly-voices";
import { Synth } from "../src/dsp/synth";
import { SAMPLE_RATE, magnitudeAt, rms } from "./helpers";

/** Fundamentals of the C major triad the chord tests hold down. */
const C4 = 261.63;
const E4 = 329.63;
const G4 = 392.0;

const MONO = 0;
const POLY = 1;

function polySynth(patch: Partial<Record<string, number>> = {}): Synth {
  const synth = new Synth(SAMPLE_RATE);
  synth.setParam("ampAttack", 0.001);
  synth.setParam("ampRelease", 0.02);
  for (const [id, value] of Object.entries(patch)) synth.setParam(id as never, value as number);
  return synth;
}

function render(synth: Synth, frames: number, blockSize = frames): Float32Array {
  const out = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += blockSize) {
    synth.render(out.subarray(offset, Math.min(frames, offset + blockSize)));
  }
  return out;
}

/** Magnitude of one pitch in the second half of a render, past the attack. */
function pitchLevel(buffer: Float32Array, hz: number): number {
  return magnitudeAt(buffer.subarray(buffer.length >> 1), hz, SAMPLE_RATE);
}

describe("PolyVoices", () => {
  it("gives each note its own voice", () => {
    const poly = new PolyVoices(SAMPLE_RATE, new ParamStore());
    for (const note of [60, 64, 67]) poly.noteOn(note, 100);
    expect(poly.activeVoices).toBe(3);
  });

  it("reuses one voice when the same note is played again", () => {
    const poly = new PolyVoices(SAMPLE_RATE, new ParamStore());
    poly.noteOn(60, 100);
    poly.noteOn(60, 100);
    expect(poly.activeVoices).toBe(1);
  });

  it("steals the oldest held voice once the pool is full", () => {
    const params = new ParamStore({ polyVoices: 2, ampAttack: 0.001 });
    const poly = new PolyVoices(SAMPLE_RATE, params);
    for (const note of [60, 64, 67]) poly.noteOn(note, 100);
    expect(poly.activeVoices).toBe(2);

    const out = new Float32Array(SAMPLE_RATE / 2);
    poly.render(out);
    // 60 was the oldest, so it is the one that lost its voice.
    expect(pitchLevel(out, C4)).toBeLessThan(0.01);
    expect(pitchLevel(out, E4)).toBeGreaterThan(0.05);
    expect(pitchLevel(out, G4)).toBeGreaterThan(0.05);
  });

  it("prefers a releasing voice over stealing one that is still held", () => {
    const params = new ParamStore({ polyVoices: 2, ampRelease: 2 });
    const poly = new PolyVoices(SAMPLE_RATE, params);
    poly.noteOn(60, 100);
    poly.noteOn(64, 100);
    poly.noteOff(60);
    poly.render(new Float32Array(4800));
    poly.noteOn(67, 100);

    const out = new Float32Array(SAMPLE_RATE / 2);
    poly.render(out);
    // The long release tail on 60 is expendable; 64 is still under a finger.
    expect(pitchLevel(out, C4)).toBeLessThan(0.01);
    expect(pitchLevel(out, E4)).toBeGreaterThan(0.05);
    expect(pitchLevel(out, G4)).toBeGreaterThan(0.05);
  });

  it("releases voices that fall outside a shrunken pool", () => {
    const params = new ParamStore({ ampRelease: 0.02 });
    const poly = new PolyVoices(SAMPLE_RATE, params);
    for (let i = 0; i < MAX_VOICES; i++) poly.noteOn(60 + i, 100);
    expect(poly.activeVoices).toBe(MAX_VOICES);

    params.set("polyVoices", 2);
    poly.applyParam("polyVoices");
    const out = new Float32Array(SAMPLE_RATE / 2);
    poly.render(out);
    // The two notes inside the new limit are still under a finger; everything
    // the allocator can no longer reach has been let go rather than stranded.
    expect(poly.activeVoices).toBe(2);
    expect(pitchLevel(out, C4)).toBeGreaterThan(0.05);
    expect(pitchLevel(out, G4)).toBeLessThan(0.01);
  });

  it("is silent with no notes and adds nothing to the buffer", () => {
    const poly = new PolyVoices(SAMPLE_RATE, new ParamStore());
    const out = new Float32Array(4800).fill(0.5);
    poly.add(out);
    expect(out.every((s) => s === 0.5)).toBe(true);
  });
});

describe("Synth voice modes", () => {
  it("holds a whole chord in poly mode", () => {
    const synth = polySynth();
    for (const note of [60, 64, 67]) synth.noteOn(note, 100);
    const buf = render(synth, SAMPLE_RATE / 2, 128);
    for (const hz of [C4, E4, G4]) expect(pitchLevel(buf, hz)).toBeGreaterThan(0.05);
  });

  it("plays only the newest note in mono mode", () => {
    const synth = polySynth({ voiceMode: MONO });
    for (const note of [60, 64, 67]) synth.noteOn(note, 100);
    const buf = render(synth, SAMPLE_RATE / 2, 128);
    expect(pitchLevel(buf, G4)).toBeGreaterThan(0.05);
    expect(pitchLevel(buf, C4)).toBeLessThan(0.01);
    expect(pitchLevel(buf, E4)).toBeLessThan(0.01);
  });

  it("leaves nothing sounding when the mode is switched under a held chord", () => {
    const synth = polySynth();
    for (const note of [60, 64, 67]) synth.noteOn(note, 100);
    render(synth, 4800, 128);
    synth.setParam("voiceMode", MONO);
    const tail = render(synth, SAMPLE_RATE / 2, 128);
    expect(rms(tail.subarray(tail.length >> 1))).toBe(0);
    expect(synth.isActive()).toBe(false);

    // And the newly selected engine plays normally afterwards.
    synth.noteOn(67, 100);
    expect(pitchLevel(render(synth, SAMPLE_RATE / 2, 128), G4)).toBeGreaterThan(0.05);
  });

  it("poly output does not depend on the render block size", () => {
    const whole = polySynth();
    const blocks = polySynth();
    for (const synth of [whole, blocks]) for (const note of [60, 64, 67]) synth.noteOn(note, 100);
    const a = render(whole, 24000, 24000);
    const b = render(blocks, 24000, 128);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
    expect(worst).toBe(0);
  });
});

describe("Sustain pedal", () => {
  it("holds notes whose keys came up, and releases them when the pedal does", () => {
    const synth = polySynth();
    synth.noteOn(60, 100);
    synth.setSustain(true);
    synth.noteOff(60);
    const held = render(synth, SAMPLE_RATE / 2, 128);
    expect(pitchLevel(held, C4)).toBeGreaterThan(0.05);

    synth.setSustain(false);
    const released = render(synth, SAMPLE_RATE / 2, 128);
    expect(rms(released.subarray(released.length >> 1))).toBe(0);
    expect(synth.isActive()).toBe(false);
  });

  it("keeps a note that is still physically held after the pedal comes up", () => {
    const synth = polySynth();
    synth.noteOn(60, 100);
    synth.setSustain(true);
    synth.noteOff(60);
    // Same note pressed again: it belongs to the key now, not the pedal.
    synth.noteOn(60, 100);
    synth.setSustain(false);
    const buf = render(synth, SAMPLE_RATE / 2, 128);
    expect(pitchLevel(buf, C4)).toBeGreaterThan(0.05);
    expect(synth.isActive()).toBe(true);
  });

  it("latches the arpeggiator chord while the pedal is down", () => {
    const synth = polySynth({ tempo: 120, arpOn: 1 });
    synth.noteOn(60, 100);
    render(synth, 4800, 128);
    synth.setSustain(true);
    synth.noteOff(60);
    render(synth, SAMPLE_RATE / 2, 128);
    expect(synth.isActive()).toBe(true);

    synth.setSustain(false);
    const stopped = render(synth, SAMPLE_RATE / 2, 128);
    expect(synth.takeEvents().some((e) => e.type === "arpStopped")).toBe(true);
    expect(rms(stopped.subarray(stopped.length >> 1))).toBe(0);
  });
});
