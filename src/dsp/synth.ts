import { Arpeggiator, type NoteSink } from "./arpeggiator";
import { ParamStore, type ParamId } from "./params";
import { MonoVoice } from "./voice";

/** Things the audio thread reports back to the UI. */
export type SynthEvent =
  | { type: "arpNote"; note: number; on: boolean }
  | { type: "arpStep"; step: number }
  | { type: "arpStopped" };

/**
 * The whole instrument: an arpeggiator feeding one monophonic voice.
 *
 * Note events go into the arpeggiator, which either passes them through or
 * swallows them and plays its own pattern. `render()` walks the output buffer
 * in chunks bounded by the next scheduled arpeggiator event, so steps start on
 * an exact sample instead of being rounded to the 128-frame render quantum.
 *
 * No Web Audio here either: the whole thing renders offline in tests.
 */
export class Synth {
  readonly params = new ParamStore();
  private readonly voice: MonoVoice;
  private readonly arp: Arpeggiator;
  private readonly events: SynthEvent[] = [];

  constructor(sampleRate: number) {
    this.voice = new MonoVoice(sampleRate, this.params);
    // The arpeggiator plays through this wrapper rather than the voice
    // directly, so every note it generates is also reported to the UI.
    const sink: NoteSink = {
      noteOn: (note, velocity) => {
        this.voice.noteOn(note, velocity);
        this.report({ type: "arpNote", note, on: true });
      },
      noteOff: (note) => {
        this.voice.noteOff(note);
        this.report({ type: "arpNote", note, on: false });
      },
      allNotesOff: () => this.voice.allNotesOff(),
    };
    this.arp = new Arpeggiator(sampleRate, this.params, sink);
    this.arp.onStep = (step) => this.events.push({ type: "arpStep", step });
    this.arp.onStop = () => this.events.push({ type: "arpStopped" });
  }

  noteOn(note: number, velocity: number): void {
    this.arp.noteOn(note, velocity);
  }

  noteOff(note: number): void {
    this.arp.noteOff(note);
  }

  allNotesOff(): void {
    this.arp.allNotesOff();
  }

  setParam(id: ParamId, value: number): void {
    this.params.set(id, value);
    this.voice.setParam(id, this.params.get(id));
    this.arp.applyParam(id);
  }

  isActive(): boolean {
    return this.voice.isActive() || this.arp.running;
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
      this.voice.render(out.subarray(offset, offset + frames));
      this.arp.advance(frames);
      offset += frames;
    }
  }
}
