import { describe, expect, it } from "vitest";
import { Arpeggiator, type NoteSink } from "../src/dsp/arpeggiator";
import { ARP_MODES } from "../src/dsp/arpeggiator";
import { DIVISION_LABELS } from "../src/dsp/clock";
import { ParamStore } from "../src/dsp/params";
import { SAMPLE_RATE } from "./helpers";

interface Emitted {
  frame: number;
  note: number;
  on: boolean;
}

/** A NoteSink that records what the arpeggiator plays and when. */
class Recorder implements NoteSink {
  readonly events: Emitted[] = [];
  frame = 0;

  noteOn(note: number, _velocity: number): void {
    this.events.push({ frame: this.frame, note, on: true });
  }

  noteOff(note: number): void {
    this.events.push({ frame: this.frame, note, on: false });
  }

  allNotesOff(): void {
    this.events.push({ frame: this.frame, note: -1, on: false });
  }

  get onsets(): Emitted[] {
    return this.events.filter((e) => e.on);
  }

  get notes(): number[] {
    return this.onsets.map((e) => e.note);
  }
}

function setup(patch: Partial<Record<string, number>> = {}) {
  const params = new ParamStore({ arpOn: 1, ...patch } as never);
  const sink = new Recorder();
  const arp = new Arpeggiator(SAMPLE_RATE, params, sink);
  // The store already had arpOn set, so tell the arpeggiator about every
  // pre-seeded value the way Synth.setParam would.
  for (const id of ["tempo", "arpRate", "arpSwing", "arpRatchet", "arpOn"] as const) arp.applyParam(id);
  return { arp, sink, params };
}

/** Run the arpeggiator's render loop for `frames` samples without any audio. */
function run(arp: Arpeggiator, sink: Recorder, frames: number): void {
  const end = sink.frame + frames;
  while (sink.frame < end) {
    arp.fire();
    const chunk = Math.max(1, Math.min(end - sink.frame, Math.floor(arp.framesToEvent())));
    arp.advance(chunk);
    sink.frame += chunk;
  }
  arp.fire();
}

const EIGHTH = DIVISION_LABELS.indexOf("1/8");

