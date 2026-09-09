import { clamp, fastTanh } from "./math";

/** Cutoffs are clamped here rather than at the knob, so modulation cannot detune the filter into instability. */
const MIN_CUTOFF = 20;

/**
 * Four-pole Moog ladder low-pass with a saturating stage in every pole.
 *
 * Four one-pole sections in series give the 24 dB/octave slope. Each pole
 * turns the phase by 45 degrees at its own cutoff, so the four together hit
 * 180 degrees exactly there: feed the last pole back into the input and that
 * is the frequency the loop rings at. Loop gain reaches unity around 4, which
 * is why resonance is scaled to a little past it and self-oscillates at the
 * top of the knob.
 *
 * Two things keep that a filter rather than an oscillator with an input:
 *
 *  - One saturator sits inside the loop, so as resonance climbs the loop gain
 *    compresses instead of running away. That soft limit is what a real
 *    ladder's transistor pairs do, and it is why the filter can be pushed to
 *    the edge of self-oscillation and stay there. The poles themselves are
 *    left linear: saturating every pole individually drives its state to
 *    `atanh` of the input, which blows up at full scale and swamps the
 *    resonance.
 *  - The unit delay a digital feedback loop cannot avoid is what detunes the
 *    peak and over-resonates it near Nyquist. Running the whole thing at
 *    twice the sample rate halves that error, and averaging the last two
 *    outputs in the feedback tap (`half`) cancels most of the rest.
 *
 * Resonance also drains the passband, exactly as it does on the hardware.
 * PASSBAND_COMP feeds a fraction of the input back in to hold the low end up,
 * which is the usual compromise: too little and a resonant sweep gets thin,
 * too much and the resonance stops being audible.
 *
 * Cutoff is marked where the resonant peak sits, the convention every ladder
 * filter is labelled by. With resonance down, that point is already 12 dB
 * along the slope: four poles, 3 dB each.
 */
export class LadderFilter {
  /** Feedback gain at full resonance. Loop gain reaches unity around 4. */
  private static readonly MAX_FEEDBACK = 4.4;
  private static readonly PASSBAND_COMP = 0.5;
  /** Oversampling factor for the feedback loop. */
  private static readonly OVERSAMPLE = 2;
  /**
   * How hard the loop hits the saturator per unit of drive. A quarter puts the
   * knee at full scale when drive reaches 4, which leaves drive 1 clean for
   * the signals a voice actually produces.
   */
  private static readonly SATURATION = 0.25;

  private stage0 = 0;
  private stage1 = 0;
  private stage2 = 0;
  private stage3 = 0;
  private half = 0;
  private prev = 0;

  private g = 1;
  private feedback = 0;
  private satGain = LadderFilter.SATURATION;
  private satComp = 1 / LadderFilter.SATURATION;

  private readonly nyquist: number;
  private readonly rateScale: number;

  constructor(sampleRate: number) {
    this.nyquist = sampleRate * 0.5;
    this.rateScale = -2 * Math.PI / (sampleRate * LadderFilter.OVERSAMPLE);
    this.setCutoff(sampleRate * 0.25);
  }

  /** Clear the poles. Called when a voice starts from silence so no note inherits the last one's tail. */
  reset(): void {
    this.stage0 = 0;
    this.stage1 = 0;
    this.stage2 = 0;
    this.stage3 = 0;
    this.half = 0;
    this.prev = 0;
  }

  /**
   * Cutoff in Hz. Cheap enough to call per sample, which is what envelope and
   * key tracking modulation needs: one exp, and the pole coefficient of a
   * one-pole low-pass is exactly `1 - exp(-2*pi*fc/fs)`.
   */
  setCutoff(hz: number): void {
    // Stop short of Nyquist: at the very top the one-pole mapping saturates
    // and the feedback loop stops being well behaved.
    const fc = clamp(hz, MIN_CUTOFF, this.nyquist * 0.9);
    this.g = 1 - Math.exp(fc * this.rateScale);
  }

  /** 0 is no peak, 1 sits at the edge of self-oscillation. */
  setResonance(amount: number): void {
    this.feedback = clamp(amount, 0, 1) * LadderFilter.MAX_FEEDBACK;
  }

  /**
   * Gain into the loop's saturator, 1 for clean.
   *
   * The makeup only puts back the square root of what the drive gain added, so
   * turning it up is mostly harmonics and compression with a moderate lift in
   * level, rather than a volume control that happens to distort.
   */
  setDrive(amount: number): void {
    const drive = Math.max(1, amount);
    this.satGain = drive * LadderFilter.SATURATION;
    this.satComp = Math.sqrt(drive) / this.satGain;
  }

  process(input: number): number {
    for (let i = 0; i < LadderFilter.OVERSAMPLE; i++) {
      // Passband compensation goes in with the feedback so it scales with it.
      const v = input - this.feedback * (this.half - LadderFilter.PASSBAND_COMP * input);
      const u = fastTanh(v * this.satGain) * this.satComp;

      this.stage0 += this.g * (u - this.stage0);
      this.stage1 += this.g * (this.stage0 - this.stage1);
      this.stage2 += this.g * (this.stage1 - this.stage2);
      this.stage3 += this.g * (this.stage2 - this.stage3);

      // Half-sample delay: the mean of this output and the last one. It has to
      // be a two-point average of successive samples, not a one-pole on its
      // own state, or the feedback arrives attenuated and lagging and the
      // resonance never builds.
      this.half = (this.stage3 + this.prev) * 0.5;
      this.prev = this.stage3;
    }
    return this.half;
  }
}

/**
 * Two-pole (12 dB/octave) high-pass for the master bus.
 *
 * Two one-pole high-pass sections in series. There is no resonance and no
 * modulation here on purpose: this is the control that gets a patch out of the
 * way of a bass line, not a second voice of the filter.
 */
export class Highpass {
  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;
  private coef = 1;

  constructor(private readonly sampleRate: number) {
    this.setCutoff(MIN_CUTOFF);
  }

  reset(): void {
    this.x1 = 0;
    this.y1 = 0;
    this.x2 = 0;
    this.y2 = 0;
  }

  setCutoff(hz: number): void {
    // Pole of a one-pole high-pass: the closer to 1, the lower it reaches.
    const fc = clamp(hz, 1, this.sampleRate * 0.45);
    this.coef = Math.exp((-2 * Math.PI * fc) / this.sampleRate);
  }

  process(input: number): number {
    // y[n] = a * (y[n-1] + x[n] - x[n-1]) is the DC-blocker form: unity in the
    // passband, first order roll-off below the pole.
    const stage1 = this.coef * (this.y1 + input - this.x1);
    this.x1 = input;
    this.y1 = stage1;
    const stage2 = this.coef * (this.y2 + stage1 - this.x2);
    this.x2 = stage1;
    this.y2 = stage2;
    return stage2;
  }
}
