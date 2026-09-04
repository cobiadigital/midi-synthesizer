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

/**
 * Rational approximation of tanh, exact enough for saturation duty and about
 * an order of magnitude cheaper than `Math.tanh`.
 *
 * The Pade form would run away past |x| = 3, where it happens to evaluate to
 * exactly 1, so clamping there is both correct and continuous.
 */
export function fastTanh(x: number): number {
  if (x >= 3) return 1;
  if (x <= -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/**
 * Deterministic xorshift32 generator returning 0..1.
 *
 * The arpeggiator's random mode needs randomness on the audio thread, where
 * `Math.random` is fine but untestable. A seeded generator makes the same
 * pattern reproducible in tests.
 */
export function makeRandom(seed = 0x2545f491): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}
