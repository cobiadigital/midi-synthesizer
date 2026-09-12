import { describe, expect, it } from "vitest";
import { PREVIEW_NOTES, renderPatchPreview, waveformEnvelope } from "../src/patch-preview";
import { defaultPatch } from "../src/dsp/params";
import { peak, rms } from "./helpers";

describe("patch preview", () => {
  it("makes a sound on the factory patch", () => {
    const preview = renderPatchPreview(defaultPatch());
    expect(preview.peak).toBeGreaterThan(0.1);
    expect(rms(preview.left)).toBeGreaterThan(0.02);
  });

  it("reports a peak past full scale rather than hiding it", () => {
    // Voices sum straight, so four notes at the default volume run hot. The
    // card draws to the peak and prints it, which is the honest picture of
    // what the patch does.
    expect(renderPatchPreview(defaultPatch()).peak).toBeGreaterThan(1);
  });

  it("holds the chord, then releases it", () => {
    const patch = defaultPatch();
    patch.ampRelease = 0.3;
    const preview = renderPatchPreview(patch);
    const held = preview.left.subarray(0, preview.releaseAt);
    const tail = preview.left.subarray(preview.releaseAt);
    expect(tail.length).toBeGreaterThan(0);
    // The tail is the release, so it has to be quieter than what was held.
    expect(rms(tail)).toBeLessThan(rms(held));
  });

  it("hears the patch, not a stock waveform: a closed filter is darker", () => {
    const open = renderPatchPreview(defaultPatch());
    const closed = defaultPatch();
    closed.filterCutoff = 200;
    expect(rms(renderPatchPreview(closed).left)).toBeLessThan(rms(open.left) * 0.9);
  });

  it("renders every voice of the chord in poly", () => {
    const one = defaultPatch();
    one.polyVoices = 2;
    const all = defaultPatch();
    expect(peak(renderPatchPreview(all).left)).toBeGreaterThan(peak(renderPatchPreview(one).left));
    expect(PREVIEW_NOTES.length).toBeGreaterThan(2);
  });

  it("stays under two seconds however slow the envelope", () => {
    const slow = defaultPatch();
    slow.ampAttack = 5;
    slow.ampDecay = 5;
    slow.ampRelease = 5;
    const preview = renderPatchPreview(slow);
    expect(preview.left.length / preview.sampleRate).toBeLessThanOrEqual(2);
  });

  it("reduces a waveform to one column per pixel", () => {
    const preview = renderPatchPreview(defaultPatch());
    const { min, max } = waveformEnvelope(preview.left, 200);
    expect(min.length).toBe(200);
    // Every column brackets zero, and the loudest one reaches the peak.
    for (let i = 0; i < 200; i++) {
      expect(min[i]!).toBeLessThanOrEqual(0);
      expect(max[i]!).toBeGreaterThanOrEqual(0);
    }
    // The envelope keeps the extremes: its tallest column is the loudest
    // positive sample in the whole render.
    let highest = 0;
    for (const s of preview.left) highest = Math.max(highest, s);
    expect(Math.max(...max)).toBeCloseTo(highest, 5);
  });

  it("survives a column count larger than the sample count", () => {
    const { min, max } = waveformEnvelope(new Float32Array([0.5, -0.5]), 8);
    expect(min.length).toBe(8);
    expect(max.length).toBe(8);
  });
});
