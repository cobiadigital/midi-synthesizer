/**
 * A patch rendered to audio offline, for the picture on the share card.
 *
 * The DSP core has no Web Audio in it and the tests already render it this
 * way, so the main thread can play a chord through a throwaway `Synth` and
 * look at the samples. That is what makes the waveform on the card the sound
 * this patch actually makes rather than a stock squiggle, and it works before
 * the Start button has ever been pressed.
 */

import { PARAMS, type PatchValues } from "./dsp/params";
import { Synth } from "./dsp/synth";

/**
 * A root, a fifth and two octaves: enough voices to show what polyphony and
 * the arpeggiator are doing, few enough to keep the render short. Mono mode
 * plays the last of them, which is the note stack behaving correctly.
 */
export const PREVIEW_NOTES = [48, 55, 60, 64];

const VELOCITY = 100;

/** Held long enough to get past the attack, capped so a slow pad still ends. */
function holdSeconds(patch: PatchValues): number {
  return clamp(patch.ampAttack + patch.ampDecay + 0.25, 0.5, 1.4);
}

/** Enough of the release to show the tail without waiting out a long one. */
function tailSeconds(patch: PatchValues): number {
  return clamp(patch.ampRelease, 0.25, 0.6);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface PatchPreview {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** How long the chord was held, in samples, for marking the release. */
  releaseAt: number;
  /** Loudest sample either side, so the drawing can scale to fill its box. */
  peak: number;
}

/**
 * Play the chord, let go, and keep rendering through the release. Total is
 * under two seconds by construction: the worst case measured for the whole
 * instrument is about 17% of a core per second of audio, so this is a few
 * hundred milliseconds of work behind a disabled button, not a freeze.
 *
 * The sample rate is an argument rather than the hardware's because this
 * never reaches a speaker. 44.1k keeps every taper below Nyquist, including
 * an 18 kHz cutoff, which a lower rate would not.
 */
export function renderPatchPreview(patch: PatchValues, sampleRate = 44100): PatchPreview {
  const synth = new Synth(sampleRate);
  for (const def of PARAMS) synth.setParam(def.id, patch[def.id]);

  const releaseAt = Math.round(holdSeconds(patch) * sampleRate);
  const total = releaseAt + Math.round(tailSeconds(patch) * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);

  for (const note of PREVIEW_NOTES) synth.noteOn(note, VELOCITY);
  // Two calls rather than one: the notes come off between them, and `render`
  // is chunked internally so the arpeggiator still lands on exact samples.
  synth.render(left.subarray(0, releaseAt), right.subarray(0, releaseAt));
  for (const note of PREVIEW_NOTES) synth.noteOff(note);
  synth.render(left.subarray(releaseAt), right.subarray(releaseAt));

  let peak = 0;
  for (let i = 0; i < total; i++) {
    peak = Math.max(peak, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
  }
  return { left, right, sampleRate, releaseAt, peak };
}

/**
 * The waveform reduced to one column of pixels per step: the lowest and
 * highest sample in each. Drawing every sample would be tens of thousands of
 * line segments for a box a few hundred pixels wide, and an envelope is what
 * a waveform display shows anyway.
 */
export function waveformEnvelope(samples: Float32Array, columns: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const perColumn = samples.length / columns;
  for (let c = 0; c < columns; c++) {
    const from = Math.floor(c * perColumn);
    const to = Math.max(from + 1, Math.floor((c + 1) * perColumn));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const s = samples[i] ?? 0;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    min[c] = lo;
    max[c] = hi;
  }
  return { min, max };
}
