import { StepClock, type Tick } from "./clock";
import { clamp, makeRandom } from "./math";
import type { ParamId, ParamStore } from "./params";

/** Anything that can be played: the voice, or a wrapper that also reports to the UI. */
export interface NoteSink {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
}

export const ARP_MODES = ["up", "down", "up-down", "down-up", "as played", "random"] as const;
export type ArpMode = (typeof ARP_MODES)[number];

interface HeldNote {
  note: number;
  velocity: number;
  /** False for a note the latch is holding after the key came up. */
  physical: boolean;
}

/**
 * A MIDI event transformer that sits between the input and the voice.
 *
 * When switched off it passes notes straight through. When on it swallows
 * them, keeps its own chord, and plays that chord back one note at a time on
 * the step clock. The voice below never knows the difference, which is why
 * glide, legato and the envelopes behave exactly as they do when playing by
 * hand.
 *
 * Timing is driven by the same render loop as the audio: the host renders up
 * to `framesToEvent()` samples, calls `advance()`, then `fire()`, so note
 * onsets land on an exact frame.
 */
export class Arpeggiator {
  /** Reports the step index and note whenever a step starts, for UI feedback. */
  onStep: ((step: number, note: number) => void) | null = null;
  /** Reports that the pattern stopped, so the UI can clear its highlights. */
  onStop: (() => void) | null = null;

  private readonly clock: StepClock;
  private readonly random = makeRandom();

  private readonly held: HeldNote[] = [];
  /** Sequence of notes to play, rebuilt whenever the chord or ordering changes. */
  private readonly seqNotes: number[] = [];
  private readonly seqVels: number[] = [];
  private readonly scratch: HeldNote[] = [];
  private seqDirty = true;
  private seqPos = -1;

  private sounding: number | null = null;
  /** Frames until the sounding note is released. Infinity when tied or silent. */
  private gateFrames = Number.POSITIVE_INFINITY;
  private wasEnabled = false;

  constructor(
    sampleRate: number,
    private readonly params: ParamStore,
    private readonly sink: NoteSink,
  ) {
    this.clock = new StepClock(sampleRate);
    this.wasEnabled = this.enabled;
    for (const id of ["tempo", "arpRate", "arpSwing", "arpRatchet"] as const) this.applyParam(id);
  }

  get enabled(): boolean {
    return this.params.get("arpOn") >= 0.5;
  }

  get running(): boolean {
    return this.clock.running;
  }

  noteOn(note: number, velocity: number): void {
    // Latch keeps released notes in the chord, so the first key of a new
    // gesture starts a fresh one instead of piling onto the old.
    if (this.latched && !this.held.some((h) => h.physical)) this.clearHeld();

    const existing = this.held.find((h) => h.note === note);
    if (existing) {
      existing.velocity = velocity;
      existing.physical = true;
    } else {
      this.held.push({ note, velocity, physical: true });
      this.seqDirty = true;
    }

    if (!this.enabled) {
      this.sink.noteOn(note, velocity);
      return;
    }
    if (!this.clock.running) this.startPattern();
  }

  noteOff(note: number): void {
    const index = this.held.findIndex((h) => h.note === note);
    if (index !== -1) {
      const entry = this.held[index];
      if (this.latched && entry) {
        entry.physical = false;
      } else {
        this.held.splice(index, 1);
        this.seqDirty = true;
      }
    }

    if (!this.enabled) {
      this.sink.noteOff(note);
      return;
    }
    if (this.held.length === 0) this.stopPattern();
  }

  allNotesOff(): void {
    this.clearHeld();
    this.stopPattern();
    this.sink.allNotesOff();
  }

  applyParam(id: ParamId): void {
    const value = this.params.get(id);
    switch (id) {
      case "tempo":
        this.clock.setTempo(value);
        break;
      case "arpRate":
        this.clock.setDivision(value);
        break;
      case "arpSwing":
        this.clock.setSwing(value / 100);
        break;
      case "arpRatchet":
        this.clock.setRatchets(value);
        break;
      case "arpMode":
      case "arpOctaves":
        this.seqDirty = true;
        break;
      case "arpLatch":
        if (!this.latched) this.dropLatchedNotes();
        break;
      case "arpOn":
        this.setEnabled(this.enabled);
        break;
      default:
        break;
    }
  }

  /** Frames the host may render before an arpeggiator event is due. */
  framesToEvent(): number {
    return Math.min(this.clock.framesToTick(), this.gateFrames);
  }

  advance(frames: number): void {
    this.clock.advance(frames);
    if (this.gateFrames !== Number.POSITIVE_INFINITY) this.gateFrames -= frames;
  }

  /** Emit every note event that is due at the current frame. */
  fire(): void {
    // The gate goes first: when a note off and the next step land on the same
    // frame, releasing after the new note on would cut the new note short.
    if (this.gateFrames < 1) this.release();
    const tick = this.clock.tick();
    if (tick) this.playTick(tick);
  }

