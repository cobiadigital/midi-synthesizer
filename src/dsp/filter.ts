import { clamp, fastTanh } from "./math";

/**
 * Filter responses available from the ladder's stage taps, ordered dark to
 * bright so a knob sweep goes somewhere sensible.
 */
export const FILTER_MODES = ["LP 24", "LP 12", "LP 6", "BP 24", "BP 12", "Notch", "HP 12", "HP 24"] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

/** Headroom of the input stage. Well above unity, so minimum drive is clean. */
const DRIVE_HEADROOM = 3;
/**
 * Headroom of the resonance path. This is what sets the amplitude of
 * self-oscillation: the loop settles where the saturation pulls the gain back
 * to unity, which lands the output around half of this.
 */
const FEEDBACK_HEADROOM = 4;
/**
 * Feedback at the top of the resonance knob. Four is the exact critical value
 * for this topology, so overshooting it slightly guarantees the filter tips
 * into self-oscillation rather than sitting on the edge of it.
 */
const MAX_FEEDBACK = 5.5;

/**
 * Four-pole transistor ladder with multimode stage taps, 2x oversampled.
 *
 * The poles are zero-delay-feedback (topology-preserving) one-poles, and the
 * resonance loop is solved in closed form rather than fed from the previous
 * sample. That matters: a unit delay in the feedback path is what makes naive
 * ladder models go flat and lose resonance as the cutoff climbs, and it caps
 * how far the resonance can be pushed. Solved this way the critical feedback
 * is exactly 4 at every cutoff.
 *
 * Two nonlinearities give the ladder its character without breaking that
 * solution. The input stage saturates hard enough to be the drive control but
 * sits far enough above unity to stay clean at minimum. The feedback path
 * saturates too, which is what limits self-oscillation and makes resonance
 * duck under a loud input the way the original does; it enters the closed form
 * as an instantaneous gain taken from the previous output, which is accurate
 * because at twice the sample rate the output barely moves between steps, and
 * safe because that gain can only ever be smaller than the feedback itself.
 *
 * Mixing the stage outputs is what gives responses other than a lowpass. An
 * n-th order highpass is the binomial combination of the first n+1 taps, and
 * a bandpass is a lowpass of half the order feeding a highpass of the other
 * half, exactly as an Oberheim Xpander derives its fifteen modes from one
 * ladder. Resonance still comes off the fourth pole, so every mode resonates
 * at the cutoff.
 *
 * Oversampling runs the whole nonlinear section at twice the sample rate and
 * averages the two results, a one-zero decimator with its null at the base
 * sample rate. That is not a brick wall, but the harmonics drive actually
 * generates are low order and it keeps them from folding back audibly.
 */
export class LadderFilter {
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private s4 = 0;
  private y4Prev = 0;

  /** One-pole coefficient, recomputed only when the cutoff actually moves. */
  private a = 0;
  private lastCutoff = -1;
  private feedback = 0;
  private passbandComp = 1;
  private driveGain = 1;
  private driveMakeup = 1;
  private mode = 0;

  constructor(private readonly sampleRate: number) {
    this.setCutoff(1000);
  }

  setResonance(resonance: number): void {
    const r = clamp(resonance, 0, 1);
    // Squaring the knob spreads the audible change evenly along its travel and
    // puts the self-oscillating region in roughly the top eighth, where a hand
    // expects to find it.
    this.feedback = MAX_FEEDBACK * r * r;
    // A ladder loses passband gain as resonance climbs, by 1/(1 + feedback).
    // Giving back half of that keeps the sound thinning the way the original
    // does without the patch disappearing at the top of the knob. It goes in
    // after the drive stage, so compensation never adds distortion of its own.
    this.passbandComp = 1 + 0.5 * this.feedback;
  }

  setDrive(drive: number): void {
    const d = clamp(drive, 0, 1);
    this.driveGain = Math.pow(10, d);
    // Overdriving should get louder, just not by the full 20 dB of input gain.
    this.driveMakeup = Math.pow(10, -0.7 * d);
  }

  setMode(mode: number): void {
    this.mode = clamp(Math.round(mode), 0, FILTER_MODES.length - 1);
  }

  /** Clear the state. Only for offline use: mid-note this would click. */
  reset(): void {
    this.s1 = this.s2 = this.s3 = this.s4 = 0;
    this.y4Prev = 0;
  }

  process(x: number, cutoffHz: number): number {
    this.setCutoff(cutoffHz);
    // Sample and hold into the oversampled rate, average on the way back down.
    return (this.step(x) + this.step(x)) * 0.5 * this.driveMakeup;
  }

  private setCutoff(cutoffHz: number): void {
    if (cutoffHz === this.lastCutoff) return;
    this.lastCutoff = cutoffHz;
    const fc = clamp(cutoffHz, 10, this.sampleRate * 0.45);
    // Prewarped one-pole: the oversampled rate is what the ladder actually runs at.
    const g = Math.tan((Math.PI * fc) / (this.sampleRate * 2));
    this.a = g / (1 + g);
  }

  private step(x: number): number {
    const a = this.a;
    const driven = DRIVE_HEADROOM * fastTanh((x * this.driveGain) / DRIVE_HEADROOM);
    const input = driven * this.passbandComp;

    // Saturation of the resonance path, folded into the feedback amount so the
    // loop can still be solved exactly. tanh(z)/z is the gain the saturator is
    // applying right now; it tends to 1 for small signals, where the filter is
    // linear and the guard below takes over.
    const z = (this.feedback * this.y4Prev) / FEEDBACK_HEADROOM;
    const k = Math.abs(z) < 1e-5 ? this.feedback : (this.feedback * fastTanh(z)) / z;

    const a2 = a * a;
    const a3 = a2 * a;
    const a4 = a3 * a;
    const state = (1 - a) * (a3 * this.s1 + a2 * this.s2 + a * this.s3 + this.s4);
    // Closed-form solution of y4 = a^4 (input - k y4) + state.
    const solved = (a4 * input + state) / (1 + k * a4);
    const y0 = input - k * solved;

    let v = a * (y0 - this.s1);
    const y1 = v + this.s1;
    this.s1 = y1 + v;
    v = a * (y1 - this.s2);
    const y2 = v + this.s2;
    this.s2 = y2 + v;
    v = a * (y2 - this.s3);
    const y3 = v + this.s3;
    this.s3 = y3 + v;
    v = a * (y3 - this.s4);
    const y4 = v + this.s4;
    this.s4 = y4 + v;
    this.y4Prev = y4;

    return this.tap(y0, y1, y2, y3, y4);
  }

  /** Mix the stage outputs into the selected response. */
  private tap(y0: number, y1: number, y2: number, y3: number, y4: number): number {
    switch (this.mode) {
      case 0:
        return y4;
      case 1:
        return y2;
      case 2:
        return y1;
      case 3:
        // Two poles of lowpass into two of highpass, scaled back to unity peak.
        return 4 * (y2 - 2 * y3 + y4);
      case 4:
        return 2 * (y1 - y2);
      case 5:
        // Notch is the 12 dB highpass and lowpass summed.
        return y0 - 2 * y1 + 2 * y2;
      case 6:
        return y0 - 2 * y1 + y2;
      default:
        return y0 - 4 * y1 + 6 * y2 - 4 * y3 + y4;
    }
  }
}
