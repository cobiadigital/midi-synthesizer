/// <reference path="./worklet-globals.d.ts" />
import { PROCESSOR_NAME, type SynthMessage, type SynthReply } from "../dsp/messages";
import { Synth } from "../dsp/synth";

/**
 * Hosts the synth on the audio rendering thread.
 *
 * All communication is via MessagePort: the main thread never touches audio
 * state directly. Output is mono duplicated to every output channel, and
 * arpeggiator activity is posted back so the UI can follow along.
 */
class SynthProcessor extends AudioWorkletProcessor {
  private readonly synth = new Synth(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<SynthMessage>) => {
      this.handle(event.data);
    };
  }

  private handle(msg: SynthMessage): void {
    switch (msg.type) {
      case "noteOn":
        this.synth.noteOn(msg.note, msg.velocity);
        break;
      case "noteOff":
        this.synth.noteOff(msg.note);
        break;
      case "allNotesOff":
        this.synth.allNotesOff();
        break;
      case "param":
        this.synth.setParam(msg.id, msg.value);
        break;
    }
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const first = output?.[0];
    if (!output || !first) return true;

    this.synth.render(first);
    for (let ch = 1; ch < output.length; ch++) {
      output[ch]?.set(first);
    }

    const events = this.synth.takeEvents();
    if (events.length > 0) {
      const reply: SynthReply = { type: "events", events };
      this.port.postMessage(reply);
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, SynthProcessor);
