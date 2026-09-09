import { DIVISIONS } from "./clock";
import { PingPongDelay } from "./delay";
import { Highpass } from "./filter";
import { clamp } from "./math";
import { paramDef, type ParamId, type ParamStore } from "./params";
import { Reverb } from "./reverb";

/** Below this the high-pass is out of the circuit entirely rather than merely low. */
const HPF_BYPASS = paramDef("hpfCutoff").min;

/**
 * The master effects bus: high-pass, then ping-pong delay, then reverb.
 *
 * The voices sum to mono, the way a polysynth's voice cards sum into its
 * mixer, and this is where the signal becomes stereo. The delay is before the
 * reverb so its repeats are in the room too, which is the order a mixing desk
 * would give you and the one that stops the repeats sounding pasted on.
 *
 * Both effects are wet sends added to the dry signal rather than crossfades,
 * so the dry level is the same at every mix setting, and a mix of zero is the
 * dry signal untouched, bit for bit. An effect at zero mix is skipped
 * altogether and reset when it comes back, so nothing that has been switched
 * off can spend CPU or come back holding what it heard before.
 */
export class Bus {
  private readonly hpf: Highpass;
  private readonly delay: PingPongDelay;
  private readonly reverb: Reverb;
  private delayIdle = true;
  private reverbIdle = true;

  constructor(sampleRate: number, private readonly params: ParamStore) {
    this.hpf = new Highpass(sampleRate);
    this.delay = new PingPongDelay(sampleRate);
    this.reverb = new Reverb(sampleRate);
    for (const id of ["hpfCutoff", "delayFeedback", "reverbSize", "reverbDamp"] as const) {
      this.applyParam(id);
    }
  }

  applyParam(id: ParamId): void {
    const value = this.params.get(id);
    switch (id) {
      case "hpfCutoff":
        this.hpf.setCutoff(value);
        break;
      case "delayFeedback":
        this.delay.setFeedback(value);
        break;
      case "reverbSize":
        this.reverb.setSize(value);
        break;
      case "reverbDamp":
        this.reverb.setDamping(value);
        break;
      default:
        // Times and mixes are read per block in process().
        break;
    }
  }

  /**
   * Read the dry mono signal from `left` and write the stereo result back into
   * `left` and `right`. With no right channel the two sides are folded back to
   * mono, which is what the offline tests render.
   */
  process(left: Float32Array, right: Float32Array | null): void {
    const delayMix = this.params.get("delayMix");
    const reverbMix = this.params.get("reverbMix");
    const highpass = this.params.get("hpfCutoff") > HPF_BYPASS;

    if (!highpass && delayMix === 0 && reverbMix === 0) {
      // Nothing switched on: the dry signal passes through exactly.
      if (right) right.set(left);
      return;
    }

    if (delayMix > 0) {
      const wasIdle = this.delayIdle;
      this.delayIdle = false;
      if (wasIdle) this.delay.reset();
      this.delay.setTime(this.delaySeconds());
      // A delay coming back on starts at its new time rather than gliding
      // there from whatever it was set to last.
      if (wasIdle) this.delay.snapTime();
    } else {
      this.delayIdle = true;
    }

    if (reverbMix > 0) {
      if (this.reverbIdle) this.reverb.reset();
      this.reverbIdle = false;
    } else {
      this.reverbIdle = true;
    }

    for (let i = 0; i < left.length; i++) {
      const dry = highpass ? this.hpf.process(left[i] ?? 0) : left[i] ?? 0;
      let outL = dry;
      let outR = dry;

      if (delayMix > 0) {
        this.delay.process(dry);
        outL += this.delay.outL * delayMix;
        outR += this.delay.outR * delayMix;
      }

      if (reverbMix > 0) {
        // Fed from the post-delay signal, summed to mono: the reverb makes its
        // own stereo image and does not need one handed to it.
        this.reverb.process((outL + outR) * 0.5);
        outL += this.reverb.outL * reverbMix;
        outR += this.reverb.outR * reverbMix;
      }

      if (right) {
        left[i] = outL;
        right[i] = outR;
      } else {
        left[i] = (outL + outR) * 0.5;
      }
    }
  }

  /**
   * Delay time in seconds, either from the knob or from the tempo. A synced
   * division is the same arithmetic the step clock uses, so a delay set to 1/8
   * lands exactly on the arpeggiator's eighths.
   */
  private delaySeconds(): number {
    if (this.params.get("delaySync") < 0.5) return this.params.get("delayTime");
    const index = clamp(Math.round(this.params.get("delayDivision")), 0, DIVISIONS.length - 1);
    const beats = DIVISIONS[index]?.beats ?? 0.5;
    const seconds = (beats * 60) / this.params.get("tempo");
    // A slow tempo at a long division can ask for more than the lines hold.
    return Math.min(seconds, PingPongDelay.MAX_SECONDS);
  }
}
