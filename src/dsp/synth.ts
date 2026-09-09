import { Arpeggiator, type NoteSink } from "./arpeggiator";
import { ParamStore, type ParamId } from "./params";
import { PolyVoices } from "./poly-voices";
import { MonoVoice, type VoiceEngine } from "./voice";

/** Things the audio thread reports back to the UI. */
export type SynthEvent =
  | { type: "arpNote"; note: number; on: boolean }
  | { type: "arpStep"; step: number }
  | { type: "arpStopped" };

/**
 * The whole instrument: a sustain gate and an arpeggiator feeding either the
 * mono voice or the poly pool.
 *
 * Note events run through the sustain gate first, then the arpeggiator, which
 * either passes them through or swallows them and plays its own pattern. Both
 * engines exist at all times and both are mixed, so switching voice mode lets
 * whatever the old engine was holding ring out instead of cutting it dead.
 *
 * `render()` walks the output buffer in chunks bounded by the next scheduled
 * arpeggiator event, so steps start on an exact sample instead of being
 * rounded to the 128-frame render quantum.
 *
 * No Web Audio here either: the whole thing renders offline in tests.
 */
export class Synth {
  readonly params = new ParamStore();
  private readonly mono: MonoVoice;
  private readonly poly: PolyVoices;
  private engine: VoiceEngine;
  private readonly arp: Arpeggiator;
  private readonly events: SynthEvent[] = [];

  private sustaining = false;
  /** Notes whose key came up while the pedal was down. */
  private readonly sustained = new Set<number>();

  constructor(sampleRate: number) {
    this.mono = new MonoVoice(sampleRate, this.params);
    this.poly = new PolyVoices(sampleRate, this.params);
    this.engine = this.selectedEngine();
    // The arpeggiator plays through this wrapper rather than an engine
    // directly, so the engine can be swapped underneath it and every note it
    // generates is also reported to the UI.
    const sink: NoteSink = {
      noteOn: (note, velocity) => {
        this.engine.noteOn(note, velocity);
        this.report({ type: "arpNote", note, on: true });
      },
      noteOff: (note) => {
        this.engine.noteOff(note);
        this.report({ type: "arpNote", note, on: false });
      },
      allNotesOff: () => {
        this.mono.allNotesOff();
        this.poly.allNotesOff();
      },
    };
    this.arp = new Arpeggiator(sampleRate, this.params, sink);
    this.arp.onStep = (step) => this.events.push({ type: "arpStep", step });
    this.arp.onStop = () => this.events.push({ type: "arpStopped" });
  }

  noteOn(note: number, velocity: number): void {
    // Pressing a note the pedal is holding hands it back to the keys, so
    // lifting the pedal later does not release a key that is still down.
    this.sustained.delete(note);
    this.arp.noteOn(note, velocity);
  }

  noteOff(note: number): void {
    if (this.sustaining) {
      this.sustained.add(note);
      return;
    }
    this.arp.noteOff(note);
  }

  /**
   * Sustain pedal. It sits above the arpeggiator rather than inside a voice,
   * which is what makes it do the musically expected thing in every mode: it
   * sustains notes when playing by hand, and holds the chord like a momentary
   * latch when the arpeggiator is running.
   */
  setSustain(on: boolean): void {
    if (on === this.sustaining) return;
    this.sustaining = on;
    if (on) return;
    for (const note of this.sustained) this.arp.noteOff(note);
    this.sustained.clear();
  }

  allNotesOff(): void {
    this.sustained.clear();
    this.arp.allNotesOff();
  }

  setParam(id: ParamId, value: number): void {
    this.params.set(id, value);
    this.mono.applyParam(id);
    this.poly.applyParam(id);
    this.arp.applyParam(id);
    if (id === "voiceMode") this.applyVoiceMode();
  }

  isActive(): boolean {
    return this.mono.isActive() || this.poly.isActive() || this.arp.running;
  }

  /**
   * Notes the arpeggiator passes straight through are not worth reporting:
   * the main thread played them itself and has already lit the key. Only what
   * the pattern generates is news.
   */
  private report(event: SynthEvent): void {
    if (this.arp.enabled) this.events.push(event);
  }

  /**
   * Drain the UI events generated since the last call. The host posts these to
   * the main thread once per block; there is nothing to send on a block where
   * the arpeggiator did not do anything.
   */
  takeEvents(): SynthEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }

  render(out: Float32Array): void {
    let offset = 0;
    while (offset < out.length) {
      this.arp.fire();
      const remaining = out.length - offset;
      // fire() leaves every timer at least a frame away, so this always makes
      // progress and the loop cannot spin.
      const frames = Math.max(1, Math.min(remaining, Math.floor(this.arp.framesToEvent())));
      const chunk = out.subarray(offset, offset + frames);
      // The worklet hands back the same buffer every block, so clear before
      // the engines mix into it.
      chunk.fill(0);
      this.mono.add(chunk);
      this.poly.add(chunk);
      this.arp.advance(frames);
      offset += frames;
    }
  }

  private selectedEngine(): VoiceEngine {
    return this.params.get("voiceMode") >= 0.5 ? this.poly : this.mono;
  }

  private applyVoiceMode(): void {
    const next = this.selectedEngine();
    if (next === this.engine) return;
    // Hand over cleanly: release what the outgoing engine is holding. Both are
    // still mixed, so its tail finishes rather than being cut off.
    this.engine.allNotesOff();
    this.engine = next;
  }
}
