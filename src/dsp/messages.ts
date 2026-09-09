import type { ParamId } from "./params";
import type { SynthEvent } from "./synth";

/** Messages sent from the main thread to the AudioWorklet over its MessagePort. */
export type SynthMessage =
  | { type: "noteOn"; note: number; velocity: number }
  | { type: "noteOff"; note: number }
  | { type: "allNotesOff" }
  | { type: "sustain"; on: boolean }
  | { type: "param"; id: ParamId; value: number };

/**
 * Messages sent back from the AudioWorklet. Only the arpeggiator produces
 * these, and only on blocks where it did something, so the port stays quiet
 * while the instrument is played by hand.
 */
export type SynthReply = { type: "events"; events: SynthEvent[] };

export const PROCESSOR_NAME = "mono-synth";
