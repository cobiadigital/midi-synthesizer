import { clamp } from "./math";

/**
 * Stereo ping-pong delay.
 *
 * The input is written to the left line, the left line's output feeds the
 * right line, and the right line's output is what comes back round into the
 * left with feedback gain. A mono source therefore lands on alternating sides:
 * first repeat left, second right, third left, and so on.
 *
 * The read position is fractional and its target is smoothed, so turning the
 * time knob glides the pitch of whatever is still in the buffer instead of
 * clicking, which is what a tape or bucket-brigade delay does anyway.
 */
export class PingPongDelay {
  /** Longest delay the buffers can hold. Synced times beyond this are clamped. */
  static readonly MAX_SECONDS = 3;

  outL = 0;
  outR = 0;

  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly size: number;
  private writeIndex = 0;

  private target: number;
  private smoothed: number;
  private readonly glide: number;

  private feedback = 0;
  private damp = 0;
  /** Damping state for each crossing: the right line's output on its way to the left, and back. */
  private fromRight = 0;
  private fromLeft = 0;

  constructor(private readonly sampleRate: number) {
    this.size = Math.ceil(PingPongDelay.MAX_SECONDS * sampleRate) + 2;
    this.left = new Float32Array(this.size);
    this.right = new Float32Array(this.size);
    this.target = sampleRate * 0.35;
    this.smoothed = this.target;
    // Roughly 50 ms to reach a new delay time: fast enough to feel immediate,
    // slow enough that the pitch glide reads as an effect rather than a glitch.
    this.glide = 1 - Math.exp(-1 / (0.05 * sampleRate));
    this.setDamping(4000);
  }

  reset(): void {
    this.left.fill(0);
    this.right.fill(0);
    this.fromRight = 0;
    this.fromLeft = 0;
    this.outL = 0;
    this.outR = 0;
  }

  setTime(seconds: number): void {
    // One sample of headroom below the buffer length, and never shorter than
    // the interpolator's two-sample reach.
    this.target = clamp(seconds, 0.001, PingPongDelay.MAX_SECONDS) * this.sampleRate;
  }

  /** Snap the smoother, for a time change that should not glide. */
  snapTime(): void {
    this.smoothed = this.target;
  }

  setFeedback(amount: number): void {
    this.feedback = clamp(amount, 0, 0.95);
  }

  /** One-pole cutoff applied inside the feedback loop, so repeats darken as they go. */
  setDamping(hz: number): void {
    this.damp = Math.exp((-2 * Math.PI * clamp(hz, 200, 20000)) / this.sampleRate);
  }

  process(input: number): void {
    this.smoothed += (this.target - this.smoothed) * this.glide;

    const readL = this.read(this.left, this.smoothed);
    const readR = this.read(this.right, this.smoothed);

    // Damping in the feedback path only: the first repeat is as bright as the
    // source, and each one after loses a little more top.
    this.fromRight = readR + this.damp * (this.fromRight - readR);
    this.fromLeft = readL + this.damp * (this.fromLeft - readL);

    // Feedback is applied once per crossing, so every repeat steps down by the
    // same amount however many times it has bounced.
    this.left[this.writeIndex] = input + this.fromRight * this.feedback;
    this.right[this.writeIndex] = this.fromLeft * this.feedback;

    this.writeIndex = this.writeIndex + 1 >= this.size ? 0 : this.writeIndex + 1;
    this.outL = readL;
    this.outR = readR;
  }

  private read(buffer: Float32Array, delaySamples: number): number {
    // Read behind the write head, wrapping, and interpolate between the two
    // neighbouring samples so a fractional delay time is not quantised.
    let position = this.writeIndex - delaySamples;
    while (position < 0) position += this.size;
    const index = Math.floor(position);
    const frac = position - index;
    const next = index + 1 >= this.size ? 0 : index + 1;
    const a = buffer[index] ?? 0;
    const b = buffer[next] ?? 0;
    return a + (b - a) * frac;
  }
}
