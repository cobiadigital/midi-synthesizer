import { snapParam, type ParamDef, type ParamId } from "../dsp/params";

/**
 * Base for every panel control, whatever it looks like.
 *
 * The panel treats a switch exactly like a knob: it binds one `ParamDef`,
 * reports changes as a `change` CustomEvent of `{ id, value }`, and carries
 * the same MIDI feedback. That matters because `CcMap` binds by `ParamId`,
 * not by widget, so an arpeggiator switch has to be learnable and has to
 * honour soft takeover the same way a cutoff knob does.
 *
 * Subclasses build their own shadow tree in their constructor, fill in
 * `onBind()` once the def is known, and redraw in `draw()`. ARIA belongs to
 * the subclass too: a slider and a switch describe themselves differently.
 */
export abstract class ControlElement extends HTMLElement {
  protected def!: ParamDef;
  protected _value = 0;
  protected learning = false;

  bind(def: ParamDef, value: number): void {
    this.def = def;
    this.onBind();
    this.value = value;
  }

  get value(): number {
    return this._value;
  }

  /** Set the displayed value without emitting a change event. */
  set value(v: number) {
    this._value = snapParam(this.def, v);
    this.draw();
  }

  get paramId(): ParamId {
    return this.def.id;
  }

  /** In learn mode a press selects the control rather than editing it. */
  set learnMode(on: boolean) {
    this.learning = on;
    this.classList.toggle("learn", on);
    if (!on) this.armed = false;
  }

  set armed(on: boolean) {
    this.classList.toggle("armed", on);
  }

  /** The CC number this control answers to, shown while learn mode is on. */
  setMidiLabel(text: string | null): void {
    const el = this.shadowRoot?.querySelector(".midi") as HTMLElement | null;
    if (!el) return;
    el.textContent = text ?? "";
    el.hidden = text === null;
  }

  /**
   * Where a physical dial is sitting, 0..1, while it waits to reach the value
   * on screen and take the control over; null once the two agree.
   */
  abstract setPot(norm: number | null): void;

  /** Called once the def is bound, before the first draw. */
  protected abstract onBind(): void;

  protected abstract draw(): void;

  protected commit(v: number): void {
    const snapped = snapParam(this.def, v);
    if (snapped === this._value) return;
    this.value = snapped;
    this.dispatchEvent(new CustomEvent("change", { detail: { id: this.def.id, value: snapped }, bubbles: true }));
  }

  /**
   * Swallow a gesture while learning and ask to be assigned instead. Every
   * press path calls this first.
   */
  protected claimForLearn(): boolean {
    if (!this.learning) return false;
    this.dispatchEvent(new CustomEvent("learn", { detail: { id: this.def.id }, bubbles: true }));
    return true;
  }

  /** The label for a discrete value, or the number if the param has no names. */
  protected choiceLabel(value: number): string {
    return this.def.choices?.[Math.round(value - this.def.min)] ?? String(value);
  }
}

/**
 * Shared shadow styles. Controls line up in a row with the knobs, so they
 * share its column width, its label type and its learn-mode colours.
 *
 * The `[hidden]` rule is load-bearing: `:host` sets a display, and an author
 * rule on the host beats the UA stylesheet's `[hidden] { display: none }`, so
 * hiding a control needs saying again here.
 */
export const CONTROL_STYLES = `
  /* Document styles do not reach inside a shadow root, so the gesture
     defences the panel relies on have to be restated here. They inherit from
     the host into the tree; UA styles on <button> do not, hence the rule
     below. The width is a custom property so the page can run the transport
     strip a size smaller than the panel on a phone. */
  :host { display: inline-flex; flex-direction: column; align-items: center; gap: 4px;
          width: var(--control-width, 72px); font: inherit; touch-action: none;
          -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
          -webkit-tap-highlight-color: transparent; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0;
           cursor: pointer; -webkit-user-select: none; user-select: none;
           -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  :host([hidden]) { display: none; }
  /* The value line. Every control carries one, empty if it has nothing to
     say, so that a switch and a knob side by side put their labels on the
     same line. */
  .readout, .state { font-size: 11px; min-height: 1.2em; color: var(--knob-readout, #f5a623); }
  .label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--knob-label, #bbb); }
  .midi { font-size: 10px; letter-spacing: 0.04em; color: var(--knob-pot, #6ba4ff); min-height: 1.1em; }
  .midi[hidden] { display: none; }
  :host(.learn) { cursor: pointer; }
  /* A dial that has not picked this control up yet. There is no rim to put a
     tick on, so the marker is a dot beside the label. */
  .waiting { display: none; width: 6px; height: 6px; border-radius: 50%;
             background: var(--knob-pot, #6ba4ff); }
  :host(.waiting-pot) .waiting { display: block; }
`;
