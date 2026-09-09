import { clamp } from "./math";
import { paramDef, type ParamId, type ParamStore } from "./params";
import { Voice, type VoiceEngine } from "./voice";

/** Hard ceiling on the pool. The registry owns the number; this mirrors it. */
export const MAX_VOICES = paramDef("polyVoices").max;

interface Slot {
  voice: Voice;
  /** Note the voice was last assigned, -1 before it has ever played. */
  note: number;
  /** Allocation order, so the oldest voice can be found without timestamps. */
  serial: number;
}

/**
 * A pool of voices, one note each.
 *
 * The whole pool is built up front and never grows, so allocation on the audio
 * thread is a search over a fixed array rather than a `new`. The Voices knob
 * sets how much of the pool the allocator may use; voices above that limit are
 * released but still rendered, so shrinking the pool mid-chord fades the extra
 * notes out instead of cutting them.
 *
 * Stealing order, least audible first:
 *  1. The voice already assigned this note, so a repeated note reuses its own
 *     voice rather than piling a second copy on top of the release tail.
 *  2. An idle voice, oldest first.
 *  3. The quietest voice that is already releasing.
 *  4. The oldest voice still being held.
 */
export class PolyVoices implements VoiceEngine {
  private readonly slots: Slot[] = [];
  private serial = 0;

  constructor(
    sampleRate: number,
    private readonly params: ParamStore,
  ) {
    for (let i = 0; i < MAX_VOICES; i++) {
      this.slots.push({ voice: new Voice(sampleRate, params), note: -1, serial: 0 });
    }
  }

  /** Voices the allocator is currently allowed to use. */
  get size(): number {
    return clamp(Math.round(this.params.get("polyVoices")), 1, MAX_VOICES);
  }

  /** Voices making sound right now, including release tails. For tests and metering. */
  get activeVoices(): number {
    let count = 0;
    for (const slot of this.slots) if (slot.voice.isActive()) count++;
    return count;
  }

  noteOn(note: number, velocity: number): void {
    const slot = this.allocate(note);
    if (!slot) return;
    slot.note = note;
    slot.serial = ++this.serial;
    // Poly voices never glide: a stolen voice sliding up from the note it was
    // playing is a swoop nobody asked for. Glide stays a mono behaviour.
    slot.voice.noteOn(note, velocity, false);
  }

  noteOff(note: number): void {
    // Release every match, not just the first: a note pressed twice through
    // two input sources can own more than one voice.
    for (const slot of this.slots) {
      if (slot.note === note && slot.voice.isActive()) slot.voice.release();
    }
  }

  allNotesOff(): void {
    for (const slot of this.slots) slot.voice.release();
  }

  isActive(): boolean {
    return this.slots.some((slot) => slot.voice.isActive());
  }

  applyParam(id: ParamId): void {
    for (const slot of this.slots) slot.voice.applyParam(id);
    if (id !== "polyVoices") return;
    // Turning the pool down would otherwise strand a held note on a voice the
    // allocator can no longer reach, and it would sustain forever.
    for (let i = this.size; i < this.slots.length; i++) this.slots[i]?.voice.release();
  }

  add(out: Float32Array): void {
    // Every slot, not just the allowed ones: an idle voice costs a branch, and
    // a voice above the limit still has a tail to finish.
    for (const slot of this.slots) slot.voice.add(out);
  }

  render(out: Float32Array): void {
    out.fill(0);
    this.add(out);
  }

  private allocate(note: number): Slot | null {
    const size = this.size;
    let idle: Slot | null = null;
    let quietest: Slot | null = null;
    let oldest: Slot | null = null;

    for (let i = 0; i < size; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      if (slot.note === note) return slot;
      if (!slot.voice.isActive()) {
        if (!idle || slot.serial < idle.serial) idle = slot;
        continue;
      }
      if (slot.voice.releasing && (!quietest || slot.voice.level < quietest.voice.level)) {
        quietest = slot;
      }
      if (!oldest || slot.serial < oldest.serial) oldest = slot;
    }
    return idle ?? quietest ?? oldest;
  }
}
