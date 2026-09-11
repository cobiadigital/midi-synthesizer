import { paramFromNorm, paramToNorm } from "../dsp/params";
import { CONTROL_STYLES, ControlElement } from "./control";

/**
 * `<synth-knob>`: a rotary control bound to one ParamDef.
 *
 * Drag vertically to change, hold Shift for fine control, double-click to
 * reset to default. Discrete params (with `step`) snap and show their choice
 * label. Emits a `change` CustomEvent with `{ id, value }`.
 *
 * It also carries its MIDI assignment: a faint outer tick showing where a
 * physical dial is sitting while it waits to pick the knob up, and, in learn
 * mode, the CC number it answers to. In learn mode a press selects the knob
 * instead of dragging it, and emits `learn` rather than `change`.
 */
export class SynthKnob extends ControlElement {
  static readonly tag = "synth-knob";

  private dragStartY = 0;
  private dragStartNorm = 0;
  private lastTapAt = 0;

  private readonly indicator: SVGLineElement;
  private readonly arc: SVGPathElement;
  private readonly readout: HTMLSpanElement;
  private readonly pot: SVGLineElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ${CONTROL_STYLES}
        :host { cursor: ns-resize; }
        svg { width: var(--knob-size, 52px); height: var(--knob-size, 52px); }
        .track { fill: none; stroke: var(--knob-track, #333); stroke-width: 4; stroke-linecap: round; }
        .arc { fill: none; stroke: var(--knob-arc, #f5a623); stroke-width: 4; stroke-linecap: round; }
        .cap { fill: var(--knob-cap, #1c1c1c); stroke: var(--knob-rim, #555); stroke-width: 1; }
        .indicator { stroke: var(--knob-indicator, #eee); stroke-width: 3; stroke-linecap: round; }
        .readout { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--knob-readout, #f5a623); min-height: 1.2em; }
        /* Where the physical dial is sitting, while it waits to reach the
           value and take over. Hidden the rest of the time. */
        .pot { stroke: var(--knob-pot, #6ba4ff); stroke-width: 2.5; stroke-linecap: round; }
        .pot[hidden] { display: none; }
        :host(.learn) .cap { stroke: var(--knob-pot, #6ba4ff); }
        :host(.armed) .cap { fill: #21323f; stroke: var(--knob-pot, #6ba4ff); stroke-width: 2; }
      </style>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <path class="track" d=""></path>
        <path class="arc" d=""></path>
        <circle class="cap" cx="26" cy="26" r="16"></circle>
        <line class="pot" x1="26" y1="1" x2="26" y2="7" hidden></line>
        <line class="indicator" x1="26" y1="26" x2="26" y2="13"></line>
      </svg>
      <span class="label"></span>
      <span class="readout"></span>
      <span class="midi" hidden></span>
    `;
    this.indicator = root.querySelector(".indicator") as SVGLineElement;
    this.arc = root.querySelector(".arc") as SVGPathElement;
    this.readout = root.querySelector(".readout") as HTMLSpanElement;
    this.pot = root.querySelector(".pot") as SVGLineElement;
    (root.querySelector(".track") as SVGPathElement).setAttribute("d", describeArc(0, 1));

    this.addEventListener("pointerdown", this.onPointerDown);
    this.addEventListener("dblclick", () => {
      if (!this.learning) this.commit(this.def.default);
    });
    this.addEventListener("wheel", this.onWheel, { passive: false });
    // A mouse drag starting here would otherwise anchor a document selection
    // and sweep the surrounding panel text as the pointer moves. Cancelling
    // mousedown suppresses that (and the native image drag) while leaving
    // click and dblclick intact; focus has to be taken by hand as a result.
    this.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.focus();
    });
    this.addEventListener("dragstart", (event) => event.preventDefault());
    // See keyboard.ts: on iOS the long-press selection comes off the touch
    // stream regardless of user-select, so the gesture has to be cancelled
    // here. This also costs the synthesized dblclick, which onPointerDown
    // replaces with its own double-tap check.
    this.addEventListener("touchstart", (event) => event.preventDefault(), { passive: false });
  }

  protected onBind(): void {
    (this.shadowRoot!.querySelector(".label") as HTMLSpanElement).textContent = this.def.label;
    this.setAttribute("role", "slider");
    this.setAttribute("aria-label", this.def.label);
    this.setAttribute("aria-valuemin", String(this.def.min));
    this.setAttribute("aria-valuemax", String(this.def.max));
    this.tabIndex = 0;
  }

  /**
   * Show where a physical dial is sitting, 0..1, or null once it has taken the
   * knob over and the two agree.
   */
  setPot(norm: number | null): void {
    // SVG elements have no `hidden` property, so the attribute and a rule in
    // the shadow stylesheet do the work.
    if (norm === null) {
      this.pot.toggleAttribute("hidden", true);
      return;
    }
    this.pot.toggleAttribute("hidden", false);
    this.pot.setAttribute("transform", `rotate(${-135 + Math.min(1, Math.max(0, norm)) * 270} 26 26)`);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.claimForLearn()) return;
    // Touch gets its own double-tap reset because cancelling touchstart above
    // stops Safari from synthesizing the dblclick the mouse path relies on.
    if (event.pointerType !== "mouse") {
      const doubleTap = event.timeStamp - this.lastTapAt < 300;
      this.lastTapAt = doubleTap ? 0 : event.timeStamp;
      if (doubleTap) {
        this.commit(this.def.default);
        return;
      }
    }
    this.setPointerCapture(event.pointerId);
    this.dragStartY = event.clientY;
    this.dragStartNorm = paramToNorm(this.def, this._value);
    // Belt and braces for pen and touch, where mousedown never fires.
    document.body.classList.add("dragging");
    const move = (e: PointerEvent) => {
      const pixelsForFullRange = e.shiftKey ? 1200 : 200;
      const delta = (this.dragStartY - e.clientY) / pixelsForFullRange;
      this.commit(paramFromNorm(this.def, this.dragStartNorm + delta));
    };
    const up = () => {
      document.body.classList.remove("dragging");
      this.removeEventListener("pointermove", move);
      this.removeEventListener("pointerup", up);
      this.removeEventListener("pointercancel", up);
    };
    this.addEventListener("pointermove", move);
    this.addEventListener("pointerup", up);
    this.addEventListener("pointercancel", up);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.learning) return;
    const stepNorm = this.def.step ? this.def.step / (this.def.max - this.def.min) : 0.02;
    const direction = event.deltaY < 0 ? 1 : -1;
    this.commit(paramFromNorm(this.def, paramToNorm(this.def, this._value) + direction * stepNorm));
  };

  protected draw(): void {
    const norm = paramToNorm(this.def, this._value);
    const angle = -135 + norm * 270;
    this.indicator.setAttribute("transform", `rotate(${angle} 26 26)`);
    this.arc.setAttribute("d", describeArc(0, norm));
    this.readout.textContent = this.format();
    this.setAttribute("aria-valuenow", String(this._value));
  }

  private format(): string {
    const { choices, unit, step } = this.def;
    if (choices || step) return this.choiceLabel(this._value);
    const v = this._value;
    const text = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    return unit ? `${text} ${unit}` : text;
  }
}

/** SVG arc path along the knob's 270 degree sweep from `from` to `to` (both 0..1). */
function describeArc(from: number, to: number): string {
  const r = 22;
  const start = polar(-135 + from * 270, r);
  const end = polar(-135 + to * 270, r);
  const largeArc = (to - from) * 270 > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: 26 + r * Math.cos(a), y: 26 + r * Math.sin(a) };
}

if (!customElements.get(SynthKnob.tag)) customElements.define(SynthKnob.tag, SynthKnob);
