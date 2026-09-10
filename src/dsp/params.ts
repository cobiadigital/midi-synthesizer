/**
 * The single source of truth for every user-facing control.
 *
 * The UI builds knobs from this list, the worklet stores values by index,
 * and presets are `Record<ParamId, number>`. Adding a control means adding
 * one entry here and reading it in the voice.
 */

import { ARP_MODES } from "./arpeggiator";
import { DEFAULT_DIVISION, DIVISION_LABELS } from "./clock";

export type ParamId =
  | "osc1Wave"
  | "osc1Octave"
  | "osc1Shape"
  | "osc2Wave"
  | "osc2Octave"
  | "osc2Pitch"
  | "osc2Detune"
  | "osc2Shape"
  | "mixOsc1"
  | "mixOsc2"
  | "mixSub"
  | "mixNoise"
  | "ampAttack"
  | "ampDecay"
  | "ampSustain"
  | "ampRelease"
  | "filterCutoff"
  | "filterResonance"
  | "filterDrive"
  | "filterKeyTrack"
  | "filterEnvAmount"
  | "hpfCutoff"
  | "filterAttack"
  | "filterDecay"
  | "filterSustain"
  | "filterRelease"
  | "voiceMode"
  | "polyVoices"
  | "glide"
  | "tempo"
  | "arpRate"
  | "arpSwing"
  | "arpGate"
  | "arpOn"
  | "arpMode"
  | "arpOctaves"
  | "arpRatchet"
  | "arpLatch"
  | "delayTime"
  | "delaySync"
  | "delayDivision"
  | "delayFeedback"
  | "delayMix"
  | "reverbSize"
  | "reverbDamp"
  | "reverbMix"
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

/**
 * Mono keeps the note stack, legato and glide of a single voice. Poly hands
 * each note its own voice from the pool, which is what `polyVoices` sizes.
 */
export const VOICE_MODES = ["mono", "poly"] as const;

const OFF_ON = ["off", "on"];

