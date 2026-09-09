import { describe, expect, it } from "vitest";
import { PingPongDelay } from "../src/dsp/delay";
import { makeRandom } from "../src/dsp/math";
import { Reverb } from "../src/dsp/reverb";
import { SAMPLE_RATE, magnitudeAt, peak, rms } from "./helpers";

/** Peak inside a short window centred on `seconds`, where a repeat should land. */
function tapAt(buffer: Float32Array, seconds: number): number {
  const centre = Math.round(seconds * SAMPLE_RATE);
  return peak(buffer.subarray(centre - 60, centre + 60));
}

function impulseResponse(delay: PingPongDelay, seconds: number): { left: Float32Array; right: Float32Array } {
  const n = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    delay.process(i === 0 ? 1 : 0);
    left[i] = delay.outL;
    right[i] = delay.outR;
  }
  return { left, right };
}

function pingPong(time: number, feedback: number): PingPongDelay {
  const delay = new PingPongDelay(SAMPLE_RATE);
  delay.setTime(time);
  delay.snapTime();
  delay.setFeedback(feedback);
  return delay;
}

describe("PingPongDelay", () => {
  it("bounces repeats between the channels", () => {
    const { left, right } = impulseResponse(pingPong(0.1, 0.6), 0.45);
    // First repeat left, second right, third left again, each one quieter.
    expect(tapAt(left, 0.1)).toBeGreaterThan(0.5);
    expect(tapAt(right, 0.1)).toBe(0);
    expect(tapAt(right, 0.2)).toBeGreaterThan(0.05);
    expect(tapAt(left, 0.2)).toBe(0);
    expect(tapAt(left, 0.3)).toBeGreaterThan(0.01);
    expect(tapAt(left, 0.3)).toBeLessThan(tapAt(left, 0.1));
  });

  it("stops after one crossing with feedback off", () => {
    const { left, right } = impulseResponse(pingPong(0.1, 0), 0.45);
    expect(tapAt(left, 0.1)).toBeGreaterThan(0.5);
    expect(tapAt(right, 0.2)).toBe(0);
    expect(tapAt(left, 0.3)).toBe(0);
  });

  it("feedback sets how long the repeats last", () => {
    // Measured past the first repeat: that one is the input itself coming
    // back round and is the same height whatever the feedback is set to.
    const later = (buffer: Float32Array) => rms(buffer.subarray(Math.round(0.1 * SAMPLE_RATE)));
    const shy = impulseResponse(pingPong(0.05, 0.2), 0.3);
    const long = impulseResponse(pingPong(0.05, 0.85), 0.3);
    expect(later(long.left)).toBeGreaterThan(later(shy.left) * 4);
  });

  it("glides to a new delay time instead of clicking", () => {
    const delay = pingPong(0.2, 0.5);
    const out = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < out.length; i++) {
      if (i === SAMPLE_RATE / 2) delay.setTime(0.05);
      delay.process(0.5 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE));
      out[i] = delay.outL;
    }
    let jump = 0;
    for (let i = 1; i < out.length; i++) jump = Math.max(jump, Math.abs((out[i] ?? 0) - (out[i - 1] ?? 0)));
    // A cut to a new read position would step by most of the waveform; a
    // smoothed one only ever moves by about a sample's worth of it.
    expect(jump).toBeLessThan(0.1);
  });

  it("reset empties the lines", () => {
    const delay = pingPong(0.05, 0.8);
    for (let i = 0; i < 4800; i++) delay.process(1);
    delay.reset();
    for (let i = 0; i < 4800; i++) {
      delay.process(0);
      expect(delay.outL).toBe(0);
      expect(delay.outR).toBe(0);
    }
  });
});

/** Feed noise for `inputSeconds`, then silence, and keep the wet output. */
function reverbRun(reverb: Reverb, inputSeconds: number, totalSeconds: number) {
  const random = makeRandom();
  const n = Math.round(totalSeconds * SAMPLE_RATE);
  const inputFrames = Math.round(inputSeconds * SAMPLE_RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let dry = 0;
  for (let i = 0; i < n; i++) {
    const input = i < inputFrames ? (random() * 2 - 1) * 0.3 : 0;
    dry += input * input;
    reverb.process(input);
    left[i] = reverb.outL;
    right[i] = reverb.outR;
  }
  return { left, right, dryRms: Math.sqrt(dry / inputFrames) };
}

function room(size: number, damping: number): Reverb {
  const reverb = new Reverb(SAMPLE_RATE);
  reverb.setSize(size);
  reverb.setDamping(damping);
  return reverb;
}

describe("Reverb", () => {
  it("puts out about as much as it takes in", () => {
    const { left, right, dryRms } = reverbRun(room(0.6, 0.4), 1, 1);
    // Each wet channel within 3 dB of the dry level, so the mix knob is a mix
    // and not a volume drop or a surprise.
    for (const channel of [left, right]) {
      const wet = rms(channel.subarray(SAMPLE_RATE - 12000)) / dryRms;
      expect(wet).toBeGreaterThan(0.7);
      expect(wet).toBeLessThan(1.4);
    }
  });

  it("keeps ringing after the input stops, for longer in a bigger room", () => {
    const small = reverbRun(room(0.2, 0.4), 0.1, 1.1);
    const large = reverbRun(room(1, 0.4), 0.1, 1.1);
    const tail = (buffer: Float32Array) => rms(buffer.subarray(SAMPLE_RATE >> 1, SAMPLE_RATE));
    expect(tail(large.left)).toBeGreaterThan(0);
    expect(tail(large.left)).toBeGreaterThan(tail(small.left) * 4);
  });

  it("damping takes the top off the tail and leaves the bottom", () => {
    const open = reverbRun(room(0.6, 0), 0.1, 1);
    const damped = reverbRun(room(0.6, 1), 0.1, 1);
    const window = (buffer: Float32Array) => buffer.subarray(SAMPLE_RATE >> 2, SAMPLE_RATE >> 1);
    const high = (buffer: Float32Array) => magnitudeAt(window(buffer), 8000, SAMPLE_RATE);
    const low = (buffer: Float32Array) => magnitudeAt(window(buffer), 300, SAMPLE_RATE);
    expect(high(damped.left)).toBeLessThan(high(open.left) * 0.2);
    expect(low(damped.left)).toBeGreaterThan(low(open.left) * 0.3);
  });

  it("decorrelates the two channels instead of doubling one", () => {
    const { left, right } = reverbRun(room(0.6, 0.4), 0.1, 1);
    const difference = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) difference[i] = (left[i] ?? 0) - (right[i] ?? 0);
    // A mono reverb fed to both sides would cancel to nothing here.
    expect(rms(difference)).toBeGreaterThan(rms(left) * 0.3);
  });

  it("stays bounded on a full-scale input in the largest room", () => {
    const reverb = room(1, 0);
    const random = makeRandom();
    let worst = 0;
    for (let i = 0; i < SAMPLE_RATE * 2; i++) {
      reverb.process(random() * 2 - 1);
      worst = Math.max(worst, Math.abs(reverb.outL), Math.abs(reverb.outR));
    }
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst).toBeLessThan(4);
  });
});
