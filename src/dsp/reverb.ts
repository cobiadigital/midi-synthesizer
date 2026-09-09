/**
 * Schroeder-Moorer reverb in the Freeverb arrangement: eight parallel comb
 * filters, each with a one-pole damper in its feedback path, into four series
 * allpasses that smear what the combs leave behind.
 *
 * The comb lengths are mutually prime so their echo trains do not line up and
 * turn into a pitched ring, and the right channel offsets every length by
 * STEREO_SPREAD so the two sides decorrelate into width rather than a single
 * centred image. The tunings are the published Freeverb ones, in samples at
 * 44.1 kHz, scaled here to whatever rate the context is running at.
 */

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const;
const ALLPASS_TUNING = [556, 441, 341, 225] as const;
const STEREO_SPREAD = 23;
const TUNING_RATE = 44100;

/**
 * Room size maps into comb feedback across this range: shortest usable tail to
 * a very long one. The top is held at 0.95 rather than the 0.98 Freeverb uses,
 * because a comb's gain for anything it is in tune with is 1/(1 - feedback):
 * a coherent full-scale input builds up 20 times at 0.95 and 50 times at 0.98,
 * and there is no limiter downstream to catch it.
 */
const ROOM_SCALE = 0.25;
const ROOM_OFFSET = 0.7;
/** Damping maps into the one-pole inside each comb. Full damp still lets some low end through. */
const DAMP_SCALE = 0.4;
/**
 * Input gain into the comb bank. Eight combs at near-unity feedback build a
 * lot of gain, so the input is scaled well down and the output brought back up
 * by WET_GAIN, which is calibrated so each wet channel comes out at about the
 * level of the dry signal that fed it.
 */
const INPUT_GAIN = 0.015;
const WET_GAIN = 2.8;
/** Comb feedback the wet gain is calibrated at: the middle of the size knob. */
const REFERENCE_FEEDBACK = ROOM_OFFSET + ROOM_SCALE * 0.6;

class Comb {
  private readonly buffer: Float32Array;
  private index = 0;
  private store = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  reset(): void {
    this.buffer.fill(0);
    this.store = 0;
  }

  process(input: number, feedback: number, damp: number): number {
    const output = this.buffer[this.index] ?? 0;
    // One-pole low-pass inside the loop: each pass round the comb loses a
    // little more top end, which is what makes a room sound like a room
    // rather than a metal tank.
    this.store = output * (1 - damp) + this.store * damp;
    this.buffer[this.index] = input + this.store * feedback;
    this.index = this.index + 1 >= this.buffer.length ? 0 : this.index + 1;
    return output;
  }
}

class Allpass {
  private readonly buffer: Float32Array;
  private index = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  reset(): void {
    this.buffer.fill(0);
  }

  process(input: number): number {
    const buffered = this.buffer[this.index] ?? 0;
    const output = buffered - input;
    // Fixed 0.5 gain: an allpass diffuser only has to scatter the echo
    // density, so it stays out of the way of the decay time.
    this.buffer[this.index] = input + buffered * 0.5;
    this.index = this.index + 1 >= this.buffer.length ? 0 : this.index + 1;
    return output;
  }
}

export class Reverb {
  outL = 0;
  outR = 0;

  private readonly combsL: Comb[] = [];
  private readonly combsR: Comb[] = [];
  private readonly allpassL: Allpass[] = [];
  private readonly allpassR: Allpass[] = [];

  private feedback = REFERENCE_FEEDBACK;
  private damp = DAMP_SCALE * 0.4;
  private wet = WET_GAIN;

  constructor(sampleRate: number) {
    const scale = sampleRate / TUNING_RATE;
    const size = (tuning: number, offset: number): number => Math.max(4, Math.round((tuning + offset) * scale));
    for (const tuning of COMB_TUNING) {
      this.combsL.push(new Comb(size(tuning, 0)));
      this.combsR.push(new Comb(size(tuning, STEREO_SPREAD)));
    }
    for (const tuning of ALLPASS_TUNING) {
      this.allpassL.push(new Allpass(size(tuning, 0)));
      this.allpassR.push(new Allpass(size(tuning, STEREO_SPREAD)));
    }
  }

  reset(): void {
    for (const comb of this.combsL) comb.reset();
    for (const comb of this.combsR) comb.reset();
    for (const allpass of this.allpassL) allpass.reset();
    for (const allpass of this.allpassR) allpass.reset();
    this.outL = 0;
    this.outR = 0;
  }

  /** 0 is a small bright room, 1 is a hall that takes its time. */
  setSize(amount: number): void {
    const feedback = ROOM_OFFSET + ROOM_SCALE * Math.min(1, Math.max(0, amount));
    this.feedback = feedback;
    // A comb holds steady-state energy of 1/(1 - g^2), so a bigger room is
    // also a louder one for the same input. Taking that back out means the mix
    // knob means the same thing wherever the size knob is, and the largest
    // hall cannot pile up on the output.
    this.wet = (WET_GAIN * Math.sqrt(1 - feedback * feedback)) / Math.sqrt(1 - REFERENCE_FEEDBACK * REFERENCE_FEEDBACK);
  }

  setDamping(amount: number): void {
    this.damp = DAMP_SCALE * Math.min(1, Math.max(0, amount));
  }

  process(input: number): void {
    const source = input * INPUT_GAIN;
    let left = 0;
    let right = 0;
    // Combs in parallel: their outputs sum, which is where the echo density
    // comes from.
    for (let i = 0; i < this.combsL.length; i++) {
      left += this.combsL[i]?.process(source, this.feedback, this.damp) ?? 0;
      right += this.combsR[i]?.process(source, this.feedback, this.damp) ?? 0;
    }
    // Allpasses in series: each one multiplies the echo density without
    // changing the level.
    for (let i = 0; i < this.allpassL.length; i++) {
      left = this.allpassL[i]?.process(left) ?? left;
      right = this.allpassR[i]?.process(right) ?? right;
    }
    this.outL = left * this.wet;
    this.outR = right * this.wet;
  }
}
