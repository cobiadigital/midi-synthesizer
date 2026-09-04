/** Small numeric helpers shared by the DSP modules. Pure functions, no state. */

export const TWO_PI = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** MIDI note number (fractional allowed, for glide) to frequency in Hz, A4 = 440. */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * One-pole coefficient that reaches ~63% of a target after `seconds`.
 * Used for glide and parameter smoothing. Guards against zero time.
 */
export function onePoleCoef(seconds: number, sampleRate: number): number {
  if (seconds <= 0) return 1;
  return 1 - Math.exp(-1 / (seconds * sampleRate));
}
