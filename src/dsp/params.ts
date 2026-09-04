/**
 * The single source of truth for every user-facing control.
 *
 * The UI builds knobs from this list, the worklet stores values by index,
 * and presets are `Record<ParamId, number>`. Adding a control means adding
 * one entry here and reading it in the voice.
 */

export type ParamId =
  | "osc1Wave"
  | "osc1Octave"
  | "osc1Shape"
  | "ampAttack"
  | "ampDecay"
  | "ampSustain"
  | "ampRelease"
  | "glide"
  | "masterVolume";

export type ParamTaper = "linear" | "log";

export interface ParamDef {
  id: ParamId;
  label: string;
  group: string;
  min: number;
  max: number;
  default: number;
  /** Discrete controls (waveform, octave) step by this amount. */
  step?: number;
  /** Log taper gives fine control at the low end, right for times and frequencies. */
  taper?: ParamTaper;
  unit?: string;
  /** Labels for discrete values, indexed from `min`. */
  choices?: string[];
}

export const WAVEFORMS = ["saw", "square", "triangle"] as const;

export const PARAMS: readonly ParamDef[] = [
  { id: "osc1Wave", label: "Wave", group: "VCO 1", min: 0, max: 2, default: 0, step: 1, choices: [...WAVEFORMS] },
  { id: "osc1Octave", label: "Octave", group: "VCO 1", min: -2, max: 2, default: 0, step: 1, choices: ["16'", "8'", "4'", "2'", "1'"] },
  { id: "osc1Shape", label: "Shape", group: "VCO 1", min: 0, max: 1, default: 0 },
  { id: "ampAttack", label: "Attack", group: "AMP EG", min: 0.001, max: 5, default: 0.005, taper: "log", unit: "s" },
  { id: "ampDecay", label: "Decay", group: "AMP EG", min: 0.001, max: 5, default: 0.3, taper: "log", unit: "s" },
  { id: "ampSustain", label: "Sustain", group: "AMP EG", min: 0, max: 1, default: 0.8 },
  { id: "ampRelease", label: "Release", group: "AMP EG", min: 0.001, max: 5, default: 0.25, taper: "log", unit: "s" },
  { id: "glide", label: "Glide", group: "VOICE", min: 0, max: 2, default: 0, taper: "log", unit: "s" },
  { id: "masterVolume", label: "Volume", group: "MASTER", min: 0, max: 1, default: 0.7 },
];

export const PARAM_INDEX: Readonly<Record<ParamId, number>> = Object.fromEntries(
  PARAMS.map((p, i) => [p.id, i]),
) as Record<ParamId, number>;

export function paramDef(id: ParamId): ParamDef {
  const def = PARAMS[PARAM_INDEX[id]];
  if (!def) throw new Error(`Unknown param ${id}`);
  return def;
}

export type PatchValues = Record<ParamId, number>;

export function defaultPatch(): PatchValues {
  return Object.fromEntries(PARAMS.map((p) => [p.id, p.default])) as PatchValues;
}

/** Store for parameter values indexed by `PARAM_INDEX`, used inside the worklet. */
export class ParamStore {
  private readonly values: Float64Array;

  constructor(initial: Partial<PatchValues> = {}) {
    this.values = new Float64Array(PARAMS.length);
    for (const def of PARAMS) {
      this.values[PARAM_INDEX[def.id]] = initial[def.id] ?? def.default;
    }
  }

  get(id: ParamId): number {
    return this.values[PARAM_INDEX[id]] ?? 0;
  }

  set(id: ParamId, value: number): void {
    const def = paramDef(id);
    this.values[PARAM_INDEX[id]] = Math.min(def.max, Math.max(def.min, value));
  }
}
