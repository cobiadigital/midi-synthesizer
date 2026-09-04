/**
 * Type declarations for the AudioWorkletGlobalScope, which TypeScript's DOM
 * lib does not include. Only the pieces this project uses.
 */
declare const sampleRate: number;
declare const currentTime: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
