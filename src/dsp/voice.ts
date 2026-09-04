import { Envelope } from "./envelope";
import { clamp, midiToHz, onePoleCoef } from "./math";
import { Oscillator } from "./oscillator";
import { ParamStore, WAVEFORMS, type ParamId } from "./params";

/**
 * A monophonic synth voice: note stack, glide, one oscillator, amp envelope.
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
  private readonly ampEnv: Envelope;

  /** Held keys, oldest first. */
  private readonly heldNotes: number[] = [];
  private targetNote = 60;
  private currentNote = 60;
  private glideCoef = 1;
  private velocityGain = 1;

  private gainSmooth = 0;
  private readonly gainCoef: number;

  constructor(private readonly sampleRate: number, params?: ParamStore) {
    this.params = params ?? new ParamStore();
    this.osc1 = new Oscillator(sampleRate);
    this.ampEnv = new Envelope(sampleRate);
    this.gainCoef = onePoleCoef(0.01, sampleRate);
    this.applyAllParams();
  }

  noteOn(note: number, velocity: number): void {
    const idx = this.heldNotes.indexOf(note);
    if (idx !== -1) this.heldNotes.splice(idx, 1);
    this.heldNotes.push(note);

    this.velocityGain = 0.3 + 0.7 * clamp(velocity / 127, 0, 1);
    const wasSilent = !this.ampEnv.isActive();
    this.targetNote = note;
    if (wasSilent) {
      // Fresh note: start from the target pitch so glide only applies between notes.
      this.currentNote = note;
      this.osc1.reset();
    }
    // Retrigger on every new key press; legato only applies when releasing.
    this.ampEnv.trigger();
  }

  noteOff(note: number): void {
    const idx = this.heldNotes.indexOf(note);
    if (idx !== -1) this.heldNotes.splice(idx, 1);

    const last = this.heldNotes[this.heldNotes.length - 1];
    if (last !== undefined) {
      this.targetNote = last;
    } else {
      this.ampEnv.release();
    }
  }

  allNotesOff(): void {
    this.heldNotes.length = 0;
    this.ampEnv.release();
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

    for (let i = 0; i < out.length; i++) {
      this.currentNote += (this.targetNote - this.currentNote) * this.glideCoef;
      const hz = midiToHz(this.currentNote + octave);

      const sample = this.osc1.process(hz, wave, shape);
      const env = this.ampEnv.process();

      this.gainSmooth += (volume * this.velocityGain - this.gainSmooth) * this.gainCoef;
      out[i] = sample * env * this.gainSmooth;
    }
  }

  private applyAllParams(): void {
    this.applyParam("ampAttack");
    this.applyParam("ampDecay");
    this.applyParam("ampSustain");
    this.applyParam("ampRelease");
    this.applyParam("glide");
  }

  private applyParam(id: ParamId): void {
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
      default:
        // Oscillator and volume params are read every block in render().
        break;
    }
  }
}
