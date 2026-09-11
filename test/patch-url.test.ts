import { describe, expect, it } from "vitest";
import { decodePatch, encodePatch, patchFragment, patchFromFragment } from "../src/patch-url";
import { defaultPatch, PARAMS, paramFromNorm, type ParamId, type PatchValues } from "../src/dsp/params";

/** Every param at a position that is not its default, for round-trip tests. */
function spreadPatch(): PatchValues {
  const patch = defaultPatch();
  PARAMS.forEach((def, i) => {
    // Walk the normalized range so each param lands somewhere different,
    // including the ends, and through its own taper.
    patch[def.id] = paramFromNorm(def, (i % 9) / 8);
  });
  return patch;
}

describe("patch url", () => {
  it("writes nothing for the factory patch", () => {
    expect(encodePatch(defaultPatch())).toBe("");
    expect(patchFragment(defaultPatch())).toBe("");
  });

  it("writes only what differs from the factory patch", () => {
    const patch = defaultPatch();
    patch.filterCutoff = 820;
    patch.arpOn = 1;
    expect(encodePatch(patch)).toBe("filterCutoff:820,arpOn:1");
  });

  it("round-trips every param within the rounding it promises", () => {
    const patch = spreadPatch();
    const decoded = decodePatch(encodePatch(patch));
    for (const def of PARAMS) {
      const value = patch[def.id];
      const back = decoded[def.id] ?? def.default;
      const span = Math.abs(value) || def.max - def.min;
      // Four significant figures, so half a unit in the fourth.
      expect(Math.abs(back - value)).toBeLessThanOrEqual(span * 5e-4);
    }
  });

  it("is stable: encoding what it decoded gives the same text", () => {
    const text = encodePatch(spreadPatch());
    expect(encodePatch({ ...defaultPatch(), ...decodePatch(text) })).toBe(text);
  });

  it("keeps stepped params on their steps", () => {
    const decoded = decodePatch("osc1Wave:2,polyVoices:3,osc2Octave:-2");
    expect(decoded.osc1Wave).toBe(2);
    expect(decoded.polyVoices).toBe(3);
    expect(decoded.osc2Octave).toBe(-2);
  });

  it("drops a param this build no longer has", () => {
    const decoded = decodePatch("filterCutoff:400,chorusDepth:0.5,toString:1");
    expect(decoded.filterCutoff).toBe(400);
    expect(Object.keys(decoded)).toEqual(["filterCutoff"]);
  });

  it("clamps a hand-edited value into the param's range", () => {
    const decoded = decodePatch("filterCutoff:999999,masterVolume:-5");
    expect(decoded.filterCutoff).toBe(18000);
    expect(decoded.masterVolume).toBe(0);
  });

  it("skips junk rather than throwing", () => {
    expect(decodePatch("")).toEqual({});
    expect(decodePatch("nonsense")).toEqual({});
    expect(decodePatch("filterCutoff:")).toEqual({});
    expect(decodePatch("filterCutoff:abc")).toEqual({});
    expect(decodePatch(":400")).toEqual({});
    // One bad pair costs that pair, not the patch.
    expect(decodePatch("filterCutoff:abc,masterVolume:.5").masterVolume).toBe(0.5);
  });

  it("reads a fragment with or without its hash", () => {
    const patch = defaultPatch();
    patch.reverbMix = 0.5;
    const fragment = patchFragment(patch);
    expect(fragment).toBe("#p=reverbMix:.5");
    expect(patchFromFragment(fragment).reverbMix).toBe(0.5);
    expect(patchFromFragment("p=reverbMix:.5").reverbMix).toBe(0.5);
    expect(patchFromFragment("")).toEqual({});
    expect(patchFromFragment("#")).toEqual({});
    expect(patchFromFragment("#other=1")).toEqual({});
  });

  it("stays short enough to paste", () => {
    // Every param off its default and off the ends of its range, where the
    // values print longest: the worst case a link can carry. A patch anyone
    // actually dials in moves a dozen or so and runs to about 200.
    const worst = defaultPatch();
    PARAMS.forEach((def, i) => {
      worst[def.id] = paramFromNorm(def, ((i % 9) + 0.5) / 9);
    });
    const text = encodePatch(worst);
    expect(text.length).toBeLessThan(1000);
    // Not quite all of them: a stepped param can snap back onto its default
    // at that position, and a param sitting on its default is not written.
    const ids = new Set(Object.keys(decodePatch(text)) as ParamId[]);
    expect(ids.size).toBeGreaterThan(PARAMS.length - 10);
  });
});
