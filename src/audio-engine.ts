import { PROCESSOR_NAME, type SynthMessage, type SynthReply } from "./dsp/messages";
import type { ParamId } from "./dsp/params";
import type { SynthEvent } from "./dsp/synth";
import workletUrl from "./worklet/synth-processor.ts?worker&url";

/**
 * Main-thread handle on the synth. Owns the AudioContext and the worklet
 * node and exposes a tiny message-based API. Browsers require a user gesture
 * before audio can start, so `start()` must be called from a click handler.
 */
export class AudioEngine {
  /** Called for each arpeggiator event the audio thread reports. */
  onEvent: ((event: SynthEvent) => void) | null = null;

  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  get isRunning(): boolean {
    return this.context?.state === "running";
  }

  async start(): Promise<void> {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    const context = new AudioContext({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = (event: MessageEvent<SynthReply>) => {
      for (const e of event.data.events) this.onEvent?.(e);
    };
    node.connect(context.destination);
    this.context = context;
    this.node = node;
    await context.resume();
  }

  noteOn(note: number, velocity = 100): void {
    this.send({ type: "noteOn", note, velocity });
  }

  noteOff(note: number): void {
    this.send({ type: "noteOff", note });
  }

  allNotesOff(): void {
    this.send({ type: "allNotesOff" });
  }

  sustain(on: boolean): void {
    this.send({ type: "sustain", on });
  }

  setParam(id: ParamId, value: number): void {
    this.send({ type: "param", id, value });
  }

  private send(msg: SynthMessage): void {
    this.node?.port.postMessage(msg);
  }
}
