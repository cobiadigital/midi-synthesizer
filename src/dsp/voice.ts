import { Envelope } from "./envelope";
import { LadderFilter } from "./filter";
import { clamp, midiToHz, onePoleCoef } from "./math";
import { Oscillator } from "./oscillator";
import { ParamStore, WAVEFORMS, type ParamId } from "./params";

/**
 * A monophonic synth voice: note stack, glide, one oscillator, ladder filter,
 * and an envelope each for the filter and the amplifier.
 *
 * The chain is oscillator into filter into amplifier, so the filter works on
 * the raw oscillator level and the amp envelope shapes what comes out of it.
 *
 * Note priority is last-note with legato: releasing the newest key while an
 * older one is still held slides back to the older note without retriggering
 * the envelope, the way a Minilogue or Sub 37 behaves in mono mode.
 *
 * Everything here is plain TypeScript with no Web Audio dependency, so it can
 * be rendered offline in tests.
 */
export class MonoVoice {
  readonly params: ParamStore;
  private readonly osc1: Oscillator;
  private readonly filter: LadderFilter;
  private readonly filtEnv: Envelope;
  private readonly ampEnv: Envelope;

  /** Held keys, oldest first. */
  private readonly heldNotes: number[] = [];
  private targetNote = 60;
  private currentNote = 60;
  private glideCoef = 1;
  private velocityGain = 1;
  /** Raw 0..1 velocity, kept apart from the gain curve for cutoff modulation. */
  private velocity = 1;

  private gainSmooth = 0;
  private readonly gainCoef: number;

  constructor(private readonly sampleRate: number, params?: ParamStore) {
    this.params = params ?? new ParamStore();
    this.osc1 = new Oscillator(sampleRate);
    this.filter = new LadderFilter(sampleRate);
    this.filtEnv = new Envelope(sampleRate);
    this.ampEnv = new Envelope(sampleRate);
    this.gainCoef = onePoleCoef(0.01, sampleRate);
    this.applyAllParams();
  }

  noteOn(note: number, velocity: number): void {
    const idx = this.heldNotes.indexOf(note);
    if (idx !== -1) this.heldNotes.splice(idx, 1);
    this.heldNotes.push(note);

    this.velocity = clamp(velocity / 127, 0, 1);
    this.velocityGain = 0.3 + 0.7 * this.velocity;
    const wasSilent = !this.ampEnv.isActive();
    this.targetNote = note;
    if (wasSilent) {
      // Fresh note: start from the target pitch so glide only applies between notes.
      this.currentNote = note;
      this.osc1.reset();
    }
    // Retrigger on every new key press; legato only applies when releasing.
    this.ampEnv.trigger();
    this.filtEnv.trigger();
  }

  noteOff(note: number): void {
    const idx = this.heldNotes.indexOf(note);
    if (idx !== -1) this.heldNotes.splice(idx, 1);

    const last = this.heldNotes[this.heldNotes.length - 1];
    if (last !== undefined) {
      this.targetNote = last;
    } else {
      this.ampEnv.release();
      this.filtEnv.release();
    }
  }

  allNotesOff(): void {
    this.heldNotes.length = 0;
    this.ampEnv.release();
    this.filtEnv.release();
  }

  isActive(): boolean {
    return this.ampEnv.isActive();
  }

  setParam(id: ParamId, value: number): void {
    this.params.set(id, value);
    this.applyParam(id);
  }

  /** Render `out.length` samples of mono audio into `out`. */
  render(out: Float32Array): void {
    const p = this.params;
    const wave = WAVEFORMS[Math.round(p.get("osc1Wave"))] ?? "saw";
    const octave = Math.round(p.get("osc1Octave")) * 12;
    const shape = p.get("osc1Shape");
    const volume = p.get("masterVolume");

    const cutoff = p.get("cutoff");
    const egAmount = p.get("filterEgAmount");
    const keyTrack = p.get("keyTrack");
    // Full velocity at maximum reaches three octaves, which is enough to open
    // a closed filter without making light playing inaudible.
    const velocityOctaves = p.get("filterVelocity") * this.velocity * 3;
    this.filter.setResonance(p.get("resonance"));
    this.filter.setDrive(p.get("drive"));
    this.filter.setMode(p.get("filterMode"));

    for (let i = 0; i < out.length; i++) {
      this.currentNote += (this.targetNote - this.currentNote) * this.glideCoef;
      const hz = midiToHz(this.currentNote + octave);

      const sample = this.osc1.process(hz, wave, shape);
      // Cutoff modulation is summed in octaves, so an envelope of a given
      // depth moves the filter by the same musical interval wherever the knob
      // is set. Key tracking at 1.0 follows the keyboard semitone for semitone.
      const octaves =
        egAmount * this.filtEnv.process() +
        (keyTrack * (this.currentNote - 60)) / 12 +
        velocityOctaves;
      const filtered = this.filter.process(sample, cutoff * Math.pow(2, octaves));
      const env = this.ampEnv.process();

      this.gainSmooth += (volume * this.velocityGain - this.gainSmooth) * this.gainCoef;
      out[i] = filtered * env * this.gainSmooth;
    }
  }

  private applyAllParams(): void {
    this.applyParam("filtAttack");
    this.applyParam("filtDecay");
    this.applyParam("filtSustain");
    this.applyParam("filtRelease");
    this.applyParam("ampAttack");
    this.applyParam("ampDecay");
    this.applyParam("ampSustain");
    this.applyParam("ampRelease");
    this.applyParam("glide");
  }

  private applyParam(id: ParamId): void {
    const v = this.params.get(id);
    switch (id) {
      case "filtAttack":
        this.filtEnv.setAttack(v);
        break;
      case "filtDecay":
        this.filtEnv.setDecay(v);
        break;
      case "filtSustain":
        this.filtEnv.setSustain(v);
        break;
      case "filtRelease":
        this.filtEnv.setRelease(v);
        break;
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
      default:
        // Oscillator, filter and volume params are read every block in render().
        break;
    }
  }
}
