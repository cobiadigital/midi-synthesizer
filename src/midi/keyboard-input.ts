/**
 * Computer keyboard as a MIDI controller: the classic two-row piano layout
 * (A S D F G H J K for white keys, W E T Y U for black keys), Z and X shift
 * octaves, and the space bar stands in for a sustain pedal. Fallback for
 * browsers without Web MIDI.
 */

const KEY_TO_SEMITONE: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15,
};

export interface KeyboardHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  sustain?(on: boolean): void;
  octaveChanged?(baseNote: number): void;
}

export class KeyboardInput {
  private baseNote = 60;
  private readonly down = new Map<string, number>();
  private sustaining = false;

  constructor(private readonly handlers: KeyboardHandlers) {}

  attach(target: Window = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.releaseAll);
  }

  detach(target: Window = window): void {
    target.removeEventListener("keydown", this.onKeyDown);
    target.removeEventListener("keyup", this.onKeyUp);
    target.removeEventListener("blur", this.releaseAll);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTextInput(event.target)) return;
    const key = event.key.toLowerCase();

    if (key === " ") {
      // Space is the pedal. Cancelling the default also stops it scrolling
      // the page or re-firing whichever button still has focus.
      event.preventDefault();
      if (!this.sustaining) {
        this.sustaining = true;
        this.handlers.sustain?.(true);
      }
      return;
    }

    if (key === "z" || key === "x") {
      this.baseNote = Math.min(96, Math.max(24, this.baseNote + (key === "z" ? -12 : 12)));
      this.handlers.octaveChanged?.(this.baseNote);
      return;
    }
    const semitone = KEY_TO_SEMITONE[key];
    if (semitone === undefined || this.down.has(key)) return;
    const note = this.baseNote + semitone;
    this.down.set(key, note);
    this.handlers.noteOn(note, 100);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === " ") {
      this.sustaining = false;
      this.handlers.sustain?.(false);
      return;
    }
    const note = this.down.get(key);
    if (note === undefined) return;
    this.down.delete(key);
    this.handlers.noteOff(note);
  };

  private readonly releaseAll = (): void => {
    for (const note of this.down.values()) this.handlers.noteOff(note);
    this.down.clear();
    // Losing focus with the pedal down would otherwise hold the chord forever:
    // the keyup never arrives.
    if (this.sustaining) {
      this.sustaining = false;
      this.handlers.sustain?.(false);
    }
  };
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}