  /**
   * Latch only means anything while the arpeggiator is running. Off, notes
   * have to leave the chord when the key comes up, or a whole performance
   * would pile up and come crashing in the moment the arpeggiator is switched
   * on.
   */
  private get latched(): boolean {
    return this.enabled && this.params.get("arpLatch") >= 0.5;
  }

  private setEnabled(enabled: boolean): void {
    if (enabled === this.wasEnabled) return;
    this.wasEnabled = enabled;
    if (enabled) {
      // Taking over: drop whatever the keys are sustaining directly.
      this.sink.allNotesOff();
      if (this.held.length > 0) this.startPattern();
    } else {
      this.stopPattern();
      this.dropLatchedNotes();
      // Handing back: keys still down should sound again straight away.
      for (const h of this.held) if (h.physical) this.sink.noteOn(h.note, h.velocity);
    }
  }

  private startPattern(): void {
    this.seqPos = -1;
    this.gateFrames = Number.POSITIVE_INFINITY;
    this.clock.start();
  }

  private stopPattern(): void {
    const wasRunning = this.clock.running;
    this.clock.stop();
    this.release();
    if (wasRunning) this.onStop?.();
  }

  private release(): void {
    this.gateFrames = Number.POSITIVE_INFINITY;
    if (this.sounding === null) return;
    this.sink.noteOff(this.sounding);
    this.sounding = null;
  }

  private clearHeld(): void {
    this.held.length = 0;
    this.seqDirty = true;
  }

  private dropLatchedNotes(): void {
    for (let i = this.held.length - 1; i >= 0; i--) {
      if (!this.held[i]?.physical) {
        this.held.splice(i, 1);
        this.seqDirty = true;
      }
    }
    if (this.enabled && this.held.length === 0) this.stopPattern();
  }

  private playTick(tick: Tick): void {
    // Ratchets repeat the step's note; only a fresh step moves the sequence on.
    if (tick.ratchet === 0) this.advanceSequence();
    const note = this.seqNotes[this.seqPos];
    const velocity = this.seqVels[this.seqPos];
    if (note === undefined || velocity === undefined) {
      this.stopPattern();
      return;
    }

    const gate = this.params.get("arpGate");
    if (gate >= 0.999) {
      // Fully open gate ties the steps together: press the next note before
      // releasing the last so the voice glides instead of restarting.
      const previous = this.sounding;
      this.sink.noteOn(note, velocity);
      this.sounding = note;
      if (previous !== null && previous !== note) this.sink.noteOff(previous);
      this.gateFrames = Number.POSITIVE_INFINITY;
    } else {
      this.release();
      this.sink.noteOn(note, velocity);
      this.sounding = note;
      this.gateFrames = Math.max(1, tick.durationFrames * gate);
    }
    this.onStep?.(tick.step, note);
  }

  private advanceSequence(): void {
    if (this.seqDirty) this.rebuild();
    const length = this.seqNotes.length;
    if (length === 0) {
      this.seqPos = -1;
      return;
    }
    if (this.mode === "random") {
      let pick = Math.floor(this.random() * length);
      // A repeated note reads as a dropped step, so nudge past it.
      if (length > 1 && pick === this.seqPos) pick = (pick + 1) % length;
      this.seqPos = pick;
      return;
    }
    this.seqPos = this.seqPos + 1 >= length ? 0 : this.seqPos + 1;
  }

  private get mode(): ArpMode {
    return ARP_MODES[clamp(Math.round(this.params.get("arpMode")), 0, ARP_MODES.length - 1)] ?? "up";
  }

  /**
   * Expand the held chord into the sequence the clock walks: the chord stacked
   * over the octave range, then reordered by mode. Runs once per chord or
   * setting change, never inside the sample loop.
   */
  private rebuild(): void {
    this.seqDirty = false;
    this.seqNotes.length = 0;
    this.seqVels.length = 0;
    if (this.held.length === 0) return;

    const mode = this.mode;
    const octaves = clamp(Math.round(this.params.get("arpOctaves")), 1, 4);

    // "As played" keeps the order the keys went down in; every other mode
    // works from the chord sorted low to high.
    this.scratch.length = 0;
    for (const h of this.held) this.scratch.push(h);
    if (mode !== "as played") this.scratch.sort((a, b) => a.note - b.note);

    for (let octave = 0; octave < octaves; octave++) {
      for (const source of this.scratch) {
        this.seqNotes.push(source.note + 12 * octave);
        this.seqVels.push(source.velocity);
      }
    }

    // The stack is built low to high, so a descending mode is that same stack
    // read backwards, top octave first.
    if (mode === "down" || mode === "down-up") {
      this.seqNotes.reverse();
      this.seqVels.reverse();
    }

    if (mode === "up-down" || mode === "down-up") {
      // Turn around without repeating the notes at either end, the classic
      // shape: 1 2 3 2 rather than 1 2 3 3 2 1.
      for (let i = this.seqNotes.length - 2; i >= 1; i--) {
        this.seqNotes.push(this.seqNotes[i] ?? 0);
        this.seqVels.push(this.seqVels[i] ?? 0);
      }
    }
  }
}
