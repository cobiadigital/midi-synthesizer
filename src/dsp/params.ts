/**
 * The single source of truth for every user-facing control.
 *
 * The UI builds knobs from this list, the worklet stores values by index,
 * and presets are `Record<ParamId, number>`. Adding a control means adding
 * one entry here and reading it in the voice.
 */

import { ARP_MODES } from "./arpeggiator";
import { DEFAULT_DIVISION, DIVISION_LABELS } from "./clock";
import { LFO_WAVES } from "./lfo";

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
  | "lfoWave"
  | "lfoRate"
  | "lfoSync"
  | "lfoDivision"
  | "lfoTarget"
  | "lfoDepth"
  | "modWheel"
  | "velToCutoff"
  | "velToAmp"
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

/**
 * How the panel draws a control. Knob unless the param says otherwise: a
 * two-state param is a switch, a short list of names is a segmented select,
 * and a small count is a stepper. Stepped params with many positions (octave,
 * clock division) stay knobs, because sweeping through them is the point.
 */
export type ParamControl = "knob" | "switch" | "select" | "stepper";

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
  /** Widget to draw. Defaults to a knob. */
  control?: ParamControl;
  /**
   * Start a new row in the section rather than following on from the last
   * control. For sections big enough that where the rows break is worth
   * deciding rather than leaving to whatever happens to fit.
   */
  newRow?: boolean;
}

export const WAVEFORMS = ["saw", "square", "triangle"] as const;

/**
 * Mono keeps the note stack, legato and glide of a single voice. Poly hands
 * each note its own voice from the pool, which is what `polyVoices` sizes.
 */
export const VOICE_MODES = ["mono", "poly"] as const;

/** Where the LFO is routed. One destination at a time, as on the hardware. */
export const LFO_TARGETS = ["cutoff", "pitch", "shape"] as const;

const OFF_ON = ["off", "on"];

/**
 * Ordered the way the signal flows, which is the order the panel reads in:
 * what allocates notes, then what makes them (oscillators into the mixer),
 * then what shapes them (filter, then the two envelopes), then what modulates
 * them, then the arpeggiator, then the effects bus. `PARAM_INDEX` is derived
 * from this array and nothing persists an index, so the order is free to
 * change; only `ParamId` is load-bearing.
 */
