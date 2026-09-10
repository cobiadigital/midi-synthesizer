import { Envelope } from "./envelope";
import { LadderFilter } from "./filter";
import { clamp, makeRandom, midiToHz, onePoleCoef } from "./math";
import { Oscillator } from "./oscillator";
import { ParamStore, WAVEFORMS, type ParamId } from "./params";

/**
 * Anything that turns note events into sound: the mono voice, or the poly
 * pool. The arpeggiator and the synth play into whichever mode is selected
 * through this interface, so nothing above the engine knows which is running.
 */
export interface VoiceEngine {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
  /** Mix into `out` without clearing it first, so engines can be summed. */
  add(out: Float32Array): void;
  isActive(): boolean;
  applyParam(id: ParamId): void;
}

/** Octaves the filter envelope sweeps at full EG Int, in either direction. */
const ENV_OCTAVES = 6;

/**
 * Samples between filter cutoff updates when something is modulating it.
 * Sixteen is a third of a millisecond at 48 kHz, finer than an envelope or a
 * glide moves, and it keeps the two exponentials that a cutoff change costs
 * off fifteen samples out of sixteen. The counter belongs to the voice rather
 * than the loop so the update points do not move when the host changes its
 * block size.
 */
const CONTROL_INTERVAL = 16;
const LN2_OVER_12 = Math.LN2 / 12;

/**
 * One sounding note: a four-source mixer into the ladder filter into the amp
 * envelope, the order every subtractive synth is wired in, plus a glide
 * smoother, a filter envelope and a velocity gain. It has no idea whether it
 * is the only voice or one of eight.
 *
 * The mixer feeds VCO 1, VCO 2, a square sub an octave below VCO 1, and white
 * noise. VCO 2 and the sub are tuned as ratios of VCO 1's frequency, worked
 * out once per block, so the per-sample cost of a second oscillator is a
 * multiply rather than another `midiToHz`. A source whose level is zero is not
 * rendered at all: the default patch is VCO 1 alone and costs exactly what it
 * did before there was a mixer. A silent oscillator's phase stops where it is,
 * which is not a discontinuity when it comes back; the step in level is, and
 * that is the same either way.
 *
 * Note priority, stealing and legato all live above this class, in the mono
 * voice's note stack or the poly pool's allocator.
 */
export class Voice {
  private readonly osc: Oscillator;
  private readonly osc2: Oscillator;
  private readonly sub: Oscillator;
  /** White noise. Seeded per voice, or eight voices would play the same noise in lockstep. */
  private readonly noise: () => number;
  private readonly filter: LadderFilter;
  private readonly ampEnv: Envelope;
  private readonly filterEnv: Envelope;

  private targetNote = 60;
  private currentNote = 60;
  private glideCoef = 1;
  private velocityGain = 1;

  private gainSmooth = 0;
  private readonly gainCoef: number;
  private controlCountdown = 0;

  constructor(
    private readonly sampleRate: number,
    private readonly params: ParamStore,
    seed = 1,
  ) {
    this.osc = new Oscillator(sampleRate);
    this.osc2 = new Oscillator(sampleRate);
    this.sub = new Oscillator(sampleRate);
    // Golden-ratio stride between voices, so the streams decorrelate instead
    // of being near neighbours of one another.
    this.noise = makeRandom(0x2545f491 + seed * 0x9e3779b1);
    this.filter = new LadderFilter(sampleRate);
    this.ampEnv = new Envelope(sampleRate);
    this.filterEnv = new Envelope(sampleRate);
    this.gainCoef = onePoleCoef(0.01, sampleRate);
    this.applyAllParams();
  }

  /** The note this voice is heading for, which is what the allocator matches on. */
  get note(): number {
    return this.targetNote;
  }

  /** Envelope level, 0..1. The poly allocator steals the quietest voice first. */
  get level(): number {
    return this.ampEnv.level;
  }

  get releasing(): boolean {
    return this.ampEnv.stage === "release";
  }

  isActive(): boolean {
    return this.ampEnv.isActive();
  }

