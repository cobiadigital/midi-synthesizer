/** Shared offline-rendering helpers for DSP tests. */

export const SAMPLE_RATE = 48000;

export function rms(buffer: Float32Array): number {
  let sum = 0;
  for (const s of buffer) sum += s * s;
  return Math.sqrt(sum / buffer.length);
}

export function peak(buffer: Float32Array): number {
  let max = 0;
  for (const s of buffer) max = Math.max(max, Math.abs(s));
  return max;
}

/**
 * Estimate fundamental frequency by counting upward zero crossings.
 * Adequate for clean periodic test signals.
 */
export function estimateFrequency(buffer: Float32Array, sampleRate: number): number {
  let crossings = 0;
  let firstCrossing = -1;
  let lastCrossing = -1;
  for (let i = 1; i < buffer.length; i++) {
    const prev = buffer[i - 1] ?? 0;
    const cur = buffer[i] ?? 0;
    if (prev < 0 && cur >= 0) {
      if (firstCrossing < 0) firstCrossing = i;
      lastCrossing = i;
      crossings++;
    }
  }
  if (crossings < 2) return 0;
  return ((crossings - 1) * sampleRate) / (lastCrossing - firstCrossing);
}

/** Naive DFT magnitude at one frequency, for checking harmonic content. */
export function magnitudeAt(buffer: Float32Array, frequency: number, sampleRate: number): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * frequency) / sampleRate;
  for (let n = 0; n < buffer.length; n++) {
    const s = buffer[n] ?? 0;
    re += s * Math.cos(w * n);
    im -= s * Math.sin(w * n);
  }
  return (2 * Math.hypot(re, im)) / buffer.length;
}