export const PARAMS: readonly ParamDef[] = [
  // How notes are allocated, before anything that makes a sound.
  { id: "voiceMode", label: "Mode", group: "VOICE", min: 0, max: 1, default: 1, step: 1, choices: [...VOICE_MODES], control: "select" },
  { id: "polyVoices", label: "Voices", group: "VOICE", min: 2, max: 8, default: 8, step: 1, control: "stepper" },
  { id: "glide", label: "Glide", group: "VOICE", min: 0, max: 2, default: 0, taper: "log", unit: "s" },

  { id: "osc1Wave", label: "Wave", group: "VCO 1", min: 0, max: 2, default: 0, step: 1, choices: [...WAVEFORMS], control: "select" },
  { id: "osc1Octave", label: "Octave", group: "VCO 1", min: -2, max: 2, default: 0, step: 1, choices: ["16'", "8'", "4'", "2'", "1'"] },
  { id: "osc1Shape", label: "Shape", group: "VCO 1", min: 0, max: 1, default: 0 },
  { id: "osc2Wave", label: "Wave", group: "VCO 2", min: 0, max: 2, default: 0, step: 1, choices: [...WAVEFORMS], control: "select" },
  { id: "osc2Octave", label: "Octave", group: "VCO 2", min: -2, max: 2, default: 0, step: 1, choices: ["16'", "8'", "4'", "2'", "1'"] },
  { id: "osc2Pitch", label: "Pitch", group: "VCO 2", min: -12, max: 12, default: 0, step: 1, unit: "st" },
  { id: "osc2Detune", label: "Detune", group: "VCO 2", min: -50, max: 50, default: 0, unit: "c" },
  { id: "osc2Shape", label: "Shape", group: "VCO 2", min: 0, max: 1, default: 0 },

  { id: "mixOsc1", label: "VCO 1", group: "MIXER", min: 0, max: 1, default: 1 },
  { id: "mixOsc2", label: "VCO 2", group: "MIXER", min: 0, max: 1, default: 0 },
  { id: "mixSub", label: "Sub", group: "MIXER", min: 0, max: 1, default: 0 },
  { id: "mixNoise", label: "Noise", group: "MIXER", min: 0, max: 1, default: 0 },

  { id: "filterCutoff", label: "Cutoff", group: "VCF", min: 20, max: 18000, default: 18000, taper: "log", unit: "Hz" },
  { id: "filterResonance", label: "Reso", group: "VCF", min: 0, max: 1, default: 0 },
  { id: "filterDrive", label: "Drive", group: "VCF", min: 1, max: 8, default: 1 },
  { id: "filterKeyTrack", label: "Key", group: "VCF", min: 0, max: 1, default: 0 },
  { id: "filterEnvAmount", label: "EG Int", group: "VCF", min: -1, max: 1, default: 0 },

  { id: "filterAttack", label: "Attack", group: "VCF EG", min: 0.001, max: 5, default: 0.005, taper: "log", unit: "s" },
  { id: "filterDecay", label: "Decay", group: "VCF EG", min: 0.001, max: 5, default: 0.5, taper: "log", unit: "s" },
  { id: "filterSustain", label: "Sustain", group: "VCF EG", min: 0, max: 1, default: 0.4 },
  { id: "filterRelease", label: "Release", group: "VCF EG", min: 0.001, max: 5, default: 0.3, taper: "log", unit: "s" },

  // The amp envelope is the last stage in the voice, so it reads after the
  // filter rather than before it.
  { id: "ampAttack", label: "Attack", group: "AMP EG", min: 0.001, max: 5, default: 0.005, taper: "log", unit: "s" },
  { id: "ampDecay", label: "Decay", group: "AMP EG", min: 0.001, max: 5, default: 0.3, taper: "log", unit: "s" },
  { id: "ampSustain", label: "Sustain", group: "AMP EG", min: 0, max: 1, default: 0.8 },
  { id: "ampRelease", label: "Release", group: "AMP EG", min: 0.001, max: 5, default: 0.25, taper: "log", unit: "s" },

  // Target and depth first: what the LFO does matters before how fast it does
  // it. Sync sits next to the two controls it swaps between.
  { id: "lfoTarget", label: "Target", group: "LFO", min: 0, max: LFO_TARGETS.length - 1, default: 0, step: 1, choices: [...LFO_TARGETS], control: "select" },
  { id: "lfoWave", label: "Wave", group: "LFO", min: 0, max: LFO_WAVES.length - 1, default: 0, step: 1, choices: [...LFO_WAVES], control: "select" },
  { id: "lfoDepth", label: "Depth", group: "LFO", min: 0, max: 1, default: 0 },
  { id: "lfoRate", label: "Rate", group: "LFO", min: 0.05, max: 30, default: 5, taper: "log", unit: "Hz" },
  { id: "lfoDivision", label: "Div", group: "LFO", min: 0, max: DIVISION_LABELS.length - 1, default: DEFAULT_DIVISION, step: 1, choices: DIVISION_LABELS },
  { id: "lfoSync", label: "Sync", group: "LFO", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON, control: "switch" },

  { id: "modWheel", label: "Mod", group: "MOD", min: 0, max: 1, default: 0 },
  { id: "velToCutoff", label: "Vel Cut", group: "MOD", min: 0, max: 1, default: 0 },
  { id: "velToAmp", label: "Vel Amp", group: "MOD", min: 0, max: 1, default: 0.7 },

  // Everything the arpeggiator owns, in one place. Rate, swing and gate shape
  // its steps, and were split off into a CLOCK group that only ever held them
  // and the tempo. Tempo is shared with LFO and delay sync, but the
  // arpeggiator is what anyone sets it for.
  { id: "arpMode", label: "Mode", group: "ARP", min: 0, max: ARP_MODES.length - 1, default: 0, step: 1, choices: [...ARP_MODES], control: "select" },
  // What the pattern is, on one row beside the mode column.
  { id: "arpOn", label: "Arp", group: "ARP", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON, control: "switch" },
  { id: "arpLatch", label: "Latch", group: "ARP", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON, control: "switch" },
  { id: "arpOctaves", label: "Range", group: "ARP", min: 1, max: 4, default: 1, step: 1, unit: "oct", control: "stepper" },
  // How it is clocked, on the rows below. Tempo is shared with LFO and delay
  // sync, but the arpeggiator is what anyone sets it for.
  { id: "tempo", label: "Tempo", group: "ARP", min: 30, max: 300, default: 120, unit: "bpm", newRow: true },
  { id: "arpRate", label: "Rate", group: "ARP", min: 0, max: DIVISION_LABELS.length - 1, default: DEFAULT_DIVISION, step: 1, choices: DIVISION_LABELS },
  { id: "arpSwing", label: "Swing", group: "ARP", min: 0, max: 75, default: 0, unit: "%" },
  { id: "arpGate", label: "Gate", group: "ARP", min: 0.05, max: 1, default: 0.5 },
  { id: "arpRatchet", label: "Ratchet", group: "ARP", min: 1, max: 4, default: 1, step: 1, choices: ["x1", "x2", "x3", "x4"], control: "stepper" },

  { id: "delaySync", label: "Sync", group: "DELAY", min: 0, max: 1, default: 0, step: 1, choices: OFF_ON, control: "switch" },
  { id: "delayTime", label: "Time", group: "DELAY", min: 0.02, max: 2, default: 0.35, taper: "log", unit: "s" },
  { id: "delayDivision", label: "Div", group: "DELAY", min: 0, max: DIVISION_LABELS.length - 1, default: DEFAULT_DIVISION, step: 1, choices: DIVISION_LABELS },
  { id: "delayFeedback", label: "Feedback", group: "DELAY", min: 0, max: 0.95, default: 0.35 },

  { id: "reverbSize", label: "Size", group: "REVERB", min: 0, max: 1, default: 0.6 },
  { id: "reverbDamp", label: "Damp", group: "REVERB", min: 0, max: 1, default: 0.4 },

  // The master stage. Both effects are sends added to the dry signal rather
  // than crossfades, so their mixes are send levels and belong together at the
  // output, where they can be reached with the effect sections folded away.
  // The high-pass is the one output control that is not a send; it runs at the
  // head of `Bus`, ahead of both effects, rather than here at the end.
  { id: "hpfCutoff", label: "HP Cut", group: "OUTPUT", min: 20, max: 2000, default: 20, taper: "log", unit: "Hz" },
  { id: "delayMix", label: "Delay", group: "OUTPUT", min: 0, max: 1, default: 0 },
  { id: "reverbMix", label: "Reverb", group: "OUTPUT", min: 0, max: 1, default: 0 },
  // The headroom control, and the last thing anyone touches: voices sum
  // straight, so a big chord with the drive and both sends up is what this is
  // holding back.
  { id: "masterVolume", label: "Volume", group: "OUTPUT", min: 0, max: 1, default: 0.7 },
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
