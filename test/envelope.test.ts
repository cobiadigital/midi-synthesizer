import { describe, expect, it } from "vitest";
import { Envelope } from "../src/dsp/envelope";
import { SAMPLE_RATE } from "./helpers";

function run(env: Envelope, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = env.process();
  return out;
}

describe("Envelope", () => {
  it("is silent when idle", () => {
    const env = new Envelope(SAMPLE_RATE);
    expect(env.process()).toBe(0);
    expect(env.isActive()).toBe(false);
  });

  it("reaches full level during attack and settles at sustain", () => {
    const env = new Envelope(SAMPLE_RATE);
    env.setAttack(0.01);
    env.setDecay(0.05);
    env.setSustain(0.5);
    env.trigger();
    const buf = run(env, SAMPLE_RATE / 2);
    expect(Math.max(...buf)).toBeCloseTo(1, 2);
    expect(buf[buf.length - 1]).toBeCloseTo(0.5, 3);
    expect(env.stage).toBe("sustain");
  });

  it("attack time roughly matches the requested duration", () => {
    const env = new Envelope(SAMPLE_RATE);
    env.setAttack(0.1);
    env.trigger();
    let samples = 0;
    while (env.stage === "attack" && samples < SAMPLE_RATE) {
      env.process();
      samples++;
    }
    const seconds = samples / SAMPLE_RATE;
    expect(seconds).toBeGreaterThan(0.05);
    expect(seconds).toBeLessThan(0.15);
  });

  it("releases to silence and goes idle", () => {
    const env = new Envelope(SAMPLE_RATE);
    env.setAttack(0.001);
    env.setRelease(0.05);
    env.trigger();
    run(env, 4800);
    env.release();
    const tail = run(env, SAMPLE_RATE / 4);
    expect(tail[tail.length - 1]).toBe(0);
    expect(env.isActive()).toBe(false);
  });

  it("retrigger does not reset the level (click-free legato)", () => {
    const env = new Envelope(SAMPLE_RATE);
    env.setAttack(0.5);
    env.trigger();
    run(env, 4800);
    const before = env.level;
    env.trigger();
    expect(env.process()).toBeGreaterThan(before);
  });
});
