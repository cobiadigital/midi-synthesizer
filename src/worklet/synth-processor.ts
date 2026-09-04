/// <reference path="./worklet-globals.d.ts" />
import { PROCESSOR_NAME, type SynthMessage } from "../dsp/messages";
import { MonoVoice } from "../dsp/voice";

/**
 * Hosts a MonoVoice on the audio rendering thread.
 *
 * All communication is via MessagePort: the main thread never touches audio
 * state directly. Output is mono duplicated to every output channel.
 */
class SynthProcessor extends AudioWorkletProcessor {
  private readonly voice = new MonoVoice(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<SynthMessage>) => {
      this.handle(event.data);
    };
  }

  private handle(msg: SynthMessage): void {
    switch (msg.type) {
      case "noteOn":
        this.voice.noteOn(msg.note, msg.velocity);
        break;
      case "noteOff":
        this.voice.noteOff(msg.note);
        break;
      case "allNotesOff":
        this.voice.allNotesOff();
        break;
      case "param":
        this.voice.setParam(msg.id, msg.value);
        break;
    }
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const first = output?.[0];
    if (!output || !first) return true;

    this.voice.render(first);
    for (let ch = 1; ch < output.length; ch++) {
      output[ch]?.set(first);
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor);
