import { describe, expect, it } from "vitest";
import { DIVISION_LABELS, StepClock } from "../src/dsp/clock";
import { SAMPLE_RATE } from "./helpers";

/** Collect the onset frame of `count` ticks by walking the clock frame by frame. */
function onsets(clock: StepClock, count: number, maxFrames = SAMPLE_RATE * 8): number[] {
  const out: number[] = [];
  let frame = 0;
  while (out.length < count && frame < maxFrames) {
    if (clock.tick()) {
      out.push(frame);
      continue;
    }
    const step = Math.max(1, Math.min(64, Math.floor(clock.framesToTick())));
    clock.advance(step);
    frame += step;
  }
  return out;
}

function gaps(values: number[]): number[] {
  return values.slice(1).map((v, i) => v - (values[i] ?? 0));
}

describe("StepClock", () => {
  it("is silent until started", () => {
    const clock = new StepClock(SAMPLE_RATE);
    expect(clock.running).toBe(false);
    expect(clock.tick()).toBeNull();
    expect(clock.framesToTick()).toBe(Number.POSITIVE_INFINITY);
  });

  it("fires the first step immediately on start", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.start();
    expect(clock.tick()?.step).toBe(0);
  });

  it("runs eighth notes at 120 bpm every 250 ms", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.setTempo(120);
    clock.setDivision(DIVISION_LABELS.indexOf("1/8"));
    clock.start();
    for (const gap of gaps(onsets(clock, 5))) expect(gap).toBeCloseTo(SAMPLE_RATE * 0.25, -1);
  });

  it("halves the step length when the tempo doubles", () => {
    const fast = new StepClock(SAMPLE_RATE);
    fast.setTempo(240);
    fast.setDivision(DIVISION_LABELS.indexOf("1/8"));
    const slow = new StepClock(SAMPLE_RATE);
    slow.setTempo(120);
    slow.setDivision(DIVISION_LABELS.indexOf("1/8"));
    expect(slow.stepFrames(0) / fast.stepFrames(0)).toBeCloseTo(2, 5);
  });

  it("triplets fit three steps in the space of two straight ones", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.setTempo(120);
    clock.setDivision(DIVISION_LABELS.indexOf("1/8T"));
    const straight = new StepClock(SAMPLE_RATE);
    straight.setTempo(120);
    straight.setDivision(DIVISION_LABELS.indexOf("1/8"));
    expect(3 * clock.stepFrames(0)).toBeCloseTo(2 * straight.stepFrames(0), 5);
  });

  it("does not drift on a division that will not divide evenly", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.setTempo(137);
    clock.setDivision(DIVISION_LABELS.indexOf("1/16T"));
    clock.start();
    const times = onsets(clock, 33);
    const expected = clock.stepFrames(0) * 32;
    // Onset 32 should land within a sample of 32 exact steps, not 32 roundings.
    expect(Math.abs((times[32] ?? 0) - expected)).toBeLessThan(1);
  });

  it("swing lengthens even steps and shortens odd ones by the same amount", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.setTempo(120);
    clock.setDivision(DIVISION_LABELS.indexOf("1/8"));
    clock.setSwing(1 / 3);
    clock.start();
    const [long = 0, short = 0] = gaps(onsets(clock, 3));
    expect(long / short).toBeCloseTo(2, 2);
    expect(long + short).toBeCloseTo(SAMPLE_RATE * 0.5, -1);
  });

  it("ratchets subdivide the step without changing its length", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.setTempo(120);
    clock.setDivision(DIVISION_LABELS.indexOf("1/8"));
    clock.setRatchets(3);
    clock.start();
    const times = onsets(clock, 7);
    expect((times[3] ?? 0) - (times[0] ?? 0)).toBeCloseTo(SAMPLE_RATE * 0.25, -1);

    const ratchets: number[] = [];
    const fresh = new StepClock(SAMPLE_RATE);
    fresh.setRatchets(3);
    fresh.start();
    while (ratchets.length < 6) {
      const tick = fresh.tick();
      if (tick) ratchets.push(tick.ratchet);
      else fresh.advance(Math.max(1, Math.floor(fresh.framesToTick())));
    }
    expect(ratchets).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("stop halts the clock and start restarts from step zero", () => {
    const clock = new StepClock(SAMPLE_RATE);
    clock.start();
    onsets(clock, 3);
    clock.stop();
    expect(clock.running).toBe(false);
    expect(clock.tick()).toBeNull();
    clock.start();
    expect(clock.tick()?.step).toBe(0);
  });
});
