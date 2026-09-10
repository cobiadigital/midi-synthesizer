import { AudioEngine } from "./audio-engine";
import { defaultPatch, type ParamId } from "./dsp/params";
import type { SynthEvent } from "./dsp/synth";
import { CcMap, SUSTAIN_CC } from "./midi/cc-map";
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

const STORAGE_KEY = "midi-cc-map";

const engine = new AudioEngine();
const patch = defaultPatch();
const ccMap = loadCcMap();
let learning = false;
let armed: ParamId | null = null;

const startButton = document.getElementById("start") as HTMLButtonElement;
const learnButton = document.getElementById("learn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;
const panelRoot = document.getElementById("panel") as HTMLElement;
const keyboardRoot = document.getElementById("keyboard") as HTMLElement;
const beatLed = document.getElementById("beat") as HTMLElement;

const panel = new Panel(panelRoot, patch, {
  change: (id, value) => {
    setParam(id, value);
    // Moved by hand, so its dial has to pick the knob up again rather than
    // yanking the value back where the pot happens to be sitting.
    ccMap.release(id);
    panel.setPot(id, null);
  },
  learn: (id) => armFor(id),
});

function setParam(id: ParamId, value: number): void {
  patch[id] = value;
  engine.setParam(id, value);
}

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

// The pedal is handled inside the synth, above the arpeggiator: it sustains
// notes when playing by hand and holds the chord while the pattern runs.
function setSustain(on: boolean): void {
  engine.sustain(on);
  keyboardRoot.classList.toggle("sustaining", on);
}

// The audio thread reports each arpeggiator step, which is the only way the
// UI can know what is sounding: the pattern is generated below the main thread.
engine.onEvent = (event: SynthEvent) => {
  switch (event.type) {
    case "arpNote":
      screenKeyboard.setArpNote(event.note, event.on);
      break;
    case "arpStep":
      pulseBeat(event.step);
      break;
    case "arpStopped":
      screenKeyboard.clearArpNotes();
      beatLed.classList.remove("on", "downbeat");
      break;
  }
};

let beatTimer = 0;
function pulseBeat(step: number): void {
  // Every fourth step reads as a downbeat, which gives the eye something to
  // count against when swing or ratcheting makes the rhythm lopsided.
  beatLed.classList.toggle("downbeat", step % 4 === 0);
  beatLed.classList.add("on");
  clearTimeout(beatTimer);
  beatTimer = window.setTimeout(() => beatLed.classList.remove("on"), 70);
}

// MIDI learn: press the button, click a knob, move a dial. Assignments live in
// localStorage, so a controller stays mapped across reloads.
function loadCcMap(): CcMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? CcMap.fromJSON(JSON.parse(stored)) : new CcMap();
  } catch {
    // Private mode, or a half-written entry. The factory map is a fine answer.
    return new CcMap();
  }
}

function saveCcMap(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ccMap.toJSON()));
  } catch {
    // Storage refused. The map still works for this session.
  }
}

function ccLabel(id: ParamId): string | null {
  const cc = ccMap.ccFor(id);
  return cc === null ? null : `CC ${cc}`;
}

function setLearning(on: boolean): void {
  learning = on;
  armed = null;
  learnButton.classList.toggle("active", on);
  learnButton.textContent = on ? "Learning" : "MIDI learn";
  panel.setLearnMode(on, ccLabel);
  panel.clearPots();
  setStatus(on ? "Click a knob, then move a dial to assign it. Click it again to clear." : idleStatus);
}

/** Arm a knob for assignment, or clear the one that is already armed. */
function armFor(id: ParamId): void {
  if (armed === id) {
    ccMap.clear(id);
    saveCcMap();
    armed = null;
    panel.setArmed(null);
    panel.refreshLabels(ccLabel);
    setStatus("Assignment cleared. Click a knob to assign another.");
    return;
  }
  armed = id;
  panel.setArmed(id);
  setStatus("Now move a dial on your controller.");
}

function onControlChange(controller: number, value: number): void {
  if (controller === SUSTAIN_CC) {
    setSustain(value >= 64);
    return;
  }

  if (learning) {
    if (armed === null) {
      setStatus("Click a knob first, then move a dial.");
      return;
    }
    ccMap.bind(controller, armed);
    saveCcMap();
    armed = null;
    panel.setArmed(null);
    panel.refreshLabels(ccLabel);
    setStatus(`Assigned CC ${controller}. Click another knob, or turn learning off.`);
    return;
  }

  const result = ccMap.handle(controller, value, (id) => patch[id]);
  if (!result) return;
  if (result.type === "applied") {
    setParam(result.id, result.value);
    panel.setValue(result.id, result.value);
    panel.setPot(result.id, null);
  } else if (result.type === "waiting") {
    // The dial has not reached the knob yet. Show where it is so the player
    // knows which way to turn.
    panel.setPot(result.id, result.pot);
  }
}

learnButton.disabled = true;
learnButton.addEventListener("click", () => setLearning(!learning));

new KeyboardInput({
  noteOn,
  noteOff,
  sustain: setSustain,
  octaveChanged: (base) => setIdleStatus(`Computer keyboard octave: C${base / 12 - 1}`),
}).attach();

function setStatus(text: string): void {
  status.textContent = text;
}

/**
 * What the status line says when nothing else is going on: which MIDI devices
 * are connected. Learn mode borrows the line and hands it back.
 */
let idleStatus = "";
function setIdleStatus(text: string): void {
  idleStatus = text;
  if (!learning) setStatus(text);
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
    setIdleStatus(`Could not start audio: ${(err as Error).message}`);
  }
});

async function connectMidi(): Promise<void> {
  if (!MidiInput.isSupported()) {
    setIdleStatus("Web MIDI not available in this browser. Use the on-screen keys or A-K on your keyboard.");
    return;
  }
  setIdleStatus("Requesting MIDI access. Approve the browser prompt if one appears.");
  const midi = new MidiInput({
    noteOn,
    noteOff,
    controlChange: onControlChange,
    devicesChanged: (names) => {
      setIdleStatus(names.length ? `MIDI: ${names.join(", ")}` : "MIDI ready. No devices connected.");
      // Dials are no use before there is something to hear.
      learnButton.disabled = names.length === 0;
    },
  });
  try {
    await midi.connect();
  } catch (err) {
    setIdleStatus(`MIDI unavailable: ${(err as Error).message}`);
  }
}

// Keep the knob panel in sync if presets get loaded later.
panel.setPatch(patch);
