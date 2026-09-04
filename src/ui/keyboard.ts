/**
 * On-screen piano keyboard. Two octaves, pointer-driven, with a note-held
 * highlight that other input sources (MIDI, computer keys) can also drive.
 */

export interface ScreenKeyboardHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export class ScreenKeyboard {
  private readonly keys = new Map<number, HTMLElement>();
  private baseNote: number;
  private activePointerNote: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly handlers: ScreenKeyboardHandlers,
    baseNote = 48,
    octaves = 2,
  ) {
    this.baseNote = baseNote;
    container.classList.add("screen-keyboard");
    for (let i = 0; i <= octaves * 12; i++) {
      const note = baseNote + i;
      const key = document.createElement("button");
      key.type = "button";
      key.className = BLACK_KEYS.has(i % 12) ? "key black" : "key white";
      key.dataset.note = String(note);
      key.setAttribute("aria-label", `Note ${note}`);
      container.appendChild(key);
      this.keys.set(note, key);
    }
    // Same reason as the knob: a mouse drag across the keys would otherwise
    // start a document selection and sweep the page text above the keyboard.
    container.addEventListener("mousedown", (event) => event.preventDefault());
    container.addEventListener("dragstart", (event) => event.preventDefault());
    container.addEventListener("pointerdown", this.onPointerDown);
    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerup", this.onPointerUp);
    container.addEventListener("pointercancel", this.onPointerUp);
    container.addEventListener("pointerleave", this.onPointerUp);
  }

  /** Reflect a note held from any source. */
  setHeld(note: number, held: boolean): void {
    this.keys.get(note)?.classList.toggle("held", held);
  }

  private noteAt(event: PointerEvent): number | null {
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const raw = el?.closest<HTMLElement>(".key")?.dataset.note;
    return raw === undefined ? null : Number(raw);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const note = this.noteAt(event);
    if (note === null) return;
    this.container.setPointerCapture(event.pointerId);
    this.activePointerNote = note;
    this.handlers.noteOn(note, velocityFromY(event, this.keys.get(note)));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.activePointerNote === null) return;
    const note = this.noteAt(event);
    if (note === null || note === this.activePointerNote) return;
    // Glissando: sliding across keys plays them legato.
    this.handlers.noteOn(note, 100);
    this.handlers.noteOff(this.activePointerNote);
    this.activePointerNote = note;
  };

  private readonly onPointerUp = (): void => {
    if (this.activePointerNote === null) return;
    this.handlers.noteOff(this.activePointerNote);
    this.activePointerNote = null;
  };

  get lowestNote(): number {
    return this.baseNote;
  }
}

/** Lower on the key is louder, like a real keyboard's velocity feel. */
function velocityFromY(event: PointerEvent, key: HTMLElement | undefined): number {
  if (!key) return 100;
  const rect = key.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  return Math.round(40 + frac * 87);
}
