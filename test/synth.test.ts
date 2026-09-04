import { describe, expect, it } from "vitest";
import { ARP_MODES } from "../src/dsp/arpeggiator";
import { DIVISION_LABELS } from "../src/dsp/clock";
import { Synth } from "../src/dsp/synth";
import { SAMPLE_RATE, estimateFrequency, rms } from "./helpers";

const EIGHTH = DIVISION_LABELS.indexOf("1/8");
/** One eighth note at 120 bpm. */
const STEP = SAMPLE_RATE * 0.25;

function arpSynth(patch: Partial<Record<string, number>> = {}): Synth {
  const synth = new Synth(SAMPLE_RATE);
  synth.setParam("ampAttack", 0.001);
  synth.setParam("ampRelease", 0.005);
  synth.setParam("tempo", 120);
  synth.setParam("arpRate", EIGHTH);
  synth.setParam("arpOn", 1);
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

/** RMS of a short window inside step `index`, taken after the attack settles. */
function stepWindow(buffer: Float32Array, index: number, fromFraction: number): Float32Array {
  const start = Math.round(index * STEP + fromFraction * STEP);
  return buffer.subarray(start, start + 2000);
}

describe("Synth", () => {
  it("behaves like the bare voice when the arpeggiator is off", () => {
    const synth = new Synth(SAMPLE_RATE);
    synth.setParam("ampAttack", 0.001);
    synth.noteOn(60, 100);
    const buf = render(synth, SAMPLE_RATE, 128);
    expect(estimateFrequency(buf.subarray(4800), SAMPLE_RATE)).toBeCloseTo(261.63, 0);
    expect(synth.takeEvents()).toEqual([]);
  });

  it("walks a held chord in step, one pitch per step", () => {
    const synth = arpSynth();
    for (const note of [60, 64, 67]) synth.noteOn(note, 100);
    const buf = render(synth, STEP * 4, 128);
    const pitches = [0, 1, 2, 3].map((i) => estimateFrequency(stepWindow(buf, i, 0.1), SAMPLE_RATE));
    // C4, E4, G4, then back round to C4.
    expect(pitches[0]).toBeCloseTo(261.63, 0);
    expect(pitches[1]).toBeCloseTo(329.63, 0);
    expect(pitches[2]).toBeCloseTo(392.0, 0);
    expect(pitches[3]).toBeCloseTo(261.63, 0);
  });

  it("gate carves silence between the steps", () => {
    const synth = arpSynth({ arpGate: 0.25 });
    synth.noteOn(60, 100);
    const buf = render(synth, STEP * 2, 128);
    expect(rms(stepWindow(buf, 0, 0.05))).toBeGreaterThan(0.05);
    expect(rms(stepWindow(buf, 0, 0.6))).toBe(0);
  });

  it("ratcheting retriggers the envelope inside one step", () => {
    const synth = arpSynth({ arpGate: 0.4, arpRatchet: 2 });
    synth.noteOn(60, 100);
    const buf = render(synth, STEP * 2, 128);
    // Two bursts per step: loud, silent, loud, silent.
    expect(rms(stepWindow(buf, 0, 0.05))).toBeGreaterThan(0.05);
    expect(rms(stepWindow(buf, 0, 0.3))).toBe(0);
    expect(rms(stepWindow(buf, 0, 0.55))).toBeGreaterThan(0.05);
    expect(rms(stepWindow(buf, 0, 0.8))).toBe(0);
  });

  it("swing pushes the second step later without moving the third", () => {
    const synth = arpSynth({ arpSwing: 33.333333, arpGate: 0.5 });
    synth.noteOn(60, 100);
    const buf = render(synth, STEP * 3, 128);
    const straight = arpSynth({ arpGate: 0.5 });
    straight.noteOn(60, 100);
    const flat = render(straight, STEP * 3, 128);
    // At the straight eighth the swung pattern is still resting.
    expect(rms(stepWindow(flat, 1, 0.02))).toBeGreaterThan(0.05);
    expect(rms(stepWindow(buf, 1, 0.02))).toBe(0);
    // Both are sounding again on the downbeat two steps later.
    expect(rms(stepWindow(buf, 2, 0.02))).toBeGreaterThan(0.05);
  });

  it("step timing does not depend on the render block size", () => {
    const patch = { arpMode: ARP_MODES.indexOf("up-down"), arpOctaves: 2, arpSwing: 20 };
    const whole = arpSynth(patch);
    const blocks = arpSynth(patch);
    for (const synth of [whole, blocks]) for (const note of [60, 64, 67]) synth.noteOn(note, 100);
    const a = render(whole, STEP * 6, STEP * 6);
    const b = render(blocks, STEP * 6, 128);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
    expect(worst).toBe(0);
  });

  it("reports its steps and notes to the main thread", () => {
    const synth = arpSynth();
    for (const note of [60, 67]) synth.noteOn(note, 100);
    render(synth, STEP * 2, 128);
    const events = synth.takeEvents();
    expect(events[0]).toEqual({ type: "arpNote", note: 60, on: true });
    expect(events[1]).toEqual({ type: "arpStep", step: 0 });
    expect(events.some((e) => e.type === "arpNote" && e.note === 67 && e.on)).toBe(true);
    expect(synth.takeEvents()).toEqual([]);
  });

  it("falls silent and reports a stop when the keys come up", () => {
    const synth = arpSynth();
    synth.noteOn(60, 100);
    render(synth, STEP, 128);
    synth.noteOff(60);
    const buf = render(synth, STEP * 2, 128);
    expect(synth.takeEvents().some((e) => e.type === "arpStopped")).toBe(true);
    expect(rms(buf.subarray(4800))).toBe(0);
    expect(synth.isActive()).toBe(false);
  });
});