describe("Arpeggiator", () => {
  it("passes notes straight through when switched off", () => {
    const { arp, sink } = setup({ arpOn: 0 });
    arp.noteOn(60, 100);
    run(arp, sink, SAMPLE_RATE);
    arp.noteOff(60);
    expect(sink.events).toEqual([
      { frame: 0, note: 60, on: true },
      { frame: SAMPLE_RATE, note: 60, on: false },
    ]);
    expect(arp.running).toBe(false);
  });

  it("plays a held chord one note at a time, lowest first", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120 });
    for (const note of [64, 60, 67]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE * 1.5);
    expect(sink.notes.slice(0, 6)).toEqual([60, 64, 67, 60, 64, 67]);
  });

  it("starts the first step the moment a key goes down", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120 });
    arp.noteOn(60, 100);
    run(arp, sink, 480);
    expect(sink.onsets[0]?.frame).toBe(0);
  });

  it("holds each mode's note order", () => {
    const orders: Record<string, number[]> = {
      up: [60, 64, 67, 60],
      down: [67, 64, 60, 67],
      "up-down": [60, 64, 67, 64, 60],
      "down-up": [67, 64, 60, 64, 67],
      "as played": [64, 60, 67, 64],
    };
    for (const [mode, expected] of Object.entries(orders)) {
      const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpMode: ARP_MODES.indexOf(mode as never) });
      for (const note of [64, 60, 67]) arp.noteOn(note, 100);
      run(arp, sink, SAMPLE_RATE * 1.5);
      expect(sink.notes.slice(0, expected.length), mode).toEqual(expected);
    }
  });

  it("stacks the chord upward over the octave range", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpOctaves: 3 });
    for (const note of [60, 64]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE * 1.5);
    expect(sink.notes.slice(0, 7)).toEqual([60, 64, 72, 76, 84, 88, 60]);
  });

  it("descends from the top of the octave range in down mode", () => {
    const { arp, sink } = setup({
      arpRate: EIGHTH,
      tempo: 120,
      arpOctaves: 2,
      arpMode: ARP_MODES.indexOf("down"),
    });
    for (const note of [60, 64]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE);
    expect(sink.notes.slice(0, 4)).toEqual([76, 72, 64, 60]);
  });

  it("random mode stays inside the chord and does not repeat a note", () => {
    const { arp, sink } = setup({
      arpRate: EIGHTH,
      tempo: 120,
      arpMode: ARP_MODES.indexOf("random"),
    });
    for (const note of [60, 64, 67]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE * 4);
    const notes = sink.notes;
    expect(notes.length).toBeGreaterThan(8);
    for (const note of notes) expect([60, 64, 67]).toContain(note);
    for (let i = 1; i < notes.length; i++) expect(notes[i]).not.toBe(notes[i - 1]);
  });

  it("gate sets how long each step sounds", () => {
    const step = SAMPLE_RATE * 0.25;
    for (const gate of [0.1, 0.5, 0.9]) {
      const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpGate: gate });
      arp.noteOn(60, 100);
      run(arp, sink, SAMPLE_RATE);
      const on = sink.events[0];
      const off = sink.events[1];
      expect(off?.on).toBe(false);
      expect((off?.frame ?? 0) - (on?.frame ?? 0)).toBeCloseTo(step * gate, -1);
    }
  });

  it("a fully open gate ties steps together instead of releasing", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpGate: 1 });
    for (const note of [60, 67]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE * 0.6);
    // Each step presses the next note before letting the previous one go, so
    // the voice below slides rather than restarting from silence.
    expect(sink.events.slice(0, 4).map((e) => [e.note, e.on])).toEqual([
      [60, true],
      [67, true],
      [60, false],
      [60, true],
    ]);
  });

  it("swing delays every second step", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpSwing: 33.333333 });
    arp.noteOn(60, 100);
    run(arp, sink, SAMPLE_RATE);
    const frames = sink.onsets.map((e) => e.frame);
    const first = (frames[1] ?? 0) - (frames[0] ?? 0);
    const second = (frames[2] ?? 0) - (frames[1] ?? 0);
    expect(first / second).toBeCloseTo(2, 1);
  });

  it("ratcheting repeats the step's note without moving the pattern on", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpRatchet: 3 });
    for (const note of [60, 67]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE * 0.5);
    expect(sink.notes.slice(0, 6)).toEqual([60, 60, 60, 67, 67, 67]);
  });

  it("stops and releases when the last key comes up", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120 });
    arp.noteOn(60, 100);
    run(arp, sink, SAMPLE_RATE * 0.3);
    arp.noteOff(60);
    const after = sink.events.length;
    run(arp, sink, SAMPLE_RATE);
    expect(arp.running).toBe(false);
    expect(sink.events.length).toBe(after);
    expect(sink.events.filter((e) => e.on).length).toBe(sink.events.filter((e) => !e.on).length);
  });

  it("latch keeps the pattern running after the keys are released", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpLatch: 1 });
    arp.noteOn(60, 100);
    arp.noteOff(60);
    run(arp, sink, SAMPLE_RATE);
    expect(arp.running).toBe(true);
    expect(sink.notes.length).toBeGreaterThan(2);
  });

  it("a new key after latching starts a fresh chord", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120, arpLatch: 1 });
    arp.noteOn(60, 100);
    arp.noteOff(60);
    run(arp, sink, SAMPLE_RATE * 0.3);
    arp.noteOn(67, 100);
    arp.noteOff(67);
    const mark = sink.events.length;
    run(arp, sink, SAMPLE_RATE);
    expect(sink.notes.slice(sink.onsets.findIndex((e) => sink.events.indexOf(e) >= mark))).not.toContain(60);
  });

  it("turning latch off drops the notes it was holding", () => {
    const { arp, sink, params } = setup({ arpRate: EIGHTH, tempo: 120, arpLatch: 1 });
    arp.noteOn(60, 100);
    arp.noteOff(60);
    run(arp, sink, SAMPLE_RATE * 0.3);
    params.set("arpLatch", 0);
    arp.applyParam("arpLatch");
    expect(arp.running).toBe(false);
  });

  it("switching the arpeggiator on silences the keys and takes over", () => {
    const { arp, sink, params } = setup({ arpOn: 0, arpRate: EIGHTH, tempo: 120 });
    arp.noteOn(60, 100);
    run(arp, sink, 480);
    params.set("arpOn", 1);
    arp.applyParam("arpOn");
    run(arp, sink, SAMPLE_RATE * 0.6);
    expect(sink.events.some((e) => e.note === -1)).toBe(true);
    expect(arp.running).toBe(true);
    expect(sink.onsets.length).toBeGreaterThan(1);
  });

  it("switching the arpeggiator off hands the held keys back to the voice", () => {
    const { arp, sink, params } = setup({ arpRate: EIGHTH, tempo: 120 });
    arp.noteOn(60, 100);
    run(arp, sink, SAMPLE_RATE * 0.3);
    params.set("arpOn", 0);
    arp.applyParam("arpOn");
    expect(arp.running).toBe(false);
    expect(sink.events[sink.events.length - 1]).toEqual({ frame: sink.frame, note: 60, on: true });
  });

  it("does not latch notes played while the arpeggiator is off", () => {
    const { arp, sink, params } = setup({ arpOn: 0, arpRate: EIGHTH, tempo: 120, arpLatch: 1 });
    for (const note of [48, 50, 52]) {
      arp.noteOn(note, 100);
      arp.noteOff(note);
    }
    arp.noteOn(60, 100);
    const mark = sink.events.length;
    params.set("arpOn", 1);
    arp.applyParam("arpOn");
    run(arp, sink, SAMPLE_RATE * 0.6);
    // Only the key still down survives into the pattern.
    const played = sink.events.slice(mark).filter((e) => e.on).map((e) => e.note);
    expect(played.length).toBeGreaterThan(1);
    expect(new Set(played)).toEqual(new Set([60]));
  });

  it("reports each step to the UI", () => {
    const { arp, sink } = setup({ arpRate: EIGHTH, tempo: 120 });
    const steps: number[] = [];
    arp.onStep = (step) => steps.push(step);
    for (const note of [60, 64]) arp.noteOn(note, 100);
    run(arp, sink, SAMPLE_RATE);
    expect(steps.slice(0, 4)).toEqual([0, 1, 2, 3]);
  });
});