export const PARAMS: readonly ParamDef[] = [
  { id: "osc1Wave", label: "Wave", group: "VCO 1", min: 0, max: 2, default: 0, step: 1, choices: [...WAVEFORMS] },
  { id: "osc1Octave", label: "Octave", group: "VCO 1", min: -2, max: 2, default: 0, step: 1, choices: ["16'", "8'", "4'", "2'", "1'"] },
  { id: "osc1Shape", label: "Shape", group: "VCO 1", min: 0, max: 1, default: 0 },
  { id: "osc2Wave", label: "Wave", group: "VCO 2", min: 0, max: 2, default: 0, step: 1, choices: [...WAVEFORMS] },
  { id: "osc2Octave", label: "Octave", group: "VCO 2", min: -2, max: 2, default: 0, step: 1, choices: ["16'", "8'", "4'", "2'", "1'"] },
  { id: "osc2Pitch", label: "Pitch", group: "VCO 2", min: -12, max: 12, default: 0, step: 1, unit: "st" },
  { id: "osc2Detune", label: "Detune", group: "VCO 2", min: -50, max: 50, default: 0, unit: "c" },
  { id: "osc2Shape", label: "Shape", group: "VCO 2", min: 0, max: 1, default: 0 },
  { id: "mixOsc1", label: "VCO 1", group: "MIXER", min: 0, max: 1, default: 1 },
  { id: "mixOsc2", label: "VCO 2", group: "MIXER", min: 0, max: 1, default: 0 },
  { id: "mixSub", label: "Sub", group: "MIXER", min: 0, max: 1, default: 0 },
  { id: "mixNoise", label: "Noise", group: "MIXER", min: 0, max: 1, default: 0 },
  { id: "ampAttack", label: "Attack", group: "AMP EG", min: 0.001, max: 5, default: 0.005, taper: "log", unit: "s" },
  { id: "ampDecay", label: "Decay", group: "AMP EG", min: 0.001, max: 5, default: 0.3, taper: "log", unit: "s" },
  { id: "ampSustain", label: "Sustain", group: "AMP EG", min: 0, max: 1, default: 0.8 },
  { id: "ampRelease", label: "Release", group: "AMP EG", min: 0.001, max: 5, default: 0.25, taper: "log", unit: "s" },
  { id: "filterCutoff", label: "Cutoff", group: "VCF", min: 20, max: 18000, default: 18000, taper: "log", unit: "Hz" },
  { id: "filterResonance", label: "Reso", group: "VCF", min: 0, max: 1, default: 0 },
  { id: "filterDrive", label: "Drive", group: "VCF", min: 1, max: 8, default: 1 },
  { id: "filterKeyTrack", label: "Key", group: "VCF", min: 0, max: 1, default: 0 },
  { id: "filterEnvAmount", label: "EG Int", group: "VCF", min: -1, max: 1, default: 0 },
  { id: "hpfCutoff", label: "HP Cut", group: "VCF", min: 20, max: 2000, default: 20, taper: "log", unit: "Hz" },
  { id: "filterAttack", label: "Attack", group: "VCF EG", min: 0.001, max: 5, default: 0.005, taper: "log", unit: "s" },
  { id: "filterDecay", label: "Decay", group: "VCF EG", min: 0.001, max: 5, default: 0.5, taper: "log", unit: "s" },
  { id: "filterSustain", label: "Sustain", group: "VCF EG", min: 0, max: 1, default: 0.4 },
  { id: "filterRelease", label: "Release", group: "VCF EG", min: 0.001, max: 5, default: 0.3, taper: "log", unit: "s" },
  { id: "voiceMode", label: "Mode", group: "VOICE", min: 0, max: 1, default: 1, step: 1, choices: [...VOICE_MODES] },
  { id: "polyVoices", label: "Voices", group: "VOICE", min: 2, max: 8, default: 8, step: 1 },
  { id: "glide", label: "Glide", group: "VOICE", min: 0, max: 2, default: 0, taper: "log", unit: "s" },
  { id: "tempo", label: "Tempo", group: "CLOCK", min: 30, max: 300, default: 120, unit: "bpm" },
  { id: "arpRate", label: "Rate", group: "CLOCK", min: 0, max: DIVISION_LABELS.length - 1, default: DEFAULT_DIVISION, step: 1, choices: DIVISION_LABELS },
  { id: "arpSwing", label: "Swing", group: "CLOCK", min: 0, max: 75, default: 0, unit: "%" },
  { id: "arpGate", label: "Gate", group: "CLOCK", min: 0.05, max: 1, default: 0.5 },
  { id: "arpOn", label: "Arp", group: "ARP", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON },
  { id: "arpMode", label: "Mode", group: "ARP", min: 0, max: ARP_MODES.length - 1, default: 0, step: 1, choices: [...ARP_MODES] },
  { id: "arpOctaves", label: "Range", group: "ARP", min: 1, max: 4, default: 1, step: 1, choices: ["1 oct", "2 oct", "3 oct", "4 oct"] },
  { id: "arpRatchet", label: "Ratchet", group: "ARP", min: 1, max: 4, default: 1, step: 1, choices: ["x1", "x2", "x3", "x4"] },
  { id: "arpLatch", label: "Latch", group: "ARP", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON },
  { id: "delayTime", label: "Time", group: "DELAY", min: 0.02, max: 2, default: 0.35, taper: "log", unit: "s" },
  { id: "delaySync", label: "Sync", group: "DELAY", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON },
  { id: "delayDivision", label: "Div", group: "DELAY", min: 0, max: DIVISION_LABELS.length - 1, default: DEFAULT_DIVISION, step: 1, choices: DIVISION_LABELS },
  { id: "delayFeedback", label: "Feedback", group: "DELAY", min: 0, max: 0.95, default: 0.35 },
  { id: "delayMix", label: "Mix", group: "DELAY", min: 0, max: 1, default: 0 },
  { id: "reverbSize", label: "Size", group: "REVERB", min: 0, max: 1, default: 0.6 },
  { id: "reverbDamp", label: "Damp", group: "REVERB", min: 0, max: 1, default: 0.4 },
  { id: "reverbMix", label: "Mix", group: "REVERB", min: 0, max: 1, default: 0 },
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

/**
 * Clamp to the param's range and snap it to its step, which is what makes a
 * discrete control land on a choice rather than between two.
 */
export function snapParam(def: ParamDef, value: number): number {
  const out = Math.min(def.max, Math.max(def.min, value));
  return def.step ? def.min + Math.round((out - def.min) / def.step) * def.step : out;
}

/**
 * Param value to 0..1 knob position, honouring the taper. Shared by the knob
 * element and by MIDI CC mapping so a controller's travel matches what the
 * knob does under a finger, log tapers and all.
 */
export function paramToNorm(def: ParamDef, value: number): number {
  if (def.taper === "log" && def.min > 0) return Math.log(value / def.min) / Math.log(def.max / def.min);
  return (value - def.min) / (def.max - def.min);
}

/** The inverse: 0..1 position to a snapped param value. */
export function paramFromNorm(def: ParamDef, norm: number): number {
  const clamped = Math.min(1, Math.max(0, norm));
  const value =
    def.taper === "log" && def.min > 0
      ? def.min * Math.pow(def.max / def.min, clamped)
      : def.min + clamped * (def.max - def.min);
  return snapParam(def, value);
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
