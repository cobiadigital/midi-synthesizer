/**
 * Web MIDI wrapper. Listens to every connected input and forwards note and
 * controller events. Web MIDI is available in Chrome and Edge; Safari support
 * is unreliable, so callers must treat `MidiInput.isSupported()` as optional.
 */

export interface MidiHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  controlChange?(controller: number, value: number): void;
  devicesChanged?(names: string[]): void;
}

const NOTE_OFF = 0x8;
const NOTE_ON = 0x9;
const CONTROL_CHANGE = 0xb;

export class MidiInput {
  private access: MIDIAccess | null = null;
  private readonly attached = new Set<MIDIInput>();

  constructor(private readonly handlers: MidiHandlers) {}

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  async connect(): Promise<void> {
    if (!MidiInput.isSupported()) throw new Error("Web MIDI is not supported in this browser");
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.attachAll();
    this.attachAll();
  }

  deviceNames(): string[] {
    return [...this.attached].map((input) => input.name ?? "Unnamed device");
  }

  private attachAll(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if (input.state === "connected" && !this.attached.has(input)) {
        input.onmidimessage = (event) => this.onMessage(event);
        this.attached.add(input);
      }
    }
    for (const input of this.attached) {
      if (input.state !== "connected") this.attached.delete(input);
    }
    this.handlers.devicesChanged?.(this.deviceNames());
  }

  private onMessage(event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data || data.length < 2) return;
    const status = data[0] ?? 0;
    const command = status >> 4;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;

    switch (command) {
      case NOTE_ON:
        // Note on with velocity 0 is note off by convention.
        if (d2 === 0) this.handlers.noteOff(d1);
        else this.handlers.noteOn(d1, d2);
        break;
      case NOTE_OFF:
        this.handlers.noteOff(d1);
        break;
      case CONTROL_CHANGE:
        this.handlers.controlChange?.(d1, d2);
        break;
    }
  }
}
