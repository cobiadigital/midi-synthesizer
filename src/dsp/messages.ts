import type { ParamId } from "./params";

/** Messages sent from the main thread to the AudioWorklet over its MessagePort. */
export type SynthMessage =
  | { type: "noteOn"; note: number; velocity: number }
  | { type: "noteOff"; note: number }
  | { type: "allNotesOff" }
  | { type: "param"; id: ParamId; value: number };

export const PROCESSOR_NAME = "mono-synth";
