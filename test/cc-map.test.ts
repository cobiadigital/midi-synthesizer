import { describe, expect, it } from "vitest";
import { paramDef, paramToNorm, type ParamId } from "../src/dsp/params";
import { CcMap, DEFAULT_BINDINGS, SUSTAIN_CC } from "../src/midi/cc-map";

/** A patch that answers `current` and records what the map applies to it. */
function patch(initial: Partial<Record<ParamId, number>> = {}) {
  const values = new Map<ParamId, number>();
  for (const [id, value] of Object.entries(initial)) values.set(id as ParamId, value as number);
  const read = (id: ParamId): number => values.get(id) ?? paramDef(id).default;
  return {
    read,
    set: (id: ParamId, value: number) => values.set(id, value),
    /** Feed a CC through the map, applying anything it returns. */
    send(map: CcMap, cc: number, raw: number) {
      const result = map.handle(cc, raw, read);
      if (result?.type === "applied") values.set(result.id, result.value);
      return result;
    },
  };
}

/** The 0..127 value whose position matches a param's current value. */
function potFor(id: ParamId, value: number): number {
  return Math.round(paramToNorm(paramDef(id), value) * 127);
}

describe("CcMap", () => {
  it("ships with the eight top dials mapped", () => {
    const map = new CcMap();
    expect(map.paramFor(21)).toBe("filterCutoff");
    expect(map.ccFor("reverbMix")).toBe(28);
    expect(map.paramFor(1)).toBe("modWheel");
    expect(DEFAULT_BINDINGS).toHaveLength(9);
  });

  it("ignores a control change it has no binding for", () => {
    const map = new CcMap();
    expect(map.handle(99, 64, () => 0)).toBeNull();
  });

  it("leaves the sustain pedal alone", () => {
    const map = new CcMap();
    map.bind(SUSTAIN_CC, "filterCutoff");
    expect(map.ccFor("filterCutoff")).toBe(21);
    expect(map.handle(SUSTAIN_CC, 127, () => 0)).toBeNull();
  });

  describe("pickup", () => {
    it("does nothing until the dial reaches the value on screen", () => {
      const map = new CcMap();
      const p = patch({ filterCutoff: 18000 });
      // The pot is down at the bottom while the cutoff is wide open.
      const waiting = p.send(map, 21, 10);
      expect(waiting).toEqual({ type: "waiting", id: "filterCutoff", pot: 10 / 127 });
      expect(p.read("filterCutoff")).toBe(18000);
    });

    it("takes over once the dial passes the value, and tracks it after that", () => {
      const map = new CcMap();
      const p = patch({ filterCutoff: 18000 });
      const meeting = potFor("filterCutoff", 18000);
      expect(p.send(map, 21, meeting - 30)?.type).toBe("waiting");
      expect(p.send(map, 21, meeting)?.type).toBe("applied");
      // Engaged: a value nowhere near the old one now applies directly.
      const result = p.send(map, 21, 20);
      expect(result?.type).toBe("applied");
      expect(p.read("filterCutoff")).toBeLessThan(1000);
    });

    it("counts a sweep straight past the value as reaching it", () => {
      const map = new CcMap();
      const p = patch({ filterCutoff: 18000 });
      const meeting = potFor("filterCutoff", 18000);
      expect(p.send(map, 21, meeting - 40)?.type).toBe("waiting");
      // A fast sweep can straddle the value without either message landing on
      // it; the crossing is what counts, not the landing.
      expect(p.send(map, 21, Math.min(127, meeting + 40))?.type).toBe("applied");
    });

    it("hands the knob back when the value moves by some other route", () => {
      const map = new CcMap();
      const p = patch({ delayMix: 0 });
      expect(p.send(map, 27, 0)?.type).toBe("applied");
      expect(p.send(map, 27, 64)?.type).toBe("applied");

      // Someone drags the on-screen knob somewhere else.
      p.set("delayMix", 1);
      map.release("delayMix");
      expect(p.send(map, 27, 70)?.type).toBe("waiting");
      expect(p.read("delayMix")).toBe(1);
    });
  });

  it("lets the mod wheel take over at once, since a wheel has a rest position", () => {
    const map = new CcMap();
    const p = patch({ modWheel: 0 });
    // Pushed straight to three quarters with the knob at zero: a pot would sit
    // and wait, a wheel is asking for that much modulation now.
    const result = p.send(map, 1, 96);
    expect(result?.type).toBe("applied");
    expect(p.read("modWheel")).toBeCloseTo(96 / 127, 2);
    // And it still tracks all the way back down to rest.
    p.send(map, 1, 0);
    expect(p.read("modWheel")).toBe(0);
  });

  describe("learning", () => {
    it("moves a param to a new dial rather than answering to both", () => {
      const map = new CcMap();
      map.bind(50, "filterCutoff");
      expect(map.ccFor("filterCutoff")).toBe(50);
      expect(map.paramFor(21)).toBeNull();
    });

    it("replaces whatever the dial used to control", () => {
      const map = new CcMap();
      map.bind(21, "masterVolume");
      expect(map.paramFor(21)).toBe("masterVolume");
      expect(map.ccFor("filterCutoff")).toBeNull();
    });

    it("makes a newly learned dial earn takeover", () => {
      const map = new CcMap();
      const p = patch({ masterVolume: 0.7 });
      map.bind(30, "masterVolume");
      expect(p.send(map, 30, 0)?.type).toBe("waiting");
    });

    it("clears an assignment", () => {
      const map = new CcMap();
      map.clear("filterCutoff");
      expect(map.ccFor("filterCutoff")).toBeNull();
      expect(map.handle(21, 64, () => 0)).toBeNull();
    });
  });

  describe("values", () => {
    it("spans the whole range, ends included", () => {
      const map = new CcMap();
      const p = patch();
      map.bind(21, "filterCutoff");
      p.send(map, 21, potFor("filterCutoff", paramDef("filterCutoff").default));
      p.send(map, 21, 0);
      expect(p.read("filterCutoff")).toBe(paramDef("filterCutoff").min);
      p.send(map, 21, 127);
      expect(p.read("filterCutoff")).toBe(paramDef("filterCutoff").max);
    });

    it("follows a log taper, so the middle of the dial is the middle of the sweep by ear", () => {
      const map = new CcMap();
      const p = patch();
      const def = paramDef("filterCutoff");
      p.send(map, 21, potFor("filterCutoff", def.default));
      p.send(map, 21, 64);
      // Geometric middle of 20 Hz to 18 kHz is 600 Hz, not the 9 kHz a linear
      // dial would give.
      expect(p.read("filterCutoff")).toBeGreaterThan(500);
      expect(p.read("filterCutoff")).toBeLessThan(750);
    });

    it("snaps a stepped param onto its choices", () => {
      const map = new CcMap();
      const p = patch();
      map.bind(40, "osc1Wave");
      p.send(map, 40, potFor("osc1Wave", paramDef("osc1Wave").default));
      p.send(map, 40, 127);
      expect(p.read("osc1Wave")).toBe(2);
      p.send(map, 40, 64);
      expect(p.read("osc1Wave")).toBe(1);
    });
  });

  describe("saving", () => {
    it("round-trips through JSON", () => {
      const map = new CcMap();
      map.bind(70, "glide");
      const restored = CcMap.fromJSON(JSON.parse(JSON.stringify(map.toJSON())));
      expect(restored.ccFor("glide")).toBe(70);
      expect(restored.paramFor(21)).toBe("filterCutoff");
    });

    it("drops assignments this build no longer has a control for", () => {
      const restored = CcMap.fromJSON({ "21": "filterCutoff", "22": "somethingRemoved", "999": "glide" });
      expect(restored.paramFor(21)).toBe("filterCutoff");
      expect(restored.paramFor(22)).toBeNull();
      expect(restored.ccFor("glide")).toBeNull();
    });

    it("survives junk in storage", () => {
      for (const junk of [null, "", 42, [], { "21": 7 }]) {
        expect(() => CcMap.fromJSON(junk)).not.toThrow();
      }
      expect(CcMap.fromJSON(null).paramFor(21)).toBeNull();
    });
  });
});
