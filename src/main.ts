import { AudioEngine } from "./audio-engine";
import { defaultPatch, type ParamId } from "./dsp/params";
import { KeyboardInput } from "./midi/keyboard-input";
import { MidiInput } from "./midi/midi-input";
import { ScreenKeyboard } from "./ui/keyboard";
import { Panel } from "./ui/panel";
import "./style.css";

// Last line of defence for the panel and keyboard: WebKit can still anchor a
// selection when a gesture starts on a non-selectable element, so refuse to
// begin one anywhere outside explicitly opted-in text.
document.addEventListener("selectstart", (event) => {
  const target = event.target as Element | null;
  const node = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement ?? null;
  if (!node?.closest(".selectable")) event.preventDefault();
});

const engine = new AudioEngine();
const patch = defaultPatch();

const startButton = document.getElementById("start") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;
const panelRoot = document.getElementById("panel") as HTMLElement;
const keyboardRoot = document.getElementById("keyboard") as HTMLElement;

const panel = new Panel(panelRoot, patch, (id: ParamId, value: number) => {
  patch[id] = value;
  engine.setParam(id, value);
});

const screenKeyboard = new ScreenKeyboard(keyboardRoot, {
  noteOn: (note, velocity) => noteOn(note, velocity),
  noteOff: (note) => noteOff(note),
});

function noteOn(note: number, velocity: number): void {
  engine.noteOn(note, velocity);
  screenKeyboard.setHeld(note, true);
}

function noteOff(note: number): void {
  engine.noteOff(note);
  screenKeyboard.setHeld(note, false);
}

new KeyboardInput({
  noteOn,
  noteOff,
  octaveChanged: (base) => setStatus(`Computer keyboard octave: C${base / 12 - 1}`),
}).attach();

function setStatus(text: string): void {
  status.textContent = text;
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  try {
    await engine.start();
    // Push the current knob state into the freshly created worklet.
    for (const [id, value] of Object.entries(patch)) engine.setParam(id as ParamId, value);
    startButton.textContent = "Audio running";
    document.body.classList.add("audio-on");
    await connectMidi();
  } catch (err) {
    startButton.disabled = false;
    setStatus(`Could not start audio: ${(err as Error).message}`);
  }
});

async function connectMidi(): Promise<void> {
  if (!MidiInput.isSupported()) {
    setStatus("Web MIDI not available in this browser. Use the on-screen keys or A-K on your keyboard.");
    return;
  }
  setStatus("Requesting MIDI access. Approve the browser prompt if one appears.");
  const midi = new MidiInput({
    noteOn,
    noteOff,
    devicesChanged: (names) =>
      setStatus(names.length ? `MIDI: ${names.join(", ")}` : "MIDI ready. No devices connected."),
  });
  try {
    await midi.connect();
  } catch (err) {
    setStatus(`MIDI unavailable: ${(err as Error).message}`);
  }
}

// Keep the knob panel in sync if presets get loaded later.
panel.setPatch(patch);
