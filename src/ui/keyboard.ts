/**
 * On-screen piano keyboard. Two octaves, pointer-driven, with a note-held
 * highlight that other input sources (MIDI, computer keys) can also drive.
 *
 * Every pointer is tracked separately, so a chord can be played with several
 * fingers on a touch screen and each finger can slide across keys on its own.
 */

export interface ScreenKeyboardHandlers {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export class ScreenKeyboard {
  private readonly keys = new Map<number, HTMLElement>();
  private baseNote: number;
  /** Note each active pointer is currently holding, keyed by pointerId. */
  private readonly pointerNotes = new Map<number, number>();

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
    // iOS decides to start a selection from the touch stream, not from the
    // pointer events, and does so even where user-select is none. Cancelling
    // touchstart is what actually stops the long-press callout. Safari has
    // already dispatched pointerdown by this point, so the note still sounds;
    // nothing here needs the synthesized click.
    container.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
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

  /**
   * Reflect a note the arpeggiator is playing. Kept separate from `held` so a
   * key that is physically down still reads as held once the step passes, and
   * so notes the arpeggiator transposes off the end of the keyboard are simply
   * ignored.
   */
  setArpNote(note: number, on: boolean): void {
    this.keys.get(note)?.classList.toggle("arp", on);
  }

  clearArpNotes(): void {
    for (const key of this.keys.values()) key.classList.remove("arp");
  }

  private noteAt(event: PointerEvent): number | null {
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const raw = el?.closest<HTMLElement>(".key")?.dataset.note;
    return raw === undefined ? null : Number(raw);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const note = this.noteAt(event);
    if (note === null) return;
    // Capture per pointer, not per element: several fingers can be captured on
    // the same keyboard at once, and each keeps getting its own moves.
    this.container.setPointerCapture(event.pointerId);
    this.pointerNotes.set(event.pointerId, note);
    this.handlers.noteOn(note, velocityFromY(event, this.keys.get(note)));
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const held = this.pointerNotes.get(event.pointerId);
    if (held === undefined) return;
    const note = this.noteAt(event);
    if (note === null || note === held) return;
    // Glissando: sliding across keys plays them legato.
    this.handlers.noteOn(note, 100);
    this.handlers.noteOff(held);
    this.pointerNotes.set(event.pointerId, note);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const held = this.pointerNotes.get(event.pointerId);
    if (held === undefined) return;
    this.pointerNotes.delete(event.pointerId);
    this.handlers.noteOff(held);
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