  /**
   * Start or retrigger a note. `glideFromCurrent` is the mono behaviour: slide
   * from whatever is sounding. A stolen poly voice passes false so it jumps to
   * the new pitch instead of swooping up from the note it was playing.
   */
  noteOn(note: number, velocity: number, glideFromCurrent = true): void {
    this.velocityGain = 0.3 + 0.7 * clamp(velocity / 127, 0, 1);
    const wasSilent = !this.ampEnv.isActive();
    this.targetNote = note;
    if (wasSilent || !glideFromCurrent) this.currentNote = note;
    // A silent voice starts from phase zero; a voice that is still sounding
    // keeps its oscillator running so the handover does not click.
    if (wasSilent) {
      this.osc.reset();
      this.osc2.reset();
      this.sub.reset();
      this.filter.reset();
      // Set the cutoff on the first sample of a fresh note rather than up to a
      // control period into it, or a snappy filter envelope opens late.
      this.controlCountdown = 0;
    }
    this.ampEnv.trigger();
    this.filterEnv.trigger();
  }

  /** Move to a new pitch without retriggering the envelope. */
  slideTo(note: number): void {
    this.targetNote = note;
  }

  release(): void {
    this.ampEnv.release();
    this.filterEnv.release();
  }

  add(out: Float32Array): void {
    const p = this.params;
    const gainTarget = p.get("masterVolume") * this.velocityGain;
    if (!this.ampEnv.isActive()) {
      // Nothing to mix. Settle the smoother on its target rather than leaving
      // it stale, so the next note starts at level instead of fading in.
      this.gainSmooth = gainTarget;
      return;
    }

    const wave = WAVEFORMS[Math.round(p.get("osc1Wave"))] ?? "saw";
    const octave = Math.round(p.get("osc1Octave")) * 12;
    const shape = p.get("osc1Shape");

    const wave2 = WAVEFORMS[Math.round(p.get("osc2Wave"))] ?? "saw";
    const shape2 = p.get("osc2Shape");
    // VCO 2's octave, coarse semitones and fine cents collapse into one ratio
    // against VCO 1, so its pitch tracks the keyboard and glide for free.
    const semitones2 =
      Math.round(p.get("osc2Octave")) * 12 + Math.round(p.get("osc2Pitch")) + p.get("osc2Detune") / 100;
    const ratio2 = Math.exp(semitones2 * LN2_OVER_12);

    const mix1 = p.get("mixOsc1");
    const mix2 = p.get("mixOsc2");
    const mixSub = p.get("mixSub");
    const mixNoise = p.get("mixNoise");

    const cutoff = p.get("filterCutoff");
    const keyTrack = p.get("filterKeyTrack");
    const envAmount = p.get("filterEnvAmount");
    // With neither modulator in play the cutoff is a per-block coefficient
    // rather than a per-sample one, which is the common case and the cheap one.
    const modulated = keyTrack !== 0 || envAmount !== 0;
    if (!modulated) this.filter.setCutoff(cutoff);

    for (let i = 0; i < out.length; i++) {
      this.currentNote += (this.targetNote - this.currentNote) * this.glideCoef;
      const hz = midiToHz(this.currentNote + octave);

      // The filter envelope runs whether or not it is routed, so turning EG
      // Int up mid-note picks it up where it already is.
      const filterEnv = this.filterEnv.process();
      if (modulated) {
        if (this.controlCountdown <= 0) {
          // Key tracking and envelope depth are both in semitones, so they add
          // before the one conversion back to Hz.
          const semitones =
            keyTrack * (this.currentNote - 60) + envAmount * filterEnv * 12 * ENV_OCTAVES;
          this.filter.setCutoff(cutoff * Math.exp(semitones * LN2_OVER_12));
          this.controlCountdown = CONTROL_INTERVAL;
        }
        this.controlCountdown--;
      }

      let source = mix1 > 0 ? this.osc.process(hz, wave, shape) * mix1 : 0;
      if (mix2 > 0) source += this.osc2.process(hz * ratio2, wave2, shape2) * mix2;
      // The sub is a square an octave under VCO 1, so it follows VCO 1's own
      // octave switch rather than sitting at a fixed pitch.
      if (mixSub > 0) source += this.sub.process(hz * 0.5, "square", 0) * mixSub;
      if (mixNoise > 0) source += (this.noise() * 2 - 1) * mixNoise;

      const sample = this.filter.process(source);
      const env = this.ampEnv.process();

      this.gainSmooth += (gainTarget - this.gainSmooth) * this.gainCoef;
      out[i] = (out[i] ?? 0) + sample * env * this.gainSmooth;
    }
  }

