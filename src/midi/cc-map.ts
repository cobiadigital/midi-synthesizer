import { PARAM_INDEX, paramDef, paramFromNorm, paramToNorm, type ParamId } from "../dsp/params";

/**
 * CC 64 is the sustain pedal and stays that way: it is handled before the map
 * is consulted and cannot be learned onto a knob.
 */
export const SUSTAIN_CC = 64;

/**
 * Factory assignment for the eight top dials of a Launchkey Mini, which send
 * CC 21 to 28. Spread across filter, envelope and effects so every dial does
 * something audible before anything is remapped.
 */
export const DEFAULT_BINDINGS: ReadonlyArray<readonly [number, ParamId]> = [
  [21, "filterCutoff"],
  [22, "filterResonance"],
  [23, "filterEnvAmount"],
  [24, "filterDrive"],
  [25, "ampAttack"],
  [26, "ampRelease"],
  [27, "delayMix"],
  [28, "reverbMix"],
];

/**
 * How close the pot has to get before it picks the knob up, as a fraction of
 * full travel. A little over one CC step, so a pot that lands exactly on the
 * value engages rather than sitting one step away forever.
 */
const PICKUP_TOLERANCE = 1.5 / 127;

/** What a control change did, so the UI can follow it. */
export type CcResult =
  | { type: "applied"; id: ParamId; value: number }
  /** Pickup has not engaged yet. `pot` is 0..1, for showing where the dial is sitting. */
  | { type: "waiting"; id: ParamId; pot: number }
  | { type: "learned"; id: ParamId; cc: number };

/**
 * Maps MIDI control changes onto params, with soft takeover.
 *
 * A physical pot has a position of its own and the patch has a value, and on
 * connecting they will not agree. Rather than letting the first nudge of a
 * dial leap the cutoff across the room, a binding stays disengaged until the
 * pot reaches or crosses the value on screen; from then on it tracks directly,
 * until something else moves that param and takeover has to be earned again.
 *
 * No DOM and no Web MIDI in here: it is a lookup table with a state machine,
 * which is what makes it testable offline.
 */
export class CcMap {
  private readonly byCc = new Map<number, ParamId>();
  /** Bindings that have earned takeover and are tracking their pot directly. */
  private readonly engaged = new Set<ParamId>();
  /** Last position seen from each pot, for detecting a crossing between messages. */
  private readonly lastPot = new Map<number, number>();

  constructor(bindings: ReadonlyArray<readonly [number, ParamId]> = DEFAULT_BINDINGS) {
    for (const [cc, id] of bindings) this.bind(cc, id);
  }

  /** CC number bound to a param, or null. */
  ccFor(id: ParamId): number | null {
    for (const [cc, bound] of this.byCc) if (bound === id) return cc;
    return null;
  }

  paramFor(cc: number): ParamId | null {
    return this.byCc.get(cc) ?? null;
  }

  /**
   * Bind a CC to a param. Both sides are exclusive: a dial controls one param,
   * and a param answers to one dial, so learning always replaces rather than
   * quietly stacking assignments that fight each other.
   */
  bind(cc: number, id: ParamId): void {
    if (cc === SUSTAIN_CC) return;
    const previous = this.ccFor(id);
    if (previous !== null) this.byCc.delete(previous);
    this.byCc.set(cc, id);
    // A freshly learned dial has to earn takeover like any other.
    this.engaged.delete(id);
  }

  clear(id: ParamId): void {
    const cc = this.ccFor(id);
    if (cc !== null) this.byCc.delete(cc);
    this.engaged.delete(id);
  }

  /**
   * Give up takeover for a param, so its dial has to pick it up again. Called
   * when the value moves by some other route: a knob dragged on screen, or a
   * preset loaded underneath it.
   */
  release(id: ParamId): void {
    this.engaged.delete(id);
  }

  /**
   * Handle one control change. `current` reads the param's value now, which is
   * what pickup compares the pot against.
   */
  handle(cc: number, raw: number, current: (id: ParamId) => number): CcResult | null {
    const id = this.byCc.get(cc);
    if (id === undefined || cc === SUSTAIN_CC) return null;

    const def = paramDef(id);
    const pot = Math.min(1, Math.max(0, raw / 127));
    const previous = this.lastPot.get(cc);
    this.lastPot.set(cc, pot);

    if (!this.engaged.has(id)) {
      const value = paramToNorm(def, current(id));
      const near = Math.abs(pot - value) <= PICKUP_TOLERANCE;
      // A pot swept past the value between two messages counts as reaching it:
      // at speed the samples can straddle the value without either landing on it.
      const crossed = previous !== undefined && (previous - value) * (pot - value) < 0;
      if (!near && !crossed) return { type: "waiting", id, pot };
      this.engaged.add(id);
    }

    return { type: "applied", id, value: paramFromNorm(def, pot) };
  }

  /** Serialisable form: CC number to param id. */
  toJSON(): Record<string, ParamId> {
    const out: Record<string, ParamId> = {};
    for (const [cc, id] of this.byCc) out[String(cc)] = id;
    return out;
  }

  /**
   * Rebuild from stored JSON, dropping anything that is not a param this build
   * still has. A saved map outlives the param list it was made against, and a
   * renamed control should cost one assignment rather than the whole map.
   */
  static fromJSON(stored: unknown): CcMap {
    const bindings: Array<[number, ParamId]> = [];
    if (stored && typeof stored === "object") {
      for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
        const cc = Number(key);
        if (!Number.isInteger(cc) || cc < 0 || cc > 127) continue;
        if (typeof value !== "string" || !(value in PARAM_INDEX)) continue;
        bindings.push([cc, value as ParamId]);
      }
    }
    return new CcMap(bindings);
  }
}
