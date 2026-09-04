import type { ParamDef } from "../dsp/params";

/**
 * `<synth-knob>`: a rotary control bound to one ParamDef.
 *
 * Drag vertically to change, hold Shift for fine control, double-click to
 * reset to default. Discrete params (with `step`) snap and show their choice
 * label. Emits a `change` CustomEvent with `{ id, value }`.
 */
export class SynthKnob extends HTMLElement {
  static readonly tag = "synth-knob";

  private def!: ParamDef;
  private _value = 0;
  private dragStartY = 0;
  private dragStartNorm = 0;
  private lastTapAt = 0;

  private readonly indicator: SVGLineElement;
  private readonly arc: SVGPathElement;
  private readonly readout: HTMLSpanElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: inline-flex; flex-direction: column; align-items: center; gap: 4px;
                width: 72px; user-select: none; touch-action: none; cursor: ns-resize; font: inherit; }
        svg { width: 52px; height: 52px; }
        .track { fill: none; stroke: var(--knob-track, #333); stroke-width: 4; stroke-linecap: round; }
        .arc { fill: none; stroke: var(--knob-arc, #f5a623); stroke-width: 4; stroke-linecap: round; }
        .cap { fill: var(--knob-cap, #1c1c1c); stroke: var(--knob-rim, #555); stroke-width: 1; }
        .indicator { stroke: var(--knob-indicator, #eee); stroke-width: 3; stroke-linecap: round; }
        .label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--knob-label, #bbb); }
        .readout { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--knob-readout, #f5a623); min-height: 1.2em; }
      </style>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <path class="track" d=""></path>
        <path class="arc" d=""></path>
        <circle class="cap" cx="26" cy="26" r="16"></circle>
        <line class="indicator" x1="26" y1="26" x2="26" y2="13"></line>
      </svg>
      <span class="label"></span>
      <span class="readout"></span>
    `;
    this.indicator = root.querySelector(".indicator") as SVGLineElement;
    this.arc = root.querySelector(".arc") as SVGPathElement;
    this.readout = root.querySelector(".readout") as HTMLSpanElement;
    (root.querySelector(".track") as SVGPathElement).setAttribute("d", describeArc(0, 1));

    this.addEventListener("pointerdown", this.onPointerDown);
    this.addEventListener("dblclick", () => this.commit(this.def.default));
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

  bind(def: ParamDef, value: number): void {
    this.def = def;
    (this.shadowRoot!.querySelector(".label") as HTMLSpanElement).textContent = def.label;
    this.setAttribute("role", "slider");
    this.setAttribute("aria-label", def.label);
    this.setAttribute("aria-valuemin", String(def.min));
    this.setAttribute("aria-valuemax", String(def.max));
    this.tabIndex = 0;
    this.value = value;
  }

  get value(): number {
    return this._value;
  }

  /** Set the displayed value without emitting a change event. */
  set value(v: number) {
    this._value = this.snap(v);
    this.setAttribute("aria-valuenow", String(this._value));
    this.draw();
  }

  private commit(v: number): void {
    const snapped = this.snap(v);
    if (snapped === this._value) return;
    this.value = snapped;
    this.dispatchEvent(new CustomEvent("change", { detail: { id: this.def.id, value: snapped }, bubbles: true }));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
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
    this.dragStartNorm = this.toNorm(this._value);
    // Belt and braces for pen and touch, where mousedown never fires.
    document.body.classList.add("dragging");
    const move = (e: PointerEvent) => {
      const pixelsForFullRange = e.shiftKey ? 1200 : 200;
      const delta = (this.dragStartY - e.clientY) / pixelsForFullRange;
      this.commit(this.fromNorm(this.dragStartNorm + delta));
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
    const stepNorm = this.def.step ? this.def.step / (this.def.max - this.def.min) : 0.02;
    const direction = event.deltaY < 0 ? 1 : -1;
    this.commit(this.fromNorm(this.toNorm(this._value) + direction * stepNorm));
  };

  private snap(v: number): number {
    const { min, max, step } = this.def;
    let out = Math.min(max, Math.max(min, v));
    if (step) out = min + Math.round((out - min) / step) * step;
    return out;
  }

  /** Map a param value to 0..1 knob position, honoring the taper. */
  private toNorm(v: number): number {
    const { min, max, taper } = this.def;
    if (taper === "log" && min > 0) return Math.log(v / min) / Math.log(max / min);
    return (v - min) / (max - min);
  }

  private fromNorm(n: number): number {
    const { min, max, taper } = this.def;
    const clamped = Math.min(1, Math.max(0, n));
    if (taper === "log" && min > 0) return min * Math.pow(max / min, clamped);
    return min + clamped * (max - min);
  }

  private draw(): void {
    const norm = this.toNorm(this._value);
    const angle = -135 + norm * 270;
    this.indicator.setAttribute("transform", `rotate(${angle} 26 26)`);
    this.arc.setAttribute("d", describeArc(0, norm));
    this.readout.textContent = this.format();
  }

  private format(): string {
    const { choices, min, unit, step } = this.def;
    if (choices) return choices[Math.round(this._value - min)] ?? String(this._value);
    if (step) return String(this._value);
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