  applyParam(id: ParamId): void {
    const v = this.params.get(id);
    switch (id) {
      case "ampAttack":
        this.ampEnv.setAttack(v);
        break;
      case "ampDecay":
        this.ampEnv.setDecay(v);
        break;
      case "ampSustain":
        this.ampEnv.setSustain(v);
        break;
      case "ampRelease":
        this.ampEnv.setRelease(v);
        break;
      case "glide":
        this.glideCoef = v <= 0.001 ? 1 : onePoleCoef(v / 4.6, this.sampleRate);
        break;
      case "filterResonance":
        this.filter.setResonance(v);
        break;
      case "filterDrive":
        this.filter.setDrive(v);
        break;
      case "filterAttack":
        this.filterEnv.setAttack(v);
        break;
      case "filterDecay":
        this.filterEnv.setDecay(v);
        break;
      case "filterSustain":
        this.filterEnv.setSustain(v);
        break;
      case "filterRelease":
        this.filterEnv.setRelease(v);
        break;
      default:
        // Oscillator and volume params are read every block in add().
        break;
    }
  }

  private applyAllParams(): void {
    const ids = [
      "ampAttack", "ampDecay", "ampSustain", "ampRelease", "glide",
      "filterResonance", "filterDrive",
      "filterAttack", "filterDecay", "filterSustain", "filterRelease",
    ] as const;
    for (const id of ids) {
      this.applyParam(id);
    }
  }
}

/**
 * A monophonic engine: one voice driven by a note stack with last-note
 * priority.
 *
 * Releasing the newest key while an older one is still held slides back to the
 * older note without retriggering the envelope, the way a Minilogue or Sub 37
 * behaves in mono mode. Glide only means anything here: in poly, a voice that
 * gets reused jumps to its new pitch.
 *
 * Everything is plain TypeScript with no Web Audio dependency, so it can be
 * rendered offline in tests.
 */
export class MonoVoice implements VoiceEngine {
  readonly params: ParamStore;
  private readonly voice: Voice;

  /** Held keys, oldest first. */
  private readonly heldNotes: number[] = [];

  constructor(sampleRate: number, params?: ParamStore) {
    this.params = params ?? new ParamStore();
    // A seed clear of the pool's, so mono and a poly voice ringing out
    // together do not play the same noise twice.
    this.voice = new Voice(sampleRate, this.params, 101);
  }

  noteOn(note: number, velocity: number): void {
    const idx = this.heldNotes.indexOf(note);
    if (idx !== -1) this.heldNotes.splice(idx, 1);
    this.heldNotes.push(note);
    // Retrigger on every new key press; legato only applies when releasing.
    this.voice.noteOn(note, velocity);
  }

  noteOff(note: number): void {
    const idx = this.heldNotes.indexOf(note);
    if (idx !== -1) this.heldNotes.splice(idx, 1);

    const last = this.heldNotes[this.heldNotes.length - 1];
    if (last !== undefined) {
      this.voice.slideTo(last);
    } else {
      this.voice.release();
    }
  }

  allNotesOff(): void {
    this.heldNotes.length = 0;
    this.voice.release();
  }

  isActive(): boolean {
    return this.voice.isActive();
  }

  setParam(id: ParamId, value: number): void {
    this.params.set(id, value);
    this.applyParam(id);
  }

  applyParam(id: ParamId): void {
    this.voice.applyParam(id);
  }

  add(out: Float32Array): void {
    this.voice.add(out);
  }

  /** Render `out.length` samples of mono audio into `out`, replacing it. */
  render(out: Float32Array): void {
    out.fill(0);
    this.add(out);
  }
}
