import { paramFromNorm } from "../dsp/params";
import { CONTROL_STYLES, ControlElement } from "./control";

/**
 * `<synth-switch>`: a two-state param as one tap.
 *
 * A knob needs 200 pixels of vertical drag to cross its range, which is an
 * absurd way to turn the arpeggiator on. Anything with two states gets this
 * instead.
 */
export class SynthSwitch extends ControlElement {
  static readonly tag = "synth-switch";

  private readonly track: HTMLElement;
  private readonly state: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ${CONTROL_STYLES}
        .track { width: 44px; height: 24px; border-radius: 12px; background: var(--knob-track, #333);
                 border: 1px solid var(--knob-rim, #555); position: relative;
                 transition: background 120ms ease-out; }
        .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
                 background: var(--knob-indicator, #eee); transition: transform 120ms ease-out; }
        :host(.on) .track { background: var(--knob-arc, #f5a623); border-color: var(--knob-arc, #f5a623); }
        :host(.on) .thumb { transform: translateX(20px); background: #111; }
        .state { letter-spacing: 0.04em; text-transform: uppercase; }
        :host(.armed) .track { outline: 2px solid var(--knob-pot, #6ba4ff); outline-offset: 2px; }
        :host(.learn) .track { border-color: var(--knob-pot, #6ba4ff); }
      </style>
      <button class="track" type="button" part="track"><span class="thumb"></span></button>
      <span class="label"></span>
      <span class="state"></span>
      <span class="waiting"></span>
      <span class="midi" hidden></span>
    `;
    this.track = root.querySelector(".track") as HTMLElement;
    this.state = root.querySelector(".state") as HTMLElement;
    this.track.addEventListener("click", () => {
      if (this.claimForLearn()) return;
      this.commit(this._value >= this.midpoint() ? this.def.min : this.def.max);
    });
  }

  protected onBind(): void {
    (this.shadowRoot!.querySelector(".label") as HTMLElement).textContent = this.def.label;
    this.track.setAttribute("role", "switch");
    this.track.setAttribute("aria-label", this.def.label);
  }

  protected draw(): void {
    const on = this._value >= this.midpoint();
    this.classList.toggle("on", on);
    this.track.setAttribute("aria-checked", String(on));
    this.state.textContent = this.choiceLabel(this._value);
  }

  setPot(norm: number | null): void {
    this.classList.toggle("waiting-pot", norm !== null);
  }

  private midpoint(): number {
    return (this.def.min + this.def.max) / 2;
  }
}

/**
 * `<synth-select>`: a short list of named choices as a segmented row.
 *
 * Every option is visible, which is the point: a waveform or an arpeggiator
 * mode is a name, and reading it off a knob means dragging blind until the
 * right word appears. Wraps to a second line rather than widening the panel,
 * so the six arpeggiator modes fit a phone.
 */
export class SynthSelect extends ControlElement {
  static readonly tag = "synth-select";

  private readonly options: HTMLElement;
  private buttons: HTMLButtonElement[] = [];

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ${CONTROL_STYLES}
        :host { width: auto; min-width: 72px; }
        /* Left aligned, so a segmented row starts where the knobs beside it
           do rather than floating in the middle of the card. */
        .options { display: flex; flex-wrap: wrap; gap: 2px; justify-content: flex-start; }
        :host { align-items: flex-start; }
        .option { font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase;
                  padding: 6px 7px; min-height: 26px; border-radius: 3px;
                  border: 1px solid var(--knob-rim, #555); color: var(--knob-label, #bbb);
                  background: var(--knob-cap, #1c1c1c); }
        .option[aria-checked="true"] { background: var(--knob-arc, #f5a623); border-color: var(--knob-arc, #f5a623); color: #111; }
        /* Where a dial is pointing while it waits to take the control over. */
        .option.pot { box-shadow: inset 0 0 0 2px var(--knob-pot, #6ba4ff); }
        :host(.armed) .options { outline: 2px solid var(--knob-pot, #6ba4ff); outline-offset: 2px; border-radius: 4px; }
        :host(.learn) .option { border-color: var(--knob-pot, #6ba4ff); }
      </style>
      <div class="options"></div>
      <span class="label"></span>
      <span class="state"></span>
      <span class="waiting"></span>
      <span class="midi" hidden></span>
    `;
    this.options = root.querySelector(".options") as HTMLElement;
  }

  protected onBind(): void {
    (this.shadowRoot!.querySelector(".label") as HTMLElement).textContent = this.def.label;
    this.setAttribute("role", "radiogroup");
    this.setAttribute("aria-label", this.def.label);
    const step = this.def.step ?? 1;
    this.buttons = [];
    this.options.replaceChildren();
    for (let v = this.def.min; v <= this.def.max; v += step) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.setAttribute("role", "radio");
      button.textContent = this.choiceLabel(v);
      const value = v;
      button.addEventListener("click", () => {
        if (this.claimForLearn()) return;
        this.commit(value);
      });
      this.options.appendChild(button);
      this.buttons.push(button);
    }
    // A row of words (waveforms, arpeggiator modes) takes a line of its own
    // rather than wrapping raggedly around the knobs beside it. A row of
    // numbers is short enough to sit among them.
    const characters = this.buttons.reduce((sum, b) => sum + (b.textContent?.length ?? 0), 0);
    this.classList.toggle("wide", characters > 12);
  }

  protected draw(): void {
    const index = Math.round((this._value - this.def.min) / (this.def.step ?? 1));
    this.buttons.forEach((button, i) => button.setAttribute("aria-checked", String(i === index)));
  }

  /** Mark the option the dial is currently pointing at, not just that it waits. */
  setPot(norm: number | null): void {
    this.classList.toggle("waiting-pot", norm !== null);
    const index =
      norm === null ? -1 : Math.round((paramFromNorm(this.def, norm) - this.def.min) / (this.def.step ?? 1));
    this.buttons.forEach((button, i) => button.classList.toggle("pot", i === index));
  }
}

/**
 * `<synth-stepper>`: a small integer count as minus and plus.
 *
 * For the voice count, where the exact number matters and there are only seven
 * of them. A knob reads it out but takes a careful drag to land on one.
 */
export class SynthStepper extends ControlElement {
  static readonly tag = "synth-stepper";

  private readonly readout: HTMLElement;
  private readonly down: HTMLButtonElement;
  private readonly up: HTMLButtonElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ${CONTROL_STYLES}
        .row { display: flex; align-items: center; gap: 2px; }
        .step { width: 24px; height: 26px; border-radius: 3px; font-size: 14px; line-height: 1;
                border: 1px solid var(--knob-rim, #555); background: var(--knob-cap, #1c1c1c);
                color: var(--knob-label, #bbb); }
        .step:disabled { opacity: 0.35; cursor: default; }
        .readout { font-size: 13px; font-variant-numeric: tabular-nums; min-width: 22px; text-align: center;
                   color: var(--knob-readout, #f5a623); }
        :host(.armed) .row { outline: 2px solid var(--knob-pot, #6ba4ff); outline-offset: 2px; border-radius: 4px; }
        :host(.learn) .step { border-color: var(--knob-pot, #6ba4ff); }
      </style>
      <div class="row">
        <button class="step down" type="button">&minus;</button>
        <span class="readout"></span>
        <button class="step up" type="button">+</button>
      </div>
      <span class="label"></span>
      <span class="state"></span>
      <span class="waiting"></span>
      <span class="midi" hidden></span>
    `;
    this.readout = root.querySelector(".readout") as HTMLElement;
    this.down = root.querySelector(".down") as HTMLButtonElement;
    this.up = root.querySelector(".up") as HTMLButtonElement;
    this.down.addEventListener("click", () => this.nudge(-1));
    this.up.addEventListener("click", () => this.nudge(1));
  }

  protected onBind(): void {
    (this.shadowRoot!.querySelector(".label") as HTMLElement).textContent = this.def.label;
    this.setAttribute("role", "spinbutton");
    this.setAttribute("aria-label", this.def.label);
    this.setAttribute("aria-valuemin", String(this.def.min));
    this.setAttribute("aria-valuemax", String(this.def.max));
    this.down.setAttribute("aria-label", `${this.def.label} down`);
    this.up.setAttribute("aria-label", `${this.def.label} up`);
  }

  protected draw(): void {
    this.readout.textContent = this.choiceLabel(this._value);
    this.setAttribute("aria-valuenow", String(this._value));
    this.down.disabled = this._value <= this.def.min;
    this.up.disabled = this._value >= this.def.max;
  }

  setPot(norm: number | null): void {
    this.classList.toggle("waiting-pot", norm !== null);
  }

  private nudge(direction: number): void {
    if (this.claimForLearn()) return;
    this.commit(this._value + direction * (this.def.step ?? 1));
  }
}

for (const cls of [SynthSwitch, SynthSelect, SynthStepper]) {
  if (!customElements.get(cls.tag)) customElements.define(cls.tag, cls);
}
