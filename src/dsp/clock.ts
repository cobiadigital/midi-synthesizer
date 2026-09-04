import { clamp } from "./math";

/**
 * Musical divisions the step clock can run at, slowest first so a knob sweeps
 * from long notes to short ones. `beats` is the length of one step in quarter
 * notes: a dotted eighth is 0.75, an eighth triplet is a third of a beat.
 */
export const DIVISIONS = [
  { label: "1/1", beats: 4 },
  { label: "1/2", beats: 2 },
  { label: "1/4.", beats: 1.5 },
  { label: "1/4", beats: 1 },
  { label: "1/4T", beats: 2 / 3 },
  { label: "1/8.", beats: 0.75 },
  { label: "1/8", beats: 0.5 },
  { label: "1/8T", beats: 1 / 3 },
  { label: "1/16.", beats: 0.375 },
  { label: "1/16", beats: 0.25 },
  { label: "1/16T", beats: 1 / 6 },
  { label: "1/32", beats: 0.125 },
] as const;

export const DIVISION_LABELS = DIVISIONS.map((d) => d.label);

/** Index of the default division, used by the param registry. */
export const DEFAULT_DIVISION = DIVISION_LABELS.indexOf("1/8");

export interface Tick {
  /** Full steps since `start()`. Swing alternates on this, not on ratchets. */
  step: number;
  /** Position within the step's ratchet group, 0 for the step's own onset. */
  ratchet: number;
  /** Length of this sub-step in frames, which sets the gate length. */
  durationFrames: number;
}

/**
 * Sample-accurate step clock: tempo, division, swing and ratcheting.
 *
 * The caller renders audio in chunks no longer than `framesToTick()` and calls
 * `advance()` for each chunk, so step onsets land on an exact sample rather
 * than being quantised to the 128-frame render quantum. Timers are fractional
 * and accumulate, which keeps a division like 1/8T from drifting.
 *
 * Swing lengthens even-numbered steps and shortens odd ones by the same
 * amount, so a pair always spans two straight steps. An amount of 1/3 gives
 * the 2:1 ratio of triplet swing.
 */
export class StepClock {
  private beats = DIVISIONS[DEFAULT_DIVISION]?.beats ?? 0.5;
  private bpm = 120;
  private swing = 0;
  private ratchets = 1;

  private stepIndex = 0;
  private ratchetIndex = 0;
  /** Frames until the next sub-step onset. Below 1 means a tick is due. */
  private framesToNext = Number.POSITIVE_INFINITY;
  private isRunning = false;

  constructor(private readonly sampleRate: number) {}

  get running(): boolean {
    return this.isRunning;
  }

  setTempo(bpm: number): void {
    this.bpm = clamp(bpm, 10, 400);
  }

  setDivision(index: number): void {
    const division = DIVISIONS[clamp(Math.round(index), 0, DIVISIONS.length - 1)];
    if (division) this.beats = division.beats;
  }

  /** 0 is straight, 0.75 is as lopsided as the pair is allowed to get. */
  setSwing(amount: number): void {
    this.swing = clamp(amount, 0, 0.75);
  }

  setRatchets(count: number): void {
    this.ratchets = Math.max(1, Math.round(count));
    if (this.ratchetIndex >= this.ratchets) this.ratchetIndex = 0;
  }

  /** Restart from step 0 with the first tick due immediately. */
  start(): void {
    this.stepIndex = 0;
    this.ratchetIndex = 0;
    this.framesToNext = 0;
    this.isRunning = true;
  }

  stop(): void {
    this.isRunning = false;
    this.framesToNext = Number.POSITIVE_INFINITY;
  }

  /** Frames the caller may render before the next tick must be serviced. */
  framesToTick(): number {
    return this.isRunning ? this.framesToNext : Number.POSITIVE_INFINITY;
  }

  advance(frames: number): void {
    if (this.isRunning) this.framesToNext -= frames;
  }

  /** Consume the tick that is due now, or return null if none is. */
  tick(): Tick | null {
    if (!this.isRunning || this.framesToNext >= 1) return null;

    const duration = this.stepFrames(this.stepIndex) / this.ratchets;
    const due: Tick = { step: this.stepIndex, ratchet: this.ratchetIndex, durationFrames: duration };

    // Accumulate rather than assign: the leftover fraction is what stops a
    // division that does not divide evenly into samples from drifting flat.
    this.framesToNext += duration;
    this.ratchetIndex++;
    if (this.ratchetIndex >= this.ratchets) {
      this.ratchetIndex = 0;
      this.stepIndex++;
    }
    return due;
  }

  /** Length of one full step in frames, before ratcheting divides it. */
  stepFrames(index: number): number {
    const straight = (this.beats * 60 * this.sampleRate) / this.bpm;
    const swung = straight * (index % 2 === 0 ? 1 + this.swing : 1 - this.swing);
    // A step shorter than a millisecond would starve the render loop.
    return Math.max(this.sampleRate / 1000, swung);
  }
}
